from pydantic import BaseModel
from typing import Optional


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    provider_id: Optional[str] = None
    model: Optional[str] = None
    context_files: Optional[list[str]] = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str
    tool_calls: Optional[list[dict]] = None
    code_blocks: Optional[list[dict]] = None


class FileReadRequest(BaseModel):
    path: str


class FileWriteRequest(BaseModel):
    path: str
    content: str


class FileDeleteRequest(BaseModel):
    path: str


class ExecuteCodeRequest(BaseModel):
    code: str
    language: str = "python"
    timeout: int = 30