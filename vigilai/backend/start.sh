#!/bin/bash
# VigilAI Backend — start script
# Usage: bash start.sh
# Always uses the project venv — never system Python.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$SCRIPT_DIR/venv"
PYTHON="$VENV/bin/python"
UVICORN="$VENV/bin/uvicorn"

# Sanity checks
if [ ! -f "$PYTHON" ]; then
  echo "ERROR: venv not found at $VENV"
  echo "Run: python3 -m venv venv && venv/bin/pip install -r requirements.txt"
  exit 1
fi

echo "============================================"
echo "  VigilAI Backend"
echo "  Python : $($PYTHON --version)"
echo "  API    : http://localhost:8000"
echo "  Docs   : http://localhost:8000/docs"
echo "  WS     : ws://localhost:8000/ws/alerts"
echo "============================================"

# Verify key imports before starting
$PYTHON -c "
import cv2, uvicorn, websockets, fastapi
from ultralytics import YOLO
print('  cv2:', cv2.__version__)
print('  fastapi:', fastapi.__version__)
print('  Dependencies OK')
"

cd "$SCRIPT_DIR"
exec "$UVICORN" main:app --reload --port 8000 --host 0.0.0.0
