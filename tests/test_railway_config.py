"""Offline deployment-config checks; no model or PetClinic requests."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def child_env():
    env = os.environ.copy()
    for key in ("PETCLINIC_BASE_URL", "FRONTEND_ORIGINS", "CHECKPOINT_DB_PATH",
                "AGENT_CHECKPOINT_PATH", "RAILWAY_VOLUME_MOUNT_PATH"):
        env.pop(key, None)
    env["RAILWAY_PROJECT_ID"] = "offline-config-test"
    return env


def run_child(env, code):
    return subprocess.run([sys.executable, "-B", "-X", "utf8", "-c", code],
                          cwd=ROOT, env=env, capture_output=True, text=True,
                          timeout=30, check=False)


class RailwayConfigTests(unittest.TestCase):
    def test_railpack_start_and_health(self):
        config = json.loads((ROOT / "railway.json").read_text(encoding="utf-8"))
        self.assertEqual(config["build"]["builder"], "RAILPACK")
        self.assertEqual(config["deploy"]["startCommand"],
                         "uvicorn demo_petclinic_api:app --host 0.0.0.0 --port $PORT")
        self.assertEqual(config["deploy"]["healthcheckPath"], "/health")

    def test_private_backend_volume_and_vercel_cors(self):
        with tempfile.TemporaryDirectory() as mount:
            env = child_env()
            env.update({
                "PETCLINIC_BASE_URL": "http://petclinic.railway.internal:9966/petclinic/api",
                "FRONTEND_ORIGINS": "https://petclinic.vercel.app, https://preview.vercel.app/",
                "RAILWAY_VOLUME_MOUNT_PATH": mount,
                "CHECKPOINT_DB_PATH": str(Path(mount) / "agent-checkpoints.sqlite"),
            })
            result = run_child(env, """
from fastapi.testclient import TestClient
import demo_petclinic_api as api
from demo_petclinic_tools import BASE_URL
assert BASE_URL == 'http://petclinic.railway.internal:9966/petclinic/api'
assert str(api.checkpoint_path) == __import__('os').environ['CHECKPOINT_DB_PATH']
client = TestClient(api.app)
allowed = client.options('/agent/chat', headers={
    'Origin': 'https://petclinic.vercel.app',
    'Access-Control-Request-Method': 'POST'})
denied = client.options('/agent/chat', headers={
    'Origin': 'http://localhost:5173',
    'Access-Control-Request-Method': 'POST'})
assert allowed.status_code == 200
assert allowed.headers['access-control-allow-origin'] == 'https://petclinic.vercel.app'
assert denied.status_code == 400
assert client.get('/health').status_code == 200
api.checkpoint_connection.close()
print('RAILWAY_CONFIG_OK')
""")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("RAILWAY_CONFIG_OK", result.stdout)

    def test_railway_rejects_localhost_and_missing_volume(self):
        env = child_env()
        result = run_child(env, "import demo_petclinic_tools")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PETCLINIC_BASE_URL", result.stderr)
        env["PETCLINIC_BASE_URL"] = "http://localhost:9966/petclinic/api"
        result = run_child(env, "import demo_petclinic_tools")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("PETCLINIC_BASE_URL", result.stderr)
        env["PETCLINIC_BASE_URL"] = "http://petclinic.railway.internal:9966/petclinic/api"
        env["FRONTEND_ORIGINS"] = "https://petclinic.vercel.app"
        env["CHECKPOINT_DB_PATH"] = "/data/agent-checkpoints.sqlite"
        result = run_child(env, "import demo_petclinic_api")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Railway Volume", result.stderr)


if __name__ == "__main__":
    unittest.main()
