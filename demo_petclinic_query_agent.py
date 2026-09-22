"""Deterministic read-only PetClinic agent with four runnable examples."""
import json
import re
from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode

from demo_petclinic_tools import get_appointment, get_pet


class State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


def model_node(state: State) -> dict:
    last = state["messages"][-1]
    if isinstance(last, ToolMessage):
        result = json.loads(last.content)
        subject = "宠物" if last.name == "get_pet" else "预约"
        if not result["ok"]:
            final = (f"{subject}不存在（HTTP 404）。" if result["status"] == 404
                     else f"查询失败：{result['error']}（HTTP 状态：{result['status']}）。")
        else:
            data = result["data"]
            if last.name == "get_pet":
                final = (f"宠物 {data['id']}：{data.get('name', '未知')}；"
                         f"类型：{(data.get('type') or {}).get('name', '未知')}；"
                         f"出生日期：{data.get('birthDate', '未知')}；"
                         f"主人 ID：{data.get('ownerId', '未知')}。")
            else:
                final = (f"预约 {data['id']}：宠物 ID {data.get('petId', '未知')}；"
                         f"兽医 ID {data.get('vetId', '未知')}；"
                         f"开始时间：{data.get('startAt', '未知')}；"
                         f"状态：{data.get('status', '未知')}。")
        return {"messages": [AIMessage(content=final)]}

    text = last.content.strip() if isinstance(last, HumanMessage) else ""
    match = re.fullmatch(r"查询(宠物|预约)\s*([0-9]+)?\s*的信息", text)
    if not match:
        return {"messages": [AIMessage(content="不支持该请求；支持按 ID 查询宠物或预约。") ]}
    subject, identifier = match.groups()
    if identifier is None:
        return {"messages": [AIMessage(content=f"请提供{subject} ID，例如：查询{subject}1的信息。") ]}
    name, argument = ("get_pet", "pet_id") if subject == "宠物" else (
        "get_appointment", "appointment_id")
    return {"messages": [AIMessage(content="", tool_calls=[{
        "name": name, "args": {argument: int(identifier)},
        "id": f"call-{name}-{identifier}", "type": "tool_call",
    }])]}


def route_after_model(state: State) -> Literal["tools", "end"]:
    last = state["messages"][-1]
    return "tools" if isinstance(last, AIMessage) and last.tool_calls else "end"


builder = StateGraph(State)
builder.add_node("model_node", model_node)
builder.add_node("tools", ToolNode([get_pet, get_appointment]))
builder.add_edge(START, "model_node")
builder.add_conditional_edges(
    "model_node", route_after_model, {"tools": "tools", "end": END}
)
builder.add_edge("tools", "model_node")
graph = builder.compile()


if __name__ == "__main__":
    examples = [
        ("查询宠物1的信息", "get_pet", {"pet_id": 1}, 200),
        ("查询预约100的信息", "get_appointment", {"appointment_id": 100}, 404),
        ("查询宠物的信息", None, None, None),
        ("列出所有医生", None, None, None),
    ]
    for request, expected_tool, expected_args, expected_status in examples:
        print(f"\n用户请求：{request}")
        path = ["START"]
        for mode, event in graph.stream(
            {"messages": [HumanMessage(content=request)]},
            stream_mode=["updates", "values"],
        ):
            if mode == "updates":
                path.extend(event)
            else:
                messages = event["messages"]
        print("执行路径：", " → ".join(path + ["END"]))
        for message in messages:
            print(type(message).__name__)
            print(json.dumps(message.model_dump(mode="json"), ensure_ascii=False, indent=2))
        assert isinstance(messages[0], HumanMessage) and messages[0].content == request
        assert isinstance(messages[-1], AIMessage) and not messages[-1].tool_calls
        if expected_tool:
            assert [type(m) for m in messages] == [HumanMessage, AIMessage, ToolMessage, AIMessage]
            call = messages[1].tool_calls[0]
            assert call["name"] == expected_tool and call["args"] == expected_args
            assert messages[2].tool_call_id == call["id"]
            assert json.loads(messages[2].content)["status"] == expected_status
        else:
            assert [type(m) for m in messages] == [HumanMessage, AIMessage]
    print("\n四个查询场景验证通过。")
