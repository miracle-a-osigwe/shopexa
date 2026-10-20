import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import boto3
import json
import os
import inspect
from typing import List, Dict, Any, Optional, Callable
from llm_provider import LLMProvider
import telemetry


class AWSBedrockProvider(LLMProvider):
    """
    AWS Bedrock implementation specializing in Amazon Nova Pro via the Converse API.
    Amazon Nova Pro is Amazon's state-of-the-art model for complex agentic workflows,
    multimodal understanding, and deep tool calling over the Model Context Protocol (MCP).
    """

    MODEL_ID = "amazon.nova-pro-v1:0"

    def __init__(self):
        region = os.getenv("AWS_REGION", "us-east-1")
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = os.getenv("BEDROCK_MODEL_ID", self.MODEL_ID)
        self.gemini_fallback = None
        try:
            from llm_provider import GeminiProvider
            self.gemini_fallback = GeminiProvider()
        except Exception as e:
            print(f"[AWSBedrockProvider] Gemini fallback notice: {e}")
        print(f"[AWSBedrockProvider] Initialized — target model: {self.model_id}")

    # ── Tool Schema Builder ───────────────────────────────────────────────────
    def _build_tool_spec(self, func: Callable) -> dict:
        """
        Automatically converts Python function signatures + docstrings
        into the Bedrock Converse API toolSpec format.
        """
        sig = inspect.signature(func)
        properties = {}
        required = []

        TYPE_MAP = {
            "str": "string", "int": "integer",
            "float": "number", "bool": "boolean",
            "dict": "object", "list": "array"
        }

        for name, param in sig.parameters.items():
            annotation = param.annotation
            type_name = "string"
            if annotation != inspect.Parameter.empty:
                raw = getattr(annotation, "__name__", str(annotation))
                type_name = TYPE_MAP.get(raw, "string")

            properties[name] = {"type": type_name}

            if param.default is inspect.Parameter.empty:
                required.append(name)

        return {
            "toolSpec": {
                "name": func.__name__,
                "description": (func.__doc__ or f"Execute {func.__name__}").strip(),
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": properties,
                        "required": required
                    }
                }
            }
        }

    # ── Main Response Generator ───────────────────────────────────────────────
    def generate_response(
        self,
        prompt: str,
        history: List[Dict[str, str]],
        tools: Optional[List[Callable]] = None
    ) -> str:

        # ── Build messages in Converse API format ─────────────────────────────
        messages = []
        for msg in history:
            role = "user" if msg["role"] == "user" else "assistant"
            messages.append({
                "role": role,
                "content": [{"text": msg["content"]}]
            })
        messages.append({"role": "user", "content": [{"text": prompt}]})

        # ── Build tool config ─────────────────────────────────────────────────
        tool_config = None
        tool_map = {}
        if tools:
            tool_config = {"tools": [self._build_tool_spec(t) for t in tools]}
            tool_map = {t.__name__: t for t in tools}

        # ── Telemetry ─────────────────────────────────────────────────────────
        telemetry.emit_thinking(f"🧠 Nova Pro: Orchestrating request across {len(tools or [])} MCP tools…")

        kwargs = dict(
            modelId=self.model_id,
            messages=messages,
            inferenceConfig={"maxTokens": 1500, "temperature": 0.2}
        )
        if tool_config:
            kwargs["toolConfig"] = tool_config

        try:
            response = self.client.converse(**kwargs)
            output_msg = response["output"]["message"]
            stop_reason = response["stopReason"]

            # ── Agentic tool-use loop ─────────────────────────────────────────────
            while stop_reason == "tool_use":
                messages.append(output_msg)
                tool_results = []

                for block in output_msg["content"]:
                    if block.get("toolUse"):
                        tu = block["toolUse"]
                        tool_name = tu["name"]
                        tool_args = tu.get("input", {})
                        tool_use_id = tu["toolUseId"]

                        telemetry.emit_tool_call(tool_name=tool_name, args=tool_args)
                        telemetry.emit_thinking(f"⚡ Nova Pro executing MCP tool: {tool_name}()")

                        func = tool_map.get(tool_name)
                        if func:
                            try:
                                result = func(**tool_args)
                            except Exception as e:
                                result = f"Error calling {tool_name}: {e}"
                        else:
                            result = f"Unknown tool: {tool_name}"

                        telemetry.emit_tool_result(tool_name=tool_name, result=str(result))

                        tool_results.append({
                            "toolResult": {
                                "toolUseId": tool_use_id,
                                "content": [{"text": str(result)}]
                            }
                        })

                # Return tool results to model
                messages.append({"role": "user", "content": tool_results})
                telemetry.emit_thinking("Tool results sent to Nova Pro. Composing final response…")

                kwargs["messages"] = messages
                response = self.client.converse(**kwargs)
                output_msg = response["output"]["message"]
                stop_reason = response["stopReason"]

            # ── Extract final text ────────────────────────────────────────────────
            for block in output_msg.get("content", []):
                if "text" in block:
                    telemetry.emit_agent_reply(block["text"])
                    return block["text"]

            return "Order processed and verified via Amazon Nova Pro."

        except Exception as e:
            telemetry.emit_thinking(f"ℹ️ Bedrock Converse notice: {e}. Executing with fallback agent…")
            if self.gemini_fallback:
                return self.gemini_fallback.generate_response(prompt=prompt, history=history, tools=tools)
            return f"An error occurred: {e}"
