"""Minimal LangGraph state -> interrupt -> checkpoint -> resume demo."""
import sys
from pathlib import Path
from typing import Literal, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class State(TypedDict):
    path: str
    content: str
    decision: str
    status: str


def approval_step(state: State) -> dict:
    decision = interrupt({
        "question": "Approve this file write?",
        "path": state["path"],
        "content": state["content"],
    })
    return {
        "decision": decision,
        "status": "approved" if decision == "approve" else "rejected",
    }


def route_after_approval(state: State) -> Literal["write", "finish"]:
    return "write" if state["decision"] == "approve" else "finish"


def write_step(state: State) -> dict:
    if state["decision"] != "approve":
        return {"status": "rejected"}
    Path(state["path"]).write_text(state["content"], encoding="utf-8")
    return {"status": "written"}


def build_graph():
    builder = StateGraph(State)
    builder.add_node("approval", approval_step)
    builder.add_node("write", write_step)
    builder.add_edge(START, "approval")
    builder.add_conditional_edges(
        "approval", route_after_approval, {"write": "write", "finish": END}
    )
    builder.add_edge("write", END)
    return builder.compile(checkpointer=InMemorySaver())


def run(decision: Literal["approve", "reject"]) -> None:
    graph = build_graph()
    config = {"configurable": {"thread_id": "file-write-demo-1"}}
    initial_state: State = {
        "path": "hitl-interrupt-demo.txt",
        "content": "Approved through LangGraph interrupt.\n",
        "decision": "pending",
        "status": "pending",
    }

    paused = graph.invoke(initial_state, config=config)
    print("INTERRUPT:", paused["__interrupt__"])

    resumed = graph.invoke(Command(resume=decision), config=config)
    print("FINAL STATE:", resumed)


if __name__ == "__main__":
    choice = sys.argv[1] if len(sys.argv) > 1 else "reject"
    if choice not in {"approve", "reject"}:
        raise SystemExit("Usage: python demo_interrupt.py [approve|reject]")
    run(choice)  # Default is reject; only approve can write the file.
