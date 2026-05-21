"""
Standalone pipeline diagnostic.
Run from backend/ with:
    python debug_stream.py path/to/video.mp4

Saves 5 frames to outputs/debug_frame_N.jpg so you can open them
and confirm the full video + overlay is rendering correctly.
"""
import sys
import cv2
import numpy as np

def main():
    video_path = sys.argv[1] if len(sys.argv) > 1 else ""

    if not video_path:
        print("Usage: python debug_stream.py <video.mp4>")
        print("Running in DEMO mode (synthetic canvas) …")
        _test_demo()
        return

    print(f"Opening: {video_path}")
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("ERROR: Cannot open video. Check the path.")
        return

    w   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    print(f"Video: {w}×{h} @ {fps:.1f} fps")

    saved = 0
    for i in range(5):
        ret, frame = cap.read()
        if not ret:
            print(f"Frame {i}: READ FAILED")
            continue

        print(f"Frame {i}: shape={frame.shape} dtype={frame.dtype} "
              f"min={frame.min()} max={frame.max()}")

        # Draw a test rectangle so we know annotation works
        cv2.rectangle(frame, (50, 50), (200, 200), (0, 255, 0), 3)
        cv2.putText(frame, f"DEBUG FRAME {i}", (55, 45),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        # Encode to JPEG
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            print(f"Frame {i}: JPEG ENCODE FAILED")
            continue

        out_path = f"outputs/debug_frame_{i}.jpg"
        import os; os.makedirs("outputs", exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(buf.tobytes())
        print(f"Frame {i}: saved to {out_path} ({len(buf.tobytes())} bytes)")
        saved += 1

    cap.release()
    print(f"\nDone. {saved}/5 frames saved to outputs/")
    print("Open outputs/debug_frame_0.jpg — you should see the full video frame with a green box.")

    # Now test with YOLO if available
    try:
        from ultralytics import YOLO
        print("\nYOLO available — testing model.track() + plot() …")
        cap2 = cv2.VideoCapture(video_path)
        ret, frame = cap2.read()
        cap2.release()
        if ret:
            model   = YOLO("yolov8n.pt")
            results = model.track(frame, persist=True, classes=[0],
                                  conf=0.35, verbose=False)
            # plot() returns RGB
            rgb = results[0].plot(conf=False, line_width=2)
            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            ok, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
            with open("outputs/debug_yolo.jpg", "wb") as f:
                f.write(buf.tobytes())
            print("YOLO frame saved to outputs/debug_yolo.jpg")
            print(f"  RGB shape: {rgb.shape}  BGR shape: {bgr.shape}")
    except ImportError:
        print("YOLO not installed — skipping YOLO test.")


def _test_demo():
    """Test the demo canvas rendering."""
    import os; os.makedirs("outputs", exist_ok=True)
    canvas = np.full((360, 640, 3), 30, dtype=np.uint8)
    cv2.rectangle(canvas, (100, 100), (200, 250), (50, 205, 50), 2)
    cv2.putText(canvas, "#1 DEMO", (105, 95),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (50, 205, 50), 1)
    ok, buf = cv2.imencode(".jpg", canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])
    with open("outputs/debug_demo.jpg", "wb") as f:
        f.write(buf.tobytes())
    print(f"Demo frame saved to outputs/debug_demo.jpg ({len(buf.tobytes())} bytes)")
    print("Open it — you should see a dark grey canvas with a green box.")


if __name__ == "__main__":
    main()
