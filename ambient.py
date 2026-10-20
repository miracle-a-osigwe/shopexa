"""
Ambient Intelligence Engine
Simulates proactive, real-world enterprise procurement events:
- Supplier price spikes with vetted alternatives
- Past-purchase lightning deals & discount recommendations
- Tiered volume rebate threshold opportunities
- Critical burn-rate low stock alerts
- Expiring supplier contract rate locks

Surfaces notifications autonomously to the user with audio interruption (chime + Polly Neural speech).
"""

import asyncio
import base64
import json
import random
from typing import List, Callable, Optional
from fastapi.websockets import WebSocket

import telemetry
from aws_services import aws_services

# ── Enterprise Purchasing Scenarios ──────────────────────────────────────────
# Weighted so price changes and past-purchase deals represent 85% of random triggers.
AMBIENT_SCENARIOS = [
    {
        "id": "supplier_price_spike",
        "product": "coffee",
        "weight": 35,
        "severity": "warning",
        "scenario": "Supplier Price Spike: Ethiopian Coffee (+26%)",
        "detail": "RoastCraft Supplies raised Ethiopian Yirgacheffe Coffee Beans by +26% (from $17.50 → $22.00/bag). Colombian Supremo is available at $16.50/bag with next-day delivery (saving $11.00 on 2 bags).",
        "spoken": "Oh, excuse me, there is a notice: RoastCraft Supplies increased Ethiopian coffee by 26 percent. I found Colombian Supremo saving 11 dollars on two bags. Would you like to switch to Colombian or keep the original?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: RoastCraft Supplies increased Ethiopian coffee by 26 percent. I found Colombian Supremo saving 11 dollars on two bags. Would you like to switch to Colombian or keep the original?",
        "suggestion": "Option 1: Switch to Colombian",
        "action_label": "Switch to Colombian ($33.00)",
        "action_type": "supplier_switch",
        "discount_type": "price_spike_alternative",
        "item_name": "Ethiopian Yirgacheffe Coffee Beans (1kg)",
        "current_price": 22.00,
        "alt_price": 16.50,
        "savings": 11.00,
        "order_amount": "33.00",
    },
    {
        "id": "past_purchase_discount_cleaning",
        "product": "cleaning",
        "weight": 20,
        "severity": "info",
        "scenario": "Past Purchase Flash Sale: Microfiber Cleaning Cloths (30% Off)",
        "detail": "Microfiber Cleaning Cloths (Pack of 12) from your facility order on Sept 14 is on a 30% flash discount ($11.89 down from $16.99). High replenish probability for facility maintenance.",
        "spoken": "Oh, there is a notice: Microfiber cleaning cloths are on a 30 percent flash discount. Restock now for 11 dollars and 89 cents?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: Microfiber cleaning cloths are on a 30 percent flash discount. Restock now for 11 dollars and 89 cents?",
        "suggestion": "Reorder microfiber cloths",
        "action_label": "Lock in Flash Deal ($11.89)",
        "action_type": "past_purchase_deal",
        "discount_type": "past_purchase_deal",
        "item_name": "Microfiber Cleaning Cloths (Pack of 12)",
        "regular_price": 16.99,
        "deal_price": 11.89,
        "savings": 5.10,
        "order_amount": "11.89",
    },
    {
        "id": "volume_tier_rebate",
        "product": "pens",
        "weight": 8,
        "severity": "info",
        "scenario": "Volume Tier Rebate Opportunity: Gel Ink Pens",
        "detail": "You ordered 8 boxes of Gel Ink Pens this quarter. Adding 2 more boxes ($11.90) unlocks the 10-unit Tier 2 enterprise rebate of 18%, saving $15.00 net across the whole batch.",
        "spoken": "Oh, there is a notice: Ordering 2 boxes of gel pens unlocks an 18 percent volume rebate, saving 15 dollars total. Shall I add them?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: Ordering 2 boxes of gel pens unlocks an 18 percent volume rebate, saving 15 dollars total. Shall I add them?",
        "suggestion": "Unlock volume tier for pens",
        "action_label": "Unlock 18% Rebate ($11.90)",
        "action_type": "volume_rebate",
        "discount_type": "volume_rebate",
        "item_name": "Gel Ink Pens (Box of 12)",
        "bundle_price": 11.90,
        "savings": 15.00,
        "order_amount": "11.90",
    },
    {
        "id": "low_stock_critical",
        "product": "coffee",
        "weight": 4,
        "severity": "critical",
        "scenario": "Critical Inventory Alert: Breakroom Coffee",
        "detail": "Breakroom coffee is down to 1 bag — estimated 36 hours remaining at team consumption rate. Based on your 30-day usage pattern, I recommend ordering 2 bags now.",
        "spoken": "Oh, there is an urgent notice: Breakroom coffee is down to 1 bag, estimated to run out in 36 hours. Shall I reorder 2 bags of Ethiopian Yirgacheffe now?",
        "spoken_interrupted": "Oh, excuse me, there is an urgent notice: Breakroom coffee is down to 1 bag, estimated to run out in 36 hours. Shall I reorder 2 bags of Ethiopian Yirgacheffe now?",
        "suggestion": "Restock the coffee",
        "action_label": "Restock Coffee ($37.00)",
        "action_type": "reorder",
        "discount_type": "low_stock",
        "item_name": "Ethiopian Yirgacheffe Coffee Beans (1kg)",
        "order_amount": "37.00",
    },
    {
        "id": "contract_renewal",
        "product": "contract",
        "weight": 3,
        "severity": "info",
        "scenario": "Supplier Contract Price-Lock Expiration",
        "detail": "Your cleaning supplies agreement with CleanCo expires in 5 days. Renewing now locks in the current rate ($120/mo) and avoids a scheduled 15% price hike.",
        "spoken": "Oh, there is a notice: Your supplier agreement with CleanCo expires in 5 days. Renewing today locks in your current rate and prevents a 15 percent price hike. Would you like me to renew?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: Your supplier agreement with CleanCo expires in 5 days. Renewing today locks in your current rate and prevents a 15 percent price hike. Would you like me to renew?",
        "suggestion": "Renew CleanCo contract",
        "action_label": "Renew & Lock Rate ($120/mo)",
        "action_type": "contract",
        "discount_type": "contract_renewal",
    },
    {
        "id": "bulk_discount_toner",
        "product": "toner",
        "weight": 20,
        "severity": "info",
        "scenario": "Volume Discount: Printer Toner (Buy 2 Get 1 Free)",
        "detail": "PrintMaster is offering a 'Buy 2 Get 1 Free' deal on High Yield Black Toner. This aligns perfectly with your projected quarterly usage.",
        "spoken": "Oh, there is a notice: PrintMaster has a buy two get one free deal on black toner, which matches your quarterly usage. Should I add this to the cart for 180 dollars?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: PrintMaster has a buy two get one free deal on black toner, which matches your quarterly usage. Should I add this to the cart for 180 dollars?",
        "suggestion": "Yes, order the toner",
        "action_label": "Claim Buy 2 Get 1 Free ($180)",
        "action_type": "volume_discount",
        "discount_type": "bulk_discount",
        "item_name": "High Yield Black Toner",
        "order_amount": "180.00",
    },
    {
        "id": "fleet_discount_desk_mats",
        "product": "desk_mats",
        "weight": 15,
        "severity": "info",
        "scenario": "Fleet Discount: High-Density Anti-Fatigue Desk Mats (25% Fleet Off)",
        "detail": "ErgoComfort is offering an enterprise fleet discount of 25% on commercial anti-fatigue desk mats ($37.49 down from $49.99). Recommended for newly provisioned workstations.",
        "spoken": "Oh, there is a notice: ErgoComfort is offering a 25 percent fleet discount on commercial standing desk mats, saving 25 dollars on 2 mats. Would you like me to stage this order?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: ErgoComfort is offering a 25 percent fleet discount on commercial standing desk mats, saving 25 dollars on 2 mats. Would you like me to stage this order?",
        "suggestion": "Stage order for desk mats",
        "action_label": "Claim 25% Fleet Deal ($74.98)",
        "action_type": "volume_discount",
        "discount_type": "fleet_discount",
        "item_name": "High-Density Anti-Fatigue Desk Mats (Set of 2)",
        "order_amount": "74.98",
    },
    {
        "id": "lightning_deal_cables",
        "product": "cables",
        "weight": 15,
        "severity": "info",
        "scenario": "Lightning Deal: 60W USB-C Braided Fast-Charging Cables 5-Pack (35% Off)",
        "detail": "Anker Direct launched a 3-hour Lightning Deal on 60W USB-C Braided Cables (5-Pack) at $18.19 (regular $27.99). Ideal for restock in conference rooms and IT peripherals.",
        "spoken": "Oh, there is a notice: A 35 percent lightning deal is live on USB-C fast-charging cable packs for 18 dollars and 19 cents. Should I add this to your staged orders?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: A 35 percent lightning deal is live on USB-C fast-charging cable packs for 18 dollars and 19 cents. Should I add this to your staged orders?",
        "suggestion": "Order USB-C cables",
        "action_label": "Lock in Lightning Deal ($18.19)",
        "action_type": "past_purchase_deal",
        "discount_type": "lightning_deal",
        "item_name": "60W USB-C Braided Cables (5-Pack)",
        "order_amount": "18.19",
    },
    {
        "id": "facility_deal_sanitizer",
        "product": "sanitizer",
        "weight": 12,
        "severity": "info",
        "scenario": "Facility Promo: Commercial Touchless Hand Sanitizer Gallons (Buy 3 Get 1 Free)",
        "detail": "PureClean Commercial Supply is offering a 'Buy 3 Get 1 Free' promotion on 1-Gallon Touchless Dispenser Refills ($45.00 total, saving $15.00). Restocks facility stations through Q4.",
        "spoken": "Oh, there is a notice: PureClean has a buy 3 get 1 free promotion on commercial hand sanitizer refills for 45 dollars. Would you like me to restock this for the facility?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: PureClean has a buy 3 get 1 free promotion on commercial hand sanitizer refills for 45 dollars. Would you like me to restock this for the facility?",
        "suggestion": "Restock hand sanitizer",
        "action_label": "Claim Buy 3 Get 1 Free ($45.00)",
        "action_type": "volume_discount",
        "discount_type": "bulk_discount",
        "item_name": "Commercial Hand Sanitizer Refill (4 Gallons)",
        "order_amount": "45.00",
    },
    {
        "id": "supplier_price_spike",
        "product": "paper",
        "weight": 35,
        "severity": "warning",
        "scenario": "Supplier Price Spike: A4 Printer Paper (+22%)",
        "detail": "Acme Paper Co. raised A4 Printer Paper prices by +22% (from $8.99 → $10.95/pack). OfficePro A4 Paper is available at $7.49 with same-day delivery.",
        "spoken": "Oh, there is a notice: Acme paper increased 22 percent. I found an OfficePro alternative saving 10 dollars. Switch to OfficePro or keep the original?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: Acme paper increased 22 percent. I found an OfficePro alternative saving 10 dollars. Switch to OfficePro or keep the original?",
        "suggestion": "Switch to OfficePro",
        "action_label": "Switch to OfficePro ($22.47)",
        "action_type": "supplier_switch",
        "discount_type": "price_spike_alternative",
        "item_name": "A4 Printer Paper",
        "current_price": 10.95,
        "alt_price": 7.49,
        "savings": 10.38,
        "order_amount": "22.47",
    },
    {
        "id": "past_purchase_discount_coffee",
        "product": "coffee",
        "weight": 30,
        "severity": "info",
        "scenario": "Past Purchase Deal: Ethiopian Coffee Beans (20% Off)",
        "detail": "An item you ordered 3 weeks ago, 'Ethiopian Yirgacheffe Coffee Beans (1kg)', just dropped by 20% on Amazon Business ($14.80 down from $18.50). 32 bags left in promotional inventory.",
        "spoken": "Oh, there is a notice: Ethiopian coffee dropped 20 percent on Amazon Business. Want me to restock 2 bags for 29 dollars and 60 cents?",
        "spoken_interrupted": "Oh, excuse me, there is a notice: Ethiopian coffee dropped 20 percent on Amazon Business. Want me to restock 2 bags for 29 dollars and 60 cents?",
        "suggestion": "Lock in discount for coffee",
        "action_label": "Lock in 20% Discount ($29.60)",
        "action_type": "past_purchase_deal",
        "discount_type": "past_purchase_deal",
        "item_name": "Ethiopian Yirgacheffe Coffee Beans (1kg)",
        "regular_price": 18.50,
        "deal_price": 14.80,
        "savings": 7.40,
        "order_amount": "29.60",
    },
]

# Tracks which scenarios and product categories have already been alerted in this session
_fired_scenarios: set = set()
_alerted_products: set = set()
_ambient_callbacks: List[Callable] = []


def reset_alerted_history():
    """Reset alerted products and fired scenarios tracking."""
    _fired_scenarios.clear()
    _alerted_products.clear()
    print("[Ambient] Alert history reset: all products available for proactive alerts.")


def get_alerted_products() -> List[str]:
    """Return list of products already alerted in this session."""
    return sorted(list(_alerted_products))


def mark_product_alerted(product: str):
    """Manually register that a product has been alerted."""
    if product:
        _alerted_products.add(product.lower())


def register_ambient_callback(cb: Callable):
    """Register a callback that receives the full scenario dict when triggered."""
    _ambient_callbacks.append(cb)


def _generate_scenario_audio(text: str) -> Optional[str]:
    """Generates base64 Polly MP3 audio (Commented out to rely on native Nova Sonic)."""
    # Polly audio disabled in favor of Amazon Nova Sonic direct voice session
    # try:
    #     if aws_services:
    #         audio_bytes = aws_services.get_tts(text)
    #         if audio_bytes:
    #             return base64.b64encode(audio_bytes).decode("utf-8")
    # except Exception as e:
    #     print(f"[Ambient] Audio synthesis notice: {e}")
    return None


def _broadcast_scenario(scenario: dict) -> dict:
    """Emit the ambient trigger event and notify registered callbacks."""
    spoken_text = (
        scenario.get("spoken")
        or f"Oh, there is a notice: {scenario['detail']} {scenario['suggestion']}"
    )
    interrupted_spoken_text = scenario.get("spoken_interrupted") or (
        spoken_text.replace(
            "Oh, there is a notice:", "Oh, excuse me, there is a notice:"
        ).replace(
            "Oh, there is an urgent notice:",
            "Oh, excuse me, there is an urgent notice:",
        )
        if "Oh, there is" in spoken_text
        else f"Oh, excuse me, there is a notice: {spoken_text}"
    )

    # Polly audio generation disabled for pure Nova Sonic streaming
    audio_b64 = None
    audio_interrupted_b64 = None

    payload = {
        **scenario,
        "spoken": spoken_text,
        "spoken_interrupted": interrupted_spoken_text,
        "audio_b64": audio_b64,
        "audio_interrupted_b64": audio_interrupted_b64,
    }

    # Record that this scenario and its product category have fired
    _fired_scenarios.add(scenario["id"])
    if scenario.get("product"):
        _alerted_products.add(scenario["product"].lower())

    telemetry.emit_ambient_trigger(
        scenario=scenario["scenario"],
        severity=scenario["severity"],
        detail=interrupted_spoken_text,
    )
    # Broadcast full scenario payload over HUD WebSocket
    telemetry.emit("ambient_scenario", payload)

    for cb in _ambient_callbacks:
        try:
            cb(payload)
        except Exception:
            pass

    return payload


def trigger_scenario(
    scenario_id: str, product_context: Optional[str] = None
) -> Optional[dict]:
    """Trigger a specific scenario by ID and broadcast it."""
    if scenario_id == "random":
        return trigger_random(product_context=product_context)
    if scenario_id == "price_deal":
        return trigger_random(force_price_deal=True, product_context=product_context)
    scenario = next((s for s in AMBIENT_SCENARIOS if s["id"] == scenario_id), None)
    if not scenario:
        return None
    return _broadcast_scenario(scenario)


def trigger_random(
    force_price_deal: bool = False,
    deduplicate: bool = True,
    product_context: Optional[str] = None,
) -> dict:
    """
    Trigger a scenario with weighted probabilities and context awareness.
    If product_context is provided (e.g., 'coffee', 'paper'), prioritizes alerts matching that product.
    Price spikes and past-purchase discounts represent 85% of total probability.
    Ensures that when it interrupts for a product, it does not repeat for that same product.
    """
    if force_price_deal:
        candidates = [
            s
            for s in AMBIENT_SCENARIOS
            if s["id"]
            in [
                "supplier_price_spike",
                "past_purchase_discount_coffee",
                "past_purchase_discount_cleaning",
            ]
        ]
    else:
        candidates = AMBIENT_SCENARIOS

    # If active product context is present, filter for relevant scenarios
    if product_context:
        ctx_lower = product_context.lower()
        contextual_candidates = [
            s
            for s in candidates
            if s.get("product", "").lower() == ctx_lower
            or ctx_lower in s.get("scenario", "").lower()
            or ctx_lower in s.get("item_name", "").lower()
        ]
        if contextual_candidates:
            candidates = contextual_candidates

    if deduplicate:
        unalerted = [
            s
            for s in candidates
            if s["id"] not in _fired_scenarios
            and s.get("product", "").lower() not in _alerted_products
        ]
        if unalerted:
            candidates = unalerted
        else:
            # All candidates/products in pool have been alerted: reset tracking so ambient cycles continue
            _alerted_products.clear()
            _fired_scenarios.clear()

    weights = [s.get("weight", 10) for s in candidates]
    chosen = random.choices(candidates, weights=weights, k=1)[0]
    return _broadcast_scenario(chosen)


def get_all_scenarios() -> List[dict]:
    return AMBIENT_SCENARIOS


# ── Autonomous Background Engine ─────────────────────────────────────────────
class AmbientProactiveEngine:
    """
    Autonomous background engine that periodically evaluates supply chains and
    proactively interrupts the user when actionable price changes or discount deals occur.
    """

    def __init__(self):
        self.running = False
        self.task: Optional[asyncio.Task] = None
        self.initial_delay_seconds = random.randint(
            30, 40
        )  # Fire exactly between 30 and 40s after starting
        self.min_interval = 40
        self.max_interval = 60
        self.count = 0

    async def _loop(self):
        self.running = True
        print(
            f"[AmbientEngine] Proactive cycle started. First alert in {self.initial_delay_seconds}s..."
        )
        await asyncio.sleep(self.initial_delay_seconds)
        while self.running:
            try:
                self.count += 1
                # 85% probability price spike / past-purchase discount
                scenario = trigger_random()
                print(
                    f"[AmbientEngine] Proactively triggered [{scenario['id']}]: {scenario['scenario']}"
                )
            except Exception as e:
                print(f"[AmbientEngine] Error in loop: {e}")

            delay = random.randint(self.min_interval, self.max_interval)
            await asyncio.sleep(delay)

    def start(self):
        self.initial_delay_seconds = random.randint(30, 40)
        if not self.running:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    self.task = loop.create_task(self._loop())
                else:
                    self.task = asyncio.ensure_future(self._loop())
                self.running = True
            except RuntimeError:
                pass

    def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()
            self.task = None
        print("[AmbientEngine] Proactive cycle stopped.")

    def is_active(self) -> bool:
        return self.running


class AmbientIntelligence:
    @staticmethod
    def trigger_scenario(scenario_id: str = "random"):
        return trigger_scenario(scenario_id)

    @staticmethod
    def trigger_random(force_price_deal: bool = False, deduplicate: bool = True):
        return trigger_random(
            force_price_deal=force_price_deal, deduplicate=deduplicate
        )

    @staticmethod
    def reset_alerted_history():
        return reset_alerted_history()

    @staticmethod
    def get_alerted_products():
        return get_alerted_products()

    @staticmethod
    def mark_product_alerted(product: str):
        return mark_product_alerted(product)


# Singleton engine instance
engine = AmbientProactiveEngine()


def start_ambient_loop():
    engine.start()


def stop_ambient_loop():
    engine.stop()


def is_ambient_running() -> bool:
    return engine.is_active()
