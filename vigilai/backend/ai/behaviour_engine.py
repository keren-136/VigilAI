"""
Behaviour Analysis Engine
Analyses tracked person trajectories and detects:
  - Persistent Following
  - Aggressive Running / Chasing
  - Suspicious Loitering
"""
import math
import time
from collections import defaultdict, deque
from typing import Dict, List, Optional, Tuple


# ── Tunable thresholds ────────────────────────────────────────────────────────
FOLLOWING_DISTANCE_THRESHOLD = 150   # pixels – max distance to be "following"
FOLLOWING_DIRECTION_THRESHOLD = 45   # degrees – max angle diff for same direction
FOLLOWING_MIN_DURATION = 10.0        # seconds

CHASING_SPEED_THRESHOLD = 8.0        # pixels/frame – "fast" movement
CHASING_APPROACH_THRESHOLD = 80      # pixels – closing distance per second
CHASING_MIN_FRAMES = 15              # consecutive fast frames

LOITERING_RADIUS = 100               # pixels – area radius
LOITERING_MIN_DURATION = 20.0        # seconds

HISTORY_MAXLEN = 150                 # frames of trajectory to keep (~5 s @ 30 fps)
# ─────────────────────────────────────────────────────────────────────────────


class TrackState:
    """Per-track rolling state."""

    def __init__(self, track_id: int):
        self.track_id = track_id
        self.positions: deque = deque(maxlen=HISTORY_MAXLEN)   # (x, y, timestamp)
        self.speeds: deque = deque(maxlen=HISTORY_MAXLEN)
        self.first_seen: float = time.time()
        self.loiter_origin: Optional[Tuple[float, float]] = None
        self.loiter_start: Optional[float] = None
        self.fast_frame_count: int = 0

    def update(self, cx: float, cy: float, ts: float):
        if self.positions:
            px, py, pt = self.positions[-1]
            dt = ts - pt
            if dt > 0:
                speed = math.hypot(cx - px, cy - py) / dt
            else:
                speed = 0.0
        else:
            speed = 0.0

        self.positions.append((cx, cy, ts))
        self.speeds.append(speed)

    @property
    def current_pos(self) -> Optional[Tuple[float, float]]:
        if self.positions:
            x, y, _ = self.positions[-1]
            return x, y
        return None

    @property
    def current_speed(self) -> float:
        return self.speeds[-1] if self.speeds else 0.0

    def avg_speed(self, n: int = 10) -> float:
        recent = list(self.speeds)[-n:]
        return sum(recent) / len(recent) if recent else 0.0

    def movement_direction(self, n: int = 10) -> Optional[float]:
        """Returns movement angle in degrees over last n frames."""
        pts = list(self.positions)
        if len(pts) < 2:
            return None
        start = pts[max(0, len(pts) - n)]
        end = pts[-1]
        dx = end[0] - start[0]
        dy = end[1] - start[1]
        if abs(dx) < 1 and abs(dy) < 1:
            return None
        return math.degrees(math.atan2(dy, dx))


def _angle_diff(a1: float, a2: float) -> float:
    """Smallest absolute difference between two angles (degrees)."""
    diff = abs(a1 - a2) % 360
    return diff if diff <= 180 else 360 - diff


def _distance(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


class BehaviourEngine:
    """
    Stateful engine that receives per-frame track updates and emits alerts.
    """

    def __init__(self):
        self.tracks: Dict[int, TrackState] = {}
        # Track pairs already flagged this session to avoid spam
        self._following_flagged: Dict[Tuple[int, int], float] = {}
        self._chasing_flagged: Dict[Tuple[int, int], float] = {}
        self._loitering_flagged: Dict[int, float] = {}
        self._cooldown = 15.0   # seconds before re-alerting same pair/track

    # ── Public API ────────────────────────────────────────────────────────────

    def update(self, detections: List[Dict]) -> List[Dict]:
        """
        Feed one frame of detections.

        detections: list of {track_id, cx, cy, timestamp}
        Returns: list of alert dicts (may be empty)
        """
        ts = time.time()
        active_ids = set()

        for det in detections:
            tid = int(det["track_id"])
            cx, cy = float(det["cx"]), float(det["cy"])
            active_ids.add(tid)

            if tid not in self.tracks:
                self.tracks[tid] = TrackState(tid)
            self.tracks[tid].update(cx, cy, ts)

        # Prune stale tracks (not seen for > 5 s)
        stale = [tid for tid, st in self.tracks.items()
                 if tid not in active_ids and ts - st.positions[-1][2] > 5.0]
        for tid in stale:
            del self.tracks[tid]

        alerts = []
        alerts += self._check_loitering(ts)
        alerts += self._check_following(ts)
        alerts += self._check_chasing(ts)
        return alerts

    # ── Detection logic ───────────────────────────────────────────────────────

    def _check_loitering(self, ts: float) -> List[Dict]:
        alerts = []
        for tid, state in self.tracks.items():
            if len(state.positions) < 10:
                continue

            pos = state.current_pos
            if pos is None:
                continue

            # Initialise loiter origin
            if state.loiter_origin is None:
                state.loiter_origin = pos
                state.loiter_start = ts
                continue

            dist_from_origin = _distance(pos, state.loiter_origin)

            if dist_from_origin <= LOITERING_RADIUS:
                duration = ts - state.loiter_start
                if duration >= LOITERING_MIN_DURATION:
                    last_flag = self._loitering_flagged.get(tid, 0)
                    if ts - last_flag > self._cooldown:
                        self._loitering_flagged[tid] = ts
                        alerts.append(self._make_alert(
                            severity="LOW",
                            action_type="loitering",
                            track_ids=str(tid),
                            description=f"Person #{tid} loitering for {duration:.0f}s",
                            duration=duration,
                        ))
            else:
                # Reset origin if person moved away
                state.loiter_origin = pos
                state.loiter_start = ts

        return alerts

    def _check_following(self, ts: float) -> List[Dict]:
        alerts = []
        track_list = list(self.tracks.items())

        for i in range(len(track_list)):
            for j in range(i + 1, len(track_list)):
                tid_a, state_a = track_list[i]
                tid_b, state_b = track_list[j]

                if len(state_a.positions) < 20 or len(state_b.positions) < 20:
                    continue

                pos_a = state_a.current_pos
                pos_b = state_b.current_pos
                if pos_a is None or pos_b is None:
                    continue

                dist = _distance(pos_a, pos_b)
                if dist > FOLLOWING_DISTANCE_THRESHOLD:
                    continue

                dir_a = state_a.movement_direction()
                dir_b = state_b.movement_direction()
                if dir_a is None or dir_b is None:
                    continue

                angle_diff = _angle_diff(dir_a, dir_b)
                if angle_diff > FOLLOWING_DIRECTION_THRESHOLD:
                    continue

                # Both moving in same direction and close — check duration
                pair = (min(tid_a, tid_b), max(tid_a, tid_b))
                # Use the older of the two track start times as proxy for duration
                duration = ts - max(state_a.first_seen, state_b.first_seen)

                if duration >= FOLLOWING_MIN_DURATION:
                    last_flag = self._following_flagged.get(pair, 0)
                    if ts - last_flag > self._cooldown:
                        self._following_flagged[pair] = ts
                        alerts.append(self._make_alert(
                            severity="LOW",
                            action_type="following",
                            track_ids=f"{tid_a},{tid_b}",
                            description=(
                                f"Person #{tid_a} following #{tid_b} "
                                f"(dist={dist:.0f}px, angle_diff={angle_diff:.0f}°)"
                            ),
                            duration=duration,
                        ))

        return alerts

    def _check_chasing(self, ts: float) -> List[Dict]:
        alerts = []
        track_list = list(self.tracks.items())

        for i in range(len(track_list)):
            for j in range(i + 1, len(track_list)):
                tid_a, state_a = track_list[i]
                tid_b, state_b = track_list[j]

                if len(state_a.positions) < CHASING_MIN_FRAMES:
                    continue
                if len(state_b.positions) < CHASING_MIN_FRAMES:
                    continue

                pos_a = state_a.current_pos
                pos_b = state_b.current_pos
                if pos_a is None or pos_b is None:
                    continue

                # One person must be moving fast
                speed_a = state_a.avg_speed(CHASING_MIN_FRAMES)
                speed_b = state_b.avg_speed(CHASING_MIN_FRAMES)

                if speed_a < CHASING_SPEED_THRESHOLD and speed_b < CHASING_SPEED_THRESHOLD:
                    continue

                # Check if the fast mover is closing distance
                pts_a = list(state_a.positions)
                pts_b = list(state_b.positions)

                # Distance N frames ago vs now
                n = min(CHASING_MIN_FRAMES, len(pts_a), len(pts_b))
                old_dist = _distance(
                    (pts_a[-n][0], pts_a[-n][1]),
                    (pts_b[-n][0], pts_b[-n][1]),
                )
                new_dist = _distance(pos_a, pos_b)
                closing = old_dist - new_dist  # positive = getting closer

                if closing < CHASING_APPROACH_THRESHOLD:
                    continue

                pair = (min(tid_a, tid_b), max(tid_a, tid_b))
                last_flag = self._chasing_flagged.get(pair, 0)
                if ts - last_flag > self._cooldown:
                    self._chasing_flagged[pair] = ts

                    # Escalate to HIGH if both are running fast
                    severity = "HIGH" if (speed_a >= CHASING_SPEED_THRESHOLD and
                                          speed_b >= CHASING_SPEED_THRESHOLD) else "MEDIUM"

                    chaser = tid_a if speed_a >= speed_b else tid_b
                    target = tid_b if chaser == tid_a else tid_a

                    alerts.append(self._make_alert(
                        severity=severity,
                        action_type="chasing",
                        track_ids=f"{chaser},{target}",
                        description=(
                            f"Person #{chaser} chasing #{target} "
                            f"(speed={max(speed_a, speed_b):.1f}px/s, "
                            f"closing={closing:.0f}px)"
                        ),
                        duration=0.0,
                    ))

        return alerts

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _make_alert(severity: str, action_type: str, track_ids: str,
                    description: str, duration: float) -> Dict:
        from datetime import datetime, timezone
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "severity": severity,
            "action_type": action_type,
            "track_ids": track_ids,
            "description": description,
            "duration_seconds": round(duration, 1),
        }
