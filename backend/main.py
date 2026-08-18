"""FastAPI 主服务。

提供 REST + SSE 接口：
- /api/chat、/api/chat/stream —— 对话
- /api/conversations —— 会话管理
- /api/files/* —— 文件管理
- /api/execute —— 代码执行
- /api/search —— 代码搜索
- /api/providers/* —— 提供商管理
- /ws/chat —— WebSocket 对话
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from agent import ConfigError, engine
from config import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    PORT,
    WORKSPACE_DIR,
    delete_user_provider,
    get_provider_api_key,
    load_providers,
    save_user_provider,
)
from models import (
    ChatRequest,
    ExecuteCodeRequest,
    FileDeleteRequest,
    FileReadRequest,
    FileWriteRequest,
    ProviderConfigRequest,
    SearchRequest,
)
from tools import delete_file, execute_code, list_files, read_file, search_files, write_file

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("CodeX.API")

APP_VERSION = "4.0.0"

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 60
_rate_limit_store: dict[str, list[float]] = {}

# 统计指标（内存中，非持久化）
_stats = {
    "started_at": time.time(),
    "total_requests": 0,
    "total_chats": 0,
    "total_files_created": 0,
    "total_code_executions": 0,
    "errors": 0,
    "active_websockets": 0,
}


def _check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    if client_ip not in _rate_limit_store:
        _rate_limit_store[client_ip] = []
    _rate_limit_store[client_ip] = [t for t in _rate_limit_store[client_ip] if t > window_start]
    _rate_limit_store[client_ip] = _rate_limit_store[client_ip][-RATE_LIMIT_MAX * 2:]
    if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_MAX:
        return False
    _rate_limit_store[client_ip].append(now)
    return True


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"CodeX Agent v{APP_VERSION} started")
    yield
    logger.info("CodeX Agent shutting down")


app = FastAPI(title="CodeX Agent", version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        if not _check_rate_limit(client_ip):
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试。"},
                headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
            )
    return await call_next(request)


@app.middleware("http")
async def log_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    start = time.time()
    _stats["total_requests"] += 1
    response = await call_next(request)
    duration = time.time() - start
    if response.status_code >= 400:
        _stats["errors"] += 1
    logger.info(f"[{request_id}] {request.method} {request.url.path} -> {response.status_code} ({duration:.3f}s)")
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "workspace": WORKSPACE_DIR,
        "name": "CodeX Agent",
        "version": APP_VERSION,
    }


@app.get("/api/stats")
async def stats():
    """返回服务运行统计信息。"""
    uptime = time.time() - _stats["started_at"]
    return {
        **{k: v for k, v in _stats.items() if k != "started_at"},
        "started_at": _stats["started_at"],
        "uptime_seconds": int(uptime),
        "uptime_human": f"{int(uptime // 3600)}h {int((uptime % 3600) // 60)}m",
        "version": APP_VERSION,
    }


# ---------------------------------------------------------------------------
# 对话
# ---------------------------------------------------------------------------
@app.post("/api/chat")
async def chat(req: ChatRequest):
    _stats["total_chats"] += 1
    try:
        result = await engine.chat(
            message=req.message,
            conversation_id=req.conversation_id,
            provider_id=req.provider_id,
            model_id=req.model,
            context_files=req.context_files,
        )
        return result
    except ConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    _stats["total_chats"] += 1
    async def event_stream():
        async for event in engine.chat_stream(
            message=req.message,
            conversation_id=req.conversation_id,
            provider_id=req.provider_id,
            model_id=req.model,
            context_files=req.context_files,
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    _stats["active_websockets"] += 1
    conversation_id = None
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            result = await engine.chat(
                message=msg.get("message", ""),
                conversation_id=conversation_id,
                provider_id=msg.get("provider_id"),
                model_id=msg.get("model"),
                context_files=msg.get("context_files"),
            )
            conversation_id = result["conversation_id"]
            await websocket.send_text(json.dumps(result, ensure_ascii=False))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"error": str(e)}))
        except Exception:
            pass
    finally:
        _stats["active_websockets"] -= 1


# ---------------------------------------------------------------------------
# 会话管理
# ---------------------------------------------------------------------------
@app.get("/api/conversations")
async def list_conversations():
    return engine.list_conversations()


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    from agent import _load_conversation

    messages = _load_conversation(conversation_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"id": conversation_id, "messages": messages}


@app.delete("/api/conversations/{conversation_id}")
async def remove_conversation(conversation_id: str):
    engine.delete_conversation(conversation_id)
    return {"success": True}


# ---------------------------------------------------------------------------
# 文件管理
# ---------------------------------------------------------------------------
@app.get("/api/files")
async def get_files(directory: str = ""):
    try:
        return list_files(directory)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/files/read")
async def api_read_file(req: FileReadRequest):
    try:
        content = read_file(req.path)
        return {"path": req.path, "content": content}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/files/write")
async def api_write_file(req: FileWriteRequest):
    _stats["total_files_created"] += 1
    try:
        result = write_file(req.path, req.content)
        return {"success": True, "message": result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/files/delete")
async def api_delete_file(req: FileDeleteRequest):
    try:
        result = delete_file(req.path)
        return {"success": True, "message": result}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# 代码执行 & 搜索
# ---------------------------------------------------------------------------
@app.post("/api/execute")
async def api_execute_code(req: ExecuteCodeRequest):
    _stats["total_code_executions"] += 1
    try:
        return await execute_code(req.code, req.language, req.timeout)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/search")
async def api_search(req: SearchRequest):
    try:
        return search_files(req.query, req.directory)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# 提供商管理
# ---------------------------------------------------------------------------
@app.get("/api/providers")
async def get_providers():
    result = []
    for p in load_providers():
        result.append({
            "id": p["id"],
            "name": p["name"],
            "base_url": p.get("base_url", ""),
            "api_key_env": p.get("api_key_env", ""),
            "api_key_set": bool(get_provider_api_key(p)),
            "models": p.get("models", []),
        })
    return result


@app.post("/api/providers/configure")
async def configure_provider(req: ProviderConfigRequest):
    providers = load_providers()
    existing = next((p for p in providers if p["id"] == req.id), None)

    if existing:
        if req.name is not None:
            existing["name"] = req.name
        if req.base_url is not None:
            existing["base_url"] = req.base_url
        if req.api_key is not None:
            existing["api_key"] = req.api_key
        if req.api_key_env is not None:
            existing["api_key_env"] = req.api_key_env
        if req.models is not None:
            existing["models"] = req.models
        save_user_provider(existing)
    else:
        if not req.name or not req.base_url:
            raise HTTPException(status_code=400, detail="新提供商需要提供 name 和 base_url")
        new_provider = {
            "id": req.id,
            "name": req.name,
            "base_url": req.base_url,
            "api_key": req.api_key or "",
            "api_key_env": req.api_key_env or f"{req.id.upper()}_API_KEY",
            "models": req.models or [],
        }
        save_user_provider(new_provider)

    engine._client_cache.pop(req.id, None)
    engine._async_client_cache.pop(req.id, None)
    return {"success": True}


@app.delete("/api/providers/{provider_id}")
async def remove_provider(provider_id: str):
    delete_user_provider(provider_id)
    engine._client_cache.pop(provider_id, None)
    engine._async_client_cache.pop(provider_id, None)
    return {"success": True}


@app.get("/api/providers/{provider_id}/test")
async def test_provider(provider_id: str):
    provider = next((p for p in load_providers() if p["id"] == provider_id), None)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider not found: {provider_id}")

    api_key = get_provider_api_key(provider)
    if not api_key:
        return {"success": False, "error": "API Key 未配置"}

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key, base_url=provider.get("base_url") or None)
        models = provider.get("models", [])
        test_model = models[0]["id"] if models else "gpt-3.5-turbo"
        response = client.chat.completions.create(
            model=test_model,
            messages=[{"role": "user", "content": "Hi"}],
            max_tokens=10,
        )
        return {"success": True, "model": test_model, "response": response.choices[0].message.content}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)