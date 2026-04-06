from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import router as auth_router
from .config import get_cors_origins, settings, validate_security_settings
from .database import init_db
from .routers.projects import router as projects_router
from .routers.ws import router as ws_router


app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(ws_router)


@app.on_event("startup")
def on_startup() -> None:
    validate_security_settings()
    init_db()


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "deployer-control-plane",
        "environment": settings.app_env,
    }
