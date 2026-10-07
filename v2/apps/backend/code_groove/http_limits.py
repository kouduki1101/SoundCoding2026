from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, limit: int = 131072):
        self.app, self.limit = app, limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] not in ("POST", "PATCH", "DELETE"):
            await self.app(scope, receive, send)
            return
        messages, size = [], 0
        limit = 8 * 1024 * 1024 if scope.get("path") == "/api/v1/projects/import" else self.limit
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > limit:
                await JSONResponse(
                    {"error": {"code": "REQUEST_TOO_LARGE", "message": "入力が大きすぎます。"}},
                    status_code=413,
                )(scope, receive, send)
                return
            messages.append(message)
            if not message.get("more_body", False):
                break
        iterator = iter(messages)

        async def replay():
            return next(iterator, None) or await receive()

        await self.app(scope, replay, send)
