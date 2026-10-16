import asyncio

import pytest
from langchain_core.messages import AIMessage
from pydantic import BaseModel

from app import llm
from app.agents.runner import AgentFailed, AgentSpec, make_tool, runner
from app.events import bus
from app.llm import ScriptedChatModel, final, tool_call


class EchoArgs(BaseModel):
    text: str


class EchoOut(BaseModel):
    echoed: str


async def _echo(ctx, text: str):
    return {"echo": text.upper()}


def _spec():
    return AgentSpec(
        name="dummy_agent",
        system_prompt="Echo things.",
        build_tools=lambda ctx: [make_tool(ctx, "echo", "Echo text", EchoArgs, _echo)],
        output_schema=EchoOut,
    )


async def test_dummy_agent_streams_events():
    model = ScriptedChatModel(script=[tool_call("echo", text="hi"), final("EchoOut", echoed="HI")])
    llm.set_model_override(lambda name: model)
    q = bus.subscribe("s_test")
    res = await runner.run(_spec(), session_id="s_test", messages="say hi")
    assert res.output.echoed == "HI"
    kinds = []
    while not q.empty():
        kinds.append((await q.get())["kind"])
    assert kinds[0] == "agent.start" and kinds[-1] == "agent.end"
    assert "tool.start" in kinds and "tool.end" in kinds and "llm.message" in kinds
    hist = await bus.history("s_test")
    tool_end = next(e for e in hist if e["kind"] == "tool.end")
    assert tool_end["data"]["result"] == {"echo": "HI"}


async def test_agent_failure_raises_and_records_error():
    model = ScriptedChatModel(script=[ValueError("boom")])
    llm.set_model_override(lambda name: model)
    with pytest.raises(AgentFailed):
        await runner.run(_spec(), session_id="s_fail", messages="x")
    hist = await bus.history("s_fail")
    assert any(e["kind"] == "error" for e in hist)


async def test_agent_timeout():
    def slow(messages):
        import time

        time.sleep(0.5)
        return AIMessage(content="late")

    llm.set_model_override(lambda name: ScriptedChatModel(script=slow))
    with pytest.raises(AgentFailed):
        await runner.run(_spec(), session_id="s_to", messages="x", timeout_s=0.1)
    await asyncio.sleep(0.6)
