# Railway deployment preparation

Deploy this Python repository root as the Agent service with Railpack (`requirements.txt` and `railway.json`). No Dockerfile is needed. Keep one service replica and one Uvicorn worker because the workflow checkpointer is a local SQLite file.

In the same Railway project **and environment**, deploy the existing Spring Boot PetClinic as a separate service. Its current application configuration listens on port `9966` under `/petclinic/`; no Java code change is needed. Set the Agent's `PETCLINIC_BASE_URL` to the Java service's private HTTP address, for example `http://${{PetClinic.RAILWAY_PRIVATE_DOMAIN}}:9966/petclinic/api` (replace `PetClinic` with the actual Railway service name, and `9966` if its configured listening port differs). Do not use localhost: the two services have separate containers. Wait for PetClinic to be healthy before testing Agent business tools.

Attach a Railway Volume **to the Agent service** at `/data`, then configure:

| Agent service variable | Value |
| --- | --- |
| `PETCLINIC_BASE_URL` | PetClinic private HTTP URL including port and `/petclinic/api` |
| `DEEPSEEK_API_KEY` | Secret set in Railway Variables; never commit it |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | The working DeepSeek model name for this project |
| `CHECKPOINT_DB_PATH` | `/data/agent-checkpoints.sqlite` |
| `FRONTEND_ORIGINS` | Exact Vercel HTTPS origin, e.g. `https://your-app.vercel.app`; comma-separate multiple origins |

Railway supplies `PORT`, `RAILWAY_PROJECT_ID` and, after the Volume is attached, `RAILWAY_VOLUME_MOUNT_PATH`. Do not set those manually. The app refuses to start on Railway if the backend URL is missing or points to localhost, if the frontend origin is absent, or if the checkpoint file is outside the mounted Volume. The start command and `/health` check are in `railway.json`; expose the Agent service with a Railway public domain for the browser.

The existing React client already reads `VITE_AGENT_API_BASE_URL`. Set that **in Vercel** to the Agent's public HTTPS origin (without `/agent`), then build the frontend; this is separate from Railway's `FRONTEND_ORIGINS`. Optional `PETCLINIC_USERNAME`/`PETCLINIC_PASSWORD` apply only if backend Basic authentication is enabled. CORS does not replace authentication; keep this demo's thread IDs private.
