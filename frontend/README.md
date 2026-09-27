# PetClinic Agent UI

PetClinic 控制台和右侧 Agent Drawer。当前重点是实时展示 Agent 的工作流，让预约变更始终经过人工审批。

## 安装和启动

需要 Node.js 20 或更新版本，以及 pnpm。

```powershell
cd frontend
pnpm install
pnpm dev
```

打开 <http://127.0.0.1:5173>。生产构建使用 `pnpm build`，测试使用 `pnpm test`。

## Agent API 配置

默认模式为真实 API。可复制 `.env.example` 为 `.env.local`：

```dotenv
VITE_AGENT_MODE=api
# 可选：直接连接 FastAPI。留空时使用 Vite 的本地代理。
VITE_AGENT_API_BASE_URL=
```

开发代理默认把 `/agent/*` 转发到 `http://127.0.0.1:8000`。FastAPI 应在该地址启动，并配置它所需的 DeepSeek 环境变量：

```powershell
# 在项目根目录运行
.\.venv\Scripts\python.exe -B -X utf8 -m uvicorn demo_petclinic_api:app --host 127.0.0.1 --port 8000
```

设置非空的 `VITE_AGENT_API_BASE_URL` 可让前端直接请求该地址；直接跨域访问时，FastAPI 也必须允许前端来源。修改 `.env.local` 后重启 Vite。

`VITE_AGENT_MODE=mock` 只供离线布局预览，不代表真实诊所数据，也不能用于 Agent API 验收。

## Vercel 部署

- 导入仓库时将 **Root Directory** 设为 `frontend`，选择 Vite；安装命令 `pnpm install`，构建命令 `pnpm build`，输出目录 `dist`。
- 在 Vercel 的环境变量中设置 `VITE_AGENT_MODE=api` 和 `VITE_AGENT_API_BASE_URL=https://<公网 FastAPI 域名>`。填 API 的 HTTPS 根地址，不要附加 `/agent`，也不要填本机地址。这两个变量在构建时写入前端，修改后需要重新部署。
- 前端会用同一地址请求 `POST /agent/chat/stream`、`GET /agent/{thread_id}/state` 和 `POST /agent/{thread_id}/resume`。公网 FastAPI 须允许 Vercel 前端域名跨域访问，并提供可用的 SSE 响应。
- 当前应用只在根路径 `/` 展示 Drawer，没有客户端子路由；从 `/` 刷新不需要 SPA rewrite。如果以后加入客户端路由，再添加 Vercel 的 `index.html` rewrite。
- 部署后打开 `https://<前端域名>/`，并检查浏览器网络请求是否发往上述公网 API 路径；也可先访问 `https://<公网 FastAPI 域名>/health` 确认后端可达。

## 当前能力

- 右侧 Copilot Drawer，将当前 `thread_id` 保存到浏览器 localStorage。页面刷新后通过 `GET /agent/{thread_id}/state` 恢复用户和 Agent 消息；如有待审批操作，也恢复后端提供的 Approval Card。New conversation 会清除页面消息与保存的线程 ID。
- Enter 发送，Shift+Enter 换行；请求期间禁用重复提交，并在打开 Drawer 时聚焦输入框。
- `POST /agent/chat/stream` 的 SSE Activity Timeline：请求开始、工具开始/完成、审批等待、完成和错误。相同工具在一轮时间线中复用一行，不显示模型内部思维。
- 后端返回 `approval_required` 时显示真实 Approval Card。Approve / Reject 通过 `POST /agent/{thread_id}/resume` 提交。
- completed 响应包含非空 `sources` 时，在回答下面显示来源标题、章节和可展开摘要。前端不会创建或补造来源。
- 网络中断、FastAPI 未启动、非 2xx、无效 SSE/JSON、未知线程和 resume 失败会显示错误；保存的线程失效时会清理 localStorage，允许重新开始。

## 已知限制

- `/resume` 目前不是 SSE。审批后的时间线会显示本地等待状态，完成后以 resume 的 JSON 响应更新。
- FastAPI 需要提供 `GET /agent/{thread_id}/state` 和 SQLite checkpoint，才能在页面刷新或服务重启后恢复对话与待审批卡。刷新后不会重放完整 Activity Timeline；前端当前不会重建既有回答的 Sources。
- Sources 是否出现取决于后端是否返回有效来源；前端不会替后端检索知识或伪造 Sources。
- New conversation 可以放弃当前待审批卡；前端清除本地线程，原后端 checkpoint 不会执行取消操作。
