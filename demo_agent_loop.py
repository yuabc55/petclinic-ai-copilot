"""Minimal deterministic LangGraph agent loop with local tools."""
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode

from demo_parallel_tools import get_project_name, get_tool_count


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def model_node(state: State) -> dict:
    results = {message.tool_call_id: message.content
               for message in state["messages"]
               if isinstance(message, ToolMessage)}
    if not results:
        return {"messages": [AIMessage(
            content="",
            id="model-tool-request",
            tool_calls=[
                {"name": "get_project_name", "args": {},
                 "id": "call-project-1", "type": "tool_call"},
                {"name": "get_tool_count", "args": {},
                 "id": "call-count-1", "type": "tool_call"},
            ],
        )]}
    final = (f"Project: {results['call-project-1']}; "
             f"local tool count: {results['call-count-1']}.")
    return {"messages": [AIMessage(content=final, id="model-final-answer")]}


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


if __name__ == "__main__":
    result = graph.invoke({"messages": []})
    for index, message in enumerate(result["messages"], start=1):
        print(
            index,
            type(message).__name__,
            f"tool_call_id={getattr(message, 'tool_call_id', None)}",
            f"content={message.content!r}",
        )
