"""Offline pet-list checks; no real model or PetClinic requests."""

import json
import os
import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

import demo_petclinic_cancel_agent as cancel
import demo_petclinic_llm_agent as llm


REQUEST_JSON = cancel.request_json


class PetListTests(unittest.TestCase):
    def setUp(self):
        for module in (cancel, llm):
            http = patch.object(module, "request_json", REQUEST_JSON)
            http.start()
            self.addCleanup(http.stop)
        env = patch.dict(os.environ, {"DEEPSEEK_MODEL": "offline-test-only"})
        env.start()
        self.addCleanup(env.stop)
        for key in ("PETCLINIC_USERNAME", "PETCLINIC_PASSWORD"):
            os.environ.pop(key, None)
        events = patch.object(cancel, "HTTP_EVENTS", [])
        events.start()
        self.addCleanup(events.stop)
        opener = patch.object(cancel, "build_opener")
        self.opener = opener.start().return_value
        self.addCleanup(opener.stop)

    def respond(self, body):
        response = BytesIO(body)
        response.status = 200
        self.opener.open.return_value = response
        self.opener.open.side_effect = None

    def test_list_returns_pets_and_count(self):
        pets = [{"id": 1, "name": "test-pet-a"}, {"id": 3, "name": "test-pet-b"}]
        self.respond(json.dumps(pets).encode())
        self.assertEqual(llm.list_pets.invoke({}),
                         {"ok": True, "status": 200, "pets": pets, "count": 2})
        request = self.opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.full_url, cancel.BASE_URL + "/pets")
        self.assertIsNone(request.data)

    def test_successful_empty_array_is_zero(self):
        self.respond(b"[]")
        self.assertEqual(llm.list_pets.invoke({}),
                         {"ok": True, "status": 200, "pets": [], "count": 0})

    def test_invalid_responses_do_not_supply_a_count(self):
        for body in (b"", b"not-json", b"null", b"{}", b"42", b'"pets"',
                     b"[null]", b"[{}]", b'[{"id": true}]',
                     b'[{"id": 1}, {"id": "2"}]'):
            with self.subTest(body=body):
                self.respond(body)
                result = llm.list_pets.invoke({})
                self.assertEqual(result,
                                 {"ok": False, "status": 200, "error": "invalid_response"})
                self.assertNotIn("count", result)

    def test_http_errors_preserve_status_and_details(self):
        for status in (401, 403, 404, 500, 503):
            with self.subTest(status=status):
                self.opener.open.side_effect = HTTPError(
                    cancel.BASE_URL + "/pets", status, "test-error", {},
                    BytesIO(b'{"code": "TEST_ERROR", "detail": "test-detail"}'))
                result = llm.list_pets.invoke({})
                self.assertEqual(result, {"ok": False, "status": status,
                                         "error": "http_error", "code": "TEST_ERROR",
                                         "detail": "test-detail"})
                self.assertNotIn("count", result)

    def test_existing_tools_keep_object_only_responses(self):
        tools = ((llm.get_pet, {"pet_id": 1}, "GET", "/pets/1"),
                 (cancel.get_appointment, {"appointment_id": 1}, "GET", "/appointments/1"),
                 (cancel.cancel_appointment, {"appointment_id": 1, "expected_version": 2},
                  "POST", "/appointments/1/cancel"))
        for tool, args, method, path in tools:
            with self.subTest(tool=tool.name):
                self.respond(b'{"id": 1}')
                self.assertEqual(tool.invoke(args),
                                 {"ok": True, "status": 200, "data": {"id": 1}})
                request = self.opener.open.call_args.args[0]
                self.assertEqual(request.get_method(), method)
                self.assertEqual(request.full_url, cancel.BASE_URL + path)
                self.respond(b"[]")
                self.assertEqual(tool.invoke(args),
                                 {"ok": False, "status": 200, "error": "invalid_response"})

    def test_list_schema_is_registered_with_no_arguments(self):
        schema = next(schema for schema in llm.SCHEMAS if schema["name"] == "list_pets")
        self.assertEqual(schema["parameters"],
                         {"type": "object", "properties": {}, "required": [],
                          "additionalProperties": False})
        self.assertTrue(schema["strict"])
        self.assertIs(llm.TOOLS["list_pets"], llm.list_pets)

    def test_guard_allows_list_without_id_and_rejects_extra_arguments(self):
        for args, destination in (({}, "read_tools"), ({"pet_id": 1}, "model_node")):
            with self.subTest(args=args):
                command = llm.guard_node({"messages": [AIMessage(content="", tool_calls=[
                    {"name": "list_pets", "args": args, "id": "test-call", "type": "tool_call"}
                ])]})
                self.assertEqual(command.goto, destination)

    def test_graph_executes_list_tool_for_list_and_count_requests(self):
        def fake_model(payload):
            if payload["input"][-1].get("type") == "function_call_output":
                return {"status": "completed", "output": [{"type": "message", "content": [
                    {"type": "output_text", "text": "offline-list-result"}]}]}
            return {"status": "completed", "output": [{"type": "function_call",
                    "name": "list_pets", "arguments": "{}", "call_id": "test-list-call"}]}

        with patch.object(llm, "responses_create", side_effect=fake_model):
            for question in ("一共有多少宠物？", "列出所有宠物", "有哪些宠物？"):
                with self.subTest(question=question):
                    self.respond(b'[{"id": 1, "name": "test-pet"}]')
                    self.opener.open.reset_mock()
                    result = llm.build_graph().invoke(
                        {"messages": [HumanMessage(content=question)]},
                        {"configurable": {"thread_id": question}})
                    tools = [message for message in result["messages"]
                             if isinstance(message, ToolMessage)]
                    self.assertEqual(len(tools), 1)
                    self.assertEqual(tools[0].name, "list_pets")
                    self.assertEqual(json.loads(tools[0].content)["count"], 1)
                    self.assertEqual(result["messages"][-1].content, "offline-list-result")
                    self.opener.open.assert_called_once()


if __name__ == "__main__":
    unittest.main()
