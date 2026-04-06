from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProjectCreate(BaseModel):
    service_type: Literal["web", "worker"] = "web"
    name: str = Field(min_length=2, max_length=120)
    git_url: str = Field(min_length=3, max_length=1000)
    local_path: str = Field(min_length=2, max_length=1000)
    domain: str | None = Field(default=None, max_length=255)
    internal_port: int | None = Field(default=None, ge=1, le=65535)
    tech_stack: str = Field(min_length=2, max_length=64)
    build_command: str | None = None
    start_command: str | None = None

    @model_validator(mode="after")
    def validate_service_shape(self) -> "ProjectCreate":
        if self.service_type == "worker" and self.domain:
            raise ValueError("domain is not supported for worker services")
        return self


class ProjectUpdate(BaseModel):
    service_type: Literal["web", "worker"] | None = None
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
    model_config = ConfigDict(from_attributes=True)

    id: int
    service_type: Literal["web", "worker"]
    name: str
    git_url: str
    local_path: str
    domain: str | None
    internal_port: int | None
    tech_stack: str
    build_command: str | None
    start_command: str | None
    status: str
    created_at: datetime
    updated_at: datetime

class LogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    level: str
    source: str
    message: str
    created_at: datetime


class DeploymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    status: str
    branch: str
    error_message: str | None
    started_at: datetime
    completed_at: datetime | None


class ProjectEnvironmentCreate(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    value: str = Field(default="")
    is_secret: bool = False


class ProjectEnvironmentUpdate(BaseModel):
    value: str | None = None
    is_secret: bool | None = None


class ProjectEnvironmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    key: str
    value: str
    is_secret: bool
    created_at: datetime
    updated_at: datetime


class NextPortOut(BaseModel):
    start_port: int
    next_port: int


class ImportPathsOut(BaseModel):
    base_paths: list[str]
    discovered_paths: list[str]


class ProjectImportAnalyzeRequest(BaseModel):
    git_url: str | None = Field(default=None, max_length=1000)
    local_path: str | None = Field(default=None, max_length=1000)
    tech_stack: str | None = Field(default=None, max_length=64)
    service_type: Literal["web", "worker"] = "web"


class ProjectImportAnalyzeOut(BaseModel):
    suggested_project_name: str | None
    suggested_local_paths: list[str]
    conflicting_paths: list[str]
    detected_stack: str | None
    detected_python_framework: str | None
    suggested_build_command: str | None
    suggested_start_command: str | None
    suggested_port: int


class NginxApplyRequest(BaseModel):
    site_name: str = Field(min_length=2, max_length=120)
    domain: str = Field(min_length=4, max_length=255)


class CommandResultOut(BaseModel):
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


class SSLIssueRequest(BaseModel):
    email: str | None = Field(default=None, max_length=255)
    extra_domains: list[str] = Field(default_factory=list)


class SSLRenewRequest(BaseModel):
    dry_run: bool = False


class BootstrapRequest(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CurrentUserOut(BaseModel):
    id: int
    username: str
    is_active: bool
    is_superuser: bool


class CredentialsUpdateRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_username: str | None = Field(default=None, min_length=3, max_length=120)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)

    @model_validator(mode="after")
    def validate_target_fields(self) -> "CredentialsUpdateRequest":
        if not (self.new_username or self.new_password):
            raise ValueError("At least one of new_username or new_password must be provided")
        return self


class SelfUpdateRequest(BaseModel):
    branch: str | None = Field(default=None, min_length=1, max_length=120)
    install_backend_dependencies: bool = True
    run_migrations: bool = True
    rebuild_frontend: bool = True


class SelfUpdateResultOut(BaseModel):
    status: str
    message: str
    branch: str
    restart_required: bool
    steps: list[CommandResultOut]
