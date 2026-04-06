from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from app import models  # noqa: F401
from app.auth import failed_attempts, locked_until
from app.database import Base, engine
from app.main import app


@pytest.fixture()
def client() -> TestClient:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    failed_attempts.clear()
    locked_until.clear()

    with TestClient(app) as test_client:
        yield test_client

    failed_attempts.clear()
    locked_until.clear()
    Base.metadata.drop_all(bind=engine)
