"""
Detection control endpoints — start/stop video processing + MJPEG stream.
"""
import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Dict

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from models.schemas import DetectionStartRequest, DetectionStatusResponse
from services.alert_service import handle_alert

logger = logging.getLogger("vigilai.detection")
router = APIRouter(prefix="/api", tags=["detection"])

# Active detector tasks: camera_id → asyncio.Task
_active_tasks:     Dict[str, asyncio.Task] = {}
_active_detectors: Dict[str, object]       = {}

VIDEOS_DIR = Path(__file__).parent.parent / "videos"

# ── Placeholder JPEG (1×1 dark pixel) served when camera is inactive ──────────
_BLANK_JPEG = (
    b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t"
    b"\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a"
    b"\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\x1e"
    b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00"
    b"\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00"
    b"\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xc4\x00"
    b"\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05\x04\x04\x00\x00"
    b"\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa\x07\"q\x142\x81"
    b"\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br\x82\t\n\x16\x17\x18\x19"
    b"\x1a%&'()*456789:CDEFGHIJSTUVWXYZcdefghijstuvwxyz\x83\x84\x85\x86"
    b"\x87\x88\x89\x8a\x92\x93\x94\x95\x96\x97\x98\x99\x9a\xa2\xa3\xa4"
    b"\xa5\xa6\xa7\xa8\xa9\xaa\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xc2"
    b"\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9"
    b"\xda\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xf1\xf2\xf3\xf4\xf5"
    b"\xf6\xf7\xf8\xf9\xfa\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd4"
    b"\xff\xd9"
)


# ── Video list ────────────────────────────────────────────────────────────────

@router.get("/videos")
def list_videos():
    if not VIDEOS_DIR.exists():
        return {"videos": []}
    videos = [f.name for f in VIDEOS_DIR.iterdir()
              if f.suffix.lower() in (".mp4", ".avi", ".mov", ".mkv")]
    return {"videos": videos}


# ── Start / Stop detection ────────────────────────────────────────────────────

@router.post("/start-detection", response_model=DetectionStatusResponse)
async def start_detection(request: DetectionStartRequest):
    from ai.detector import VideoDetector

    camera_id = request.camera_id

    # Stop existing task for this camera
    await _stop_camera(camera_id)

    # Resolve video path
    video_path = request.video_path.strip()

    # Explicit "demo" keyword → skip file lookup
    if video_path.lower() == "demo":
        is_demo = True
        logger.info(f"Demo mode requested for {camera_id}")
    else:
        if not os.path.isabs(video_path):
            # Auto-append .mp4 if no extension given
            if not Path(video_path).suffix:
                video_path = video_path + '.mp4'
            video_path = str(VIDEOS_DIR / video_path)
        is_demo = not os.path.exists(video_path)
        if is_demo:
            logger.warning(
                f"Video not found: {video_path} — falling back to demo mode"
            )
        else:
            logger.info(f"Starting detection on: {video_path} [{camera_id}]")

    async def alert_cb(alert: dict):
        await handle_alert(alert, camera_id=camera_id)

    detector = VideoDetector(
        video_path=video_path if not is_demo else "",
        camera_id=camera_id,
        alert_callback=alert_cb,
    )
    _active_detectors[camera_id] = detector

    loop = asyncio.get_event_loop()
    task = loop.create_task(_run_detector(detector, video_path, is_demo))
    _active_tasks[camera_id] = task

    mode = "demo" if is_demo else "live"
    return DetectionStatusResponse(
        status="started",
        message=f"Detection started for {camera_id} ({mode} mode)",
        camera_id=camera_id,
    )


@router.post("/stop-detection/{camera_id}", response_model=DetectionStatusResponse)
async def stop_detection(camera_id: str):
    if camera_id not in _active_tasks:
        raise HTTPException(status_code=404, detail=f"No active detection for {camera_id}")
    await _stop_camera(camera_id)
    return DetectionStatusResponse(
        status="stopped",
        message=f"Detection stopped for {camera_id}",
        camera_id=camera_id,
    )


@router.get("/detection-status")
def detection_status():
    active = [
        {"camera_id": cam_id, "running": not task.done()}
        for cam_id, task in _active_tasks.items()
    ]
    return {"active_detections": active}


# ── MJPEG video feed ──────────────────────────────────────────────────────────

@router.get("/video-feed/{camera_id}")
async def video_feed(camera_id: str):
    """
    Processed MJPEG stream — original video frames with bounding boxes + labels.
    Frontend: <img src="http://localhost:8000/api/video-feed/CAM-01">
    """
    return StreamingResponse(
        _mjpeg_generator(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/video-feed/raw/{camera_id}")
async def video_feed_raw(camera_id: str):
    """DEBUG: same stream, kept for diagnostics."""
    return StreamingResponse(
        _mjpeg_generator(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Access-Control-Allow-Origin": "*",
        },
    )


async def _mjpeg_generator(camera_id: str, processed: bool = True):
    """
    Yield MJPEG frames at ~15 fps.
    Format that all browsers accept:
      --frame\r\n
      Content-Type: image/jpeg\r\n
      Content-Length: <bytes>\r\n
      \r\n
      <jpeg bytes>
      \r\n
    """
    INTERVAL = 1 / 15

    while True:
        detector = _active_detectors.get(camera_id)
        frame_bytes = (detector.latest_frame
                       if detector and detector.latest_frame
                       else _BLANK_JPEG)

        header = (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n"
            b"\r\n"
        )
        yield header + frame_bytes + b"\r\n"
        await asyncio.sleep(INTERVAL)


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _stop_camera(camera_id: str):
    if camera_id in _active_tasks:
        det = _active_detectors.get(camera_id)
        if det:
            det.stop()
        task = _active_tasks[camera_id]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        _active_tasks.pop(camera_id, None)
        _active_detectors.pop(camera_id, None)


async def _run_detector(detector, video_path: str, is_demo: bool):
    try:
        if is_demo:
            await _run_demo(detector)
        else:
            await detector.run()
    except asyncio.CancelledError:
        detector.stop()
        raise
    except Exception as e:
        logger.error(f"Detector error: {e}", exc_info=True)


async def _run_demo(detector):
    """
    Demo mode: synthetic detections + rendered canvas frames.
    Also fires a synthetic alert every 15 s so the WebSocket pipeline
    can be verified even before real behaviour thresholds are met.
    """
    frame_idx = 0
    detector.running = True
    engine = detector.engine
    last_synthetic_alert = 0.0

    logger.info(f"Demo mode started for {detector.camera_id}")

    while detector.running:
        import time
        now = time.time()

        # Step 1 — synthetic detections
        detections = detector._demo_detections(frame_idx)

        # Step 2 — behaviour engine
        alerts = engine.update(detections)

        # Step 3 — update behaviour labels BEFORE rendering
        for alert in alerts:
            for tid_str in (alert.get("track_ids") or "").split(","):
                tid_str = tid_str.strip()
                if tid_str.isdigit():
                    detector._active_labels[int(tid_str)] = alert["action_type"]

        # Step 4 — render frame with up-to-date labels
        detector.latest_frame = detector.render_demo_frame(frame_idx)

        # Step 5 — fire real behaviour alerts
        for alert in alerts:
            alert["camera_id"] = detector.camera_id
            if detector.alert_callback:
                await detector.alert_callback(alert)

        # Step 6 — synthetic debug alert every 15 s to verify WS pipeline
        if (now - last_synthetic_alert) >= 15.0:
            last_synthetic_alert = now
            from datetime import datetime, timezone
            synthetic = {
                "timestamp":        datetime.now(timezone.utc).isoformat(),
                "severity":         "LOW",
                "action_type":      "loitering",
                "track_ids":        "1",
                "camera_id":        detector.camera_id,
                "description":      "Demo: Person #1 loitering near entrance",
                "duration_seconds": 15.0,
            }
            if detector.alert_callback:
                await detector.alert_callback(synthetic)
            logger.info(f"[Demo] Synthetic alert fired for {detector.camera_id}")

        frame_idx += 1
        await asyncio.sleep(1 / 15)

    logger.info(f"Demo mode stopped for {detector.camera_id}")
