"""
Alert service — routes raw alerts through the Threat Engine + Alert Manager,
then persists to SQLite and broadcasts via WebSocket.
"""
import logging
from datetime import datetime, timezone
from typing import Dict

from sqlalchemy.orm import Session

from database.db import Incident, SessionLocal
from services.connection_manager import manager
from services.threat_engine import threat_engine
from services.alert_manager import alert_manager

logger = logging.getLogger("vigilai.alerts")


async def handle_alert(alert: Dict, camera_id: str = "CAM-01"):
    """
    Flow:
      raw alert
        → ThreatEngine.process()   (scoring, escalation rules)
        → AlertManager.process()   (dedup, merge, cooldown, priority)
        → save to DB
        → broadcast via WebSocket
    """
    # Step 1 — threat accumulation
    enriched = threat_engine.process(alert, camera_id)
    if enriched is None:
        return None   # suppressed by threat engine cooldown

    # Step 2 — smart alert containment
    payload = alert_manager.process(enriched)
    if payload is None:
        return None   # suppressed as duplicate / within cooldown

    # Step 3 — persist to DB
    db: Session = SessionLocal()
    try:
        incident = Incident(
            timestamp=datetime.now(timezone.utc),
            severity=enriched.get("severity", "LOW"),
            action_type=enriched.get("action_type", "unknown"),
            track_ids=enriched.get("track_ids", ""),
            camera_id=camera_id,
            description=enriched.get("description", ""),
            duration_seconds=payload.get("duration_seconds", 0.0),
            threat_score=enriched.get("threat_score", 0),
            occurrence_count=enriched.get("occurrence_count", 1),
            escalated_from=enriched.get("escalated_from"),
        )
        db.add(incident)
        db.commit()
        db.refresh(incident)

        # Attach DB id to payload before broadcast
        payload["id"] = incident.id

        logger.info(
            f"Alert saved (id={incident.id}) "
            f"[{incident.severity}] score={incident.threat_score} "
            f"occurrences={incident.occurrence_count}"
        )
    except Exception as e:
        logger.error(f"Failed to save alert: {e}")
        db.rollback()
    finally:
        db.close()

    # Step 4 — broadcast enriched payload
    await manager.broadcast(payload)
    return payload.get("id")
