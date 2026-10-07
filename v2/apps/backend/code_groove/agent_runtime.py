"""A single ADK custom agent runs the governed loop; durable state stays in JobService."""

from typing import Any

from google.adk.agents import BaseAgent
from google.adk.events import Event
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic import PrivateAttr


class BoundedRepositoryAgent(BaseAgent):
    _context: Any = PrivateAttr()
    _loop: Any = PrivateAttr()
    _result: Any = PrivateAttr(default=None)

    def __init__(self, context, loop):
        super().__init__(name="code_groove", description="Bounded read-only repository reasoning")
        self._context, self._loop = context, loop

    async def _run_async_impl(self, ctx):
        self._result = await self._loop(self._context)
        yield Event(
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text="Validated candidate submitted")]),
        )


async def run_with_adk(context, loop):
    agent = BoundedRepositoryAgent(context, loop)
    runner = InMemoryRunner(agent=agent, app_name="code_groove")
    session = await runner.session_service.create_session(app_name="code_groove", user_id="worker")
    try:
        async for _event in runner.run_async(
            user_id="worker",
            session_id=session.id,
            new_message=types.Content(
                role="user", parts=[types.Part(text="Inspect the selected immutable snapshot")]
            ),
        ):
            pass
        return agent._result
    finally:
        await runner.close()
