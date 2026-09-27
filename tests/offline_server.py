"""Test-only ASGI app: real FastAPI/LangGraph/SQLite, no external requests."""

import json
from uuid import uuid4

import demo_petclinic_cancel_agent as cancel
import demo_petclinic_llm_agent as llm


def fake_http(method, path, body=None):
    if method != "GET" or path != "/appointments/5":
        raise AssertionError("The offline restart test must not send a cancel POST")
    return {"ok": True, "status": 200,
            "data": {"id": 5, "status": "REQUESTED", "version": 7}}


def fake_model(payload):
    outputs = [json.loads(item["output"]) for item in payload["input"]
               if item.get("type") == "function_call_output"]
    if payload["tool_choice"] == "none":
        return {"status": "completed", "output": [{"type": "message",
                "content": [{"type": "output_text", "text": "取消未执行"}]}]}
    name = "get_appointment" if not outputs else "cancel_appointment"
    args = ({"appointment_id": 5} if not outputs else
            {"appointment_id": 5, "expected_version": outputs[0]["data"]["version"]})
    return {"status": "completed", "output": [{"type": "function_call",
            "name": name, "arguments": json.dumps(args), "call_id": str(uuid4())}]}


llm.responses_create = fake_model
llm.request_json = fake_http
cancel.request_json = fake_http

from demo_petclinic_api import app  # noqa: E402 - patch before graph use
