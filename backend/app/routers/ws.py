from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..auth import decode_token_subject
from ..database import SessionLocal
from ..models import Log, Project, User

router = APIRouter(tags=["ws"])


@router.websocket("/api/v1/ws/projects/{project_id}/logs")
async def project_log_stream(websocket: WebSocket, project_id: int) -> None:
    token = websocket.query_params.get("token", "")
    if not token:
        await websocket.close(code=1008, reason="Missing token")
        return

    try:
        user_id = decode_token_subject(token)
    except Exception:
        await websocket.close(code=1008, reason="Invalid token")
        return

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        project = db.get(Project, project_id)
        if not user or not user.is_active or not project:
            await websocket.close(code=1008, reason="Unauthorized")
            return

        await websocket.accept()
        last_seen_id = 0

        while True:
            rows = (
                db.execute(
                    select(Log)
                    .where(Log.project_id == project_id, Log.id > last_seen_id)
                    .order_by(Log.id.asc())
                    .limit(200)
                )
                .scalars()
                .all()
            )

            for row in rows:
                await websocket.send_json(
                    {
                        "id": row.id,
                        "project_id": row.project_id,
                        "level": row.level,
                        "source": row.source,
                        "message": row.message,
                        "created_at": row.created_at.isoformat() if row.created_at else None,
                    }
                )
                last_seen_id = row.id

            try:
                _ = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        return
    finally:
        db.close()
