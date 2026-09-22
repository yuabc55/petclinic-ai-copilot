"""Deterministic PetClinic agent: a real local HTTP tool, without an LLM."""
import json
import re
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode

from demo_petclinic_tools import get_pet


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def model_node(state: State) -> dict:
    last = state["messages"][-1]
    if isinstance(last, ToolMessage):
        result = json.loads(last.content)
        if result["ok"]:
            pet = result["data"]
            final = (
                f"宠物 {pet['id']}：{pet.get('name', '未知')}；"
                f"类型：{(pet.get('type') or {}).get('name', '未知')}；"
                f"出生日期：{pet.get('birthDate', '未知')}；"
                f"主人 ID：{pet.get('ownerId', '未知')}。"
            )
        else:
            final = f"查询失败：{result['error']}（HTTP 状态：{result['status']}）。"
        return {"messages": [AIMessage(content=final)]}

    match = re.fullmatch(r"查询宠物\s*(\d+)\s*的信息", last.content)
    if not isinstance(last, HumanMessage) or not match:
        return {"messages": [AIMessage(content="请使用：查询宠物1的信息") ]}
    return {"messages": [AIMessage(content="", tool_calls=[{
        "name": "get_pet", "args": {"pet_id": int(match.group(1))},
        "id": "call-pet-1", "type": "tool_call",
    }])]}


def route_after_model(state: State) -> Literal["tools", "end"]:
    last = state["messages"][-1]
    return "tools" if isinstance(last, AIMessage) and last.tool_calls else "end"


builder = StateGraph(State)
builder.add_node("model", model_node)
builder.add_node("tools", ToolNode([get_pet]))
builder.add_edge(START, "model")
builder.add_conditional_edges(
    "model", route_after_model, {"tools": "tools", "end": END}
)
builder.add_edge("tools", "model")
graph = builder.compile()


if __name__ == "__main__":
    result = graph.invoke({"messages": [HumanMessage(content="查询宠物1的信息")]})
    messages = result["messages"]
    for index, message in enumerate(messages, start=1):
        print(f"{index}. {type(message).__name__}")
        print(json.dumps(message.model_dump(mode="json"), ensure_ascii=False, indent=2))
    assert [type(message) for message in messages] == [
        HumanMessage, AIMessage, ToolMessage, AIMessage,
    ]
    assert messages[2].tool_call_id == messages[1].tool_calls[0]["id"]
    assert not messages[-1].tool_calls
