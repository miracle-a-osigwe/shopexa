import requests
import json

payload = {
    "message": "Order the coffee we got last time",
    "modality": "voice",
    "presenter_mode": False
}
try:
    res = requests.post("http://localhost:8000/api/chat", json=payload, timeout=10)
    print("Status:", res.status_code)
    data = res.json()
    print("Reply:", data.get("reply"))
    print("Audio b64 length:", len(data.get("audio_b64") or ""))
    print("Model used:", data.get("model_used"))
except Exception as e:
    print("Error:", e)
