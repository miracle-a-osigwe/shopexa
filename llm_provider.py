from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional, Callable
import os
try:
    from google import genai
    from google.genai import types
    has_genai = True
except ImportError:
    genai = None
    types = None
    has_genai = False

import json
import telemetry


class LLMProvider(ABC):
    """
    Abstract Base Class for LLM Providers.
    Ensures easy switching between Gemini and AWS Bedrock.
    """

    @abstractmethod
    def generate_response(
        self,
        prompt: str,
        history: List[Dict[str, str]],
        tools: Optional[List[Callable]] = None,
    ) -> str:
        pass


class GeminiProvider(LLMProvider):
    """
    Gemini implementation of the LLMProvider.
    Uses Gemini 3.8 Pro for complex function calling and reasoning.
    Emits live telemetry events for the HUD panel.
    """

    def __init__(self, api_key: Optional[str] = None):
        if not has_genai:
            raise RuntimeError("google-genai SDK not installed in environment")
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY environment variable is required")

        self.client = genai.Client(api_key=self.api_key)
        self.model_id = "gemini-flash-latest"

    def generate_response(
        self,
        prompt: str,
        history: List[Dict[str, str]],
        tools: Optional[List[Callable]] = None,
    ) -> str:
        # ── Emit: user input received ────────────────────────────────────────
        telemetry.emit_thinking("Analysing user intent…")

        contents = []
        for msg in history:
            role = "user" if msg["role"] == "user" else "model"
            contents.append(
                types.Content(
                    role=role, parts=[types.Part.from_text(text=msg["content"])]
                )
            )

        contents.append(
            types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
        )

        config_params = {}
        if tools:
            config_params["tools"] = tools

        # ── Emit: calling LLM ────────────────────────────────────────────────
        telemetry.emit_thinking(
            f"Sending request to {self.model_id} with {len(tools or [])} MCP tools available…"
        )

        response = self.client.models.generate_content(
            model=self.model_id,
            contents=contents,
            config=types.GenerateContentConfig(**config_params)
            if config_params
            else None,
        )

        # ── Handle tool calls (Agentic Loop) ─────────────────────────────────
        if response.function_calls:
            contents.append(response.candidates[0].content)
            tool_responses = []

            for fc in response.function_calls:
                func_name = fc.name
                args = fc.args

                # ── Emit: MCP tool call ──────────────────────────────────────
                telemetry.emit_tool_call(
                    tool_name=func_name, args=dict(args) if args else {}
                )
                telemetry.emit_thinking(f"Executing MCP tool → {func_name}()")

                target_func = next((t for t in tools if t.__name__ == func_name), None)
                if target_func:
                    try:
                        result = target_func(**args)
                    except Exception as e:
                        result = f"Error calling {func_name}: {str(e)}"

                    # ── Emit: tool result ────────────────────────────────────
                    telemetry.emit_tool_result(tool_name=func_name, result=str(result))

                    tool_responses.append(
                        types.Part.from_function_response(
                            name=func_name, response={"result": result}
                        )
                    )

            contents.append(types.Content(role="user", parts=tool_responses))

            telemetry.emit_thinking("Tool results received. Composing final response…")

            final_response = self.client.models.generate_content(
                model=self.model_id,
                contents=contents,
                config=types.GenerateContentConfig(**config_params)
                if config_params
                else None,
            )

            telemetry.emit_agent_reply(final_response.text)
            return final_response.text

        telemetry.emit_agent_reply(response.text)
        return response.text
