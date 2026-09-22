"""Minimal LangGraph AIMessage/ToolMessage correlation demo."""
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langgraph.graph import END, START, StateGraph, add_messages


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def record_tool_exchange(state: State) -> dict:
    return {
        "messages": [
            AIMessage(
                content="",
                id="assistant-1",
                tool_calls=[
                    {"name": "list_files", "args": {"path": "."},
                     "id": "call-list-1", "type": "tool_call"},
                    {"name": "read_text_file", "args": {"path": "notes.txt"},
                     "id": "call-read-1", "type": "tool_call"},
                ],
            ),
            ToolMessage(
                content="['demo.py', 'notes.txt']",
                name="list_files",
                tool_call_id="call-list-1",
                id="tool-result-1",
            ),
            ToolMessage(
                content="Notes content",
                name="read_text_file",
                tool_call_id="call-read-1",
                id="tool-result-2",
            ),
        ]
    }


builder = StateGraph(State)
builder.add_node("record_tool_exchange", record_tool_exchange)
builder.add_edge(START, "record_tool_exchange")
builder.add_edge("record_tool_exchange", END)
graph = builder.compile()


if __name__ == "__main__":
    result = graph.invoke({"messages": []})
    for message in result["messages"]:
        tool_call_id = getattr(message, "tool_call_id", None)
        print(
            f"type={type(message).__name__} "
            f"id={message.id} "
            f"tool_call_id={tool_call_id}"
        )
        if isinstance(message, AIMessage):
            print("tool_calls:", [(call["name"], call["id"])
                                  for call in message.tool_calls])
