"""Minimal LangGraph ToolNode demo with two independent tool calls."""
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


@tool
def get_project_name() -> str:
    """Return the local demo project name."""
    return "temp-learning-tool-demo"


@tool
def get_tool_count() -> int:
    """Return the number of local tools in this demo."""
    return 2


tools = [get_project_name, get_tool_count]
tool_node = ToolNode(tools)

builder = StateGraph(State)
builder.add_node("execute_tools", tool_node)
builder.add_edge(START, "execute_tools")
builder.add_edge("execute_tools", END)
graph = builder.compile()


if __name__ == "__main__":
    assistant_message = AIMessage(
        content="",
        id="assistant-1",
        tool_calls=[
            {"name": "get_project_name", "args": {},
             "id": "call-project-1", "type": "tool_call"},
            {"name": "get_tool_count", "args": {},
             "id": "call-count-1", "type": "tool_call"},
        ],
    )
    result = graph.invoke({"messages": [assistant_message]})

    expected = {"call-project-1", "call-count-1"}
    actual = {message.tool_call_id for message in result["messages"]
              if hasattr(message, "tool_call_id")}
    assert actual == expected

    for message in result["messages"]:
        print(
            f"type={type(message).__name__} "
            f"id={message.id} "
            f"tool_call_id={getattr(message, 'tool_call_id', None)} "
            f"content={message.content!r}"
        )
