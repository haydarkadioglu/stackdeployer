from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    git_url: str = Field(min_length=3, max_length=1000)
    local_path: str = Field(min_length=2, max_length=1000)
    domain: str | None = Field(default=None, max_length=255)
    internal_port: int = Field(ge=1, le=65535)
    tech_stack: str = Field(min_length=2, max_length=64)
    build_command: str | None = None
    start_command: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    git_url: str | None = Field(default=None, min_length=3, max_length=1000)
    local_path: str | None = Field(default=None, min_length=2, max_length=1000)
    domain: str | None = Field(default=None, max_length=255)
    internal_port: int | None = Field(default=None, ge=1, le=65535)
    tech_stack: str | None = Field(default=None, min_length=2, max_length=64)
    build_command: str | None = None
    start_command: str | None = None
    status: str | None = Field(default=None, max_length=32)


class ProjectOut(BaseModel):
    id: int
    name: str
    git_url: str
    local_path: str
    domain: str | None
    internal_port: int
    tech_stack: str
    build_command: str | None
    start_command: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LogOut(BaseModel):
    id: int
    project_id: int
    level: str
    source: str
    message: str
    created_at: datetime

    class Config:
        from_attributes = True


class NginxApplyRequest(BaseModel):
    site_name: str = Field(min_length=2, max_length=120)
    domain: str = Field(min_length=4, max_length=255)


class CommandResultOut(BaseModel):
    command: list[str]
    returncode: int
    stdout: str
    stderr: str
