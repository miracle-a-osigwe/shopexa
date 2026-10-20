"""
Telemetry Event Bus
Central module that broadcasts real-time agent events via WebSocket.
The frontend Live MCP Inspector panel subscribes to /ws/telemetry.
"""
import asyncio
import json
from datetime import datetime
from typing import List, Any
from fastapi.websockets import WebSocket

# All currently connected WebSocket clients (the HUD panels)
_connections: List[WebSocket] = []

def _now() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

async def connect(ws: WebSocket):
    await ws.accept()
    _connections.append(ws)

def disconnect(ws: WebSocket):
    if ws in _connections:
        _connections.remove(ws)

async def _broadcast(event: dict):
    """Fire-and-forget broadcast to all connected HUD clients."""
    dead = []
    for ws in _connections:
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            dead.append(ws)
    for ws in dead:
        disconnect(ws)

def emit(event_type: str, data: dict):
    """
    Synchronous entry-point so non-async tool code can emit events.
    Schedules the broadcast onto the running event loop.
    """
    event = {"ts": _now(), "type": event_type, **data}
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_broadcast(event))
        else:
            loop.run_until_complete(_broadcast(event))
    except RuntimeError:
        pass  # No event loop in this thread – silently skip

# ── Convenience emitters ─────────────────────────────────────────────────────

def emit_user_input(message: str):
    emit("user_input", {"message": message})

def emit_thinking(step: str):
    emit("thinking", {"step": step})

def emit_tool_call(tool_name: str, args: dict):
    emit("tool_call", {"tool": tool_name, "args": args})

def emit_tool_result(tool_name: str, result: Any):
    res_str = json.dumps(result) if isinstance(result, (dict, list)) else str(result)
    emit("tool_result", {"tool": tool_name, "result": res_str[:300]})  # truncate for HUD

def emit_agent_reply(reply: str):
    emit("agent_reply", {"reply": reply[:200]})

def emit_ambient_trigger(scenario: str, severity: str, detail: str):
    emit("ambient_trigger", {
        "scenario": scenario,
        "severity": severity,
        "detail": detail
    })

def emit_presenter_aside(text: str, status: str = "Presenter narrating to judges"):
    emit("presenter_aside", {
        "text": text,
        "status": status
    })

def emit_presenter_mode(enabled: bool):
    emit("presenter_mode", {
        "enabled": enabled,
        "mode": "JUDGE_DEMO_ACTIVE" if enabled else "DIRECT_ASSISTANT"
    })

def emit_attention(state: str, speaker_intent: str, text: str):
    emit("attention", {
        "state": state,
        "speaker_intent": speaker_intent,
        "text": text[:150]
    })

def emit_barge_in():
    emit("barge_in", {
        "action": "HALT_PLAYBACK",
        "detail": "User speech detected during AI response (barge-in interruption)"
    })

def emit_dual_model_handoff(from_model: str, to_model: str, task: str):
    emit("dual_model_handoff", {
        "from_model": from_model,
        "to_model": to_model,
        "task": task
    })
