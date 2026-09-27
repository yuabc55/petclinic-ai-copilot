"""Local FastAPI wrapper around the existing DeepSeek PetClinic Agent graph."""

import os
import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.sse import EventSourceResponse, ServerSentEvent
from langgraph.checkpoint.sqlite import SqliteSaver
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command
from pydantic import BaseModel, Field

from demo_petclinic_llm_agent import build_graph


on_railway = bool(os.getenv("RAILWAY_PROJECT_ID"))
configured_origins = [origin.strip().rstrip("/") for origin in
                      os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
if on_railway and not configured_origins:
    raise RuntimeError("Set FRONTEND_ORIGINS to the deployed frontend origin.")
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins or [f"http://{host}:{port}"
                                        for host in ("localhost", "127.0.0.1")
                                        for port in (5173, 3000)],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
configured_checkpoint = os.getenv("CHECKPOINT_DB_PATH")
volume_path = os.getenv("RAILWAY_VOLUME_MOUNT_PATH")
if on_railway and (not configured_checkpoint or not volume_path):
    raise RuntimeError("Set CHECKPOINT_DB_PATH and attach a Railway Volume.")
checkpoint_path = Path(configured_checkpoint or os.getenv("AGENT_CHECKPOINT_PATH")
                       or ".agent-state/checkpoints.sqlite3")
if not checkpoint_path.is_absolute():
    checkpoint_path = Path(__file__).resolve().parent / checkpoint_path
if on_railway and not checkpoint_path.resolve().is_relative_to(Path(volume_path).resolve()):
    raise RuntimeError("CHECKPOINT_DB_PATH must be inside the Railway Volume mount.")
checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
checkpoint_connection = sqlite3.connect(checkpoint_path, check_same_thread=False)
graph = build_graph(checkpointer=SqliteSaver(checkpoint_connection))
graph_lock = Lock()


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    thread_id: str | None = None


class ResumeRequest(BaseModel):
    decision: Literal["approve", "reject"]


def config_for(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}


def has_interrupt(config: dict) -> bool:
    return any(task.interrupts for task in graph.get_state(config).tasks)


def sources_for(messages: list) -> list[dict[str, str]]:
    start = max((i for i, msg in enumerate(messages) if isinstance(msg, HumanMessage)),
                default=-1)
    sources, seen = [], set()
    for message in messages[start + 1:]:
        if not isinstance(message, ToolMessage) or message.name != "search_knowledge":
            continue
        try:
            rows = json.loads(message.content).get("results", [])
        except (TypeError, ValueError):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            source = {key: row.get(key, "") for key in ("title", "section", "snippet")}
            marker = tuple(source.values())
            if all(marker) and marker not in seen:
                sources.append(source)
                seen.add(marker)
    return sources


def response_for(result: dict, thread_id: str) -> dict:
    if result.get("__interrupt__"):
        pause = result["__interrupt__"][0].value
        return {"thread_id": thread_id, "status": "approval_required", "approval": {
            key: pause[key] for key in ("action", "appointmentId", "status", "expectedVersion")
        }}
    return {"thread_id": thread_id, "status": "completed",
            "message": result["messages"][-1].content,
            "sources": sources_for(result["messages"])}


def run_graph(value: dict | Command, config: dict, thread_id: str) -> dict:
    missing = [name for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL")
               if not os.getenv(name)]
    if missing:
        raise HTTPException(503, "Missing configuration: " + ", ".join(missing))
    try:
        return response_for(graph.invoke(value, config=config), thread_id)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/agent/chat")
def chat(body: ChatRequest) -> dict:
    if not body.message.strip():
        raise HTTPException(422, "message must not be blank")
    thread_id = body.thread_id or str(uuid4())
    config = config_for(thread_id)
    with graph_lock:
        if body.thread_id:
            snapshot = graph.get_state(config)
            if not snapshot.values:
                raise HTTPException(404, "Unknown thread_id")
            if has_interrupt(config):
                raise HTTPException(409, "Approval pending; use /resume")
        return run_graph({"messages": [HumanMessage(content=body.message)]}, config, thread_id)


@app.get("/agent/{thread_id}/state")
def thread_state(thread_id: str) -> dict:
    with graph_lock:
        snapshot = graph.get_state(config_for(thread_id))
        messages = snapshot.values.get("messages", [])
        if not messages:
            raise HTTPException(404, "Unknown thread_id")
        visible = []
        for message in messages:
            if isinstance(message, HumanMessage) and isinstance(message.content, str):
                visible.append({"role": "user", "content": message.content})
            elif (isinstance(message, AIMessage) and not message.tool_calls
                  and isinstance(message.content, str) and message.content):
                visible.append({"role": "assistant", "content": message.content})
        pauses = [pause for task in snapshot.tasks for pause in task.interrupts]
        approval = ({key: pauses[0].value[key] for key in
                    ("action", "appointmentId", "status", "expectedVersion")}
                    if pauses else None)
        return {"thread_id": thread_id,
                "status": "approval_required" if approval else "completed",
                "messages": visible, "approval": approval,
                "sources": sources_for(messages)}


@app.post("/agent/{thread_id}/resume")
def resume(thread_id: str, body: ResumeRequest) -> dict:
    config = config_for(thread_id)
    with graph_lock:
        if not has_interrupt(config):
            raise HTTPException(409, "No pending approval for thread_id")
        return run_graph(Command(resume=body.decision), config, thread_id)



@app.post("/agent/chat/stream", response_class=EventSourceResponse)
def chat_stream(body: ChatRequest):
    if not body.message.strip():
        raise HTTPException(422, "message must not be blank")
    thread_id = body.thread_id or str(uuid4())
    config = config_for(thread_id)
    labels = {"get_pet": "宠物", "get_appointment": "预约", "search_knowledge": "知识"}

    def events():
        yield ServerSentEvent(event="started", data={"thread_id": thread_id,
                              "message": "正在处理..."})
        with graph_lock:
            if body.thread_id:
                snapshot = graph.get_state(config)
                if not snapshot.values or has_interrupt(config):
                    yield ServerSentEvent(event="error", data={"thread_id": thread_id,
                                          "message": "未知 thread_id 或有待审批请求"})
                    return
            missing = [name for name in ("DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL")
                       if not os.getenv(name)]
            if missing:
                yield ServerSentEvent(event="error", data={"thread_id": thread_id,
                                      "message": "Missing configuration: " + ", ".join(missing)})
                return
            try:
                for part in graph.stream({"messages": [HumanMessage(content=body.message)]},
                                         config=config, stream_mode="updates", version="v2"):
                    updates = part["data"]
                    if "model_node" in updates:
                        message = updates["model_node"]["messages"][-1]
                        if isinstance(message, AIMessage):
                            for call in message.tool_calls:
                                if call["name"] in labels:
                                    yield ServerSentEvent(event="tool_started", data={
                                        "thread_id": thread_id, "tool": call["name"],
                                        "message": f"正在查询{labels[call['name']]}..."})
                    if "read_tools" in updates:
                        for message in updates["read_tools"]["messages"]:
                            if isinstance(message, ToolMessage):
                                yield ServerSentEvent(event="tool_completed", data={
                                    "thread_id": thread_id, "tool": message.name,
                                    "status": json.loads(message.content).get("status"),
                                    "message": f"{labels.get(message.name, '工具')}查询完成"})
                snapshot = graph.get_state(config)
                pauses = [pause for task in snapshot.tasks for pause in task.interrupts]
                if pauses:
                    payload = pauses[0].value
                    yield ServerSentEvent(event="approval_required", data={
                        "thread_id": thread_id, "status": "approval_required",
                        "message": "等待人工审批...",
                        "approval": {key: payload[key] for key in
                                     ("action", "appointmentId", "status", "expectedVersion")}})
                else:
                    yield ServerSentEvent(event="completed", data={
                        "thread_id": thread_id, "status": "completed",
                        "message": snapshot.values["messages"][-1].content,
                        "sources": sources_for(snapshot.values["messages"])})
            except (RuntimeError, ValueError, KeyError) as exc:
                yield ServerSentEvent(event="error", data={"thread_id": thread_id,
                                      "message": str(exc)})

    yield from events()
