"""Minimal LangGraph add_messages replacement demo."""
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langgraph.graph import END, START, StateGraph, add_messages


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def add_answer(state: State) -> dict:
    return {"messages": [AIMessage("Initial answer", id="answer-1")]}


def correct_answer(state: State) -> dict:
    return {"messages": [AIMessage("Corrected answer", id="answer-1")]}


builder = StateGraph(State)
builder.add_node("add_answer", add_answer)
builder.add_node("correct_answer", correct_answer)
builder.add_edge(START, "add_answer")
builder.add_edge("add_answer", "correct_answer")
builder.add_edge("correct_answer", END)
graph = builder.compile()


if __name__ == "__main__":
    result = graph.invoke({
        "messages": [HumanMessage("What is 2 + 2?", id="question-1")]
    })
    for message in result["messages"]:
        print(type(message).__name__, message.id, repr(message.content))
