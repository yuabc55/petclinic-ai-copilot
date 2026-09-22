"""Minimal LangGraph reducer demo with two parallel updates."""
import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph


class State(TypedDict):
    logs: Annotated[list[str], operator.add]


def first_node(state: State) -> dict:
    return {"logs": ["first node completed"]}


def second_node(state: State) -> dict:
    return {"logs": ["second node completed"]}


builder = StateGraph(State)
builder.add_node("first", first_node)
builder.add_node("second", second_node)
builder.add_edge(START, "first")
builder.add_edge(START, "second")
builder.add_edge("first", END)
builder.add_edge("second", END)
graph = builder.compile()


if __name__ == "__main__":
    result = graph.invoke({"logs": []})
    print(result)
