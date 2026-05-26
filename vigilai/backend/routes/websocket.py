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
    On connect, sends a confirmation message.
    Messages are JSON: { type, id, timestamp, severity, action_type, ... }
    """
    await manager.connect(websocket)

    # Send immediate confirmation so frontend knows the connection is live
    await manager.send_personal(websocket, {
        "type": "connection",
        "status": "connected",
        "message": "VigilAI WebSocket connected",
    })

    try:
        # Keep connection alive — server pushes alerts, client sends nothing
        while True:
            data = await websocket.receive_text()
            logger.debug(f"WS received from client: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WS client disconnected cleanly")
    except Exception as e:
        logger.warning(f"WS error: {e}")
        manager.disconnect(websocket)
