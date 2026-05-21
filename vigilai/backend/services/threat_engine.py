"""
Threat Accumulation Engine
==========================
Sits between the behaviour detector and the alert pipeline.

Responsibilities:
  - Maintain a rolling event window per (camera, track_ids, action_type) key
  - Compute a cumulative threat score using point values
  - Apply escalation rules (LOW→MEDIUM→HIGH)
  - Suppress duplicate spam — only emit when score crosses a threshold
    or severity changes
  - Decay scores over time when no events occur

Escalation Rules
----------------
Rule 1  Following ≥ 3 times within 60 s          → MEDIUM
Rule 2  Loitering continuously > 45 s             → MEDIUM
Rule 3  Following + Chasing same IDs within 90 s  → HIGH
Rule 4  ≥ 5 alerts on same camera within 120 s    → camera HIGH RISK ZONE

Score Points
------------
following          +20
loitering          +15
chasing            +40
aggressive (HIGH)  +50

Thresholds
----------
0–39   → LOW
40–79  → MEDIUM
80+    → HIGH

Score decays by 5 pts/s when no new events arrive.
"""

import time
import logging
from collections import defaultdict, deque
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("vigilai.threat")

# ── Point values ──────────────────────────────────────────────────────────────
ACTION_POINTS: Dict[str, int] = {
    "following": 20,
    "loitering": 15,
    "chasing":   40,
}
HIGH_SEVERITY_BONUS = 50   # added when raw severity is already HIGH

# ── Score thresholds ──────────────────────────────────────────────────────────
SCORE_LOW    = 0
SCORE_MEDIUM = 40
SCORE_HIGH   = 80

# ── Escalation rule windows ───────────────────────────────────────────────────
FOLLOWING_REPEAT_WINDOW  = 60.0   # seconds
FOLLOWING_REPEAT_COUNT   = 3      # occurrences to escalate
LOITERING_ESCALATE_AFTER = 45.0   # seconds of continuous loitering
COMBO_WINDOW             = 90.0   # following + chasing → HIGH
CAMERA_RISK_WINDOW       = 120.0  # seconds
CAMERA_RISK_COUNT        = 5      # alerts to mark camera HIGH RISK

# ── Decay ─────────────────────────────────────────────────────────────────────
SCORE_DECAY_RATE = 5.0   # points per second
DECAY_INTERVAL   = 2.0   # apply decay every N seconds

# ── Dedup cooldown ────────────────────────────────────────────────────────────
# Only re-emit an alert for the same key if severity changed OR
# this many seconds have passed since last emission.
DEDUP_SAME_SEVERITY_COOLDOWN = 12.0


def _severity_from_score(score: int) -> str:
    if score >= SCORE_HIGH:
        return "HIGH"
    if score >= SCORE_MEDIUM:
        return "MEDIUM"
    return "LOW"


def _normalise_ids(track_ids: str) -> str:
    """Sort track IDs so '1,2' and '2,1' map to the same key."""
    parts = [p.strip() for p in track_ids.split(",") if p.strip()]
    return ",".join(sorted(parts, key=lambda x: int(x) if x.isdigit() else x))


class ThreatState:
    """Per-(camera, track_ids, action_type) rolling state."""

    def __init__(self, camera_id: str, track_ids: str, action_type: str):
        self.camera_id   = camera_id
        self.track_ids   = track_ids
        self.action_type = action_type

        self.score: float = 0.0
        self.occurrence_count: int = 0
        self.event_times: deque = deque()   # timestamps of raw events
        self.last_event_ts: float = 0.0
        self.last_decay_ts: float = time.time()
        self.last_emit_ts: float = 0.0
        self.last_emit_severity: Optional[str] = None
        self.escalated_from: Optional[str] = None

        # For loitering: track when continuous loitering started
        self.loiter_start: Optional[float] = None

    def add_event(self, raw_severity: str, ts: float):
        """Record a new raw event and update score."""
        self._apply_decay(ts)

        points = ACTION_POINTS.get(self.action_type, 20)
        if raw_severity == "HIGH":
            points += HIGH_SEVERITY_BONUS
        self.score = min(self.score + points, 200.0)   # cap at 200

        self.occurrence_count += 1
        self.event_times.append(ts)
        self.last_event_ts = ts

        # Prune old events outside the longest window we care about
        cutoff = ts - max(FOLLOWING_REPEAT_WINDOW, COMBO_WINDOW, CAMERA_RISK_WINDOW)
        while self.event_times and self.event_times[0] < cutoff:
            self.event_times.popleft()

        # Loitering: track continuous start
        if self.action_type == "loitering":
            if self.loiter_start is None:
                self.loiter_start = ts
        else:
            self.loiter_start = None

    def _apply_decay(self, now: float):
        elapsed = now - self.last_decay_ts
        if elapsed >= DECAY_INTERVAL:
            decay = SCORE_DECAY_RATE * elapsed
            self.score = max(0.0, self.score - decay)
            self.last_decay_ts = now

    def current_severity(self) -> str:
        return _severity_from_score(int(self.score))

    def events_in_window(self, window: float, now: float) -> int:
        cutoff = now - window
        return sum(1 for t in self.event_times if t >= cutoff)

    def loiter_duration(self, now: float) -> float:
        if self.loiter_start is None:
            return 0.0
        return now - self.loiter_start

    def should_emit(self, computed_severity: str, now: float) -> bool:
        """Decide whether to send this alert to the pipeline."""
        if self.last_emit_severity is None:
            return True
        # Always emit on severity upgrade
        sev_order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
        if sev_order.get(computed_severity, 0) > sev_order.get(self.last_emit_severity, 0):
            return True
        # Cooldown for same severity
        return (now - self.last_emit_ts) >= DEDUP_SAME_SEVERITY_COOLDOWN

    def mark_emitted(self, severity: str, now: float):
        self.last_emit_ts = now
        self.last_emit_severity = severity


class ThreatEngine:
    """
    Singleton engine — call process(alert, camera_id) for every raw alert.
    Returns an enriched alert dict to emit, or None to suppress.
    """

    def __init__(self):
        # key: (camera_id, normalised_track_ids, action_type) → ThreatState
        self._states: Dict[Tuple, ThreatState] = {}
        # camera-level event log for Rule 4
        self._camera_events: Dict[str, deque] = defaultdict(deque)
        # track combo detection: camera → {track_ids_key → {action_type → ts}}
        self._combo_log: Dict[str, Dict[str, Dict[str, float]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        # cameras currently flagged HIGH RISK
        self._high_risk_cameras: Dict[str, float] = {}   # camera_id → flagged_ts

    # ── Public API ────────────────────────────────────────────────────────────

    def process(self, alert: Dict, camera_id: str) -> Optional[Dict]:
        """
        Feed one raw alert from the behaviour engine.
        Returns enriched alert dict to emit, or None to suppress.
        """
        now = time.time()
        action_type  = alert.get("action_type", "unknown")
        raw_severity = alert.get("severity", "LOW")
        track_ids    = _normalise_ids(alert.get("track_ids", ""))

        key = (camera_id, track_ids, action_type)
        if key not in self._states:
            self._states[key] = ThreatState(camera_id, track_ids, action_type)

        state = self._states[key]
        state.add_event(raw_severity, now)

        # ── Apply escalation rules ────────────────────────────────────────────
        computed_severity = self._apply_rules(state, camera_id, track_ids,
                                              action_type, raw_severity, now)

        # ── Camera-level event log (Rule 4) ───────────────────────────────────
        self._camera_events[camera_id].append(now)
        # prune old
        cutoff = now - CAMERA_RISK_WINDOW
        while self._camera_events[camera_id] and \
              self._camera_events[camera_id][0] < cutoff:
            self._camera_events[camera_id].popleft()

        camera_alert_count = len(self._camera_events[camera_id])
        camera_high_risk = camera_alert_count >= CAMERA_RISK_COUNT

        if camera_high_risk:
            self._high_risk_cameras[camera_id] = now
            if computed_severity != "HIGH":
                computed_severity = "HIGH"
                logger.info(f"[Rule 4] Camera {camera_id} HIGH RISK ZONE "
                            f"({camera_alert_count} alerts in {CAMERA_RISK_WINDOW}s)")

        # ── Dedup check ───────────────────────────────────────────────────────
        if not state.should_emit(computed_severity, now):
            return None

        # ── Track escalation ──────────────────────────────────────────────────
        escalated_from = None
        if computed_severity != raw_severity:
            escalated_from = raw_severity
            state.escalated_from = raw_severity
            logger.info(f"ESCALATION {raw_severity}→{computed_severity} "
                        f"[{action_type}] tracks={track_ids} cam={camera_id} "
                        f"score={state.score:.0f}")

        state.mark_emitted(computed_severity, now)

        # ── Build enriched alert ──────────────────────────────────────────────
        enriched = dict(alert)
        enriched.update({
            "severity":         computed_severity,
            "camera_id":        camera_id,
            "threat_score":     int(state.score),
            "occurrence_count": state.occurrence_count,
            "escalated_from":   escalated_from,
            "camera_high_risk": camera_high_risk,
            "description":      self._build_description(
                                    alert, state, computed_severity,
                                    escalated_from, camera_high_risk,
                                    camera_alert_count),
        })
        return enriched

    def get_camera_status(self) -> List[Dict]:
        """Return threat summary per camera for the /threat-status endpoint."""
        now = time.time()
        result = {}

        for (cam_id, track_ids, action_type), state in self._states.items():
            state._apply_decay(now)
            if cam_id not in result:
                result[cam_id] = {
                    "camera_id":    cam_id,
                    "max_score":    0,
                    "severity":     "LOW",
                    "high_risk":    cam_id in self._high_risk_cameras,
                    "alert_count":  len(self._camera_events.get(cam_id, [])),
                    "active_tracks": [],
                }
            entry = result[cam_id]
            if state.score > entry["max_score"]:
                entry["max_score"]  = int(state.score)
                entry["severity"]   = state.current_severity()
            if track_ids and track_ids not in entry["active_tracks"]:
                entry["active_tracks"].append(track_ids)

        return list(result.values())

    # ── Rule application ──────────────────────────────────────────────────────

    def _apply_rules(self, state: ThreatState, camera_id: str,
                     track_ids: str, action_type: str,
                     raw_severity: str, now: float) -> str:

        score_severity = state.current_severity()

        # Rule 1 — Following repeated ≥ 3× in 60 s → MEDIUM
        if action_type == "following":
            count = state.events_in_window(FOLLOWING_REPEAT_WINDOW, now)
            if count >= FOLLOWING_REPEAT_COUNT:
                score_severity = _escalate(score_severity, "MEDIUM")
                logger.debug(f"[Rule 1] Following ×{count} in {FOLLOWING_REPEAT_WINDOW}s → MEDIUM")

        # Rule 2 — Loitering continuously > 45 s → MEDIUM
        if action_type == "loitering":
            if state.loiter_duration(now) >= LOITERING_ESCALATE_AFTER:
                score_severity = _escalate(score_severity, "MEDIUM")
                logger.debug(f"[Rule 2] Loitering {state.loiter_duration(now):.0f}s → MEDIUM")

        # Rule 3 — Following + Chasing same IDs within 90 s → HIGH
        combo = self._combo_log[camera_id][track_ids]
        combo[action_type] = now
        # prune stale
        stale = [k for k, t in combo.items() if now - t > COMBO_WINDOW]
        for k in stale:
            del combo[k]

        if "following" in combo and "chasing" in combo:
            score_severity = "HIGH"
            logger.debug(f"[Rule 3] Following+Chasing combo → HIGH tracks={track_ids}")

        return score_severity

    # ── Description builder ───────────────────────────────────────────────────

    @staticmethod
    def _build_description(alert: Dict, state: ThreatState,
                           computed_severity: str, escalated_from: Optional[str],
                           camera_high_risk: bool, camera_alert_count: int) -> str:
        base = alert.get("description", "")
        parts = [base] if base else []

        if state.occurrence_count > 1:
            parts.append(f"Occurrences: {state.occurrence_count}")

        parts.append(f"Threat score: {int(state.score)}")

        if escalated_from:
            parts.append(f"Escalated: {escalated_from} → {computed_severity}")

        if camera_high_risk:
            parts.append(f"⚠ Camera HIGH RISK ZONE ({camera_alert_count} alerts/2 min)")

        return " | ".join(parts)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _escalate(current: str, minimum: str) -> str:
    """Return the higher of current and minimum severity."""
    order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    return current if order[current] >= order[minimum] else minimum


# ── Singleton ─────────────────────────────────────────────────────────────────
threat_engine = ThreatEngine()
