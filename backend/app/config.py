import posixpath

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "StackDeployer Control Plane"
    app_env: str = "development"
    database_url: str = "sqlite:///./stackdeployer.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    auth_max_failed_attempts: int = 5
    auth_failure_window_minutes: int = 10
    auth_lockout_minutes: int = 15
    certbot_email: str = ""
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    allowed_project_roots: str = "/srv/apps,/opt/apps,/home/ubuntu/apps"
    self_update_enabled: bool = True
    self_update_repo_root: str = "/opt/stackdeployer"
    self_update_default_branch: str = "main"
    self_update_service_name: str = "stackdeployer"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


def validate_security_settings() -> None:
    if settings.app_env.lower() == "production":
        if settings.jwt_secret == "change-me-in-production" or len(settings.jwt_secret) < 32:
            raise ValueError(
                "Invalid jwt_secret for production. Set a strong random secret with at least 32 characters."
            )


def get_cors_origins() -> list[str]:
    return [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]


def get_allowed_project_roots() -> list[str]:
    roots: list[str] = []
    for raw_root in settings.allowed_project_roots.split(","):
        root = raw_root.strip()
        if not root or not root.startswith("/"):
            continue

        normalized = posixpath.normpath(root)
        if not normalized.startswith("/"):
            continue
        if normalized not in roots:
            roots.append(normalized)

    return roots or ["/srv/apps"]
