"""LLM factory (OpenRouter via langchain-openai) plus a scripted model for tests and evals."""

import json
import uuid
from collections.abc import Callable, Sequence
from typing import Any

import httpx
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.config import get_settings

# model id -> (prompt $/token, completion $/token), filled from OpenRouter's /models on startup.
_pricing: dict[str, tuple[float, float]] = {}

# Test hook: when set, called as override(agent_name) and must return a chat model.
_model_override: Callable[[str], BaseChatModel] | None = None


def set_model_override(fn: Callable[[str], BaseChatModel] | None) -> None:
    global _model_override
    _model_override = fn


def model_name_for(agent: str) -> str:
    s = get_settings()
    return s.drafting_model if agent == "drafting_agent" else s.model_default


def get_chat_model(agent: str) -> BaseChatModel:
    if _model_override is not None:
        return _model_override(agent)
    s = get_settings()
    if not s.openrouter_api_key:
        raise LLMNotConfigured("OPENROUTER_API_KEY is not set")
    from langchain_openai import ChatOpenAI

    return ChatOpenAI(
        base_url=s.openrouter_base_url,
        api_key=s.openrouter_api_key,
        model=model_name_for(agent),
        temperature=0.2,
        timeout=s.agent_timeout_s,
        max_retries=0,  # AgentRunner owns retries
        extra_body={"usage": {"include": True}},
        default_headers={"HTTP-Referer": "https://github.com/awaaz", "X-Title": "Awaaz"},
    )


class LLMNotConfigured(RuntimeError):
    pass


async def load_pricing() -> None:
    s = get_settings()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{s.openrouter_base_url}/models")
            r.raise_for_status()
        for m in r.json().get("data", []):
            p = m.get("pricing") or {}
            try:
                _pricing[m["id"]] = (float(p.get("prompt", 0)), float(p.get("completion", 0)))
            except (TypeError, ValueError):
                continue
    except Exception:  # noqa: BLE001 - pricing is best effort
        pass


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    p_in, p_out = _pricing.get(model, (0.0, 0.0))
    return tokens_in * p_in + tokens_out * p_out


class ScriptedChatModel(BaseChatModel):
    """Deterministic chat model. `script` is a list of AIMessages or a function(messages) -> AIMessage."""

    script: Any
    calls: int = 0
    model_name: str = "scripted"

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> "ScriptedChatModel":
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        if callable(self.script):
            msg = self.script(messages)
        else:
            if self.calls >= len(self.script):
                raise RuntimeError("scripted model ran out of responses")
            msg = self.script[self.calls]
        self.calls += 1
        if isinstance(msg, Exception):
            raise msg
        msg = msg.model_copy()
        msg.usage_metadata = {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}
        return ChatResult(generations=[ChatGeneration(message=msg)])


def tool_call(name: str, **args: Any) -> AIMessage:
    """Helper to build an AIMessage that calls one tool."""
    return AIMessage(content="", tool_calls=[{"name": name, "args": args, "id": f"call_{uuid.uuid4().hex[:8]}"}])


def tool_calls(*calls: tuple[str, dict[str, Any]]) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": n, "args": a, "id": f"call_{uuid.uuid4().hex[:8]}"} for n, a in calls],
    )


def final(schema_name: str, **fields: Any) -> AIMessage:
    """Structured-output answer for ToolStrategy (the schema is exposed as a tool)."""
    return tool_call(schema_name, **fields)


def dumps(o: Any) -> str:
    return json.dumps(o, ensure_ascii=False, default=str)
