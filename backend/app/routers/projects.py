from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..executor import DeploymentPlan, Executor, ExecutorError
from ..models import Log, Project
from ..nginx_config import NginxConfigError, NginxManager, NginxSiteConfig
from ..schemas import (
    CommandResultOut,
    LogOut,
    NginxApplyRequest,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
)

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
executor = Executor()
nginx_manager = NginxManager()


def _get_project_or_404(db: Session, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def _create_log(db: Session, project_id: int, level: str, source: str, message: str) -> None:
    log = Log(project_id=project_id, level=level, source=source, message=message)
    db.add(log)
    db.commit()


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[Project]:
    return db.execute(select(Project).order_by(Project.created_at.desc())).scalars().all()


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> Project:
    project = Project(**payload.model_dump())
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
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, key, value)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = _get_project_or_404(db, project_id)
    db.delete(project)
    db.commit()


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


@router.post("/{project_id}/deploy", status_code=status.HTTP_202_ACCEPTED)
def deploy_project(project_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    project = _get_project_or_404(db, project_id)

    def logger(line: str) -> None:
        _create_log(db, project.id, "INFO", "executor", line)

    plan = DeploymentPlan(
        repo_url=project.git_url,
        target_dir=Path(project.local_path),
        stack=project.tech_stack,
        build_command=project.build_command,
        start_command=project.start_command,
    )

    try:
        project.status = "building"
        db.add(project)
        db.commit()

        executor.deploy(plan, stream=logger)

        project.status = "running"
        db.add(project)
        db.commit()
    except ExecutorError as exc:
        project.status = "error"
        db.add(project)
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
