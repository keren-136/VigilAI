"""
WebSocket endpoint for real-time alert streaming.
"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.connection_manager import manager

logger = logging.getLogger("vigilai.ws")
router = APIRouter(tags=["websocket"])


@router.websocket("/ws/alerts")
async def websocket_alerts(websocket: WebSocket):
    """
    Frontend connects here to receive live alert events.
    Messages are JSON objects with shape:
      { type, id, timestamp, severity, action_type, track_ids, camera_id, description }
    """
    await manager.connect(websocket)
    try:
        # Keep connection alive; we only push from server side
        while True:
            # Receive any ping/pong or client messages (ignored)
            data = await websocket.receive_text()
            logger.debug(f"WS received: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"WS error: {e}")
        manager.disconnect(websocket)
