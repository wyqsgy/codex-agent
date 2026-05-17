import os
import json
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from models import (
    ChatRequest, ChatResponse, FileReadRequest,
    FileWriteRequest, FileDeleteRequest, ExecuteCodeRequest,
)
from agent import engine
from tools import list_files, read_file, write_file, delete_file, execute_code, search_files
from config import (
    WORKSPACE_DIR, load_providers, save_user_provider, delete_user_provider,
    get_provider_api_key, DEFAULT_PROVIDER, DEFAULT_MODEL,
)

app = FastAPI(title="Wsygqy Agent", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "workspace": WORKSPACE_DIR, "name": "Wsygqy Agent"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    try:
        result = await engine.chat(
            message=req.message,
            conversation_id=req.conversation_id,
            provider_id=req.provider_id,
            model_id=req.model,
            context_files=req.context_files,
        )
        return ChatResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    return {"success": True}


@app.delete("/api/providers/{provider_id}")
async def remove_provider(provider_id: str):
    delete_user_provider(provider_id)
    engine._client_cache.pop(provider_id, None)
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