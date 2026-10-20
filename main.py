import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import os
import re
import asyncio
from dotenv import load_dotenv

load_dotenv(override=True)

from llm_provider import GeminiProvider

try:
    from aws_bedrock_provider import AWSBedrockProvider

    has_aws = True
except ImportError:
    has_aws = False

import tools
import telemetry
import ambient
from mcp_server import mcp
from modality_router import router as modality_router

from contextlib import asynccontextmanager

# 1. Initialize the streamable HTTP app at module level so session_manager exists
# Create the MCP sub-application at module level
mcp_subapp = None
if hasattr(mcp, "streamable_http_app"):
    mcp_subapp = mcp.streamable_http_app()
elif hasattr(mcp, "sse_app"):
    mcp_subapp = mcp.sse_app()
elif hasattr(mcp, "_sse_app"):
    mcp_subapp = mcp._sse_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    import db

    db.init_db()
    # Start the MCP Session Manager Task Group for the lifetime of the server
    if hasattr(mcp, "session_manager") and hasattr(mcp.session_manager, "run"):
        async with mcp.session_manager.run():
            yield
    else:
        yield


app = FastAPI(
    title="Shopexa Ops API",
    description="Alexa+ Hackathon — Proactive Commerce Agent",
    lifespan=lifespan,
)

# ── MCP Streamable HTTP & SSE Transport (Spec 2025-11-25+) ───────────────────
# try:
#     if hasattr(mcp, "streamable_http_app"):
#         try:
#             mcp_subapp = mcp.streamable_http_app(streamable_http_path="/")
#         except TypeError:
#             mcp_subapp = mcp.streamable_http_app()

#         app.mount("/mcp", mcp_subapp)
#         print("✅ MCP Streamable HTTP transport mounted at /mcp (spec 2025-11-25+)")

#         # Redirect /mcp to /mcp/mcp so external tools don't hit 404
#         @app.api_route(
#             "/mcp",
#             methods=["GET", "POST", "DELETE", "OPTIONS"],
#             include_in_schema=False,
#         )
#         @app.api_route(
#             "/mcp/",
#             methods=["GET", "POST", "DELETE", "OPTIONS"],
#             include_in_schema=False,
#         )
#         async def mcp_redirect_handler(request: Request):
#             from starlette.responses import RedirectResponse

#             return RedirectResponse(url="/mcp/mcp", status_code=307)

#     elif hasattr(mcp, "sse_app"):
#         app.mount("/mcp", mcp.sse_app())
#         print("✅ MCP SSE transport mounted at /mcp/sse")
#     elif hasattr(mcp, "_sse_app"):
#         app.mount("/mcp", mcp._sse_app)
#         print("✅ MCP SSE transport mounted at /mcp/sse")
# except Exception as e:
#     print(f"ℹ️  MCP mount notice: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── LLM Provider Initialization ───────────────────────────────────────────────
llm = None
if has_aws and os.getenv("USE_AWS_BEDROCK", "false").lower() == "true":
    try:
        llm = AWSBedrockProvider()
        print("[LLM Provider] Using AWS Bedrock (Amazon Nova Pro) as LLM Provider")
    except Exception as e:
        print(f"[LLM Provider] Bedrock notice: {e}. Falling back to Gemini…")

if not llm:
    try:
        llm = GeminiProvider()
        print("[LLM Provider] Using Gemini as fallback LLM Provider")
    except Exception as e:
        print(f"[LLM Provider] Failed to initialize any LLM Provider: {e}")

AGENT_TOOLS = [
    tools.get_unread_notifications,
    tools.get_order_history,
    tools.search_inventory,
    tools.create_payable_order,
    tools.authorize_order,
    tools.find_product_alternatives,
    tools.resume_previous_flow,
]

SYSTEM_PROMPT = """You are Shopexa, an intelligent proactive procurement assistant embedded in an Alexa+ Smart Display powered by Amazon Nova Pro and the Model Context Protocol (MCP).

Your personality: calm, sharp, proactive. You anticipate what the user needs next.

Your MCP tools:
- get_unread_notifications: Check emails, supply alerts, calendar changes
- get_order_history: Look up past purchases and vendor details
- search_inventory: Query stock levels, prices, catalog items
- create_payable_order: Confirm and stage a payable purchase order
- authorize_order: Authorize and dispatch a staged purchase order
- find_product_alternatives: Check price updates and supplier alternatives
- resume_previous_flow: Resume an uncompleted or suspended purchase flow, returning the staged order to the display ready for authorization

Core Rules:
1. Always call the relevant MCP tools before answering questions about orders, inventory, or notifications.
2. For coffee restock commands, stage only Ethiopian Yirgacheffe Coffee ($37.00). For paper restock commands, stage only A4 Printer Paper ($26.97). For both, stage both ($61.97). State that the purchase order has been staged and request authorization on screen. Do NOT repeat previous questions or ask if they want to restock.
3. For authorization requests ('authorize', 'approve', 'confirm'), call authorize_order to dispatch the order. State that the purchase order is authorized and dispatched via AWS IAM. Once authorized, the process is complete — do not re-prompt for this order on subsequent turns.
4. Keep responses concise for voice and smart display output.
5. Distinguish between direct user commands vs. presenter narrating/explaining to hackathon judges. If the presenter is explaining to judges (e.g. 'Judges, notice how...'), do not trigger accidental purchases; remain on standby."""

# ── Conversation History ──────────────────────────────────────────────────────
conversation_history = []

# ── Pydantic Models ───────────────────────────────────────────────────────────
from typing import Optional
import base64


# ── Pydantic Models ───────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    modality: str = "text"  # "text" | "voice"
    presenter_mode: bool = False


class ChatResponse(BaseModel):
    reply: str
    audio_b64: Optional[str] = None  # Base64 MP3 bytes from Polly / Nova Sonic
    model_used: Optional[str] = None  # Which AWS model handled this turn
    modality: Optional[str] = None
    presenter_aside: bool = False


class PresenterModeRequest(BaseModel):
    enabled: bool


class AmbientTriggerRequest(BaseModel):
    scenario_id: str = "random"


# ── REST: Presenter Mode Toggle ──────────────────────────────────────────────
@app.post("/api/presenter_mode")
async def toggle_presenter_mode(req: PresenterModeRequest):
    telemetry.emit_presenter_mode(req.enabled)
    return {"status": "ok", "presenter_mode": req.enabled}


# ── WebSocket: Live MCP Telemetry HUD ────────────────────────────────────────
@app.websocket("/ws/telemetry")
async def telemetry_ws(websocket: WebSocket):
    """
    WebSocket endpoint — the frontend HUD panel connects here to receive
    live JSON events: thinking steps, MCP tool calls, tool results, ambient triggers.
    """
    await telemetry.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        telemetry.disconnect(websocket)


# ── WebSocket: Nova Sonic Live Voice Session ──────────────────────────────────
@app.websocket("/ws/voice")
async def voice_ws(websocket: WebSocket):
    """
    Full-duplex voice session via Amazon Nova Sonic.
    Browser sends raw 16kHz PCM audio chunks (base64).
    Nova Sonic returns 24kHz PCM audio + text transcripts + tool events.
    """
    await websocket.accept()
    try:
        from nova_sonic_bridge import run_voice_session

        await run_voice_session(websocket)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass


# ── REST: Chat (Modality-Aware) ───────────────────────────────────────────────
@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    global conversation_history

    # Sanitize browser speech recognition artifacts like "print print print" -> "print"
    sanitized_msg = re.sub(
        r"\b(\w+)(?:\s+\1\b)+", r"\1", req.message, flags=re.IGNORECASE
    ).strip()
    sanitized_msg = re.sub(
        r"\b(\w+\s+\w+)(?:\s+\1\b)+", r"\1", sanitized_msg, flags=re.IGNORECASE
    ).strip()
    req.message = sanitized_msg or req.message

    telemetry.emit_user_input(req.message)
    telemetry.emit(
        "modality_switch",
        {
            "modality": req.modality,
            "model": "nova-sonic" if req.modality == "voice" else "nova-pro",
            "presenter_mode": req.presenter_mode,
        },
    )

    history_with_system = conversation_history.copy()
    if not history_with_system:
        history_with_system.insert(0, {"role": "user", "content": SYSTEM_PROMPT})
        history_with_system.insert(
            1, {"role": "model", "content": "Understood. I'm Shopexa, ready to assist."}
        )

    try:
        # ── Route through Modality Router if AWS is configured ─────────────
        if modality_router:
            if req.modality == "voice":
                result = await asyncio.to_thread(
                    modality_router.generate_voice_response,
                    req.message,
                    history_with_system,
                    AGENT_TOOLS,
                    req.presenter_mode,
                )
            else:
                result = await asyncio.to_thread(
                    modality_router.generate_text_response,
                    req.message,
                    history_with_system,
                    AGENT_TOOLS,
                    req.presenter_mode,
                )

            reply = result["text"]
            audio_b64 = None
            if result.get("audio"):
                audio_b64 = base64.b64encode(result["audio"]).decode("utf-8")

            is_aside = "presenter-standby" in (
                result.get("model") or ""
            ) or "attention-standby" in (result.get("model") or "")
            if not is_aside:
                conversation_history.append({"role": "user", "content": req.message})
                conversation_history.append({"role": "model", "content": reply})
                # Trim to prevent unbounded growth
                if len(conversation_history) > 20:
                    conversation_history = conversation_history[-20:]

            return ChatResponse(
                reply=reply,
                audio_b64=audio_b64,
                model_used=result.get("model"),
                modality=req.modality,
                presenter_aside=is_aside,
            )

        # ── Fallback: Gemini ───────────────────────────────────────────────
        elif llm:
            reply = llm.generate_response(
                prompt=req.message, history=history_with_system, tools=AGENT_TOOLS
            )
            conversation_history.append({"role": "user", "content": req.message})
            conversation_history.append({"role": "model", "content": reply})
            return ChatResponse(reply=reply, model_used="gemini", modality=req.modality)
        else:
            raise HTTPException(
                status_code=500, detail="No LLM provider configured. Check .env"
            )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── REST: Ambient Trigger & Proactive Engine ────────────────────────────────
@app.post("/api/ambient/trigger")
async def trigger_ambient(req: AmbientTriggerRequest):
    """
    Triggers a proactive ambient event.
    High-likelihood of price changes and past-purchase discount deals (~85%).
    """
    if req.scenario_id in ["random", "auto"]:
        scenario = ambient.trigger_random()
    elif req.scenario_id in ["price_deal", "price_spike", "price_change"]:
        scenario = ambient.trigger_random(force_price_deal=True)
    else:
        scenario = ambient.trigger_scenario(req.scenario_id)

    if not scenario:
        raise HTTPException(
            status_code=404, detail=f"Scenario '{req.scenario_id}' not found"
        )

    # Inject the ambient alert into the global conversation history so the LLM has context
    # of the proactive interruption when the user responds to it.
    ambient_msg = scenario.get("spoken_interrupted") or scenario.get("spoken")
    if ambient_msg:
        conversation_history.append(
            {"role": "model", "content": f"[AMBIENT_PROACTIVE_ALERT]\n{ambient_msg}"}
        )
        if len(conversation_history) > 20:
            # We must modify the global list in place to preserve references
            while len(conversation_history) > 20:
                conversation_history.pop(0)

    return JSONResponse(content=scenario)


@app.get("/api/ambient/scenarios")
async def list_scenarios():
    """Returns all available ambient scenarios for the UI to enumerate."""
    return JSONResponse(content=ambient.get_all_scenarios())


@app.post("/api/ambient/start")
async def start_ambient_engine():
    """Starts the autonomous proactive background cycle (first event in 12s)."""
    ambient.start_ambient_loop()
    return {"status": "started", "active": True}


@app.post("/api/ambient/stop")
async def stop_ambient_engine():
    """Stops the autonomous proactive background cycle."""
    ambient.stop_ambient_loop()
    return {"status": "stopped", "active": False}


@app.get("/api/ambient/status")
async def ambient_status():
    """Returns whether the autonomous proactive loop is currently running and alerted products."""
    return {
        "active": ambient.is_ambient_running(),
        "alerted_products": ambient.get_alerted_products(),
    }


@app.post("/api/ambient/reset_history")
async def reset_ambient_history():
    """Resets the history of alerted products so they can be alerted again."""
    ambient.reset_alerted_history()
    return {"status": "reset", "alerted_products": []}


# ── REST: Reset Conversation ──────────────────────────────────────────────────
@app.post("/api/reset")
async def reset_conversation():
    global conversation_history
    conversation_history = []
    ambient.reset_alerted_history()
    return {"status": "ok"}


# ── REST: Amazon Polly TTS (Disabled for Nova Sonic) ──────────────────────────
# from fastapi.responses import Response
# from aws_services import aws_services


@app.post("/api/tts")
async def get_tts_audio(req: ChatRequest):
    """
    Polly endpoint disabled — voice is delivered natively via Amazon Nova Sonic duplex stream.
    """
    return JSONResponse(
        content={
            "status": "disabled",
            "message": "Polly disabled; using Amazon Nova Sonic.",
        },
        status_code=200,
    )


# ── Static Files + UI ─────────────────────────────────────────────────────────
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def read_root():
    return FileResponse(
        "static/index.html",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


# ── Mount MCP at root so the endpoint lives at clean http://localhost:8000/mcp ──
if mcp_subapp:
    app.mount("/", mcp_subapp)
    print("✅ MCP Streamable HTTP live at http://localhost:8000/mcp")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
