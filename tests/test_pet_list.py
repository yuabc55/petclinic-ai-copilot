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
                    self.assertIn('**1', result["messages"][-1].content)
                    if question != "一共有多少宠物？":
                        self.assertIn('test-pet', result["messages"][-1].content)
                    self.opener.open.assert_called_once()


    def test_existing_thread_can_query_pets_after_eight_model_turns(self):
        payloads = []

        def fake_model(payload):
            payloads.append(payload)
            if (payload['tool_choice'] == 'none'
                    or payload['input'][-1].get('type') == 'function_call_output'):
                return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                    {'type': 'output_text', 'text': 'offline-result'}]}]}
            return {'status': 'completed', 'output': [{'type': 'function_call',
                    'name': 'list_pets', 'arguments': '{}',
                    'call_id': f'test-call-{len(payloads)}'}]}

        graph = llm.build_graph()
        config = {'configurable': {'thread_id': 'test-multiple-pet-queries'}}
        with patch.object(llm, 'responses_create', side_effect=fake_model):
            for index in range(5):
                self.respond(b'[{"id": 1}]')
                result = graph.invoke({'messages': [HumanMessage(
                    content=f'How many pets? Request {index + 1}.')]}, config)
                self.assertEqual(result['turns'], 2)
                self.assertFalse(result['halted'])
        self.assertEqual(self.opener.open.call_count, 5)
        self.assertTrue(all(payload['tool_choice'] == 'auto' for payload in payloads))
        self.assertEqual(sum(isinstance(message, HumanMessage)
                             for message in result['messages']), 5)
        self.assertEqual(sum(isinstance(message, ToolMessage)
                             for message in result['messages']), 5)
        self.assertEqual(sum(item.get('role') == 'user'
                             for item in payloads[-1]['input']), 5)

    def test_new_query_can_use_tools_after_a_blocked_request(self):
        calls = []

        def fake_model(payload):
            calls.append(payload['tool_choice'])
            if (payload['tool_choice'] == 'none'
                    or payload['input'][-1].get('type') == 'function_call_output'):
                return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                    {'type': 'output_text', 'text': 'offline-result'}]}]}
            args = {'pet_id': 1} if payload['input'][-1]['content'] == 'blocked-query' else {}
            return {'status': 'completed', 'output': [{'type': 'function_call',
                    'name': 'list_pets', 'arguments': json.dumps(args),
                    'call_id': f'test-blocked-call-{len(calls)}'}]}

        graph = llm.build_graph()
        config = {'configurable': {'thread_id': 'test-query-after-block'}}
        with patch.object(llm, 'responses_create', side_effect=fake_model):
            blocked = graph.invoke({'messages': [HumanMessage(content='blocked-query')]}, config)
            self.assertTrue(blocked['halted'])
            self.opener.open.assert_not_called()
            self.respond(b'[{"id": 1}]')
            result = graph.invoke({'messages': [HumanMessage(content='How many pets?')]}, config)
        self.assertEqual(calls, ['auto', 'none'])
        self.assertFalse(result['halted'])
        self.assertEqual(result['turns'], 2)
        self.opener.open.assert_called_once()
        self.assertEqual(json.loads(result['messages'][-2].content)['count'], 1)

    def test_single_request_still_stops_at_the_tool_turn_limit(self):
        calls = []

        def response(request, timeout):
            result = BytesIO(b'[{"id": 1}]')
            result.status = 200
            return result

        def looping_model(payload):
            calls.append(payload['tool_choice'])
            if payload['tool_choice'] == 'none':
                return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                    {'type': 'output_text', 'text': 'offline-stopped'}]}]}
            return {'status': 'completed', 'output': [{'type': 'function_call',
                    'name': 'list_pets', 'arguments': '{}', 'call_id': f'test-loop-{len(calls)}'}]}

        self.opener.open.side_effect = response
        with patch.object(llm, 'responses_create', side_effect=looping_model):
            result = llm.build_graph().invoke(
                {'messages': [HumanMessage(content='Inspect pets in detail')]},
                {'configurable': {'thread_id': 'test-pet-loop-limit'}, 'recursion_limit': 50})
        self.assertEqual(calls, ['auto'] * 8 + ['none'])
        self.assertTrue(result['halted'])
        self.assertEqual(self.opener.open.call_count, 8)


    def test_explicit_pet_list_requests_require_list_tool(self):
        questions = ('how many pets in total', 'How many pets are there?',
                     '  HOW   MANY PETS IN TOTAL?  ', 'list all pets', 'show all pets',
                     '一共有多少宠物？', '列出所有宠物', '有哪些宠物？')
        with patch.object(llm, 'responses_create') as model:
            for question in questions:
                with self.subTest(question=question):
                    result = llm.model_node({'messages': [HumanMessage(content=question)]})
                    call = result['messages'][-1].tool_calls[0]
                    self.assertEqual(call['name'], 'list_pets')
                    self.assertEqual(call['args'], {})
                    self.assertEqual(result['api_history'], [{'role': 'user', 'content': question}])
            model.assert_not_called()
        self.opener.open.assert_not_called()

    def test_other_requests_keep_automatic_tool_selection(self):
        response = {'status': 'completed', 'output': [{'type': 'message', 'content': [
                    {'type': 'output_text', 'text': 'offline-result'}]}]}
        with patch.object(llm, 'responses_create', return_value=response) as model:
            for question in ('Show pet 1', 'Cancel appointment 5', '取消预约5',
                             'How many pets does owner 1 have?', 'Do not list all pets',
                             'What are the clinic vaccination policies?'):
                with self.subTest(question=question):
                    llm.model_node({'messages': [HumanMessage(content=question)]})
                    self.assertEqual(model.call_args.args[0]['tool_choice'], 'auto')
        self.opener.open.assert_not_called()

    def test_old_refusal_history_cannot_skip_required_list_query(self):
        history = [{'role': 'user', 'content': 'how many pets in total'},
                   {'role': 'assistant', 'content': 'I have no pet list tool.'}] * 7
        self.respond(b'[{"id": 1}, {"id": 3}]')
        with patch.object(llm, 'responses_create') as model:
            result = llm.build_graph().invoke(
                {'messages': [HumanMessage(content='how many pets in total')],
                 'api_history': history, 'turns': 20, 'halted': True},
                {'configurable': {'thread_id': 'test-historical-refusals'}})
        model.assert_not_called()
        self.assertEqual(result['messages'][-1].content, 'There are **2 pets** in total.')
        self.assertEqual(result['api_history'][:len(history)], history)
        self.opener.open.assert_called_once()

    def test_explicit_list_http_error_is_preserved_in_graph(self):
        self.opener.open.side_effect = HTTPError(
            cancel.BASE_URL + '/pets', 404, 'test-error', {},
            BytesIO(b'{"detail": "test-not-found"}'))

        with patch.object(llm, 'responses_create') as model:
            result = llm.build_graph().invoke(
                {'messages': [HumanMessage(content='how many pets in total')]},
                {'configurable': {'thread_id': 'test-list-http-error'}})
        self.assertIn('HTTP 404', result['messages'][-1].content)
        self.assertNotIn('pets** in total', result['messages'][-1].content)
        tool = next(message for message in result['messages'] if isinstance(message, ToolMessage))
        self.assertNotIn('count', json.loads(tool.content))
        model.assert_not_called()
        self.opener.open.assert_called_once()


if __name__ == "__main__":
    unittest.main()
