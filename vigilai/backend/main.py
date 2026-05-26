"""
VigilAI — FastAPI Backend Entry Point

Run with:
  cd vigilai/backend
  source venv/bin/activate
  uvicorn main:app --reload --port 8000
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import init_db
from routes.alerts import router as alerts_router
from routes.detection import router as detection_router
from routes.websocket import router as ws_router

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vigilai")


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("VigilAI backend starting …")
    logger.info("  API docs : http://localhost:8000/docs")
    logger.info("  WS alerts: ws://localhost:8000/ws/alerts")
    logger.info("  Video feed: http://localhost:8000/api/video-feed/CAM-01")
    logger.info("=" * 60)
    init_db()
    logger.info("Database initialised.")
    yield
    logger.info("VigilAI backend shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="VigilAI",
    description="AI-powered behavioural escalation and harassment detection",
    version="1.0.0",
    lifespan=lifespan,
)

# Allow all origins in dev — tighten in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(alerts_router)
app.include_router(detection_router)
app.include_router(ws_router)


@app.get("/")
def root():
    return {
        "name": "VigilAI",
        "status": "running",
        "docs": "/docs",
        "websocket": "ws://localhost:8000/ws/alerts",
    }


@app.get("/health")
def health():
    return {"status": "ok"}
