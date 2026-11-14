"""Vercel entry point: serves every /api/* request with the same handler server.py uses locally.
Vercel's disk is read-only except /tmp, so the SQLite database lives there (it is temporary: demo data only)."""
import os
import sys
from http.server import BaseHTTPRequestHandler

os.environ.setdefault("DATA_DIR", "/tmp/smart_stall")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import H  # noqa: E402


class handler(H, BaseHTTPRequestHandler):
    pass
