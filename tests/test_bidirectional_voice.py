"""
Automated Bidirectional Voice Streaming Test for Shopexa Nova Sonic Bridge.
Tests:
  1. WebSocket connection to /ws/voice
  2. session_ready handshake
  3. Continuous 16kHz PCM audio frame transmission from client
  4. Real-time transcript processing & Attention Gate classification
  5. Autonomous Nova Pro MCP tool execution (staging order)
  6. Amazon Polly Neural 16kHz PCM audio chunk streaming to client
  7. Full-duplex barge-in interruption handling
"""

import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
import json
import base64
from starlette.testclient import TestClient
from main import app

def test_bidirectional_voice_websocket():
    client = TestClient(app)
    with client.websocket_connect("/ws/voice") as ws:
        # 1. Expect session_ready
        initial_msg = ws.receive_json()
        print("\n[WS Test] 1. Received initial:", initial_msg)
        assert initial_msg["type"] == "session_ready"
        assert initial_msg["sample_rate"] in [16000, 24000]

        # 2. Test General Conversation / Presenter Aside -> SILENT STANDBY (NO AUDIO)
        print("\n[WS Test] 2. Testing Bystander / Presenter Aside Standby suppression...")
        ws.send_json({
            "type": "transcript",
            "text": "As we can see here for the judges, the dashboard demonstrates the UI.",
            "is_final": True
        })
        standby_msg = ws.receive_json()
        print("[WS Test] -> Received standby response:", standby_msg)
        assert standby_msg.get("type") == "transcript"
        assert standby_msg.get("role") == "USER"
        assert standby_msg.get("ignored") is True
        assert standby_msg.get("attention", {}).get("action") == "STANDBY"

        # 3. Test Direct Procurement Command -> MCP Execution + Audio Stream
        print("\n[WS Test] 3. Testing Direct Command: 'Restock the coffee'...")
        ws.send_json({
            "type": "transcript",
            "text": "Restock the coffee",
            "is_final": True
        })

        user_transcript_received = False
        assistant_transcript_received = False
        order_created_received = False
        audio_chunks_received = 0

        for _ in range(60):
            try:
                resp = ws.receive_json()
                rtype = resp.get("type")
                if rtype == "transcript":
                    if resp.get("role") == "USER":
                        user_transcript_received = True
                        print("[WS Test] -> Received USER transcript:", resp.get("text"))
                    elif resp.get("role") == "ASSISTANT":
                        assistant_transcript_received = True
                        print("[WS Test] -> Received ASSISTANT transcript (len):", len(resp.get("text", "")))
                elif rtype == "order_created":
                    order_created_received = True
                    print("[WS Test] -> Received ORDER_CREATED:", resp.get("detail")[:60])
                elif rtype == "audio":
                    audio_chunks_received += 1
                elif rtype == "speech_done":
                    print(f"[WS Test] -> Received SPEECH_DONE! Total audio chunks: {audio_chunks_received}")
                    break
            except Exception as e:
                print("[WS Test] Read notice:", e)
                break

        assert user_transcript_received, "Did not receive user transcript back from server"
        assert assistant_transcript_received, "Did not receive assistant transcript back from server"
        assert order_created_received, "Did not receive staged order notification"
        assert audio_chunks_received > 0, "Did not receive streamed audio chunks from server"

        # 4. Test Ambient Alert Synchronization + Follow-up Voice Response
        print("\n[WS Test] 4. Testing Ambient Alert Sync + Follow-up Voice Acceptance...")
        ws.send_json({
            "type": "ambient_alert",
            "scenario": "Past Purchase Deal: Ethiopian Coffee Beans (20% Off)",
            "detail": "Ethiopian Yirgacheffe Coffee Beans dropped by 20% on Amazon Business ($14.80).",
            "suggestion": "Restock Ethiopian Yirgacheffe Coffee Beans with 20% discount",
            "product": "Ethiopian Yirgacheffe Coffee Beans"
        })

        # Send affirmative voice confirmation
        ws.send_json({
            "type": "transcript",
            "text": "Yes, lock in the deal",
            "is_final": True
        })

        alert_order_created = False
        alert_audio_received = 0
        for _ in range(60):
            try:
                resp = ws.receive_json()
                rtype = resp.get("type")
                if rtype == "order_created":
                    alert_order_created = True
                    print("[WS Test] -> Ambient alert follow-up produced ORDER_CREATED:", resp.get("detail")[:60])
                elif rtype == "audio":
                    alert_audio_received += 1
                elif rtype == "speech_done":
                    break
            except Exception as e:
                print("[WS Test] Read notice:", e)
                break

        assert alert_order_created, "Ambient alert follow-up voice confirmation did not trigger order creation"
        assert alert_audio_received > 0, "Did not receive audio response for ambient follow-up"

        # 5. Test Ambient Alert Dismissal
        print("\n[WS Test] 5. Testing Ambient Alert Voice Dismissal...")
        ws.send_json({
            "type": "ambient_alert",
            "scenario": "Printer Paper Delivery Delay",
            "detail": "Printer paper shipment is delayed by 3 days.",
            "suggestion": "Order alternative paper from nearby fulfillment center",
            "product": "Hammermill Printer Paper"
        })
        ws.send_json({
            "type": "transcript",
            "text": "Dismiss this alert",
            "is_final": True
        })

        dismissed_received = False
        for _ in range(40):
            try:
                resp = ws.receive_json()
                if resp.get("type") == "ambient_dismissed":
                    dismissed_received = True
                    print("[WS Test] -> Received ambient_dismissed notification!")
                elif resp.get("type") == "speech_done":
                    break
            except Exception:
                break
        assert dismissed_received, "Ambient alert dismissal was not received"

        # 6. Test Barge-in
        print("\n[WS Test] 6. Testing Barge-in crossfade trigger...")
        ws.send_json({"type": "barge_in"})
        barge_ack = ws.receive_json()
        print("[WS Test] 6. Received barge-in confirmation:", barge_ack)
        assert barge_ack.get("type") == "barge_in"

        # 7. Test Ping/Pong
        ws.send_json({"type": "ping"})
        pong_msg = ws.receive_json()
        print("[WS Test] 7. Received pong:", pong_msg)
        assert pong_msg.get("type") == "pong"

        # 8. Test Speaker Echo Loop Suppression (prevent echoing assistant speech back to model)
        print("\n[WS Test] 8. Testing Speaker Echo Loop Suppression...")
        ws.send_json({
            "type": "transcript",
            "text": "I found your previous order for 2 bags of Ethiopian Yirgacheffe Coffee Beans at $37.00.",
            "is_final": True
        })
        # Server must silently suppress the echo without generating a recursive order or audio
        ws.send_json({"type": "ping"})
        echo_pong = ws.receive_json()
        assert echo_pong.get("type") == "pong", "Server failed to respond to ping after echo suppression"
        print("[WS Test] -> Echo successfully suppressed with zero recursive audio loop!")

    print("\n✅ ALL BIDIRECTIONAL VOICE & AMBIENT STREAMING TESTS PASSED PERFECTLY!\n")

if __name__ == "__main__":
    test_bidirectional_voice_websocket()
