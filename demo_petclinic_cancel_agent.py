"""Real PetClinic cancellation with deterministic planning and human approval.

Run: .venv/Scripts/python.exe -B -X utf8 demo_petclinic_cancel_agent.py
Optional HTTP Basic credentials: PETCLINIC_USERNAME / PETCLINIC_PASSWORD.
InMemorySaver survives interrupts within this process, not process restarts.
"""
import base64
import json
import os
import re
import sys
from typing import Annotated, Literal, TypedDict
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import uuid4

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode
from langgraph.types import Command, interrupt

from demo_petclinic_tools import BASE_URL, TIMEOUT_SECONDS


HTTP_EVENTS: list[dict] = []  # Demo trace: never record credentials.


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # A write must not silently follow a redirect.


def request_json(method: str, path: str, body: dict | None = None,
                 *, allow_list: bool = False) -> dict:
    headers = {"Accept": "application/json"}
    username, password = os.getenv("PETCLINIC_USERNAME"), os.getenv("PETCLINIC_PASSWORD")
    if username is not None or password is not None:
        if not username or password is None:
            return {"ok": False, "status": None, "error": "incomplete_credentials"}
        token = base64.b64encode(f"{username}:{password}".encode()).decode()
        headers["Authorization"] = f"Basic {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(BASE_URL + path, method=method, headers=headers,
                      data=None if body is None else json.dumps(body).encode())
    event = {"method": method, "url": request.full_url, "body": body, "status": None}
    HTTP_EVENTS.append(event)
    try:
        with build_opener(NoRedirect()).open(request, timeout=TIMEOUT_SECONDS) as response:
            event["status"] = response.status
            raw = response.read()
    except HTTPError as exc:
        event["status"] = exc.code
        with exc:
            raw = exc.read()
    except (URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "status": event["status"], "error": "connection_failure",
                "detail": str(exc), "outcome_unknown": method == "POST"}
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError):
        data = None
    status = event["status"]
    if status != 200:
        return {"ok": False, "status": status, "error": "http_error",
                "code": data.get("code") if isinstance(data, dict) else None,
                "detail": data.get("detail") if isinstance(data, dict) else "Non-JSON error response"}
    if not isinstance(data, list if allow_list else dict):
        return {"ok": False, "status": 200, "error": "invalid_response"}
    return {"ok": True, "status": 200, "data": data}


@tool
def get_appointment(appointment_id: int) -> dict:
    """Read an appointment and its current version from PetClinic."""
    return request_json("GET", f"/appointments/{appointment_id}")


@tool
def cancel_appointment(appointment_id: int, expected_version: int) -> dict:
    """Cancel the approved appointment using its approved version; never retry."""
    return request_json("POST", f"/appointments/{appointment_id}/cancel",
                        {"expectedVersion": expected_version})


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def final_answer(content: str) -> dict:
    return {"messages": [AIMessage(content=content)]}


def tool_request(name: str, args: dict) -> dict:
    return {"messages": [AIMessage(content="", tool_calls=[{
        "name": name, "args": args, "id": str(uuid4()), "type": "tool_call",
    }])]}


def model_node(state: State) -> dict:
    last = state["messages"][-1]
    if isinstance(last, HumanMessage):
        match = re.fullmatch(r"取消预约\s*([1-9][0-9]*)", last.content.strip())
        if not match or int(match[1]) > 2147483647:
            return final_answer("请提供有效预约 ID，例如：取消预约10。")
        return tool_request("get_appointment", {"appointment_id": int(match[1])})

    result = json.loads(last.content)
    if result.get("error") == "human_rejected":
        return final_answer("人工拒绝：未发送取消请求，取消操作未执行。")
    if not result["ok"]:
        if last.name == "cancel_appointment" and result["status"] == 409:
            return final_answer("预约已变化或当前状态不允许取消（HTTP 409）。"
                                "必须重新查询并重新审批；本次没有自动重试。")
        uncertain = "取消结果未知，请人工核实；本次没有重试。" if result.get("outcome_unknown") else ""
        return final_answer(f"{last.name} 失败：HTTP {result['status']}，"
                            f"{result.get('code') or result['error']}。{uncertain}")

    call = next(call for message in reversed(state["messages"])
                if isinstance(message, AIMessage) for call in message.tool_calls
                if call["id"] == last.tool_call_id)
    data = result["data"]
    version = data.get("version")
    if (data.get("id") != call["args"]["appointment_id"]
            or type(version) is not int or not 0 <= version <= 9223372036854775807
            or not isinstance(data.get("status"), str)):
        return final_answer("后端响应缺少匹配的预约 ID、状态或有效版本；停止处理，请人工核实。")
    if last.name == "get_appointment":
        return tool_request("cancel_appointment", {
            "appointment_id": data["id"], "expected_version": version,
        })
    if data["status"] != "CANCELLED":
        return final_answer("取消接口返回了非 CANCELLED 状态，请人工核实；不会重试。")
    return final_answer(f"预约 {data['id']} 已取消：status=CANCELLED，version={version}。")


def route_after_model(state: State) -> Literal["read_tools", "approval_node", "end"]:
    last = state["messages"][-1]
    if not last.tool_calls:
        return "end"
    return "read_tools" if last.tool_calls[0]["name"] == "get_appointment" else "approval_node"


def approval_node(state: State) -> Command[Literal["cancel_tools", "model_node"]]:
    call = state["messages"][-1].tool_calls[0]
    args = call["args"]
    observed = json.loads(next(message.content for message in reversed(state["messages"])
                               if isinstance(message, ToolMessage)
                               and message.name == "get_appointment"))["data"]
    decision = interrupt({
        "action": "cancel_appointment", "appointmentId": args["appointment_id"],
        "status": observed["status"],
        "expectedVersion": args["expected_version"], "tool_call_id": call["id"],
    })
    if decision == "approve":
        return Command(goto="cancel_tools")
    return Command(goto="model_node", update={"messages": [ToolMessage(
        name=call["name"], tool_call_id=call["id"],
        content=json.dumps({"ok": False, "status": None, "error": "human_rejected"}),
    )]})


def build_graph():
    builder = StateGraph(State)
    builder.add_node("model_node", model_node)
    builder.add_node("read_tools", ToolNode([get_appointment]))
    builder.add_node("approval_node", approval_node)
    builder.add_node("cancel_tools", ToolNode([cancel_appointment]))
    builder.add_edge(START, "model_node")
    builder.add_conditional_edges("model_node", route_after_model, {
        "read_tools": "read_tools", "approval_node": "approval_node", "end": END,
    })
    builder.add_edge("read_tools", "model_node")
    builder.add_edge("cancel_tools", "model_node")
    return builder.compile(checkpointer=InMemorySaver())


def run_stage(graph, value, config) -> dict:
    for update in graph.stream(value, config=config, stream_mode="updates"):
        print("GRAPH:", ", ".join(update))
    snapshot = graph.get_state(config)
    print("CHECKPOINT:", config["configurable"]["thread_id"], "next=", snapshot.next)
    return snapshot.values


def print_messages(messages):
    for message in messages:
        print(type(message).__name__)
        print(json.dumps(message.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    graph = build_graph()
    config = {"configurable": {"thread_id": str(uuid4())}}
    request = sys.argv[1] if len(sys.argv) > 1 else "取消预约10"
    result = run_stage(graph, {"messages": [HumanMessage(content=request)]}, config)
    snapshot = graph.get_state(config)
    pauses = [pause for task in snapshot.tasks for pause in task.interrupts]
    if pauses:
        print_messages(result["messages"])
        print("INTERRUPT:", json.dumps(pauses[0].value, ensure_ascii=False))
        print("HTTP BEFORE APPROVAL:", json.dumps(HTTP_EVENTS, ensure_ascii=False))
        try:
            decision = input("输入 approve 批准；其他输入拒绝：").strip()
        except (EOFError, KeyboardInterrupt):
            decision = "reject"
        result = run_stage(graph, Command(resume=decision), config)
    print_messages(result["messages"])
    print("HTTP REQUESTS:", json.dumps(HTTP_EVENTS, ensure_ascii=False, indent=2))
