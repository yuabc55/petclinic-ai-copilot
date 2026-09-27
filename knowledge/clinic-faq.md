# PetClinic 常见问题（演示）

## 如何查询当前预约
提供预约 ID 后，Agent 通过 PetClinic 的 GET /appointments/{appointmentId} 查询当前状态、开始时间和版本。知识文档只解释规则，不包含任何预约的当前状态。

## 如何查询宠物
提供宠物 ID 后，Agent 通过 GET /pets/{petId} 获取宠物资料。宠物的实时资料不写入本知识库。

## 为什么取消需要确认
取消会改变后端业务状态。本演示先读取实时预约和 version，再在 Agent 的人工审批节点暂停；只有批准后才调用 Java 后端的取消 REST API。
