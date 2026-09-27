"""Offline regression tests for the Agent API; never call DeepSeek or PetClinic."""

import importlib
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command


class AgentAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.saved_env = {key: os.environ.get(key) for key in (
            "AGENT_CHECKPOINT_PATH", "CHECKPOINT_DB_PATH", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL")}
        os.environ["AGENT_CHECKPOINT_PATH"] = str(Path(cls.tmp.name) / "api.sqlite3")
        os.environ["CHECKPOINT_DB_PATH"] = str(Path(cls.tmp.name) / "api.sqlite3")
        for key in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"):
            os.environ.setdefault(key, "offline-test-only")
        cls.llm = importlib.import_module("demo_petclinic_llm_agent")
        cls.cancel = importlib.import_module("demo_petclinic_cancel_agent")
        cls.api = importlib.import_module("demo_petclinic_api")
        cls.real_model = cls.llm.responses_create
        cls.real_pet_http = cls.llm.request_json
        cls.real_appointment_http = cls.cancel.request_json
        cls.client = TestClient(cls.api.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.api.checkpoint_connection.close()
        cls.tmp.cleanup()
        for key, value in cls.saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def setUp(self):
        self.http = []
        self.llm.responses_create = self.fake_model
        self.llm.request_json = self.fake_http
        self.cancel.request_json = self.fake_http

    def tearDown(self):
        self.llm.responses_create = self.real_model
        self.llm.request_json = self.real_pet_http
        self.cancel.request_json = self.real_appointment_http

    def fake_http(self, method, path, body=None):
        self.http.append((method, path, body))
        if method == "POST":
            return {"ok": True, "status": 200,
                    "data": {"id": 5, "status": "CANCELLED", "version": 8}}
        if path == "/pets/1":
            return {"ok": True, "status": 200, "data": {"id": 1, "name": "Buddy"}}
        return {"ok": True, "status": 200,
                "data": {"id": 5, "status": "REQUESTED", "version": 7}}

    def fake_model(self, payload):
        items = payload["input"]
        user = next(item["content"] for item in items if item.get("role") == "user")
        outputs = [json.loads(item["output"]) for item in items
                   if item.get("type") == "function_call_output"]

        def call(name, args):
            return {"status": "completed", "output": [{"type": "function_call",
                    "name": name, "arguments": json.dumps(args), "call_id": str(uuid4())}]}

        if payload["tool_choice"] == "none":
            text = "操作未执行" if outputs[-1].get("error") == "human_rejected" else "操作已完成"
        elif user.startswith("取消预约"):
            if not outputs:
                return call("get_appointment", {"appointment_id": 5})
            return call("cancel_appointment", {"appointment_id": 5,
                                               "expected_version": outputs[0]["data"]["version"]})
        elif "预约5" in user and "规则" in user:
            if not outputs:
                return call("get_appointment", {"appointment_id": 5})
            if len(outputs) == 1:
                return call("search_knowledge", {"query": "预约取消规则"})
            text = "预约状态与政策已查询"
        elif "规则" in user:
            if not outputs:
                return call("search_knowledge", {"query": "诊所取消预约规则"})
            text = "已根据知识库回答"
        elif not outputs:
            return call("get_pet", {"pet_id": 1})
        else:
            text = "宠物信息已查询"
        return {"status": "completed", "output": [{"type": "message",
                "content": [{"type": "output_text", "text": text}]}]}

    def test_health_and_business_chat(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        result = self.client.post("/agent/chat", json={"message": "查询宠物1的信息"}).json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["sources"], [])
        self.assertEqual(self.http, [("GET", "/pets/1", None)])

    def test_knowledge_and_mixed_sources(self):
        knowledge = self.client.post("/agent/chat", json={"message": "诊所取消预约有什么规则"}).json()
        self.assertEqual(knowledge["status"], "completed")
        self.assertFalse(self.http)
        self.assertTrue(knowledge["sources"])
        self.assertTrue(all(set(row) == {"title", "section", "snippet"}
                            for row in knowledge["sources"]))
        mixed = self.client.post("/agent/chat", json={"message": "预约5状态和取消规则"}).json()
        self.assertEqual(mixed["status"], "completed")
        self.assertEqual(self.http, [("GET", "/appointments/5", None)])
        self.assertTrue(mixed["sources"])

    def test_sse_completed_with_sources(self):
        with self.client.stream("POST", "/agent/chat/stream",
                                json={"message": "诊所取消预约有什么规则"}) as response:
            raw = "".join(response.iter_text())
        self.assertEqual(response.status_code, 200)
        self.assertIn("event: tool_started", raw)
        self.assertIn("event: tool_completed", raw)
        self.assertIn("event: completed", raw)
        completed = [json.loads(line[6:]) for line in raw.splitlines()
                     if line.startswith("data: ") and '"sources"' in line]
        self.assertTrue(completed[0]["sources"])

    def test_approval_reject_approve_and_invalid_thread(self):
        self.assertEqual(self.client.post("/agent/unknown/resume",
                                          json={"decision": "reject"}).status_code, 409)
        self.assertEqual(self.client.post("/agent/chat",
                         json={"message": "hi", "thread_id": "unknown"}).status_code, 404)
        chat = self.client.post("/agent/chat", json={"message": "取消预约5"}).json()
        self.assertEqual(chat["status"], "approval_required")
        self.assertEqual(chat["approval"]["expectedVersion"], 7)
        self.assertEqual(self.http, [("GET", "/appointments/5", None)])
        self.assertEqual(self.client.post("/agent/chat", json={"message": "hi",
                         "thread_id": chat["thread_id"]}).status_code, 409)
        reject = self.client.post(f"/agent/{chat['thread_id']}/resume",
                                  json={"decision": "reject"}).json()
        self.assertEqual(reject["status"], "completed")
        self.assertNotIn("POST", [event[0] for event in self.http])
        chat2 = self.client.post("/agent/chat", json={"message": "取消预约5"}).json()
        approve = self.client.post(f"/agent/{chat2['thread_id']}/resume",
                                   json={"decision": "approve"}).json()
        self.assertEqual(approve["status"], "completed")
        self.assertEqual([event for event in self.http if event[0] == "POST"],
                         [("POST", "/appointments/5/cancel", {"expectedVersion": 7})])

    def test_checkpoint_reopens_for_reject(self):
        path = Path(self.tmp.name) / f"restart-{uuid4()}.sqlite3"
        config = self.api.config_for(str(uuid4()))
        conn = sqlite3.connect(path, check_same_thread=False)
        first = self.llm.build_graph(SqliteSaver(conn))
        paused = first.invoke({"messages": [HumanMessage(content="取消预约5")]}, config)
        self.assertTrue(paused.get("__interrupt__"))
        conn.close()
        conn = sqlite3.connect(path, check_same_thread=False)
        second = self.llm.build_graph(SqliteSaver(conn))
        finished = second.invoke(Command(resume="reject"), config)
        self.assertEqual(finished["messages"][-1].content, "操作未执行")
        self.assertEqual(self.http, [("GET", "/appointments/5", None)])
        conn.close()


if __name__ == "__main__":
    unittest.main()
