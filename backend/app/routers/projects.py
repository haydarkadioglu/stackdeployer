from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import posixpath
import re
import socket
import subprocess

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..database import get_db
from ..executor import DeploymentPlan, Executor, ExecutorError
from ..models import Deployment, Log, Project, ProjectDomainRecord, ProjectEnvironment
from ..nginx_config import NginxConfigError, NginxManager, NginxSiteConfig
from ..schemas import (
    CommandResultOut,
    DeploymentOut,
    ImportPathsOut,
    DomainPlanOut,
    DomainRecordIn,
    DomainRecordsOut,
    DomainRecordsUpsertRequest,
    DomainValidationOut,
    DomainValidationRecordOut,
    LogOut,
    NginxApplyRequest,
    NextPortOut,
    ProjectImportAnalyzeOut,
    ProjectImportAnalyzeRequest,
    ProjectSSLStatusOut,
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
from ..config import get_allowed_project_roots

router = APIRouter(prefix="/api/v1/projects", tags=["projects"], dependencies=[Depends(require_admin)])
executor = Executor()
nginx_manager = NginxManager()
ssl_service = SSLService()
DEFAULT_IMPORT_BASE_PATHS = ["/srv/apps", "/opt/apps", "/home/ubuntu/apps"]
FORBIDDEN_COMMAND_PATTERN = re.compile(r"[;&|`$><\r\n]")
WINDOWS_DRIVE_PREFIX_PATTERN = re.compile(r"^[a-zA-Z]:")
DOMAIN_PATTERN = re.compile(r"^(?!-)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


def _validate_service_constraints(service_type: str, internal_port: int | None, domain: str | None) -> None:
    if service_type == "worker" and domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="domain is not supported for worker services",
        )


def _resolve_posix_path(path: str) -> str:
    resolved = Path(path).resolve(strict=False).as_posix()
    if WINDOWS_DRIVE_PREFIX_PATTERN.match(resolved):
        resolved = resolved[2:]
    return posixpath.normpath(resolved)


def _validate_local_path(local_path: str) -> str:
    normalized = local_path.strip()
    if not normalized.startswith("/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="local_path must be an absolute path",
        )

    if ".." in PurePosixPath(normalized).parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="local_path cannot contain parent directory segments",
        )

    normalized = posixpath.normpath(normalized)

    allowed_roots = get_allowed_project_roots()
    for root in allowed_roots:
        if normalized == root or normalized.startswith(f"{root}/"):
            resolved = _resolve_posix_path(normalized)
            for allowed_root in allowed_roots:
                if resolved == allowed_root or resolved.startswith(f"{allowed_root}/"):
                    return normalized
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"local_path resolves outside allowed roots: {', '.join(allowed_roots)}",
            )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"local_path must be inside allowed roots: {', '.join(allowed_roots)}",
    )


def _validate_command(command: str | None, field_name: str) -> None:
    if command is None:
        return

    stripped = command.strip()
    if not stripped:
        return

    if FORBIDDEN_COMMAND_PATTERN.search(stripped):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} contains forbidden shell characters",
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


def _safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9-]", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "project"


def _is_valid_domain(value: str) -> bool:
    return bool(DOMAIN_PATTERN.match(value.strip()))


def _build_fqdn(domain: str, host: str) -> str:
    normalized_domain = domain.strip().rstrip(".").lower()
    normalized_host = host.strip().rstrip(".").lower()
    if normalized_host in {"@", ""}:
        return normalized_domain
    if normalized_host.endswith(normalized_domain):
        return normalized_host
    return f"{normalized_host}.{normalized_domain}"


def _resolve_dns_values(record_type: str, fqdn: str) -> list[str]:
    if record_type == "A":
        try:
            _host, _aliases, ips = socket.gethostbyname_ex(fqdn)
            return sorted(set(ips))
        except socket.gaierror:
            return []

    if record_type == "CNAME":
        try:
            result = subprocess.run(
                ["nslookup", "-type=CNAME", fqdn],
                capture_output=True,
                text=True,
                check=False,
            )
            lines = [line.strip() for line in (result.stdout + "\n" + result.stderr).splitlines()]
            values: list[str] = []
            for line in lines:
                match = re.search(r"canonical name\s*=\s*(.+)$", line, re.IGNORECASE)
                if match:
                    values.append(match.group(1).strip().rstrip(".").lower())
            return sorted(set(values))
        except OSError:
            return []

    return []


def _generate_auto_domain(db: Session, project_name: str) -> str:
    if not settings.domain_auto_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="auto domain is disabled")
    base_domain = settings.domain_base_domain.strip().lower()
    if not base_domain or not _is_valid_domain(base_domain):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="domain_base_domain is not configured")

    slug = _safe_slug(project_name)
    candidate = f"{slug}.{base_domain}"
    counter = 2
    existing_domains = set(db.execute(select(Project.domain).where(Project.domain.is_not(None))).scalars().all())
    while candidate in existing_domains:
        candidate = f"{slug}-{counter}.{base_domain}"
        counter += 1
    return candidate


def _default_domain_records(domain: str) -> list[DomainRecordIn]:
    a_target = settings.domain_default_a_target.strip() or "127.0.0.1"
    cname_target = settings.domain_default_cname_target.strip() or domain
    return [
        DomainRecordIn(record_type="A", host="@", value=a_target, ttl=300),
        DomainRecordIn(record_type="CNAME", host="www", value=cname_target, ttl=300),
    ]


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
    resolved_domain = payload.domain
    if payload.service_type == "web" and not resolved_domain and settings.domain_auto_enabled:
        base_domain = settings.domain_base_domain.strip().lower()
        if base_domain and _is_valid_domain(base_domain):
            resolved_domain = _generate_auto_domain(db, payload.name)

    resolved_port = payload.internal_port or _next_available_port(db, 8000)
    _validate_service_constraints(payload.service_type, resolved_port, resolved_domain)
    project_data = payload.model_dump()
    project_data["internal_port"] = resolved_port
    project_data["domain"] = resolved_domain

    project_data["local_path"] = _validate_local_path(project_data["local_path"])
    _validate_command(project_data.get("build_command"), "build_command")
    _validate_command(project_data.get("start_command"), "start_command")

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

    normalized_local_path: str | None = None
    if "local_path" in fields and payload.local_path is not None:
        normalized_local_path = _validate_local_path(payload.local_path)
    if "build_command" in fields:
        _validate_command(payload.build_command, "build_command")
    if "start_command" in fields:
        _validate_command(payload.start_command, "start_command")

    for key, value in payload.model_dump(exclude_unset=True).items():
        if key == "local_path" and normalized_local_path is not None:
            value = normalized_local_path
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
    if reveal_secrets and items:
        _create_log(db, project_id, "INFO", "api", "Environment secrets viewed via API")
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


@router.get("/{project_id}/domain/plan", response_model=DomainPlanOut)
def plan_domain(
    project_id: int,
    mode: str = "auto",
    domain: str | None = None,
    db: Session = Depends(get_db),
) -> DomainPlanOut:
    project = _get_project_or_404(db, project_id)
    if project.service_type != "web":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="domain is only available for web services")

    normalized_mode = mode.strip().lower()
    if normalized_mode not in {"auto", "custom"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mode must be auto or custom")

    resolved_domain = (domain or "").strip().lower()
    if normalized_mode == "auto":
        resolved_domain = _generate_auto_domain(db, project.name)
    elif not resolved_domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="domain is required for custom mode")

    if not _is_valid_domain(resolved_domain):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="domain format is invalid")

    return DomainPlanOut(mode=normalized_mode, domain=resolved_domain, records=_default_domain_records(resolved_domain))


@router.get("/{project_id}/domain/records", response_model=DomainRecordsOut)
def list_domain_records(project_id: int, db: Session = Depends(get_db)) -> DomainRecordsOut:
    project = _get_project_or_404(db, project_id)
    rows = (
        db.execute(
            select(ProjectDomainRecord)
            .where(ProjectDomainRecord.project_id == project_id)
            .order_by(ProjectDomainRecord.record_type.asc(), ProjectDomainRecord.host.asc())
        )
        .scalars()
        .all()
    )
    return DomainRecordsOut(domain=project.domain, records=rows)


@router.put("/{project_id}/domain/records", response_model=DomainRecordsOut)
def upsert_domain_records(
    project_id: int,
    payload: DomainRecordsUpsertRequest,
    db: Session = Depends(get_db),
) -> DomainRecordsOut:
    project = _get_project_or_404(db, project_id)
    if project.service_type != "web":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="domain is only available for web services")

    normalized_domain = payload.domain.strip().lower()
    if not _is_valid_domain(normalized_domain):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="domain format is invalid")

    if not payload.records:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="at least one DNS record is required")

    seen: set[tuple[str, str]] = set()
    for record in payload.records:
        host = record.host.strip().lower()
        if not host:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="record host cannot be empty")
        if not record.value.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="record value cannot be empty")
        key = (record.record_type, host)
        if key in seen:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="duplicate DNS record type+host")
        seen.add(key)

    existing = db.execute(select(ProjectDomainRecord).where(ProjectDomainRecord.project_id == project_id)).scalars().all()
    for row in existing:
        db.delete(row)

    for record in payload.records:
        db.add(
            ProjectDomainRecord(
                project_id=project_id,
                record_type=record.record_type,
                host=record.host.strip().lower(),
                value=record.value.strip().lower(),
                ttl=record.ttl,
                is_verified=False,
            )
        )

    project.domain = normalized_domain
    db.add(project)
    db.commit()

    rows = (
        db.execute(
            select(ProjectDomainRecord)
            .where(ProjectDomainRecord.project_id == project_id)
            .order_by(ProjectDomainRecord.record_type.asc(), ProjectDomainRecord.host.asc())
        )
        .scalars()
        .all()
    )
    return DomainRecordsOut(domain=project.domain, records=rows)


@router.post("/{project_id}/domain/validate", response_model=DomainValidationOut)
def validate_domain_records(project_id: int, db: Session = Depends(get_db)) -> DomainValidationOut:
    project = _get_project_or_404(db, project_id)
    if not project.domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="project domain is not set")

    rows = (
        db.execute(
            select(ProjectDomainRecord)
            .where(ProjectDomainRecord.project_id == project_id)
            .order_by(ProjectDomainRecord.record_type.asc(), ProjectDomainRecord.host.asc())
        )
        .scalars()
        .all()
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no DNS records configured")

    items: list[DomainValidationRecordOut] = []
    all_matched = True
    for row in rows:
        fqdn = _build_fqdn(project.domain, row.host)
        actual_values = _resolve_dns_values(row.record_type, fqdn)
        expected = row.value.strip().lower().rstrip(".")
        matched = expected in {item.strip().lower().rstrip(".") for item in actual_values}
        if not matched:
            all_matched = False
        row.is_verified = matched
        db.add(row)
        items.append(
            DomainValidationRecordOut(
                record_type=row.record_type,
                fqdn=fqdn,
                expected=expected,
                actual_values=actual_values,
                matched=matched,
            )
        )

    db.commit()
    return DomainValidationOut(domain=project.domain, all_matched=all_matched, records=items)


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


@router.get("/{project_id}/ssl/status", response_model=ProjectSSLStatusOut)
def get_ssl_status(project_id: int, db: Session = Depends(get_db)) -> ProjectSSLStatusOut:
    project = _get_project_or_404(db, project_id)
    if project.service_type != "web":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SSL status is only available for web services",
        )
    if not project.domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project domain is required before checking SSL status",
        )

    try:
        status_payload = ssl_service.certificate_status(project.domain)
        return ProjectSSLStatusOut(**status_payload)
    except SSLServiceError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/ssl/renew")
def renew_ssl(payload: SSLRenewRequest) -> dict[str, str]:
    try:
        output = ssl_service.renew_certificates(dry_run=payload.dry_run)
        return {"status": "ok", "message": output}
    except SSLServiceError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
