"""
Attention Gate — Zero-Wake-Word Intent & Audience Attention Classifier
Distinguishes between:
  1. DIRECT_ADDRESS: User issuing an action/inquiry to Shopexa (no wake word needed).
  2. PRESENTER_NARRATION: Presenter explaining features/architecture to hackathon judges.
  3. BYSTANDER_CHATTER: Background talk or unrelated discussion.
"""

import re
from typing import Dict, Any


class AttentionGate:
    # Markers indicating the presenter is addressing hackathon judges / audience
    PRESENTER_MARKERS = [
        r"\bjudges?\b",
        r"\bas you can see\b",
        r"\bnotice how\b",
        r"\bwe built\b",
        r"\bdemonstrating\b",
        r"\bfor the demo\b",
        r"\bshowing you\b",
        r"\bmeet shopexa\b",
        r"\bmeet shopexa ops\b",
        r"\bour architecture\b",
        r"\bmcp tool\b",
        r"\bmodel context protocol\b",
        r"\btelemetry hud\b",
        r"\bdual model\b",
        r"\bbedrock nova\b",
        r"\bwhat we've created\b",
        r"\bhere we see\b",
        r"\bin this project\b",
        r"\bour agent\b",
        # Pitch narrative markers (prevents accidental command execution during speech)
        r"\bevery smart display\b",
        r"\bsmall business\b",
        r"\bcafe operators\b",
        r"\boffice managers\b",
        r"\bby the time you notice\b",
        r"\bsits idle\b",
        r"\bwasted thousands\b",
        r"\bthis is shopexa\b",
        r"\bambient procurement\b",
        r"\bhere is the problem\b",
        r"\bin real offices\b",
        r"\bconstant interruptions\b",
        r"\bready to authorize\b",
        r"\bready to be authorized\b",
    ]

    # Explicit direct imperatives / procurement intents that should execute immediately
    DIRECT_INTENTS = [
        r"\bwhat did i miss\b",
        r"\bwhat's on my agenda\b",
        r"\bunread\b",
        r"\bbriefing\b",
        r"\brestock\b",
        r"\border\b",
        r"\breorder\b",
        r"\bbuy\b",
        r"\bpurchase\b",
        r"\bcheck inventory\b",
        r"\bsearch inventory\b",
        r"\bstock levels?\b",
        r"\bauthorize\b",
        r"\bapprove\b",
        r"\bconfirm order\b",
        r"\bpay now\b",
        r"\boption [1-3]\b",
        r"\bswitch to\b",
        r"\bchoose colombian\b",
        r"\bchoose kenya\b",
        r"\bkeep original\b",
        r"\bhow much is\b",
        r"\block in\b",
        r"\bresume\b",
        r"\bback to my order\b",
        r"\breturn to\b",
        r"\bwhere were we\b",
        # Notice & Alert Inquiries
        r"\bwhat('s| is) that notice\b",
        r"\bwhat('s| is) that alert\b",
        r"\bshow (the|my) notice\b",
        r"\bcheck (the|my) notice\b",
        r"\bread (the|my) notice\b",
        r"\breview notices\b",
        # Explicit authorization (must be an imperative command, not a passive clause)
        r"^(please\s+)?authorize\b",
        r"\bauthorize (the|this|my|purchase)?\s*order\b",
        r"\bapprove (the|this|my|purchase)?\s*order\b",
        r"\bconfirm (the|this|my|purchase)?\s*order\b",
        # Alternatives & Selection
        r"\boption [1-3]\b",
        r"\bswitch to\b",
        r"\bchoose colombian\b",
        r"\bchoose kenya\b",
        r"\bkeep original\b",
        # Inventory & Reordering
        r"^(please\s+)?(check|search|show)\s+(the\s+)?(inventory|stock|catalog)\b",
        r"\bcheck printer paper\b",
        r"\bcheck coffee\b",
        r"\bhow much is\b",
        r"^(please\s+)?(restock|reorder|buy|order)\b",
        # Flow Control
        r"\bback to my order\b",
        r"\bresume my order\b",
        r"\breturn to my order\b",
        r"\bwhere were we\b",
        r"\bwhat did i miss\b",
        r"\bwhat's on my agenda\b",
    ]

    @classmethod
    def classify(cls, utterance: str, presenter_mode: bool = False) -> Dict[str, Any]:
        text = (utterance or "").lower().strip()
        if not text:
            return {"action": "STANDBY", "intent": "SILENCE", "confidence": 1.0}

        # 1. Script Cue Check (Presenter introducing Shopexa to Judges)
        if "meet shopexa" in text or "meet shopexa ops" in text:
            return {
                "action": "STANDBY",
                "intent": "PRESENTER_NARRATION",
                "script_cue": "meet_shopexa_ops",
                "confidence": 0.98,
            }

        # 2. Check for Presenter Narration to Judges
        is_explaining = any(re.search(pat, text) for pat in cls.PRESENTER_MARKERS)
        if is_explaining:
            # Check if this is the exact 0:24 pitch cue that triggers Act 1
            is_script_cue = any(
                k in text
                for k in [
                    "ready to authorize",
                    "ready to be authorized",
                    "solution is ready",
                    "this is shopexa",
                    "meet shopexa",
                ]
            )
            return {
                "action": "STANDBY",
                "intent": "PRESENTER_NARRATION",
                "script_cue": is_script_cue,
                "confidence": 0.99,
            }

        # 3. Check for Direct Action Intent (Hands-free, NO wake word needed)
        has_direct_intent = any(re.search(pat, text) for pat in cls.DIRECT_INTENTS)
        if has_direct_intent:
            return {
                "action": "EXECUTE",
                "intent": "DIRECT_COMMAND",
                "confidence": 0.96,
            }

        # 4. Addressing by Name
        if any(w in text for w in ["alexa", "shopexa", "hey shopexa"]):
            return {
                "action": "EXECUTE",
                "intent": "DIRECT_COMMAND",
                "confidence": 0.99,
            }

        # ── Direct Wake Word ("Alexa" or "Shopexa") ──────────────────
        # If the user or a testing judge says the name, ALWAYS execute!
        has_wake_word = bool(re.search(r"\b(alexa|shopexa)\b", text))
        if has_wake_word:
            # Strip the wake word and check if it's a command
            clean_cmd = re.sub(r"\b(alexa|shopexa)[,\s]*", "", text).strip()
            return {
                "action": "EXECUTE",
                "intent": "DIRECT_WAKE_COMMAND",
                "clean_text": clean_cmd,
                "confidence": 1.0,
            }

        # 5. Short Confirmations (e.g., "yes", "do it", "sure", "cancel")
        if text in [
            "yes",
            "yeah",
            "sure",
            "proceed",
            "do it",
            "confirm",
            "no",
            "cancel",
            "stop",
            "dismiss",
        ]:
            return {
                "action": "EXECUTE",
                "intent": "DIRECT_CONFIRMATION",
                "confidence": 0.90,
            }

        # 6. Default fallback: If under Presenter Mode, default to Standby to protect the presentation
        if presenter_mode:
            return {
                "action": "STANDBY",
                "intent": "PRESENTER_NARRATION",
                "confidence": 0.85,
            }

        # Default for conversational queries
        return {
            "action": "EXECUTE",
            "intent": "DIRECT_CONVERSATION",
            "confidence": 0.70,
        }
