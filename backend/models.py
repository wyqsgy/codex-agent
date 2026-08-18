"""Pydantic 数据模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="用户消息")
    conversation_id: str | None = None
    provider_id: str | None = None
    model: str | None = None
    context_files: list[str] | None = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    tool_calls: list[dict] | None = None
    code_blocks: list[dict] | None = None


class FileReadRequest(BaseModel):
    path: str


class FileWriteRequest(BaseModel):
    path: str
    content: str


class FileDeleteRequest(BaseModel):
    path: str


class ExecuteCodeRequest(BaseModel):
    code: str = Field(..., min_length=1)
    language: str = "python"
    timeout: int = Field(default=30, ge=5, le=120)


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, description="搜索关键字")
    directory: str = Field(default="", description="搜索目录（相对工作区路径）")


class ProviderConfigRequest(BaseModel):
    id: str
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    api_key_env: str | None = None
    models: list[dict] | None = None