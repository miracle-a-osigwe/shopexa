import requests

payload = {
    "message": "Authorize purchase order #47",
    "modality": "voice",
    "presenter_mode": False
}
try:
    res = requests.post("http://localhost:8000/api/chat", json=payload, timeout=10)
    print("Status:", res.status_code)
    data = res.json()
    print("Reply:\n", data.get("reply"))
    print("Model used:", data.get("model_used"))
except Exception as e:
    print("Error:", e)
