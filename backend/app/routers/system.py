from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import platform
import re
import shutil
import sys
import tempfile
import threading

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..config import settings
from ..database import get_db
from ..executor import CommandResult, Executor, ExecutorError
from ..models import Deployment, Project
from ..schemas import CommandResultOut, SelfUpdateRequest, SelfUpdateResultOut, SystemInfoOut, SystemServiceStatusOut

router = APIRouter(prefix="/api/v1/system", tags=["system"], dependencies=[Depends(require_admin)])
executor = Executor()
update_lock = threading.Lock()
update_state_lock = threading.Lock()
update_state: dict[str, str] = {"status": "idle", "message": "", "branch": ""}
BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")
SERVICE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.@-]+$")
CHECKOUT_CONFLICT_MARKERS = (
    "would be overwritten by checkout",
    "please move or remove them before you switch branches",
)
PROTECTED_FILES_FOR_CLEAN = (
    Path("backend/.env"),
    Path("backend/stackdeployer.db"),
)


def _as_out(result: CommandResult) -> CommandResultOut:
    return CommandResultOut(
        command=result.command,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )


def _backup_protected_files(repo_root: Path) -> dict[Path, Path]:
    backups: dict[Path, Path] = {}
    for rel_path in PROTECTED_FILES_FOR_CLEAN:
        source = repo_root / rel_path
        if not source.exists() or not source.is_file():
            continue

        temp_file = tempfile.NamedTemporaryFile(prefix="stackdeployer-selfupdate-", delete=False)
        temp_file.close()
        backup_path = Path(temp_file.name)
        shutil.copy2(source, backup_path)
        backups[source] = backup_path
    return backups


def _restore_protected_files(backups: dict[Path, Path]) -> None:
    for source, backup in backups.items():
        try:
            source.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup, source)
        finally:
            backup.unlink(missing_ok=True)


def _is_checkout_conflict_error(exc: ExecutorError) -> bool:
    message = str(exc).lower()
    return any(marker in message for marker in CHECKOUT_CONFLICT_MARKERS)


def _set_update_state(**fields: str) -> None:
    with update_state_lock:
        update_state.update(fields)


def _run_self_update_job(
    repo_root: Path,
    branch: str,
    service_name: str,
    payload: SelfUpdateRequest,
) -> None:
    try:
        steps: list[CommandResultOut] = []

        fetch_result = executor.run(["git", "fetch", "origin"], cwd=repo_root)
        executor._ensure_success(fetch_result, "git fetch failed")
        steps.append(_as_out(fetch_result))

        try:
            checkout_result = executor.run(["git", "checkout", branch], cwd=repo_root)
            executor._ensure_success(checkout_result, f"git checkout {branch} failed")
            steps.append(_as_out(checkout_result))
        except ExecutorError as exc:
            if not _is_checkout_conflict_error(exc):
                raise

            backups = _backup_protected_files(repo_root)
            try:
                clean_result = executor.run(["git", "clean", "-fd"], cwd=repo_root)
                executor._ensure_success(clean_result, "git clean -fd failed")
                steps.append(_as_out(clean_result))

                checkout_force_result = executor.run(["git", "checkout", "-B", branch, f"origin/{branch}"], cwd=repo_root)
                executor._ensure_success(checkout_force_result, f"git checkout -B {branch} origin/{branch} failed")
                steps.append(_as_out(checkout_force_result))
            finally:
                _restore_protected_files(backups)

        pull_result = executor.run(["git", "pull", "--ff-only", "origin", branch], cwd=repo_root)
        executor._ensure_success(pull_result, f"git pull origin {branch} failed")
        steps.append(_as_out(pull_result))

        backend_root = repo_root / "backend"
        venv_bin = backend_root / ".venv" / "bin"
        pip_binary = venv_bin / "pip"
        alembic_binary = venv_bin / "alembic"

        if payload.install_backend_dependencies and backend_root.exists() and pip_binary.exists() and (backend_root / "requirements.txt").exists():
            pip_result = executor.run([str(pip_binary), "install", "-r", "requirements.txt"], cwd=backend_root)
            executor._ensure_success(pip_result, "backend dependency install failed")
            steps.append(_as_out(pip_result))

        if payload.run_migrations and backend_root.exists() and alembic_binary.exists():
            migration_result = executor.run([str(alembic_binary), "upgrade", "head"], cwd=backend_root)
            executor._ensure_success(migration_result, "migration failed")
            steps.append(_as_out(migration_result))

        frontend_root = repo_root / "frontend"
        if payload.rebuild_frontend and frontend_root.exists() and (frontend_root / "package.json").exists():
            npm_install_result = executor.run(["npm", "install"], cwd=frontend_root)
            executor._ensure_success(npm_install_result, "frontend npm install failed")
            steps.append(_as_out(npm_install_result))

            npm_build_result = executor.run(["npm", "run", "build"], cwd=frontend_root)
            executor._ensure_success(npm_build_result, "frontend build failed")
            steps.append(_as_out(npm_build_result))

        _set_update_state(
            status="done",
            message=(
                "Self update completed. If backend code changed, restart the service to apply runtime changes "
                f"(suggested: systemctl restart {service_name})."
            ),
            branch=branch,
        )
    except Exception as exc:  # noqa: BLE001
        _set_update_state(status="failed", message=str(exc), branch=branch)
    finally:
        update_lock.release()


def _probe_pm2() -> SystemServiceStatusOut:
    try:
        result = executor.pm2_status()
        return SystemServiceStatusOut(name="pm2", ok=result.returncode == 0, detail="reachable")
    except Exception as exc:  # noqa: BLE001
        return SystemServiceStatusOut(name="pm2", ok=False, detail=str(exc))


def _probe_nginx() -> SystemServiceStatusOut:
    try:
        result = executor.run(["nginx", "-t"])
        ok = result.returncode == 0
        detail = (result.stdout.strip() or result.stderr.strip() or ("ok" if ok else "failed"))
        return SystemServiceStatusOut(name="nginx", ok=ok, detail=detail[:240])
    except Exception as exc:  # noqa: BLE001
        return SystemServiceStatusOut(name="nginx", ok=False, detail=str(exc)[:240])


def _probe_database(db: Session) -> SystemServiceStatusOut:
    try:
        _ = db.execute(select(func.count(Project.id))).scalar_one()
        return SystemServiceStatusOut(name="database", ok=True, detail="reachable")
    except Exception as exc:  # noqa: BLE001
        return SystemServiceStatusOut(name="database", ok=False, detail=str(exc)[:240])


@router.get("/info", response_model=SystemInfoOut)
def system_info(db: Session = Depends(get_db)) -> SystemInfoOut:
    disk_path = Path(settings.self_update_repo_root)
    if not disk_path.exists():
        disk_path = Path.cwd()

    disk_total, disk_used, disk_free = shutil.disk_usage(disk_path)

    project_total = db.execute(select(func.count(Project.id))).scalar_one()
    project_running = db.execute(select(func.count(Project.id)).where(Project.status == "running")).scalar_one()
    project_error = db.execute(select(func.count(Project.id)).where(Project.status == "error")).scalar_one()
    deployment_total = db.execute(select(func.count(Deployment.id))).scalar_one()

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    deployment_last_24h = db.execute(
        select(func.count(Deployment.id)).where(Deployment.started_at >= since)
    ).scalar_one()

    services = [_probe_database(db)]
    services.append(_probe_pm2())
    services.append(_probe_nginx())

    return SystemInfoOut(
        app_name=settings.app_name,
        environment=settings.app_env,
        host=platform.node() or os.getenv("HOSTNAME", "unknown"),
        platform=f"{platform.system()} {platform.release()}",
        python_version=sys.version.split(" ", 1)[0],
        disk_total_bytes=disk_total,
        disk_used_bytes=disk_used,
        disk_free_bytes=disk_free,
        project_total=project_total,
        project_running=project_running,
        project_error=project_error,
        deployment_total=deployment_total,
        deployment_last_24h=deployment_last_24h,
        services=services,
    )


@router.post("/self-update", response_model=SelfUpdateResultOut)
def run_self_update(payload: SelfUpdateRequest) -> SelfUpdateResultOut:
    if not settings.self_update_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Self update is disabled")

    if not update_lock.acquire(blocking=False):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Another self update is already running")

    worker_started = False
    try:
        repo_root = Path(settings.self_update_repo_root)
        if not repo_root.is_absolute():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="self_update_repo_root must be an absolute path",
            )

        if not repo_root.exists() or not repo_root.is_dir():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="self_update_repo_root does not exist or is not a directory",
            )

        if not (repo_root / ".git").exists():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="self_update_repo_root is not a git repository",
            )

        branch = (payload.branch or settings.self_update_default_branch).strip()
        if not BRANCH_PATTERN.match(branch):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid git branch name")

        service_name = settings.self_update_service_name.strip()
        if service_name and not SERVICE_NAME_PATTERN.match(service_name):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid service name")

        _set_update_state(status="running", message="Self update started", branch=branch)
        worker = threading.Thread(
            target=_run_self_update_job,
            args=(repo_root, branch, service_name, payload),
            daemon=True,
        )
        worker.start()
        worker_started = True

        return SelfUpdateResultOut(
            status="accepted",
            message=(
                "Self update started in the background. Refresh after a minute and restart the service if needed "
                f"(suggested: systemctl restart {service_name})."
            ),
            branch=branch,
            restart_required=True,
            steps=[],
        )
    except ExecutorError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    finally:
        if not worker_started and update_lock.locked():
            update_lock.release()
