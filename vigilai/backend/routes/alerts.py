"""
REST endpoints for alerts and incidents.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime

from database.db import get_db, Incident
from models.schemas import IncidentResponse
from services.threat_engine import threat_engine

router = APIRouter(prefix="/api", tags=["alerts"])


@router.get("/alerts", response_model=List[IncidentResponse])
def get_alerts(
    limit: int = Query(50, ge=1, le=500),
    severity: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return recent alerts, optionally filtered by severity."""
    query = db.query(Incident).order_by(Incident.timestamp.desc())
    if severity:
        query = query.filter(Incident.severity == severity.upper())
    return query.limit(limit).all()


@router.get("/incidents", response_model=List[IncidentResponse])
def get_incidents(
    limit: int = Query(100, ge=1, le=1000),
    action_type: Optional[str] = Query(None),
    camera_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return incident log with optional filters."""
    query = db.query(Incident).order_by(Incident.timestamp.desc())
    if action_type:
        query = query.filter(Incident.action_type == action_type.lower())
    if camera_id:
        query = query.filter(Incident.camera_id == camera_id)
    return query.limit(limit).all()


@router.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    """Summary statistics for the analytics page."""
    total = db.query(Incident).count()
    low = db.query(Incident).filter(Incident.severity == "LOW").count()
    medium = db.query(Incident).filter(Incident.severity == "MEDIUM").count()
    high = db.query(Incident).filter(Incident.severity == "HIGH").count()

    following = db.query(Incident).filter(Incident.action_type == "following").count()
    chasing = db.query(Incident).filter(Incident.action_type == "chasing").count()
    loitering = db.query(Incident).filter(Incident.action_type == "loitering").count()

    return {
        "total": total,
        "by_severity": {"LOW": low, "MEDIUM": medium, "HIGH": high},
        "by_type": {"following": following, "chasing": chasing, "loitering": loitering},
    }


@router.get("/threat-status")
def get_threat_status():
    """
    Live threat accumulation state per camera.
    Returns current scores, severities, and high-risk flags.
    """
    return {"cameras": threat_engine.get_camera_status()}


@router.get("/active-incidents")
def get_active_incidents():
    """
    Live deduplicated active incidents from the Alert Manager.
    Priority-sorted: HIGH → MEDIUM → LOW, escalated first.
    """
    from services.alert_manager import alert_manager
    return {
        "active":   alert_manager.get_active_incidents(),
        "archived": alert_manager.get_archived_incidents(),
    }
