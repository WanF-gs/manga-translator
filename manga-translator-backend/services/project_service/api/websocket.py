from __future__ import annotations
"""
WebSocket endpoints for real-time progress updates.
WS /ws/batch/{batch_id} — Batch progress streaming
WS /ws/page/{page_id} — Single page progress streaming
"""
import asyncio
import logging
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])

# Connected clients tracking
_active_connections: dict = {}  # {connection_group: set(WebSocket)}


def _get_redis_client():
    """Get Redis client for pub/sub."""
    try:
        import redis.asyncio as aioredis
        from common.core.config import settings
        return aioredis.from_url(settings.REDIS_URL)
    except Exception:
        return None


@router.websocket("/ws/batch/{batch_id}")
async def batch_progress_ws(
    websocket: WebSocket,
    batch_id: str,
    token: str = Query(None),
):
    """
    WebSocket for real-time batch progress.
    
    Connect: ws://host/api/v1/ws/batch/{batch_id}?token=JWT_TOKEN
    
    Messages sent:
    {
        "type": "progress",
        "batch_id": "...",
        "overall_progress": 45,
        "current_step": "translate",
        "step_progress": 50,
        "total_pages": 20,
        "completed_pages": 9,
        "status": "running",
        "timestamp": "2025-..."
    }
    """
    await websocket.accept()
    
    # Add to connection group
    group_key = f"batch:{batch_id}"
    if group_key not in _active_connections:
        _active_connections[group_key] = set()
    _active_connections[group_key].add(websocket)
    
    try:
        # Send initial status
        redis = _get_redis_client()
        
        # Poll Redis for progress every 1 second
        while True:
            try:
                if redis:
                    progress_key = f"batch:{batch_id}:progress"
                    data = await redis.get(progress_key)
                    
                    if data:
                        progress = json.loads(data)
                        await websocket.send_json({
                            "type": "progress",
                            **progress,
                            "timestamp": progress.get("updated_at", ""),
                        })
                    else:
                        await websocket.send_json({
                            "type": "heartbeat",
                            "batch_id": batch_id,
                            "timestamp": "",
                        })
                else:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "batch_id": batch_id,
                        "note": "Redis not available",
                    })
                
                # Check if batch is done
                if redis:
                    progress_key = f"batch:{batch_id}:progress"
                    data = await redis.get(progress_key)
                    if data:
                        progress = json.loads(data)
                        if progress.get("status") in ("completed", "failed", "cancelled"):
                            await websocket.send_json({
                                "type": "complete",
                                "status": progress["status"],
                                "batch_id": batch_id,
                                "overall_progress": progress.get("overall_progress", 100),
                            })
                            break
                
                await asyncio.sleep(1)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.warning(f"WS error for batch {batch_id}: {e}")
                await asyncio.sleep(2)
                
    except WebSocketDisconnect:
        pass
    finally:
        # Clean up
        if group_key in _active_connections:
            _active_connections[group_key].discard(websocket)
            if not _active_connections[group_key]:
                del _active_connections[group_key]
        
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/page/{page_id}")
async def page_progress_ws(
    websocket: WebSocket,
    page_id: str,
    token: str = Query(None),
):
    """
    WebSocket for single page progress.
    
    Messages sent:
    {
        "type": "progress",
        "page_id": "...",
        "step": "translate",
        "status": "processing|completed|failed",
        "progress": 50
    }
    """
    await websocket.accept()
    
    group_key = f"page:{page_id}"
    if group_key not in _active_connections:
        _active_connections[group_key] = set()
    _active_connections[group_key].add(websocket)
    
    try:
        redis = _get_redis_client()
        
        while True:
            try:
                if redis:
                    progress_key = f"page:{page_id}:progress"
                    data = await redis.get(progress_key)
                    
                    if data:
                        progress = json.loads(data)
                        await websocket.send_json({
                            "type": "progress",
                            **progress,
                        })
                        
                        if progress.get("status") in ("completed", "failed", "skipped"):
                            await websocket.send_json({
                                "type": "complete",
                                "status": progress["status"],
                                "page_id": page_id,
                            })
                            break
                
                await asyncio.sleep(0.5)
                
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.warning(f"WS error for page {page_id}: {e}")
                await asyncio.sleep(1)
                
    except WebSocketDisconnect:
        pass
    finally:
        if group_key in _active_connections:
            _active_connections[group_key].discard(websocket)
            if not _active_connections[group_key]:
                del _active_connections[group_key]
        
        try:
            await websocket.close()
        except Exception:
            pass
