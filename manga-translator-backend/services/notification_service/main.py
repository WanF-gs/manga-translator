from __future__ import annotations
"""
Notification Microservice - Port 8007
Handles notification CRUD, email sending, and WebSocket push.
"""
import sys
import os
import uuid
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Depends, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select, update, delete, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from common.core.config import settings
from common.core.database import engine, Base, get_db
from common.core.security import get_current_user
from common.core.response import success_response, paginated_response, error_response
from common.middleware.request_id import RequestIDMiddleware
from common.middleware.auth import AuthenticationMiddleware
from common.monitoring import setup_instrumentation, setup_json_logging
from common.models.notification import Notification
from .api import preferences

# JSON-structured logging for Loki
setup_json_logging(service_name="notification-service", log_level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(
    title="Notification Service",
    description="通知微服务 - 站内通知、邮件、WebSocket实时推送",
    version="0.1.0",
    docs_url="/docs",
    lifespan=lifespan,
)

# Prometheus metrics instrumentation
setup_instrumentation(app, service_name="notification-service")

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(RequestIDMiddleware)
app.add_middleware(AuthenticationMiddleware)


# ===================== Pydantic Models =====================

class NotificationResponse(BaseModel):
    notification_id: str
    type: str
    title: str
    content: str
    is_read: bool
    ref_type: Optional[str] = None
    ref_id: Optional[str] = None
    created_at: Optional[str] = None


class EmailRequest(BaseModel):
    to_email: str
    subject: str
    body_html: str


# ===================== Health Check =====================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "notification-service"}


@app.get("/health/ready")
async def ready():
    return {"status": "ready", "service": "notification-service"}


# ===================== Notification CRUD API =====================

@app.get("/api/v1/notifications", response_model=dict)
async def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    is_read: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get paginated notifications for the current user."""
    user_id = current_user["sub"]
    
    query = select(Notification).where(Notification.user_id == user_id)
    if is_read is not None:
        query = query.where(Notification.is_read == is_read)
    query = query.order_by(Notification.created_at.desc())
    
    # Count
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Paginated
    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    notifications = result.scalars().all()
    
    items = [
        NotificationResponse(
            notification_id=str(n.notification_id),
            type=n.type,
            title=n.title,
            content=n.content,
            is_read=n.is_read,
            ref_type=n.ref_type,
            ref_id=str(n.ref_id) if n.ref_id else None,
            created_at=n.created_at.isoformat() if n.created_at else None,
        ).dict()
        for n in notifications
    ]
    
    return paginated_response(items=items, page=page, page_size=page_size, total=total)


@app.get("/api/v1/notifications/unread-count")
async def get_unread_count(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get unread notification count."""
    user_id = current_user["sub"]
    result = await db.execute(
        select(func.count(Notification.notification_id)).where(
            and_(Notification.user_id == user_id, Notification.is_read == False)
        )
    )
    count = result.scalar() or 0
    return success_response(data={"unread_count": count})


@app.put("/api/v1/notifications/{notification_id}/read")
async def mark_as_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark a notification as read."""
    user_id = current_user["sub"]
    result = await db.execute(
        update(Notification)
        .where(and_(
            Notification.notification_id == notification_id,
            Notification.user_id == user_id,
        ))
        .values(is_read=True)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.commit()
    return success_response(message="Marked as read")


@app.put("/api/v1/notifications/read-all")
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark all notifications as read."""
    user_id = current_user["sub"]
    result = await db.execute(
        update(Notification)
        .where(and_(
            Notification.user_id == user_id,
            Notification.is_read == False,
        ))
        .values(is_read=True)
    )
    count = result.rowcount
    await db.commit()
    return success_response(data={"marked_read": count}, message=f"Marked {count} notifications as read")


@app.delete("/api/v1/notifications/{notification_id}")
async def delete_notification(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Delete a notification."""
    user_id = current_user["sub"]
    result = await db.execute(
        delete(Notification).where(and_(
            Notification.notification_id == notification_id,
            Notification.user_id == user_id,
        ))
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.commit()
    return success_response(message="Notification deleted")


# ===================== Email API =====================

@app.post("/api/v1/email/send")
async def send_email(
    request: EmailRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Send an email notification."""
    try:
        import aiosmtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = os.getenv("SMTP_USER", "")
        smtp_pass = os.getenv("SMTP_PASS", "")
        smtp_from = os.getenv("SMTP_FROM", "noreply@manga-translator.com")
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = request.subject
        msg["From"] = smtp_from
        msg["To"] = request.to_email
        msg.attach(MIMEText(request.body_html, "html", "utf-8"))
        
        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=smtp_user or None,
            password=smtp_pass or None,
            start_tls=True,
        )
        
        return success_response(message="Email sent successfully")
    except ImportError:
        return error_response(code=5001, message="Email service not configured (aiosmtplib not installed)")
    except Exception as e:
        logger.error(f"Email send failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===================== WebSocket for Real-time Notifications =====================

# Connected clients
_ws_connections: dict = {}  # {user_id: set(WebSocket)}


@app.websocket("/api/v1/ws/notifications")
async def notification_websocket(
    websocket: WebSocket,
    token: str = Query(None),
):
    """
    WebSocket for real-time notification push.
    Connect: ws://host/api/v1/ws/notifications?token=JWT_TOKEN
    """
    from common.core.security import decode_token
    
    # Authenticate
    if token:
        try:
            payload = decode_token(token)
            user_id = payload.get("sub", "")
        except Exception:
            await websocket.close(code=4001)
            return
    else:
        await websocket.close(code=4001)
        return
    
    await websocket.accept()
    
    # Register connection
    if user_id not in _ws_connections:
        _ws_connections[user_id] = set()
    _ws_connections[user_id].add(websocket)
    
    try:
        # Send initial unread count
        await websocket.send_json({
            "type": "connected",
            "user_id": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        
        # Keep connection alive
        while True:
            try:
                data = await websocket.receive_text()
                # Client can send ping
                if data == "ping":
                    await websocket.send_json({"type": "pong"})
            except WebSocketDisconnect:
                break
            except Exception:
                break
    finally:
        # Clean up
        if user_id in _ws_connections:
            _ws_connections[user_id].discard(websocket)
            if not _ws_connections[user_id]:
                del _ws_connections[user_id]
        
        try:
            await websocket.close()
        except Exception:
            pass


async def push_notification_to_user(user_id: str, notification_data: dict):
    """Push a notification to a connected user via WebSocket."""
    if user_id in _ws_connections:
        disconnected = set()
        for ws in _ws_connections[user_id]:
            try:
                await ws.send_json({
                    "type": "notification",
                    **notification_data,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
            except Exception:
                disconnected.add(ws)
        
        # Clean up disconnected
        for ws in disconnected:
            _ws_connections[user_id].discard(ws)
        if not _ws_connections[user_id]:
            del _ws_connections[user_id]


# 通知偏好设置路由
app.include_router(preferences.router)


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("NOTIFICATION_SERVICE_PORT", "8007"))
    uvicorn.run(app, host="0.0.0.0", port=port)
