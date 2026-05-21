# VigilAI — AI-Powered Behavioural Surveillance System

A working MVP that detects behavioural escalation in CCTV footage using YOLOv8 + ByteTrack, with a real-time React dashboard.

---

## Architecture

```
CCTV Video
    ↓
YOLOv8n (human detection)
    ↓
ByteTrack (persistent person tracking)
    ↓
Behaviour Analysis Engine
  ├── Persistent Following  → LOW alert
  ├── Aggressive Chasing    → MEDIUM / HIGH alert
  └── Suspicious Loitering  → LOW alert
    ↓
FastAPI Backend (REST + WebSocket)
    ↓
React Dashboard (live alerts, analytics)
```

---

## Project Structure

```
vigilai/
├── backend/
│   ├── ai/
│   │   ├── behaviour_engine.py   # Core detection logic
│   │   └── detector.py           # YOLO + ByteTrack pipeline
│   ├── routes/
│   │   ├── alerts.py             # GET /alerts, /incidents, /stats
│   │   ├── detection.py          # POST /start-detection
│   │   └── websocket.py          # WS /ws/alerts
│   ├── services/
│   │   ├── alert_service.py      # DB save + WS broadcast
│   │   └── connection_manager.py # WebSocket manager
│   ├── models/
│   │   └── schemas.py            # Pydantic models
│   ├── database/
│   │   └── db.py                 # SQLite + SQLAlchemy
│   ├── videos/                   # Drop .mp4 files here
│   ├── outputs/                  # Processed video output
│   ├── main.py                   # FastAPI entry point
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Dashboard.jsx     # Main dashboard
    │   │   ├── Incidents.jsx     # Incident log table
    │   │   └── Analytics.jsx     # Charts & stats
    │   ├── components/
    │   │   ├── Sidebar.jsx
    │   │   ├── AlertSidebar.jsx  # Live alert feed
    │   │   ├── CameraCard.jsx    # Camera control
    │   │   ├── AlertTimeline.jsx
    │   │   ├── StatCard.jsx
    │   │   └── SeverityBadge.jsx
    │   ├── services/
    │   │   ├── api.js            # REST client
    │   │   └── websocket.js      # WS client
    │   └── App.jsx
    ├── package.json
    └── vite.config.js
```

---

## Quick Start

### 1. Backend Setup

```bash
cd vigilai/backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn main:app --reload --port 8000
```

The backend starts at **http://localhost:8000**  
API docs: **http://localhost:8000/docs**

### 2. Frontend Setup

```bash
cd vigilai/frontend

npm install
npm run dev
```

Dashboard opens at **http://localhost:5173**

---

## Using the System

### Demo Mode (no video needed)

1. Open the dashboard at http://localhost:5173
2. Click **Start** on any camera card (leave the input as `demo`)
3. Alerts will appear in the right sidebar within ~30 seconds
4. Check the **Incidents** and **Analytics** pages

### Real Video Mode

1. Drop an `.mp4` file into `backend/videos/`
2. In the camera card input, type the filename (e.g. `crowd.mp4`)
3. Click **Start**
4. YOLOv8 will detect and track people, generating real alerts

---

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alerts` | Recent alerts (supports `?severity=HIGH&limit=50`) |
| GET | `/api/incidents` | Full incident log |
| GET | `/api/stats` | Summary statistics |
| GET | `/api/videos` | List available video files |
| POST | `/api/start-detection` | Start detection `{"video_path": "demo", "camera_id": "CAM-01"}` |
| POST | `/api/stop-detection/{camera_id}` | Stop detection |
| GET | `/api/detection-status` | Active cameras |
| WS | `/ws/alerts` | Real-time alert stream |

### Sample Alert Response

```json
{
  "id": 42,
  "timestamp": "2024-01-15T14:23:11.000Z",
  "severity": "MEDIUM",
  "action_type": "chasing",
  "track_ids": "3,7",
  "camera_id": "CAM-01",
  "description": "Person #3 chasing #7 (speed=12.4px/s, closing=95px)",
  "duration_seconds": 0.0
}
```

---

## Behaviour Detection Logic

### Persistent Following (LOW)
- Two people within **150px** of each other
- Moving in the **same direction** (< 45° angle difference)
- Sustained for **> 10 seconds**

### Aggressive Chasing (MEDIUM / HIGH)
- One person moving at **> 8px/frame** average speed
- Closing distance by **> 80px** over 15 frames
- Escalates to **HIGH** if both people are running fast

### Suspicious Loitering (LOW)
- Person stays within a **100px radius** for **> 20 seconds**

---

## Severity System

| Severity | Triggers |
|----------|----------|
| LOW | Following, Loitering |
| MEDIUM | Chasing (one fast mover) |
| HIGH | Chasing (both fast movers) |

---

## Tech Stack

- **AI**: YOLOv8n (Ultralytics) + ByteTrack
- **Backend**: FastAPI, SQLAlchemy, SQLite, WebSockets
- **Frontend**: React 18, Vite, Tailwind CSS, Recharts, React Router
- **Language**: Python 3.10+, JavaScript (ES2022)

---

## Requirements

- Python 3.10+
- Node.js 18+
- ~500MB disk (for YOLOv8n model download on first run)
- No GPU required (CPU inference works fine for MVP)
