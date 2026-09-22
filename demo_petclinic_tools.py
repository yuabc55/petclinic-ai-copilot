"""Two read-only PetClinic HTTP tools; no LLM or agent graph."""

import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from langchain_core.tools import tool


BASE_URL = os.environ.get(
    "PETCLINIC_BASE_URL", "http://localhost:9966/petclinic/api"
).rstrip("/")
TIMEOUT_SECONDS = 5


def _get(resource: str, identifier: int) -> dict:
    url = f"{BASE_URL}/{resource}/{identifier}"
    try:
        with urlopen(Request(url, method="GET"), timeout=TIMEOUT_SECONDS) as response:
            raw = response.read()
            status = response.status
    except HTTPError as exc:
        exc.close()
        return {"ok": False, "status": exc.code,
                "error": "not_found" if exc.code == 404 else "http_error"}
    except (URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "status": None, "error": "connection_failure",
                "detail": str(exc)}

    if status != 200:
        return {"ok": False, "status": status, "error": "unexpected_status"}
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "status": 200, "error": "invalid_json"}
    if not isinstance(data, dict) or not isinstance(data.get("id"), int):
        return {"ok": False, "status": 200, "error": "invalid_response"}
    return {"ok": True, "status": 200, "data": data}


@tool
def get_appointment(appointment_id: int) -> dict:
    """Get one appointment by ID from the local PetClinic REST API."""
    return _get("appointments", appointment_id)


@tool
def get_pet(pet_id: int) -> dict:
    """Get one pet by ID from the local PetClinic REST API."""
    return _get("pets", pet_id)
