"""
Automated Test Suite for Price Updates, Alternatives, Meeting/Proposal Actions,
and Regression Verification of Existing Flows.
"""

import sys
import os

# Ensure project root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from modality_router import ModalityRouter

def test_all():
    router = ModalityRouter()
    # Fast offline mock for audio synthesis during unit tests
    router._polly_tts = lambda text: b"test_polly_audio"
    import ambient
    ambient._generate_scenario_audio = lambda text: "dGVzdF9iNjQ="
    passed = 0
    total = 0

    def assert_test(name, condition, details=""):
        nonlocal passed, total
        total += 1
        if condition:
            passed += 1
            print(f"  [PASS] {name}", flush=True)
        else:
            print(f"  [FAIL] {name} - {details}", flush=True)

    print("\n--- TEST GROUP 1: Price Updates & Alternatives Flow ---", flush=True)
    
    # 1. Price check query
    res1 = router.process("Check for price updates")
    assert_test(
        "Price check returns PRICE_UPDATE_WITH_ALTERNATIVES",
        "PRICE_UPDATE_WITH_ALTERNATIVES|Coffee" in res1["text"]
    )
    assert_test(
        "Price check includes Colombian Supremo option",
        "Colombian Supremo" in res1["text"] and "$16.50" in res1["text"]
    )
    assert_test(
        "Price check generates response with audio key",
        "audio" in res1
    )

    # 2. Select Option 1 (Colombian Supremo)
    res2 = router.process("Option 1", conversation_history=[
        {"role": "user", "text": "Check for price updates"},
        {"role": "assistant", "text": res1["text"]}
    ])
    assert_test(
        "Option 1 creates payable order for Colombian ($33.00)",
        "ORDER_CREATED_SUCCESSFULLY" in res2["text"] and "33.00" in res2["text"]
    )

    # Extract order id
    order_id = "10"
    for line in res2["text"].split("\n"):
        if line.startswith("ORDER_CREATED_SUCCESSFULLY"):
            parts = line.split("|")
            if len(parts) >= 2:
                order_id = parts[1]
                break

    # 3. Authorize staged order
    res3 = router.process(f"Authorize purchase order #{order_id}", conversation_history=[
        {"role": "user", "text": "Option 1"},
        {"role": "assistant", "text": res2["text"]}
    ])
    assert_test(
        "Authorization completes successfully for staged amount",
        "ORDER_AUTHORIZED_SUCCESSFULLY" in res3["text"] and "33.00" in res3["text"]
    )

    print("\n--- TEST GROUP 2: Paper Price Update & Option 1 ---")
    res_paper = router.process("Did paper prices increase?")
    assert_test(
        "Paper price check returns Paper alternatives",
        "PRICE_UPDATE_WITH_ALTERNATIVES|Paper" in res_paper["text"] and "OfficePro" in res_paper["text"]
    )
    res_paper_opt = router.process("Switch to OfficePro", conversation_history=[
        {"role": "user", "text": "Did paper prices increase?"},
        {"role": "assistant", "text": res_paper["text"]}
    ])
    assert_test(
        "Switch to OfficePro stages order for $22.47",
        "ORDER_CREATED_SUCCESSFULLY" in res_paper_opt["text"] and "22.47" in res_paper_opt["text"]
    )

    print("\n--- TEST GROUP 3: Calendar & Proposal Actionability ---")
    res_cal = router.process("Confirm meeting with Acme")
    assert_test(
        "Confirm meeting locks in calendar",
        "Calendar Updated & Confirmed" in res_cal["text"] and "4:00 PM" in res_cal["text"]
    )

    res_prop = router.process("Summarize proposal")
    assert_test(
        "Summarize proposal analyzes contract clauses & drafts response",
        "Q3 Supplier Proposal Summary" in res_prop["text"] and "price-lock clause" in res_prop["text"]
    )

    print("\n--- TEST GROUP 4: Regression Tests for Existing Flows (Must NOT Break) ---")
    
    # Direct coffee restock
    res_coffee = router.process("Order coffee")
    assert_test(
        "Order coffee alone stages $37.00",
        "ORDER_CREATED_SUCCESSFULLY" in res_coffee["text"] and "37.00" in res_coffee["text"]
    )

    # Direct paper restock
    res_paper_only = router.process("Order paper")
    assert_test(
        "Order paper alone stages $26.97",
        "ORDER_CREATED_SUCCESSFULLY" in res_paper_only["text"] and "26.97" in res_paper_only["text"]
    )

    # Direct both restock
    res_both = router.process("Order both coffee and paper")
    assert_test(
        "Order both stages $61.97",
        "ORDER_CREATED_SUCCESSFULLY" in res_both["text"] and "61.97" in res_both["text"]
    )

    # Morning briefing / unread
    res_miss = router.process("What did I miss?")
    assert_test(
        "What did I miss returns morning executive briefing",
        "Here is what you missed" in res_miss["text"] and "Acme Corp" in res_miss["text"]
    )

    # Inventory search
    res_inv = router.process("Check inventory levels")
    assert_test(
        "Check inventory returns stock counts",
        "inventory" in res_inv["text"].lower() and "coffee" in res_inv["text"].lower()
    )

    print("\n--- TEST GROUP 5: Proactive Deals & Past-Purchase Discount Scenarios ---", flush=True)
    from ambient import AmbientIntelligence

    # 1. Past-purchase coffee deal ($14.80 x 2 = $29.60)
    res_deal_coffee = router.process("Lock in 20% discount on coffee")
    assert_test(
        "Coffee past-purchase deal stages $29.60 (saving $7.40)",
        "ORDER_CREATED_SUCCESSFULLY" in res_deal_coffee["text"] and "29.60" in res_deal_coffee["text"]
    )

    # 2. Past-purchase cleaning cloths flash deal ($11.89)
    res_deal_cloths = router.process("Lock in flash deal on cleaning cloths")
    assert_test(
        "Cleaning cloths flash deal stages $11.89 (saving $5.10)",
        "ORDER_CREATED_SUCCESSFULLY" in res_deal_cloths["text"] and "11.89" in res_deal_cloths["text"]
    )

    # 3. Volume tier rebate opportunity for gel pens ($11.90)
    res_rebate_pens = router.process("Order 2 boxes of pens to unlock rebate")
    assert_test(
        "Volume tier rebate stages $11.90 for 2 boxes of pens",
        "ORDER_CREATED_SUCCESSFULLY" in res_rebate_pens["text"] and "11.90" in res_rebate_pens["text"]
    )

    # 4. Contract renewal rate lock ($120/mo)
    res_renewal = router.process("Renew contract and lock rate")
    assert_test(
        "Contract renewal returns CONTRACT_RENEWED_SUCCESSFULLY with $120.00/month rate lock",
        "CONTRACT_RENEWED_SUCCESSFULLY" in res_renewal["text"] and "$120.00" in res_renewal["text"]
    )

    # 5. Ambient scenario generation with high-likelihood price/deal filter
    amb_deal = AmbientIntelligence.trigger_scenario("price_deal")
    assert_test(
        "Ambient scenario generation yields high-likelihood deal/price spike",
        amb_deal["discount_type"] in ["past_purchase_deal", "price_spike_alternative", "volume_rebate"]
    )
    assert_test(
        "Ambient scenario includes audio_b64 or spoken synthesis prompt",
        "audio_b64" in amb_deal and (bool(amb_deal.get("audio_b64")) or bool(amb_deal.get("spoken")))
    )

    print("\n--- TEST GROUP 6: Smart Ambient Interruption Deduplication & Coordination ---", flush=True)
    # 1. Reset history
    AmbientIntelligence.reset_alerted_history()
    assert_test(
        "Reset alerted history clears all product tracking",
        len(AmbientIntelligence.get_alerted_products()) == 0
    )

    # 2. Trigger paper scenario
    sc_paper = AmbientIntelligence.trigger_scenario("supplier_price_spike")
    assert_test(
        "Paper scenario contains explicit product tag 'paper'",
        sc_paper.get("product") == "paper"
    )
    assert_test(
        "Alerted products contains 'paper' after trigger",
        "paper" in AmbientIntelligence.get_alerted_products()
    )

    # 3. Deduplication in trigger_random
    # With 'paper' already alerted, trigger_random should pick from non-paper candidates
    sc_next = AmbientIntelligence.trigger_random(deduplicate=True)
    assert_test(
        "Subsequent trigger does not repeat 'paper' when unalerted products remain",
        sc_next.get("product") != "paper"
    )

    # 4. Product tags exist on all scenarios
    from ambient import get_all_scenarios
    all_scenarios = get_all_scenarios()
    valid_products = ["paper", "coffee", "cleaning", "pens", "contract", "toner", "desk_mats", "cables", "sanitizer"]
    all_have_product = all("product" in s and s["product"] in valid_products for s in all_scenarios)
    assert_test(
        "All ambient scenarios have valid enterprise product tags",
        all_have_product
    )

    # 5. Reset cleans up
    AmbientIntelligence.reset_alerted_history()
    assert_test(
        "Final reset returns alerted products to clean state",
        len(AmbientIntelligence.get_alerted_products()) == 0
    )

    print(f"\n==========================================")
    print(f"Results: {passed} / {total} tests passed ({passed/total*100:.1f}%)")
    print(f"==========================================")

    if passed == total:
        print("\nALL TESTS PASSED! No regressions detected.")
        return 0
    else:
        print("\nSOME TESTS FAILED.")
        return 1

if __name__ == "__main__":
    sys.exit(test_all())
