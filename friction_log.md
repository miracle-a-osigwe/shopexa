# 📋 Shopexa Ops: Official Developer Friction Log & Feature Requests
*Prepared for the Amazon Developer Hackathon Reviewers & Judging Panel*
*Track: Alexa+ | Mini-Challenges: AWS Builder & Open Source*

---

## 🛠️ Structured Friction Log Entries

### Entry 1: Mounting MCP Streamable HTTP (Spec 2025-11-25+) within FastAPI ASGI Lifecycles
* **Task Attempted:** Exposing a self-hosted Model Context Protocol (MCP) server over Streamable HTTP (spec 2025-11-25 / 2024-11-05) alongside FastAPI WebSockets and static assets on a single unified server port.
* **Steps Taken:**
  1. Implemented procurement MCP tools (`get_unread_notifications`, `create_payable_order`, `authorize_order`, etc.) using `mcp.server.MCPServer`.
  2. Attempted to mount the MCP ASGI application into FastAPI via `app.mount("/mcp", mcp.streamable_http_app())`.
  3. Tested HTTP/2 and SSE connections using `curl` and MCP client tools.
* **Expected vs. Actual:**
  - *Expected:* Standard ASGI sub-application mounting where `/mcp` endpoints seamlessly inherit FastAPI lifespan and serve requests at `http://host/mcp`.
  - *Actual:* Two distinct friction points occurred:
    1. **Lifespan Task Group Failure:** FastAPI/Starlette does not invoke the lifespan of mounted sub-applications. Because the sub-app's lifespan never executed, the SDK's `StreamableHTTPSessionManager` task group was never started, causing the first incoming request to crash with:  
       `RuntimeError: Task group is not initialized. Make sure to use run().`
    2. **Double Path Prefix (`/mcp/mcp`):** The Starlette instance returned by `streamable_http_app()` hardcodes `/mcp` into its internal router. Mounting at `app.mount("/mcp", ...)` produced `/mcp/mcp` while requests to `/mcp` or `/mcp/` returned `404 Not Found`.
* **Severity Rating:** **High (Architecture & Protocol Onboarding Blocker)**
* **Workaround Used:**
  1. Updated the host FastAPI application's `lifespan` context manager to explicitly enter the MCP task group:
     ```python
     @asynccontextmanager
     async def lifespan(app: FastAPI):
         db.init_db()
         if hasattr(mcp, "session_manager"):
             async with mcp.session_manager.run():
                 yield
         else:
             yield
     ```
  2. Mounted `mcp_subapp` at the root (`app.mount("/", mcp_subapp)`) at the bottom of the route stack, allowing `/` + `/mcp` to expose the endpoint natively at clean `http://host/mcp` with full SSE framing support (`event: message\ndata: {...}`).
* **Actionable Suggestion for Amazon / MCP Team:** 
  1. Export a native `mcp.server.fastapi.MCPRouter` or standard Starlette router so developers can use `app.include_router(mcp.router, prefix="/mcp")` without sub-app lifespan isolation issues.
  2. Allow `streamable_http_app(path="/")` to accept custom root paths so developers aren't forced into `/mcp/mcp` when mounting at `/mcp`.

---

### Entry 2: Full-Duplex Bidirectional Audio Streaming via AWS Common Runtime (`awscrt`)
* **Task Attempted:** Connecting a browser microphone (16kHz PCM) directly to Amazon Nova Sonic (`amazon.nova-2-5-sonic`) for full-duplex speech-to-speech with hardware-level barge-in detection.
* **Steps Taken:**
  1. Configured standard AWS Bedrock Python SDK (`boto3.client("bedrock-runtime")`).
  2. Called `InvokeModelWithBidirectionalStream`.
* **Expected vs. Actual:**
  - *Expected:* Boto3 would natively initiate an HTTP/2 full-duplex connection.
  - *Actual:* Standard `botocore` HTTP/1.1 transport (`urllib3`) fails on bidirectional HTTP/2 event streams, raising transport negotiation errors on non-CRT environments.
* **Severity Rating:** **High (Technical Blocker for Standard Python Runtimes)**
* **Workaround Used:** Built `nova_sonic_bridge.py` utilizing `awscrt` and `AsyncBedrockRuntimeClient` with explicit event stream framing and decoupled audio receiver tasks to guarantee low-latency bidirectional streaming directly with Bedrock.
* **Actionable Suggestion for AWS Team:** Document the `awscrt` HTTP/2 prerequisite prominently on the Bedrock Nova Sonic documentation landing page, and release an official, lightweight high-level Python streaming client wrapper (`bedrock-duplex-stream`).

---

### Entry 3: Speaker Acoustic Echo Barge-In & Semantic False-Triggering
* **Task Attempted:** Maintaining continuous ambient listening for hands-free smart display interaction while the assistant simultaneously speaks briefings, price spike alerts, and order confirmations.
* **Steps Taken:** Streamed 16kHz microphone audio continuously to Bedrock Nova Sonic.
* **Expected vs. Actual:**
  - *Expected:* Clean barge-in only when the user intentionally speaks over the assistant.
  - *Actual:* Two major false-triggering modes occurred:
    1. **Acoustic Speaker Echo Loop:** Laptop speaker output was immediately recaptured by the microphone. Bedrock Nova Sonic heard its own voice, interpreted it as user speech, and triggered an internal `{ "interrupted": true }` barge-in, cutting off its own speech mid-sentence.
    2. **Passive Narration False-Triggering:** During the pitch hook, saying *"...a verified solution is ready to be authorized"* contained the word *authorized*. Loose keyword classifiers mistook this passive statement for an imperative command, prematurely dispatching un-staged purchase orders to Nova Pro.
* **Severity Rating:** **High (User Experience & Demo Disruption)**
* **Workaround Used:**
  1. **EchoGuard Gating:** Implemented a hardware-level gate in `audio.js` that mutes outbound PCM frames while Nova Sonic is generating speech, combined with a 400ms acoustic room cooldown.
  2. **Imperative Syntax Classifier (`attention_gate.py`):** Replaced loose regexes with strict grammatical classification: requires explicit leading action verbs (*"Authorize purchase order"*, *"Option 1"*) or direct wake words (*"Alexa"*, *"Shopexa"*), while shielding passive narrative speech (*"ready to be authorized"*) into `action: "STANDBY"`.
* **Actionable Suggestion for Alexa+ Team:** Ship an official Web Simulator Audio Bridge package with reference-signal software echo cancellation (AEC) and an integrated syntactic addressing classifier.

---

### Entry 4: Conversational State Suspension During Unprompted Proactive Alerts
* **Task Attempted:** Triggering an autonomous supplier price spike alert while a user is actively reviewing or staging a purchase order.
* **Steps Taken:** Pushed an ambient alert card directly into the smart display DOM viewport when a background supplier price increase was detected.
* **Expected vs. Actual:**
  - *Expected:* The user should be able to evaluate the alert, dismiss it, and seamlessly return to their uncompleted order.
  - *Actual:* The alert card completely overwrote the staged order in memory, destroying multi-turn context and forcing the user to start over.
* **Severity Rating:** **Medium (Workflow Disruption)**
* **Workaround Used:** Implemented an **Interaction State Machine with an Interruption Stack (LIFO)**. When an ambient interruption occurs, the active state (Order ID, Amount, Product, exact DOM card snapshot) is pushed onto a stack. A topbar badge (`1 Suspended (ITEM)`) should appear, and saying *"Back to my order"* or clicking *"Dismiss"* immediately pops the snapshot and delivers a natural voice bridge (*"Returning to your staged coffee order totaling $33.00. Ready to authorize."*).
* **Actionable Suggestion for Alexa+ Team:** Add native session suspend/resume primitives (`session.suspend()`, `session.resume()`) to the Alexa+ Agent Skill SDK so background ambient interruptions preserve active conversational contexts automatically.

---

### Entry 5: Python 3.14 `awscrt` Cancelled Future Bug During Teardown
* **Task Attempted:** Cleanly terminating Bedrock bidirectional duplex sessions when a user disconnects or refreshes the browser page.
* **Steps Taken:** Called `stream_response.close()` inside task cancellation handlers.
* **Expected vs. Actual:**
  - *Expected:* The stream terminates silently within milliseconds.
  - *Actual:* In Python 3.14, task cancellation transitions internal `asyncio.Future` objects into the `CANCELLED` state. When the background C-thread of `awscrt` received the final connection termination frame, `awscrt.aio.http._on_body` called `future.set_result(chunk)` on the cancelled future, crashing with:  
    `concurrent.futures._base.InvalidStateError: CANCELLED`  
    `Treating Python exception as error 3(AWS_ERROR_UNKNOWN)`
* **Severity Rating:** **High (Unclean Server Crashes on Session Close)**
* **Workaround Used:**
  1. Applied an in-memory runtime patch to `awscrt.aio.http._on_body` that checks `if fut.cancelled(): return` before attempting to set results on dead futures.
  2. Implemented strict teardown sequencing: explicitly close `stream_response.input_stream` and await `stream_response.close()` *before* cancelling worker tasks.
* **Actionable Suggestion for AWS SDK Team:** Update `awscrt.aio.http` to check `if not future.done() and not future.cancelled():` before calling `.set_result()` to ensure Python 3.14 compliance.

---

## 💡 Official Feature Requests

| Feature Request | Target Platform | Urgency | Why It Matters |
| :--- | :--- | :--- | :--- |
| **Native FastAPI Router Export** | MCP Python SDK | **Critical** | Eliminates sub-app lifespan isolation bugs (`Task group is not initialized`) and enables one-line mounting. |
| **Priority Queue / Atomic Batching in Bedrock Duplex Streams** | AWS Bedrock SDK (`smithy_core`) | **Critical** | Prevents HTTP/2 backpressure deadlocks when multiplexing real-time audio with asynchronous tool results. |
| **Python 3.14 `awscrt` Cancellation Guard** | AWS Common Runtime (`awscrt`) | **High** | Prevents unhandled `InvalidStateError` crashes when WebSocket clients refresh or disconnect. |
| **Conversational State Suspension Primitives** | Alexa+ / Agent Skills | **Important** | Essential for proactive, ambient assistants that interrupt users with urgent supply alerts without wiping in-flight task progress. |
| **Official Web Audio Echo-Cancellation Bridge** | Alexa Developer Tools | **Important** | Prevents microphone self-triggering in browser-based smart display simulators, dramatically improving demo reliability. |
| **Non-Blocking Duplex Stream Teardown & Liveness Signals** | AWS Bedrock SDK (`smithy_core`) | **Critical** | Prevents deadlocks during bidirectional audio session teardown and eliminates the temptation to use cascaded TTS workarounds. |

