"""
Smart Alert Manager
===================
Sits on top of the threat engine output and applies:

  Rule 1 — Merge duplicates (same camera + track_ids + action_type)
            → increment occurrence_count, update score, update timestamp
  Rule 2 — Cooldown suppression (10–15 s) unless severity escalates
  Rule 3 — Active incident mode: one live card per incident key
  Rule 4 — Priority sorting: HIGH > MEDIUM > LOW, escalated first, newest first
  Rule 5 — Auto-archive: mark incidents inactive after ARCHIVE_AFTER seconds
            of no new events

This module is used by the WebSocket broadcast layer.
The frontend receives a curated, deduplicated stream.
"""

import time
import logging
from typing import Dict, Optional, List

logger = logging.getLogger("vigilai.alert_manager")

# ── Tuning ────────────────────────────────────────────────────────────────────
COOLDOWN_SAME_SEVERITY = 12.0   # seconds — suppress identical severity repeats
COOLDOWN_ESCALATION    = 0.0    # always emit on escalation
ARCHIVE_AFTER          = 45.0   # seconds of silence → mark incident archived
MAX_ACTIVE_INCIDENTS   = 30     # cap on live incident slots

SEV_ORDER = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}


def _incident_key(alert: dict) -> str:
    """Stable key for deduplication."""
    cam    = alert.get("camera_id", "")
    tracks = ",".join(sorted(
        (alert.get("track_ids") or "").split(",")
    ))
    atype  = alert.get("action_type", "")
    return f"{cam}|{tracks}|{atype}"


class ActiveIncident:
    """Tracks the live state of one ongoing incident."""

    def __init__(self, alert: dict):
        self.key              = _incident_key(alert)
        self.camera_id        = alert.get("camera_id", "")
        self.action_type      = alert.get("action_type", "")
        self.track_ids        = alert.get("track_ids", "")
        self.severity         = alert.get("severity", "LOW")
        self.threat_score     = alert.get("threat_score", 0)
        self.occurrence_count = alert.get("occurrence_count", 1)
        self.escalated_from   = alert.get("escalated_from")
        self.camera_high_risk = alert.get("camera_high_risk", False)
        self.description      = alert.get("description", "")
        self.first_seen       = time.time()
        self.last_seen        = time.time()
        self.last_emitted     = time.time()
        self.last_severity    = alert.get("severity", "LOW")
        self.archived         = False

    def update(self, alert: dict) -> bool:
        """
        Merge new alert data into this incident.
        Returns True if the update should be emitted to the frontend.
        """
        now          = time.time()
        new_severity = alert.get("severity", "LOW")
        new_score    = alert.get("threat_score", 0)

        self.last_seen        = now
        self.occurrence_count = alert.get("occurrence_count", self.occurrence_count)
        self.threat_score     = max(self.threat_score, new_score)
        self.description      = alert.get("description", self.description)
        self.camera_high_risk = alert.get("camera_high_risk", self.camera_high_risk)

        # Always emit on severity escalation
        escalated = SEV_ORDER.get(new_severity, 0) > SEV_ORDER.get(self.severity, 0)
        if escalated:
            self.escalated_from = self.severity
            self.severity       = new_severity
            self.last_emitted   = now
            self.last_severity  = new_severity
            return True

        self.severity = new_severity

        # Cooldown for same severity
        if (now - self.last_emitted) >= COOLDOWN_SAME_SEVERITY:
            self.last_emitted  = now
            self.last_severity = new_severity
            return True

        return False   # suppress

    def to_payload(self) -> dict:
        now      = time.time()
        duration = now - self.first_seen
        return {
            "type":             "alert",
            "incident_key":     self.key,
            "camera_id":        self.camera_id,
            "action_type":      self.action_type,
            "track_ids":        self.track_ids,
            "severity":         self.severity,
            "threat_score":     self.threat_score,
            "occurrence_count": self.occurrence_count,
            "escalated_from":   self.escalated_from,
            "camera_high_risk": self.camera_high_risk,
            "description":      self.description,
            "duration_seconds": round(duration, 1),
            "active":           not self.archived,
            "timestamp":        _iso_now(),
        }

    def check_archive(self, now: float) -> bool:
        """Mark archived if no events for ARCHIVE_AFTER seconds."""
        if not self.archived and (now - self.last_seen) > ARCHIVE_AFTER:
            self.archived = True
            return True
        return False


class AlertManager:
    """
    Singleton smart alert manager.
    Call `process(enriched_alert)` → returns payload dict to broadcast, or None.
    Call `get_active_incidents()` → sorted list for REST polling.
    """

    def __init__(self):
        self._incidents: Dict[str, ActiveIncident] = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def process(self, alert: dict) -> Optional[dict]:
        """
        Merge alert into active incidents.
        Returns a payload to broadcast, or None to suppress.
        """
        key = _incident_key(alert)
        now = time.time()

        # Auto-archive stale incidents
        self._sweep_archives(now)

        if key in self._incidents:
            incident = self._incidents[key]
            incident.archived = False   # reactivate if it was archived
            should_emit = incident.update(alert)
            if not should_emit:
                return None
            return incident.to_payload()
        else:
            # New incident
            if len(self._incidents) >= MAX_ACTIVE_INCIDENTS:
                self._evict_oldest()
            incident = ActiveIncident(alert)
            self._incidents[key] = incident
            return incident.to_payload()

    def get_active_incidents(self) -> List[dict]:
        """
        Return all active (non-archived) incidents, priority-sorted:
        HIGH > MEDIUM > LOW, escalated first, most recent first.
        """
        now = time.time()
        self._sweep_archives(now)

        active = [inc for inc in self._incidents.values() if not inc.archived]
        active.sort(key=lambda i: (
            -SEV_ORDER.get(i.severity, 0),   # HIGH first
            -(1 if i.escalated_from else 0), # escalated first
            -i.last_seen,                    # most recent first
        ))
        return [inc.to_payload() for inc in active]

    def get_archived_incidents(self) -> List[dict]:
        archived = [inc for inc in self._incidents.values() if inc.archived]
        archived.sort(key=lambda i: -i.last_seen)
        return [inc.to_payload() for inc in archived]

    # ── Internal ──────────────────────────────────────────────────────────────

    def _sweep_archives(self, now: float):
        for inc in list(self._incidents.values()):
            if inc.check_archive(now):
                logger.debug(f"Archived incident: {inc.key}")

    def _evict_oldest(self):
        """Remove the oldest archived incident, or oldest active if none archived."""
        archived = [k for k, v in self._incidents.items() if v.archived]
        if archived:
            oldest = min(archived, key=lambda k: self._incidents[k].last_seen)
        else:
            oldest = min(self._incidents, key=lambda k: self._incidents[k].last_seen)
        del self._incidents[oldest]


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# Singleton
alert_manager = AlertManager()
