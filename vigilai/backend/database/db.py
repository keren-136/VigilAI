"""
SQLite database setup using SQLAlchemy.
"""
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "vigilai.db")

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    severity = Column(String(10), nullable=False)    # LOW | MEDIUM | HIGH
    action_type = Column(String(50), nullable=False) # following | chasing | loitering
    track_ids = Column(String(100), nullable=True)   # comma-separated track IDs
    camera_id = Column(String(50), default="CAM-01")
    description = Column(Text, nullable=True)
    duration_seconds = Column(Float, default=0.0)

    # ── Threat accumulation fields ────────────────────────────────────────────
    threat_score = Column(Integer, default=0)        # cumulative score at time of save
    occurrence_count = Column(Integer, default=1)    # how many times this event repeated
    escalated_from = Column(String(10), nullable=True)  # original severity before escalation


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
