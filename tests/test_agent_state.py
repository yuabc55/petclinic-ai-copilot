"""Process-level, offline checks for the public checkpoint projection."""

import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import httpx


class StateEndpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self.tmp.name) / "checkpoints.sqlite3")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.process = None

    def tearDown(self):
        self.stop()
        assert Path(self.tmp.name).resolve().parent == Path(tempfile.gettempdir()).resolve()
        for attempt in range(20):
            try:
                self.tmp.cleanup()
                break
            except PermissionError:
                if attempt == 19:
                    raise
                time.sleep(0.1)  # Windows may release SQLite after the launcher exits.

    def start(self):
        env = os.environ.copy()
        env["AGENT_CHECKPOINT_PATH"] = self.db
        env["CHECKPOINT_DB_PATH"] = self.db
        for key in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"):
            env.setdefault(key, "offline-test-only")
        self.process = subprocess.Popen(
            [sys.executable, "-B", "-X", "utf8", "-m", "uvicorn",
             "offline_server:app", "--app-dir", "tests",
             "--host", "127.0.0.1", "--port", str(self.port)],
            cwd=Path(__file__).resolve().parent.parent, env=env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        for _ in range(100):
            if self.process.poll() is not None:
                self.fail(f"Uvicorn exited with {self.process.returncode}")
            try:
                if httpx.get(self.base + "/health", timeout=0.3).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.1)
        self.fail("Uvicorn did not become healthy")

    def stop(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
            self.process.wait(timeout=10)
            self.process = None

    def test_unknown_thread(self):
        self.start()
        response = httpx.get(self.base + "/agent/unknown/state", timeout=5)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "Unknown thread_id")

    def test_pending_restart_resume_and_completed_projection(self):
        self.start()
        chat = httpx.post(self.base + "/agent/chat",
                          json={"message": "取消预约5"}, timeout=15).json()
        self.assertEqual(chat["status"], "approval_required")
        thread_id = chat["thread_id"]
        route = self.base + f"/agent/{thread_id}/state"
        pending = httpx.get(route, timeout=5).json()
        self.assertEqual(set(pending), {"thread_id", "status", "messages", "approval", "sources"})
        self.assertEqual(pending["status"], "approval_required")
        self.assertEqual(pending["approval"], chat["approval"])
        self.assertEqual(pending["messages"], [{"role": "user", "content": "取消预约5"}])
        self.assertEqual(pending["sources"], [])

        self.stop()  # Fully terminate the first Uvicorn process.
        self.start()  # Same SQLite path, different Python process.
        restored = httpx.get(route, timeout=5).json()
        self.assertEqual(restored, pending)
        resumed = httpx.post(self.base + f"/agent/{thread_id}/resume",
                             json={"decision": "reject"}, timeout=15).json()
        self.assertEqual(resumed["status"], "completed")
        self.assertEqual(resumed["thread_id"], thread_id)
        completed = httpx.get(route, timeout=5).json()
        self.assertEqual(completed["status"], "completed")
        self.assertIsNone(completed["approval"])
        self.assertEqual(completed["messages"], [
            {"role": "user", "content": "取消预约5"},
            {"role": "assistant", "content": resumed["message"]},
        ])


if __name__ == "__main__":
    unittest.main()
