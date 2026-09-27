# PetClinic 预约规则（演示）

## 创建预约
公开 REST API 接收 petId、vetId 和带时区的未来 startAt。创建成功返回 HTTP 201 和预约对象；当前演示中创建后的初始状态为 REQUESTED。实际校验由 Java 后端负责。

## 状态与实时查询
预约状态包括 REQUESTED、CONFIRMED、CANCELLED、COMPLETED。某个预约当前的状态、时间和 version 必须调用 GET /appointments/{appointmentId} 查询；本知识库不保存任何预约实例的实时数据。

## 确认预约
后端的确认接口针对未来且处于 REQUESTED 的预约，提交时需要 expectedVersion。版本冲突或无效状态转换返回 HTTP 409。
