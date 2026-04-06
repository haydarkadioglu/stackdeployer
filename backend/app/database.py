from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


is_sqlite = settings.database_url.startswith("sqlite")
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if is_sqlite else {},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, class_=Session)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models

    _ = models
    Base.metadata.create_all(bind=engine)
