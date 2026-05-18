import os
import json
import time
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from models import (
    ChatRequest, ChatResponse, FileReadRequest,
    FileWriteRequest, FileDeleteRequest, ExecuteCodeRequest,
)
from agent import engine, AgentError, ConfigError, LLMError
from tools import list_files, read_file, write_file, delete_file, execute_code, search_files
from config import (
    WORKSPACE_DIR, load_providers, save_user_provider, delete_user_provider,
    get_provider_api_key, DEFAULT_PROVIDER, DEFAULT_MODEL,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("Wsygqy")

RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX = 60
_rate_limit_store: dict[str, list[float]] = {}


def _check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    if client_ip not in _rate_limit_store:
        _rate_limit_store[client_ip] = []
    _rate_limit_store[client_ip] = [
        t for t in _rate_limit_store[client_ip] if t > window_start
    ]
    _rate_limit_store[client_ip] = _rate_limit_store[client_ip][-RATE_LIMIT_MAX * 2:]
    if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_MAX:
        return False
    _rate_limit_store[client_ip].append(now)
    return True


async def _gc_periodic():
    while True:
        await asyncio.sleep(300)
        engine._gc_conversations()
        now = time.time()
        expired = [
            ip for ip, times in _rate_limit_store.items()
            if not times or max(times) < now - RATE_LIMIT_WINDOW * 2
        ]
        for ip in expired:
            _rate_limit_store.pop(ip, None)


@asynccontextmanager
async def lifespan(app: FastAPI):
    gc_task = asyncio.create_task(_gc_periodic())
    logger.info("Wsygqy Agent started")
    yield
    gc_task.cancel()
    logger.info("Wsygqy Agent shutting down")


app = FastAPI(title="Wsygqy Agent", version="2.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Remaining", "X-RateLimit-Reset"],
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    if request.url.path.startswith("/api/") and request.url.path != "/api/health":
        if not _check_rate_limit(client_ip):
            return StreamingResponse(
                content=iter([json.dumps({"detail": "请求过于频繁，请稍后再试。"})]),
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(RATE_LIMIT_WINDOW)},
            )
    response = await call_next(request)
    return response


@app.middleware("http")
async def log_middleware(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    logger.info(f"{request.method} {request.url.path} -> {response.status_code} ({duration:.3f}s)")
    return response


@app.exception_handler(AgentError)
async def agent_error_handler(request: Request, exc: AgentError):
    logger.warning(f"Agent error: {exc}")
    return StreamingResponse(
        content=iter([json.dumps({"detail": str(exc), "code": type(exc).__name__})]),
        status_code=400,
        media_type="application/json",
    )


@app.exception_handler(Exception)
async def global_error_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return StreamingResponse(
        content=iter([json.dumps({"detail": f"内部错误: {str(exc)}", "code": "InternalError"})]),
        status_code=500,
        media_type="application/json",
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "workspace": WORKSPACE_DIR, "name": "Wsygqy Agent", "version": "2.1.0"}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        result = await engine.chat(
            message=req.message,
            conversation_id=req.conversation_id,
            provider_id=req.provider_id,
            model_id=req.model,
            context_files=req.context_files,
        )
        if result.get("error"):
            raise ConfigError(result["reply"])
        return result
    except AgentError:
        raise
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    async def event_stream():
        try:
            async for event in engine.chat_stream(
                message=req.message,
                conversation_id=req.conversation_id,
                provider_id=req.provider_id,
                model_id=req.model,
                context_files=req.context_files,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except AgentError as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/conversations")
async def list_conversations():
    return engine.list_conversations()


@app.delete("/api/conversations/{conversation_id}")
async def remove_conversation(conversation_id: str):
    engine.delete_conversation(conversation_id)
    return {"success": True}


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


@app.post("/api/execute")
async def api_execute_code(req: ExecuteCodeRequest):
    try:
        result = execute_code(req.code, req.language, req.timeout)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/search")
async def api_search(query: str, directory: str = ""):
    try:
        results = search_files(query, directory)
        return results
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/providers")
async def get_providers():
    providers = load_providers()
    result = []
    for p in providers:
        api_key = get_provider_api_key(p)
        result.append({
            "id": p["id"],
            "name": p["name"],
            "base_url": p.get("base_url", ""),
            "api_key_env": p.get("api_key_env", ""),
            "api_key_set": bool(api_key),
            "models": p.get("models", []),
        })
    return result


class ProviderConfigRequest(BaseModel):
    id: str
    name: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    api_key_env: Optional[str] = None
    models: Optional[list[dict]] = None


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
    providers = load_providers()
    provider = next((p for p in providers if p["id"] == provider_id), None)
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider not found: {provider_id}")

    api_key = get_provider_api_key(provider)
    if not api_key:
        return {"success": False, "error": "API Key 未配置"}

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=provider.get("base_url", "") or None)
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


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
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