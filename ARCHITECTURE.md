# PetClinic AI Copilot architecture

```text
React (Vercel presentation)
  ├─ ordinary pet queries → FastAPI /api read-only BFF → Java PetClinic REST → database
  └─ Copilot → FastAPI /agent (HTTP transport, SSE, CORS)
     → LangGraph (state, ToolNode, conditional routing, approval interrupt)
       ↔ DeepSeek (reasoning and tool selection through Responses API)
       ↔ Python business tools → PetClinic REST → Spring Boot → database
       ↔ search_knowledge → local Markdown chunks and in-memory search index
       ↔ SQLite checkpointer → workflow checkpoint keyed by thread_id
```

The BFF and Agent routes share the public FastAPI deployment on Railway. The BFF forwards only GET requests for pets and owner summaries, validates their shapes and resource IDs, and preserves upstream error statuses. It does not execute the model or Graph. The browser uses the public FastAPI origin; only Python connects to Java's Railway private address. Owner summaries expose ID and name, rather than the full owner record.

Registered Agent tools are `get_pet`, `list_pets`, `get_appointment`, `search_knowledge`, and `cancel_appointment`. `list_pets` explicitly accepts an array and derives its count from that array; other existing HTTP calls keep object-only responses. Explicit supported list/count prompts route through the list tool. Resource errors are never translated into a zero count. No pet mutation tool is registered; development/operations access is separate from product capabilities.

The model chooses read tools and proposes a write tool call. LangGraph validates a cancellation proposal against a real `get_appointment` ToolMessage, including its exact version, then interrupts before the write ToolNode. Only an approved resume reaches `cancel_appointment`; the Python tool sends one REST POST. HTTP 409 does not trigger a new GET, version substitution or automatic retry. Spring Boot remains responsible for authorization, business rules, transactions and final state. The Agent never connects to the business database.

The knowledge tool loads the four `knowledge/*.md` files at process startup, splits them by Markdown section into short chunks, and ranks matching text with a small local term index. Each result retains title, section and snippet for FastAPI `sources`. Policy and FAQ text are unstructured reference material; live pet and appointment instances are never inserted into the knowledge index. The model should combine a business GET with knowledge search when a question asks about both current state and policy.

SQLite persists LangGraph state and pending interrupts across a single FastAPI process restart. It is a local development checkpointer, not distributed coordination. This demo assumes one API worker and a stable backend dataset: the default PetClinic H2 database may reset on a Java restart, so an old pending approval must not be treated as a production-grade authorization after backend data replacement. The small file-based knowledge corpus is not a large vector database; there is no document administration, distributed deployment, login layer or LLM-owned business consistency. For production, use durable backend data, suitable identity/authorization, shared workflow storage and an explicit approval audit trail.
