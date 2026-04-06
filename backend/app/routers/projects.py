from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..database import get_db
from ..executor import DeploymentPlan, Executor, ExecutorError
from ..models import Deployment, Log, Project, ProjectEnvironment
from ..nginx_config import NginxConfigError, NginxManager, NginxSiteConfig
from ..schemas import (
    CommandResultOut,
    DeploymentOut,
    ImportPathsOut,
    LogOut,
    NginxApplyRequest,
    NextPortOut,
    ProjectImportAnalyzeOut,
    ProjectImportAnalyzeRequest,
    ProjectEnvironmentCreate,
    ProjectEnvironmentOut,
    ProjectEnvironmentUpdate,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    SSLIssueRequest,
    SSLRenewRequest,
)
from ..ssl_service import SSLService, SSLServiceError
from ..config import settings

router = APIRouter(prefix="/api/v1/projects", tags=["projects"], dependencies=[Depends(require_admin)])
executor = Executor()
nginx_manager = NginxManager()
ssl_service = SSLService()
DEFAULT_IMPORT_BASE_PATHS = ["/srv/apps", "/opt/apps", "/home/ubuntu/apps"]


def _validate_service_constraints(service_type: str, internal_port: int | None, domain: str | None) -> None:
    if service_type == "worker" and domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="domain is not supported for worker services",
        )


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _create_log(db: Session, project_id: int, level: str, source: str, message: str) -> None:
    log = Log(project_id=project_id, level=level, source=source, message=message)
    db.add(log)
    db.commit()


def _next_available_port(db: Session, start_port: int = 8000) -> int:
    used_ports = set(
        db.execute(select(Project.internal_port).where(Project.internal_port.is_not(None))).scalars().all()
    )

    port = max(start_port, 1)
    while port in used_ports:
        port += 1
        if port > 65535:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No available port left in valid range",
            )
    return port


def _safe_slug_from_git_url(git_url: str) -> str:
    trimmed = git_url.strip().rstrip("/")
    leaf = trimmed.split("/")[-1]
    if leaf.endswith(".git"):
        leaf = leaf[:-4]
    leaf = re.sub(r"[^a-zA-Z0-9._-]", "-", leaf).strip("-")
    return leaf or "new-project"


def _discover_paths(base_paths: list[str]) -> list[str]:
    discovered: list[str] = []
    for base in base_paths:
        base_path = Path(base)
        if not base_path.exists() or not base_path.is_dir():
            continue

        discovered.append(str(base_path))
        for child in sorted(base_path.iterdir(), key=lambda p: p.name.lower()):
            if child.is_dir() and not child.name.startswith("."):
                discovered.append(str(child))
    return discovered


def _to_env_out(item: ProjectEnvironment, reveal_secrets: bool = False) -> ProjectEnvironmentOut:
    value = item.value if reveal_secrets or not item.is_secret else "********"
    return ProjectEnvironmentOut(
        id=item.id,
        project_id=item.project_id,
        key=item.key,
        value=value,
        is_secret=item.is_secret,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _suggest_commands(
    project_path: str | None,
    stack: str,
    service_type: str,
    port: int,
) -> tuple[str | None, str | None, str | None]:
    path_arg = Path(project_path) if project_path and Path(project_path).exists() else None
    return executor.suggest_commands(
        project_dir=path_arg,
        stack=stack,
        service_type=service_type,
        port=port,
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[Project]:
    return db.execute(select(Project).order_by(Project.created_at.desc())).scalars().all()


@router.get("/ports/next", response_model=NextPortOut)
def get_next_port(start_port: int = 8000, db: Session = Depends(get_db)) -> NextPortOut:
    return NextPortOut(start_port=start_port, next_port=_next_available_port(db, start_port))


@router.get("/import/paths", response_model=ImportPathsOut)
def list_import_paths(db: Session = Depends(get_db)) -> ImportPathsOut:
    _ = db
    discovered = _discover_paths(DEFAULT_IMPORT_BASE_PATHS)
    return ImportPathsOut(base_paths=DEFAULT_IMPORT_BASE_PATHS, discovered_paths=discovered)


@router.post("/import/analyze", response_model=ProjectImportAnalyzeOut)
def analyze_project_import(payload: ProjectImportAnalyzeRequest, db: Session = Depends(get_db)) -> ProjectImportAnalyzeOut:
    suggested_port = _next_available_port(db, 8000)
    existing_paths = set(db.execute(select(Project.local_path)).scalars().all())

    candidate_paths = _discover_paths(DEFAULT_IMPORT_BASE_PATHS)
    suggested_project_name: str | None = None
    if payload.git_url:
        repo_name = _safe_slug_from_git_url(payload.git_url)
        suggested_project_name = repo_name
        candidate_paths = [f"/srv/apps/{repo_name}", *candidate_paths]

    local_path = payload.local_path.strip() if payload.local_path else None
    if local_path and local_path not in candidate_paths:
        candidate_paths = [local_path, *candidate_paths]

    conflicting_paths = [path for path in candidate_paths if path in existing_paths]

    detected_stack = payload.tech_stack.lower() if payload.tech_stack else None
    detected_framework: str | None = None

    if local_path and Path(local_path).exists() and Path(local_path).is_dir():
        try:
            detected_stack = executor.detect_stack(local_path)
            if detected_stack == "python":
                detected_framework = executor.detect_python_framework(local_path)
        except ExecutorError:
            detected_stack = detected_stack or None

    if not detected_stack and payload.service_type == "web":
        detected_stack = "python"

    build_command = None
    start_command = None
    if detected_stack:
        build_command, start_command, framework = _suggest_commands(
            local_path,
            stack=detected_stack,
            service_type=payload.service_type,
            port=suggested_port,
        )
        detected_framework = detected_framework or framework

    return ProjectImportAnalyzeOut(
        suggested_project_name=suggested_project_name,
        suggested_local_paths=candidate_paths[:40],
        conflicting_paths=conflicting_paths,
        detected_stack=detected_stack,
        detected_python_framework=detected_framework,
        suggested_build_command=build_command,
        suggested_start_command=start_command,
        suggested_port=suggested_port,
    )


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> Project:
    resolved_port = payload.internal_port or _next_available_port(db, 8000)
    _validate_service_constraints(payload.service_type, resolved_port, payload.domain)
    project_data = payload.model_dump()
    project_data["internal_port"] = resolved_port

    if not project_data.get("start_command"):
        _build, suggested_start, _framework = _suggest_commands(
            project_data.get("local_path"),
            stack=project_data["tech_stack"],
            service_type=project_data["service_type"],
            port=resolved_port,
        )
        project_data["start_command"] = suggested_start

    if not project_data.get("build_command"):
        suggested_build, _start, _framework = _suggest_commands(
            project_data.get("local_path"),
            stack=project_data["tech_stack"],
            service_type=project_data["service_type"],
            port=resolved_port,
        )
        project_data["build_command"] = suggested_build

    project = Project(**project_data)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, db: Session = Depends(get_db)) -> Project:
    return _get_project_or_404(db, project_id)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)) -> Project:
    project = _get_project_or_404(db, project_id)
    fields = payload.model_fields_set

    next_service_type = payload.service_type if "service_type" in fields else project.service_type
    next_internal_port = payload.internal_port if "internal_port" in fields else project.internal_port
    next_domain = payload.domain if "domain" in fields else project.domain

    if next_internal_port is None:
        next_internal_port = _next_available_port(db, 8000)

    _validate_service_constraints(next_service_type, next_internal_port, next_domain)

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    project.internal_port = next_internal_port
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> Response:
    project = _get_project_or_404(db, project_id)
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/logs", response_model=list[LogOut])
def get_project_logs(project_id: int, limit: int = 200, db: Session = Depends(get_db)) -> list[Log]:
    _get_project_or_404(db, project_id)
    rows = (
        db.execute(
            select(Log)
            .where(Log.project_id == project_id)
            .order_by(Log.created_at.desc())
            .limit(min(max(limit, 1), 1000))
        )
        .scalars()
        .all()
    )
    return rows


@router.get("/{project_id}/deployments", response_model=list[DeploymentOut])
def list_project_deployments(project_id: int, limit: int = 50, db: Session = Depends(get_db)) -> list[Deployment]:
    _get_project_or_404(db, project_id)
    rows = (
        db.execute(
            select(Deployment)
            .where(Deployment.project_id == project_id)
            .order_by(Deployment.started_at.desc())
            .limit(min(max(limit, 1), 200))
        )
        .scalars()
        .all()
    )
    return rows


@router.get("/{project_id}/env", response_model=list[ProjectEnvironmentOut])
def list_project_environment(
    project_id: int,
    reveal_secrets: bool = False,
    db: Session = Depends(get_db),
) -> list[ProjectEnvironmentOut]:
    _get_project_or_404(db, project_id)
    items = (
        db.execute(
            select(ProjectEnvironment)
            .where(ProjectEnvironment.project_id == project_id)
            .order_by(ProjectEnvironment.key.asc())
        )
        .scalars()
        .all()
    )
    return [_to_env_out(item, reveal_secrets=reveal_secrets) for item in items]


@router.post("/{project_id}/env", response_model=ProjectEnvironmentOut, status_code=status.HTTP_201_CREATED)
def create_project_environment(
    project_id: int,
    payload: ProjectEnvironmentCreate,
    db: Session = Depends(get_db),
) -> ProjectEnvironmentOut:
    _get_project_or_404(db, project_id)

    key = payload.key.strip()
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="key cannot be empty")

    existing = db.execute(
        select(ProjectEnvironment).where(
            ProjectEnvironment.project_id == project_id,
            ProjectEnvironment.key == key,
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Environment key already exists")

    item = ProjectEnvironment(
        project_id=project_id,
        key=key,
        value=payload.value,
        is_secret=payload.is_secret,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_env_out(item)


@router.patch("/{project_id}/env/{env_id}", response_model=ProjectEnvironmentOut)
def update_project_environment(
    project_id: int,
    env_id: int,
    payload: ProjectEnvironmentUpdate,
    db: Session = Depends(get_db),
) -> ProjectEnvironmentOut:
    _get_project_or_404(db, project_id)
    item = db.get(ProjectEnvironment, env_id)
    if not item or item.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Environment variable not found")

    if payload.value is not None:
        item.value = payload.value
    if payload.is_secret is not None:
        item.is_secret = payload.is_secret

    db.add(item)
    db.commit()
    db.refresh(item)
    return _to_env_out(item)


@router.delete("/{project_id}/env/{env_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_environment(project_id: int, env_id: int, db: Session = Depends(get_db)) -> Response:
    _get_project_or_404(db, project_id)
    item = db.get(ProjectEnvironment, env_id)
    if not item or item.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Environment variable not found")

    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/deploy", status_code=status.HTTP_202_ACCEPTED)
def deploy_project(project_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    project = _get_project_or_404(db, project_id)
    deployment = Deployment(project_id=project.id, status="building", branch="main")
    db.add(deployment)
    db.commit()
    db.refresh(deployment)

    def logger(line: str) -> None:
        _create_log(db, project.id, "INFO", "executor", line)

    plan = DeploymentPlan(
        repo_url=project.git_url,
        target_dir=Path(project.local_path),
        stack=project.tech_stack,
        build_command=project.build_command,
        start_command=project.start_command,
        internal_port=project.internal_port,
        service_type=project.service_type,
    )

    try:
        project.status = "building"
        db.add(project)
        db.commit()

        executor.deploy(plan, stream=logger)

        project.status = "running"
        deployment.status = "completed"
        deployment.completed_at = datetime.now(timezone.utc)
        db.add(project)
        db.add(deployment)
        db.commit()
    except ExecutorError as exc:
        project.status = "error"
        deployment.status = "error"
        deployment.error_message = str(exc)
        deployment.completed_at = datetime.now(timezone.utc)
        db.add(project)
        db.add(deployment)
        db.commit()
        _create_log(db, project.id, "ERROR", "executor", str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return {"status": "accepted", "message": "Deployment completed"}


@router.post("/{project_id}/start", response_model=CommandResultOut)
def start_project(project_id: int, db: Session = Depends(get_db)) -> CommandResultOut:
    project = _get_project_or_404(db, project_id)
    if not project.start_command:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_command is not configured")

    parts = project.start_command.split()
    script = parts[0]
    extra_args = parts[1:] if len(parts) > 1 else None

    try:
        result = executor.pm2_start(project.name, project.local_path, script, extra_args)
        project.status = "running"
        db.add(project)
        db.commit()
        return CommandResultOut(**result.__dict__)
    except ExecutorError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{project_id}/restart", response_model=CommandResultOut)
def restart_project(project_id: int, db: Session = Depends(get_db)) -> CommandResultOut:
    project = _get_project_or_404(db, project_id)
    try:
        result = executor.pm2_restart(project.name)
        project.status = "running"
        db.add(project)
        db.commit()
        return CommandResultOut(**result.__dict__)
    except ExecutorError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{project_id}/stop", response_model=CommandResultOut)
def stop_project(project_id: int, db: Session = Depends(get_db)) -> CommandResultOut:
    project = _get_project_or_404(db, project_id)
    try:
        result = executor.pm2_stop(project.name)
        project.status = "stopped"
        db.add(project)
        db.commit()
        return CommandResultOut(**result.__dict__)
    except ExecutorError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/{project_id}/status", response_model=CommandResultOut)
def project_status(project_id: int, db: Session = Depends(get_db)) -> CommandResultOut:
    project = _get_project_or_404(db, project_id)
    try:
        result = executor.pm2_status(project.name)
        return CommandResultOut(**result.__dict__)
    except ExecutorError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{project_id}/nginx/apply")
def apply_nginx(project_id: int, payload: NginxApplyRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    project = _get_project_or_404(db, project_id)
    if project.service_type != "web":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nginx routing is only available for web services",
        )
    if project.internal_port is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="internal_port is required before applying nginx",
        )
    try:
        path = nginx_manager.apply_site(
            NginxSiteConfig(
                site_name=payload.site_name,
                domain=payload.domain,
                upstream_port=project.internal_port,
            )
        )
        project.domain = payload.domain
        db.add(project)
        db.commit()
        return {"status": "ok", "config_path": str(path)}
    except (NginxConfigError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/{project_id}/nginx/{site_name}")
def remove_nginx(project_id: int, site_name: str, db: Session = Depends(get_db)) -> dict[str, str]:
    _get_project_or_404(db, project_id)
    try:
        nginx_manager.remove_site(site_name)
        return {"status": "ok", "removed": site_name}
    except (NginxConfigError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/{project_id}/ssl/issue")
def issue_ssl(project_id: int, payload: SSLIssueRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    project = _get_project_or_404(db, project_id)
    if project.service_type != "web":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SSL issuance is only available for web services",
        )
    if not project.domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project domain is required before issuing SSL",
        )

    email = payload.email or settings.certbot_email
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="email is required (request email or certbot_email setting)",
        )

    try:
        output = ssl_service.issue_certificate(
            project.domain,
            email=email,
            extra_domains=payload.extra_domains,
        )
        _create_log(db, project.id, "INFO", "ssl", f"SSL issued for {project.domain}")
        return {"status": "ok", "message": output}
    except SSLServiceError as exc:
        _create_log(db, project.id, "ERROR", "ssl", str(exc))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/ssl/renew")
def renew_ssl(payload: SSLRenewRequest) -> dict[str, str]:
    try:
        output = ssl_service.renew_certificates(dry_run=payload.dry_run)
        return {"status": "ok", "message": output}
    except SSLServiceError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
