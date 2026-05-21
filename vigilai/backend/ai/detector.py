"""
Video Detection Pipeline
Runs YOLOv8 + ByteTrack on a video file, feeds detections into
BehaviourEngine, pushes alerts via callback, and maintains a
latest-frame buffer for MJPEG streaming.

Frame pipeline (real video):
  cap.read() → raw BGR frame
    → model.track() → YOLO annotated frame (boxes + IDs already drawn)
    → _draw_behaviour_labels() → add behaviour text on top
    → cv2.imencode() → JPEG bytes → latest_frame

Frame pipeline (demo mode):
  synthetic canvas (dark grid background, fixed 640×360)
    → _draw_demo_people() → draw coloured person rectangles
    → _draw_behaviour_labels() → add behaviour text
    → cv2.imencode() → JPEG bytes → latest_frame
"""
import cv2
import time
import asyncio
import logging
import math
from pathlib import Path
from typing import Callable, Optional, Dict, List

import numpy as np

from ai.behaviour_engine import BehaviourEngine

logger = logging.getLogger("vigilai.detector")

try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    logger.warning("ultralytics not installed – running in DEMO mode")

# ── Annotation colours (BGR) ──────────────────────────────────────────────────
COLOUR_DEFAULT = (50, 205, 50)    # lime green
COLOUR_FOLLOW  = (0, 200, 255)    # yellow-orange
COLOUR_LOITER  = (0, 140, 255)    # orange
COLOUR_CHASE   = (0, 50, 220)     # red

# Demo canvas
DEMO_W, DEMO_H = 640, 360


def _behaviour_colour(label: str):
    return (
        COLOUR_CHASE  if label == "chasing"  else
        COLOUR_FOLLOW if label == "following" else
        COLOUR_LOITER if label == "loitering" else
        COLOUR_DEFAULT
    )


class VideoDetector:
    """
    Wraps YOLO tracking + behaviour analysis for a single video stream.
    Exposes `latest_frame` (JPEG bytes) for MJPEG streaming.
    """

    def __init__(
        self,
        video_path: str,
        camera_id: str = "CAM-01",
        alert_callback: Optional[Callable] = None,
        output_dir: str = "outputs",
    ):
        self.video_path     = video_path
        self.camera_id      = camera_id
        self.alert_callback = alert_callback
        self.output_dir     = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.engine  = BehaviourEngine()
        self.running = False
        self._model  = None

        # Latest JPEG frame bytes — read by the MJPEG endpoint
        self.latest_frame: Optional[bytes] = None
        # Active behaviour labels per track for annotation
        self._active_labels: Dict[int, str] = {}

    # ── Model loading ─────────────────────────────────────────────────────────

    def _load_model(self):
        if not YOLO_AVAILABLE:
            return None
        if self._model is None:
            logger.info("Loading YOLOv8n model …")
            self._model = YOLO("yolov8n.pt")
        return self._model

    # ── Main processing loop (real video) ─────────────────────────────────────

    async def run(self):
        self.running = True
        logger.info(f"Starting detection on {self.video_path} [{self.camera_id}]")

        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            logger.error(f"Cannot open video: {self.video_path}")
            self.running = False
            return

        fps         = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_delay = 1.0 / fps
        model       = self._load_model()
        frame_idx   = 0

        # Resize large videos to max 1280px wide for streaming performance
        orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        max_w  = 1280
        if orig_w > max_w:
            scale    = max_w / orig_w
            stream_w = max_w
            stream_h = int(orig_h * scale)
        else:
            stream_w, stream_h = orig_w, orig_h
        logger.info(f"Stream size: {stream_w}×{stream_h} (original {orig_w}×{orig_h})")

        try:
            while self.running:
                ret, frame = cap.read()
                if not ret:
                    logger.info("Video ended — looping")
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    frame_idx = 0
                    continue

                frame_idx += 1

                # Resize for streaming if needed
                if (stream_w, stream_h) != (orig_w, orig_h):
                    frame = cv2.resize(frame, (stream_w, stream_h),
                                       interpolation=cv2.INTER_LINEAR)

                # ── Run detection and get annotated frame ──────────────────
                detections, annotated_frame = self._process_frame_with_render(
                    frame, model, frame_idx
                )

                # ── Update behaviour engine ────────────────────────────────
                alerts = self.engine.update(detections)
                for alert in alerts:
                    for tid_str in (alert.get("track_ids") or "").split(","):
                        tid_str = tid_str.strip()
                        if tid_str.isdigit():
                            self._active_labels[int(tid_str)] = alert["action_type"]

                # ── Draw behaviour labels on top of YOLO frame ─────────────
                self._draw_behaviour_labels(annotated_frame, detections)
                self._draw_watermark(annotated_frame)

                # ── Encode and store ───────────────────────────────────────
                self.latest_frame = self._encode_jpeg(annotated_frame)

                # ── Fire alert callbacks ───────────────────────────────────
                for alert in alerts:
                    alert["camera_id"] = self.camera_id
                    if self.alert_callback:
                        await self.alert_callback(alert)

                await asyncio.sleep(frame_delay * 0.5)

        finally:
            cap.release()
            self.running      = False
            self.latest_frame = None
            logger.info(f"Detection stopped for {self.camera_id}")

    def stop(self):
        self.running = False

    # ── Frame processing — returns (detections, annotated_frame) ─────────────

    def _process_frame_with_render(
        self, frame: np.ndarray, model, frame_idx: int
    ):
        """
        Run YOLO on the real frame.
        Returns (detections list, annotated BGR frame).

        Strategy:
          - frame is the raw BGR frame from cap.read()  ← this IS the video
          - we copy it, draw boxes on the copy
          - we never use results[0].plot() because it converts to RGB
            internally and is unreliable across Ultralytics versions
        """
        if model is None:
            return [], frame.copy()

        try:
            results = model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",
                classes=[0],
                conf=0.35,
                iou=0.5,
                verbose=False,
            )
        except Exception as e:
            logger.warning(f"YOLO error on frame {frame_idx}: {e}")
            return [], frame.copy()

        # ── Start with the original video frame ───────────────────────────
        # frame is already BGR from cv2.VideoCapture — copy it and draw on top
        annotated = frame.copy()

        detections = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                if box.id is None:
                    continue

                track_id        = int(box.id.item())
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                conf            = float(box.conf.item())

                detections.append({
                    "track_id": track_id,
                    "cx":  (x1 + x2) / 2,
                    "cy":  (y1 + y2) / 2,
                    "bbox": [x1, y1, x2, y2],
                    "conf": conf,
                })

                # Draw bounding box on the original video frame
                colour = COLOUR_DEFAULT
                cv2.rectangle(annotated, (x1, y1), (x2, y2), colour, 2)

                # Track ID label
                label = f"#{track_id}"
                (tw, th), _ = cv2.getTextSize(
                    label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1
                )
                cv2.rectangle(annotated,
                              (x1, y1 - th - 6), (x1 + tw + 6, y1),
                              colour, -1)
                cv2.putText(annotated, label,
                            (x1 + 3, y1 - 4),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                            (0, 0, 0), 1, cv2.LINE_AA)

        return detections, annotated

    # ── Behaviour label overlay ───────────────────────────────────────────────

    def _draw_behaviour_labels(
        self, frame: np.ndarray, detections: List[Dict]
    ):
        """
        Draw coloured behaviour label badges on top of an already-annotated frame.
        Called for both real-video and demo modes.
        """
        for det in detections:
            tid   = det["track_id"]
            label = self._active_labels.get(tid, "")
            bbox  = det.get("bbox")
            if not bbox or not label:
                continue

            colour = _behaviour_colour(label)
            x1, y1, x2, y2 = [int(v) for v in bbox]

            # Coloured border to highlight behaviour
            cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)

            # Behaviour badge below the box
            badge_text = label.upper()
            (tw, th), _ = cv2.getTextSize(
                badge_text, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1
            )
            bx1 = x1
            by1 = y2
            bx2 = x1 + tw + 6
            by2 = y2 + th + 6
            cv2.rectangle(frame, (bx1, by1), (bx2, by2), colour, -1)
            cv2.putText(
                frame, badge_text,
                (bx1 + 3, by2 - 3),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1, cv2.LINE_AA
            )

    def _draw_watermark(self, frame: np.ndarray):
        h, w = frame.shape[:2]
        ts   = time.strftime("%H:%M:%S")
        # Semi-transparent bar at bottom
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, h - 22), (w, h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)
        cv2.putText(
            frame,
            f"VigilAI  {self.camera_id}  {ts}",
            (6, h - 6),
            cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 180, 180), 1, cv2.LINE_AA
        )

    # ── JPEG encoding ─────────────────────────────────────────────────────────

    @staticmethod
    def _encode_jpeg(frame: np.ndarray) -> bytes:
        ok, buf = cv2.imencode(
            ".jpg", frame,
            [cv2.IMWRITE_JPEG_QUALITY, 75]
        )
        if not ok:
            logger.error("JPEG encoding failed")
            return b""
        return buf.tobytes()

    # ── Demo detections (synthetic, bounded to canvas) ────────────────────────

    def _demo_detections(self, frame_idx: int) -> List[Dict]:
        """
        Synthetic person positions that stay within DEMO_W × DEMO_H.
        Uses a slow oscillating walk so people stay on screen indefinitely.
        """
        t = frame_idx / 15.0   # seconds at 15 fps

        # Person 1 — walks left-right, bouncing off edges
        x1_cx = 80 + (math.sin(t * 0.3) * 0.5 + 0.5) * (DEMO_W - 160)
        y1_cy = DEMO_H * 0.45 + math.sin(t * 0.7) * 20

        # Person 2 — follows person 1 with offset (triggers FOLLOWING)
        x2_cx = x1_cx - 70 + math.sin(t * 0.2) * 10
        y2_cy = y1_cy + 15

        # Person 3 — loiters near centre
        x3_cx = DEMO_W * 0.65 + math.sin(t * 0.4) * 25
        y3_cy = DEMO_H * 0.55 + math.cos(t * 0.4) * 20

        # Person 4 — chases person 1 at higher speed (after 20 s)
        x4_cx = x1_cx - 130 + max(0, t - 20) * 8
        x4_cx = min(x4_cx, x1_cx - 5)   # never overtake
        y4_cy = y1_cy - 25

        pw, ph = 40, 70   # person box width / height

        def box(cx, cy):
            return [cx - pw/2, cy - ph/2, cx + pw/2, cy + ph/2]

        detections = [
            {"track_id": 1, "cx": x1_cx, "cy": y1_cy, "bbox": box(x1_cx, y1_cy)},
            {"track_id": 2, "cx": x2_cx, "cy": y2_cy, "bbox": box(x2_cx, y2_cy)},
            {"track_id": 3, "cx": x3_cx, "cy": y3_cy, "bbox": box(x3_cx, y3_cy)},
        ]
        if t > 20:
            detections.append(
                {"track_id": 4, "cx": x4_cx, "cy": y4_cy, "bbox": box(x4_cx, y4_cy)}
            )
        return detections

    # ── Demo frame renderer ───────────────────────────────────────────────────

    def render_demo_frame(self, frame_idx: int) -> bytes:
        """
        Render a synthetic surveillance-style frame for demo mode.
        Uses a realistic dark-grey background (not pure black) with
        a subtle grid, then draws person silhouettes + behaviour overlays.
        """
        # ── Background: dark grey, not pure black ─────────────────────────
        canvas = np.full((DEMO_H, DEMO_W, 3), 30, dtype=np.uint8)

        # ── Subtle grid ───────────────────────────────────────────────────
        grid_colour = (45, 45, 45)
        for x in range(0, DEMO_W, 64):
            cv2.line(canvas, (x, 0), (x, DEMO_H), grid_colour, 1)
        for y in range(0, DEMO_H, 48):
            cv2.line(canvas, (0, y), (DEMO_W, y), grid_colour, 1)

        # ── Ground plane hint ─────────────────────────────────────────────
        cv2.line(canvas, (0, int(DEMO_H * 0.75)),
                 (DEMO_W, int(DEMO_H * 0.75)), (55, 55, 55), 1)

        # ── Draw person silhouettes ───────────────────────────────────────
        detections = self._demo_detections(frame_idx)
        for det in detections:
            tid   = det["track_id"]
            label = self._active_labels.get(tid, "")
            x1, y1, x2, y2 = [int(v) for v in det["bbox"]]

            # Clamp to canvas
            x1 = max(0, min(x1, DEMO_W - 1))
            x2 = max(0, min(x2, DEMO_W - 1))
            y1 = max(0, min(y1, DEMO_H - 1))
            y2 = max(0, min(y2, DEMO_H - 1))
            if x2 <= x1 or y2 <= y1:
                continue

            colour = _behaviour_colour(label)

            # Person body fill (semi-transparent look via blending)
            body = canvas.copy()
            cv2.rectangle(body, (x1, y1), (x2, y2), colour, -1)
            cv2.addWeighted(body, 0.25, canvas, 0.75, 0, canvas)

            # Person body outline
            cv2.rectangle(canvas, (x1, y1), (x2, y2), colour, 2)

            # Head circle
            head_r  = max(6, (x2 - x1) // 3)
            head_cx = (x1 + x2) // 2
            head_cy = y1 - head_r - 2
            if head_cy - head_r > 0:
                cv2.circle(canvas, (head_cx, head_cy), head_r, colour, 2)

            # Track ID label above head
            id_text = f"#{tid}"
            cv2.putText(
                canvas, id_text,
                (head_cx - 8, head_cy - head_r - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, colour, 1, cv2.LINE_AA
            )

        # ── Behaviour labels ──────────────────────────────────────────────
        self._draw_behaviour_labels(canvas, detections)

        # ── Watermark ─────────────────────────────────────────────────────
        self._draw_watermark(canvas)

        # ── DEMO badge ────────────────────────────────────────────────────
        cv2.putText(
            canvas, "DEMO MODE",
            (DEMO_W - 80, 16),
            cv2.FONT_HERSHEY_SIMPLEX, 0.38, (80, 80, 80), 1, cv2.LINE_AA
        )

        return self._encode_jpeg(canvas)
