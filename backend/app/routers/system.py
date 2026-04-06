from __future__ import annotations

from pathlib import Path
import re
import threading

from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import require_admin
from ..config import settings
from ..executor import CommandResult, Executor, ExecutorError
from ..schemas import CommandResultOut, SelfUpdateRequest, SelfUpdateResultOut

router = APIRouter(prefix="/api/v1/system", tags=["system"], dependencies=[Depends(require_admin)])
executor = Executor()
update_lock = threading.Lock()
BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")
SERVICE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9_.@-]+$")


def _as_out(result: CommandResult) -> CommandResultOut:
    return CommandResultOut(
        command=result.command,
        returncode=result.returncode,
        stdout=result.stdout,
        stderr=result.stderr,
    )


@router.post("/self-update", response_model=SelfUpdateResultOut)
def run_self_update(payload: SelfUpdateRequest) -> SelfUpdateResultOut:
    if not settings.self_update_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Self update is disabled")

    if not update_lock.acquire(blocking=False):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Another self update is already running")

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

        steps: list[CommandResultOut] = []

        fetch_result = executor.run(["git", "fetch", "origin"], cwd=repo_root)
        executor._ensure_success(fetch_result, "git fetch failed")
        steps.append(_as_out(fetch_result))

        checkout_result = executor.run(["git", "checkout", branch], cwd=repo_root)
        executor._ensure_success(checkout_result, f"git checkout {branch} failed")
        steps.append(_as_out(checkout_result))

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

        return SelfUpdateResultOut(
            status="ok",
            message=(
                "Self update completed. If backend code changed, restart the service to apply runtime changes "
                f"(suggested: systemctl restart {service_name})."
            ),
            branch=branch,
            restart_required=True,
            steps=steps,
        )
    except ExecutorError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    finally:
        update_lock.release()
