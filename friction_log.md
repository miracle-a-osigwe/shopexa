# 📋 Shopexa Ops: Official Developer Friction Log & Feature Requests
*Prepared for the Amazon Developer Hackathon Reviewers & Judging Panel*

> [!NOTE]
> Per hackathon guidelines: *"Friction log entries for each one: the task you attempted, the steps you took, what you expected vs. what actually happened, a severity rating, any workaround you used, and an actionable suggestion. Submissions with friction logs can earn up to a 10% judging bonus."*

---

## 🛠️ Structured Friction Log Entries

### Entry 1: Mounting MCP Streamable HTTP (Spec 2025-11-25+) within FastAPI ASGI Lifecycles
* **Task Attempted:** Exposing a self-hosted Model Context Protocol (MCP) server over Streamable HTTP (spec 2025-11-25 or later) alongside FastAPI WebSockets and static assets on a single unified server port.
* **Steps Taken:**
  1. Implemented procurement MCP tools (`get_unread_notifications`, `create_payable_order`, `authorize_order`, etc.) using `mcp.server.MCPServer`.
  2. Attempted to mount the MCP ASGI application into FastAPI via `app.mount("/mcp", mcp.streamable_http_app())`.
  3. Tested HTTP/2 and SSE connections from agent clients.
* **Expected vs. Actual:**
  - *Expected:* Standard ASGI router mount where `/mcp` endpoints seamlessly inherit FastAPI middleware (CORS, lifespan, exception handling).
  - *Actual:* The MCP Python SDK's `MCPServer` generates an internal Starlette instance whose subpath routing and SSE headers require explicit prefix awareness. If mounted without exact trailing slash coordination, client handshakes return 404 or drop the stream.
* **Severity Rating:** **Medium (Developer Onboarding Friction)**
* **Workaround Used:** Integrated conditional transport mounting in `main.py` inspecting both `streamable_http_app()` (Streamable HTTP spec 2025-11-25+) and `sse_app()` with unified CORS middleware and isolated exception handling.
* **Actionable Suggestion for Amazon / MCP Team:** Provide a first-class `mcp.server.fastapi.MCPRouter` or standard Starlette router export in the official Python SDK to make HTTP mounting a one-liner (`app.include_router(mcp.router, prefix="/mcp")`).

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

### Entry 3: Ambient Room Voice False-Triggering & Speaker Acoustic Echo Barge-In
* **Task Attempted:** Continuous listening for smart display voice interaction while the assistant simultaneously speaks briefings and order confirmations.
* **Steps Taken:** Enabled browser microphone streaming with continuous speech recognition (`webkitSpeechRecognition` + Web Audio API ScriptProcessor).
* **Expected vs. Actual:**
  - *Expected:* Clean barge-in when a user speaks over the assistant.
  - *Actual:* Speaker output from the laptop speakers was immediately captured by the microphone, transcribing the AI's own voice as user input, creating an acoustic feedback loop that prematurely canceled speech playback.
* **Severity Rating:** **High (User Experience & Demo Disruption)**
* **Workaround Used:**
  1. Added WebRTC audio constraints: `{ echoCancellation: true, noiseSuppression: true, autoGainControl: true }`.
  2. Gated microphone audio frames during active speech output (`if (isSpeaking || playingAudio) return;`).
  3. Engineered an **Attention & Addressing Gate** (`attention_gate.py`) that analyzes conversational syntax in real-time, categorizing utterances into direct commands (`DIRECT_COMMAND`) vs. bystander chatter (`BYSTANDER_CHATTER`) or presenter narration to judges (`JUDGE_NARRATION`).
* **Actionable Suggestion for Alexa+ Team:** Ship an official Web Simulator Audio Bridge NPM package with built-in reference-signal software echo cancellation and wake-word verification.

---

### Entry 4: Conversational State Suspension During Unprompted Proactive Alerts
* **Task Attempted:** Triggering an ambient supplier price spike or past-purchase discount alert while a user is actively reviewing or staging a purchase order.
* **Steps Taken:** Pushed an ambient alert card directly into the smart display DOM viewport when an external supplier price change occurred.
* **Expected vs. Actual:**
  - *Expected:* The user should be able to evaluate the alert, dismiss it, and seamlessly return to their uncompleted order.
  - *Actual:* The alert card completely overwrote the staged order in memory, destroying multi-turn context and forcing the user to start over.
* **Severity Rating:** **Medium (Workflow Disruption)**
* **Workaround Used:** Implemented an **Interaction State Machine with an Interruption Stack (LIFO)**. When an ambient interruption occurs that matches the active product, the active state (Order ID, Amount, Product, exact DOM card snapshot) is pushed onto a stack. A topbar badge (`1 Suspended (COFFEE)`) appears, and saying *"Back to my order"* or clicking *"Dismiss"* immediately pops the snapshot and delivers a natural voice bridge (*"Returning to your staged coffee order totaling $33.00. Ready to authorize."*). Unrelated alerts are queued in the Notice Tray without disrupting the active order.
* **Actionable Suggestion for Alexa+ Team:** Add native session suspend/resume primitives (`session.suspend()`, `session.resume()`) to the Alexa+ Agent Skill SDK so background ambient interruptions preserve active conversational contexts automatically.

---

### Entry 5: Cascaded TTS Masking Duplex Audio Health & Smithy EventStream Teardown Deadlock
* **Task Attempted:** Validating that Amazon Nova Sonic (`amazon.nova-2-5-sonic`) is actively handling bidirectional speech-to-speech streaming, and cleanly closing/reopening streams during session restarts.
* **Steps Taken:**
  1. Connected browser microphone to Bedrock's `InvokeModelWithBidirectionalStream`.
  2. Simultaneously maintained a fallback Amazon Polly TTS pipeline.
  3. Attempted to close and reconnect sessions using `await stream_response.close()`.
* **Expected vs. Actual:**
  - *Expected:* We would hear Nova Sonic's native audio output, and `stream_response.close()` would terminate the stream cleanly within milliseconds.
  - *Actual:* Two critical friction points occurred:
    1. Cascaded Polly TTS masked underlying Nova Sonic streaming failures—audio continued to play via Polly even when the Nova Sonic duplex event stream was broken or unestablished.
    2. In `smithy_core.aio.eventstream.DuplexEventStream`, calling `await stream_response.close()` hung indefinitely if the generator was awaiting incoming CRT frames or if unconsumed events remained in the buffer.
* **Severity Rating:** **High (Architecture & Session Lifecycle Blocker)**
* **Workaround Used:**
  1. Completely removed Amazon Polly from the runtime path, forcing the system to rely exclusively on pure, native Nova Sonic speech-to-speech audio streaming.
  2. Decoupled downstream audio receiving into a dedicated asynchronous worker task and wrapped stream teardown in `asyncio.wait_for(stream_response.close(), timeout=1.0)` to prevent event-loop hangs.
* **Actionable Suggestion for AWS Bedrock Team:**
  1. Provide explicit stream liveness/heartbeat callbacks in the Bedrock SDK so developers know with certainty when the foundation model's speech engine is connected and streaming audio vs. silent.
  2. Implement an asynchronous timeout or cancellation token within `DuplexEventStream.close()` in `smithy_core` so closing an idle or unconsumed stream cannot deadlock the Python event loop.

---

## 💡 Official Feature Requests

| Feature Request | Target Platform | Urgency | Why It Matters |
| :--- | :--- | :--- | :--- |
| **Native FastAPI Router Export** | MCP Python SDK | **Critical** | Simplifies exposing MCP tools over Streamable HTTP in existing enterprise web applications from 40 lines of boilerplate to 1 line. |
| **Conversational State Suspension Primitives** | Alexa+ / Agent Skills | **Important** | Essential for proactive, ambient assistants that interrupt users with urgent supply alerts without wiping in-flight task progress. |
| **Official Web Audio Echo-Cancellation Bridge** | Alexa Developer Tools | **Important** | Prevents microphone self-triggering in browser-based smart display simulators, dramatically improving demo reliability. |
| **Non-Blocking Duplex Stream Teardown & Liveness Signals** | AWS Bedrock SDK (`smithy_core`) | **Critical** | Prevents deadlocks during bidirectional audio session teardown and eliminates the temptation to use cascaded TTS workarounds. |
