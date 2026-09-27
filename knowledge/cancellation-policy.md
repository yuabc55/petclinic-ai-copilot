# PetClinic 取消预约规则（演示）

## 可取消条件
Java 后端允许取消未来且状态为 REQUESTED 或 CONFIRMED 的预约。已经 CANCELLED 或 COMPLETED 的预约不属于可取消状态；最终能否取消由后端根据实时预约数据判定。

## 版本校验与冲突
取消前应通过 GET /appointments/{appointmentId} 读取实时 version，再向 POST /appointments/{appointmentId}/cancel 提交相同的 expectedVersion。版本过期或状态转换无效时，后端返回 HTTP 409；需要重新查询并重新审批，不自动改用新版本重试。

## 审批、权限和结果
本演示 Agent 在发送取消 POST 前必须暂停等待人工批准。启用后端安全时，未认证可能返回 HTTP 401、权限不足返回 HTTP 403。取消成功返回 HTTP 200，响应中的预约状态为 CANCELLED；不存在的预约返回 HTTP 404。
