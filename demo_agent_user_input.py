"""Deterministic LangGraph agent loop starting from a HumanMessage."""
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode

from demo_parallel_tools import get_project_name, get_tool_count


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def model_node(state: State) -> dict:
    user = next(message for message in reversed(state["messages"])
                if isinstance(message, HumanMessage))
    request = str(user.content).lower()
    wants_project = "project name" in request
    wants_count = "tool count" in request
    results = {message.tool_call_id: message.content
               for message in state["messages"]
               if isinstance(message, ToolMessage)}

    if results:
        parts = []
        if wants_project:
            parts.append(f"Project: {results['call-project-1']}")
        if wants_count:
            parts.append(f"Tool count: {results['call-count-1']}")
        return {"messages": [AIMessage("; ".join(parts), id="final-answer")]}

    calls = []
    if wants_project:
        calls.append({"name": "get_project_name", "args": {},
                      "id": "call-project-1", "type": "tool_call"})
    if wants_count:
        calls.append({"name": "get_tool_count", "args": {},
                      "id": "call-count-1", "type": "tool_call"})
    if calls:
        return {"messages": [AIMessage(content="", id="tool-request",
                                       tool_calls=calls)]}
    return {"messages": [AIMessage("No tool is needed.", id="direct-answer")]}


def route_after_model(state: State) -> Literal["tools", "end"]:
    last = state["messages"][-1]
    return "tools" if isinstance(last, AIMessage) and last.tool_calls else "end"


builder = StateGraph(State)
builder.add_node("model", model_node)
builder.add_node("tools", ToolNode([get_project_name, get_tool_count]))
builder.add_edge(START, "model")
builder.add_conditional_edges(
    "model", route_after_model, {"tools": "tools", "end": END}
)
builder.add_edge("tools", "model")
graph = builder.compile()


def run_example(number: int, request: str) -> None:
    path = ["START"]
    final = ""
    for update in graph.stream(
        {"messages": [HumanMessage(request, id=f"user-{number}")]},
        stream_mode="updates",
    ):
        for node, state_update in update.items():
            path.append(node)
            for message in state_update.get("messages", []):
                if isinstance(message, AIMessage) and message.content:
                    final = str(message.content)
    path.append("END")
    print(f"{number}. INPUT: {request}")
    print("   PATH:", " -> ".join(path))
    print("   FINAL:", final)


if __name__ == "__main__":
    examples = [
        "What is the project name?",
        "What is the tool count?",
        "What are the project name and tool count?",
        "Say hello without using a tool.",
    ]
    for index, example in enumerate(examples, start=1):
        run_example(index, example)
