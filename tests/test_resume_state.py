import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from modality_router import ModalityRouter

def test_resume_flow():
    router = ModalityRouter()
    router._polly_tts = lambda text: b"test_polly_audio"
    history = []

    # 1. User asks to restock coffee
    res1 = router.process("Restock the coffee", conversation_history=history, modality="voice")
    history.append({"role": "user", "content": "Restock the coffee"})
    history.append({"role": "assistant", "content": res1["text"]})
    assert "ORDER_CREATED_SUCCESSFULLY" in res1["text"], f"Expected order created, got: {res1['text']}"
    print("[PASS] Step 1: Restock coffee stages order successfully")

    # 2. User gets side-tracked or interrupted with an inventory check
    res2 = router.process("Check inventory levels", conversation_history=history, modality="voice")
    history.append({"role": "user", "content": "Check inventory levels"})
    history.append({"role": "assistant", "content": res2["text"]})
    assert "inventory" in res2["text"].lower() or "stock" in res2["text"].lower()
    print("[PASS] Step 2: Detour/side-query executes cleanly")

    # 3. User says "Resume" or "Back to my order"
    res3 = router.process("Back to my order", conversation_history=history, modality="voice")
    history.append({"role": "user", "content": "Back to my order"})
    history.append({"role": "assistant", "content": res3["text"]})
    assert "ORDER_CREATED_SUCCESSFULLY" in res3["text"], f"Expected order resumed, got: {res3['text']}"
    assert "resum" in res3["text"].lower()
    print("[PASS] Step 3: 'Back to my order' successfully resumes staged order")

    # 4. User authorizes the resumed order
    res4 = router.process("Authorize purchase order", conversation_history=history, modality="voice")
    history.append({"role": "user", "content": "Authorize purchase order"})
    history.append({"role": "assistant", "content": res4["text"]})
    assert "ORDER_AUTHORIZED_SUCCESSFULLY" in res4["text"], f"Expected authorization, got: {res4['text']}"
    print("[PASS] Step 4: Authorization succeeds after resume")

    # 5. Subsequent inquiry does NOT re-trigger the authorized order
    res5 = router.process("Check inventory levels", conversation_history=history, modality="voice")
    assert "ORDER_CREATED_SUCCESSFULLY" not in res5["text"]
    assert "ORDER_AUTHORIZED_SUCCESSFULLY" not in res5["text"]
    print("[PASS] Step 5: State reset completed after authorization; subsequent inquiry clean")

if __name__ == '__main__':
    test_resume_flow()
    print("\nALL STATE & RESUME UNIT TESTS PASSED!")
