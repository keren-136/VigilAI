"""
Pydantic schemas for request/response validation.
"""
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class IncidentBase(BaseModel):
    severity: str
    action_type: str
    track_ids: Optional[str] = None
    camera_id: str = "CAM-01"
    description: Optional[str] = None
    duration_seconds: float = 0.0
    # Threat accumulation fields
    threat_score: int = 0
    occurrence_count: int = 1
    escalated_from: Optional[str] = None


class IncidentCreate(IncidentBase):
    pass


class IncidentResponse(IncidentBase):
    id: int
    timestamp: datetime

    class Config:
        from_attributes = True


class AlertPayload(BaseModel):
    """Real-time WebSocket alert payload."""
    id: Optional[int] = None
    timestamp: str
    severity: str          # LOW | MEDIUM | HIGH
    action_type: str       # following | chasing | loitering
    track_ids: Optional[str] = None
    camera_id: str = "CAM-01"
    description: Optional[str] = None
    duration_seconds: float = 0.0
    # Threat accumulation fields
    threat_score: int = 0
    occurrence_count: int = 1
    escalated_from: Optional[str] = None
    camera_high_risk: bool = False


class DetectionStartRequest(BaseModel):
    video_path: str
    camera_id: str = "CAM-01"


class DetectionStatusResponse(BaseModel):
    status: str
    message: str
    camera_id: Optional[str] = None
