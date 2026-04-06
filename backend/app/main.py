from fastapi import FastAPI

from .config import settings
from .database import init_db
from .routers.projects import router as projects_router


app = FastAPI(title=settings.app_name)
app.include_router(projects_router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "deployer-control-plane",
        "environment": settings.app_env,
    }
