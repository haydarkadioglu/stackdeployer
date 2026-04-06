from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Deployer Control Plane"
    app_env: str = "development"
    database_url: str = "sqlite:///./deployer.db"
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

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
