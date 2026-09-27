# PetClinic Agent (local demo)

React → FastAPI/SSE → LangGraph → DeepSeek tool calls → PetClinic REST or local knowledge search. Appointment cancellation always pauses for human approval before the POST. See [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and limitations.

## Start on Windows (three terminals)

1. Start the separate Spring PetClinic REST project using its own README. From its project root in PowerShell: `./mvnw.cmd spring-boot:run`. Wait for `http://localhost:9966/petclinic/actuator/health` to become healthy. The Agent does not access H2 directly.
2. In this Agent project, create and use a local virtual environment:

   ```powershell
   py -3 -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   $env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'DeepSeek API key' -AsSecureString)).Password
   $env:DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
   $env:DEEPSEEK_MODEL = 'deepseek-flash'
   $env:PETCLINIC_BASE_URL = 'http://localhost:9966/petclinic/api'
   $env:CHECKPOINT_DB_PATH = '.agent-state/checkpoints.sqlite3'
   .\.venv\Scripts\python.exe -B -X utf8 -m uvicorn demo_petclinic_api:app --host 127.0.0.1 --port 8000
   ```

   `.env.example` documents these variables but is not loaded automatically. Keep the real key out of source control. An optional `PETCLINIC_USERNAME` and `PETCLINIC_PASSWORD` pair is supported when backend Basic authentication is enabled. The SQLite checkpoint path is resolved relative to this project, even if Uvicorn is launched from another working directory. Keep one Uvicorn worker for this local SQLite setup.
3. In the `frontend` directory, run `pnpm install` and `pnpm dev`, then open `http://127.0.0.1:5173`. Vite proxies `/agent` to FastAPI at port 8000. See [frontend/README.md](frontend/README.md).

## API and checks

- `GET /health`
- `POST /agent/chat` with `{"message":"查询宠物1的信息","thread_id":null}`
- `POST /agent/chat/stream` with the same body; SSE emits started, tool events, approval_required or completed.
- `GET /agent/{thread_id}/state` reads the latest SQLite checkpoint without executing the graph. It returns `thread_id`, `status`, visible `messages`, pending `approval` (or null), and `sources`; an unknown thread returns 404. Keep thread IDs private: this local demo has no login layer.
- `POST /agent/{thread_id}/resume` with `{"decision":"approve"}` or `{"decision":"reject"}`. Use the same thread ID returned by the interrupt. Completed responses include `message` and `sources`; sources have title, section and snippet.

Run offline regression tests with `./.venv/Scripts/python.exe -B -X utf8 -m unittest discover -s tests -v`. These replace the model and PetClinic HTTP in process; they do not consume API credit or mutate appointments. Restarting only FastAPI preserves pending approvals in the configured SQLite file. Do not delete that file while an approval is pending.
