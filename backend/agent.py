"""CodeX Agent 核心引擎。

基于 OpenAI 兼容 API 的 Function Calling 实现多轮对话与工具调用循环。
特性：
- 原生 Function Calling（不再用正则解析 tool 块）
- 流式输出（SSE 兼容）
- SQLite 持久化会话历史
- 指数退避重试
- 多提供商支持
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator

from openai import AsyncOpenAI, OpenAI

from config import (
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    get_provider_api_key,
    load_providers,
)
from tools import TOOL_DEFINITIONS, call_tool

logger = logging.getLogger("CodeX.Agent")

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are CodeX, a powerful AI coding assistant built with FastAPI and React. You help users with software engineering tasks: writing, editing, debugging, explaining code, and managing project files.

You have access to the following tools:
- **list_files** — list files in a directory
- **read_file** — read a file's content
- **write_file** — create or overwrite a file
- **delete_file** — delete a file or directory
- **execute_code** — run Python / JavaScript / TypeScript code in a sandbox
- **search_files** — search for text in workspace files

Important rules:
- Always read a file before modifying it
- Write complete, working code
- Explain your reasoning step by step
- If code execution fails, analyze the error and fix it
- Respond in the user's language
- The workspace directory is the root of all file operations
"""

MAX_TOOL_ITERATIONS = 8
MAX_RETRIES = 3
BASE_RETRY_DELAY = 1.0
CONVERSATION_MAX_MESSAGES = 60
CONVERSATION_TTL = 3600  # 1 hour

CODE_BLOCK_PATTERN = re.compile(r"```(\w+)?\s*\n(.*?)\n```", re.DOTALL)

# SQLite 数据库路径
DB_DIR = Path(__file__).parent / "data"
DB_PATH = DB_DIR / "conversations.db"


# ---------------------------------------------------------------------------
# SQLite 持久化
# ---------------------------------------------------------------------------
def _init_db() -> None:
    """初始化数据库表。"""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                messages TEXT NOT NULL DEFAULT '[]',
                title TEXT NOT NULL DEFAULT '',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_updated_at ON conversations(updated_at DESC)")
        conn.commit()


@contextmanager
def _get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def _save_conversation(conv_id: str, messages: list[dict], title: str = "") -> None:
    now = time.time()
    with _get_db() as conn:
        conn.execute(
            """INSERT INTO conversations (id, messages, title, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
               messages = excluded.messages, title = excluded.title,
               updated_at = excluded.updated_at""",
            (conv_id, json.dumps(messages, ensure_ascii=False), title, now, now),
        )
        conn.commit()


def _load_conversation(conv_id: str) -> list[dict] | None:
    with _get_db() as conn:
        row = conn.execute("SELECT messages FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if row:
        return json.loads(row["messages"])
    return None


def _delete_conversation(conv_id: str) -> None:
    with _get_db() as conn:
        conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        conn.commit()


def _list_conversations() -> list[dict]:
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50"
        ).fetchall()
    return [
        {
            "id": r["id"],
            "title": r["title"] or "New Conversation",
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


def _gc_conversations() -> None:
    """清理过期会话。"""
    now = time.time()
    threshold = now - CONVERSATION_TTL
    with _get_db() as conn:
        conn.execute("DELETE FROM conversations WHERE updated_at < ?", (threshold,))
        conn.commit()


# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------
class AgentError(Exception):
    pass


class ConfigError(AgentError):
    pass


class LLMError(AgentError):
    pass


# ---------------------------------------------------------------------------
# Agent 引擎
# ---------------------------------------------------------------------------
@dataclass
class ToolCallRecord:
    name: str
    args: dict[str, Any]
    result: dict[str, Any]


class AgentEngine:
    """CodeX Agent 核心。

    负责：
    - 管理多提供商客户端
    - 多轮对话（含 Function Calling）
    - 流式输出
    - 会话 SQLite 持久化
    """

    def __init__(self) -> None:
        self._client_cache: dict[str, OpenAI] = {}
        self._async_client_cache: dict[str, AsyncOpenAI] = {}
        # 内存缓存：活跃会话的消息（避免频繁读 SQLite）
        self._active_conversations: dict[str, list[dict]] = {}
        _init_db()

    # ---- 客户端管理 ------------------------------------------------------

    def _get_client(self, provider_id: str) -> OpenAI | None:
        if provider_id in self._client_cache:
            return self._client_cache[provider_id]

        providers = load_providers()
        provider = next((p for p in providers if p["id"] == provider_id), None)
        if not provider:
            return None

        api_key = get_provider_api_key(provider)
        if not api_key:
            return None

        client = OpenAI(
            api_key=api_key,
            base_url=provider.get("base_url") or None,
            timeout=120.0,
            max_retries=2,
        )
        self._client_cache[provider_id] = client
        return client

    def _get_async_client(self, provider_id: str) -> AsyncOpenAI | None:
        if provider_id in self._async_client_cache:
            return self._async_client_cache[provider_id]

        providers = load_providers()
        provider = next((p for p in providers if p["id"] == provider_id), None)
        if not provider:
            return None

        api_key = get_provider_api_key(provider)
        if not api_key:
            return None

        client = AsyncOpenAI(
            api_key=api_key,
            base_url=provider.get("base_url") or None,
            timeout=120.0,
            max_retries=2,
        )
        self._async_client_cache[provider_id] = client
        return client

    def _resolve_model(self, provider_id: str, model_id: str) -> tuple[str, str]:
        providers = load_providers()
        provider = next((p for p in providers if p["id"] == provider_id), None)

        if not provider:
            for p in providers:
                for m in p.get("models", []):
                    if m["id"] == model_id:
                        return p["id"], model_id
            return DEFAULT_PROVIDER, DEFAULT_MODEL

        if not model_id:
            models = provider.get("models", [])
            return provider_id, models[0]["id"] if models else DEFAULT_MODEL

        return provider_id, model_id

    # ---- 会话管理 --------------------------------------------------------

    def _ensure_conversation(self, conv_id: str) -> list[dict]:
        """保证会话存在，返回消息列表。"""
        if conv_id not in self._active_conversations:
            cached = _load_conversation(conv_id)
            if cached:
                self._active_conversations[conv_id] = cached
            else:
                self._active_conversations[conv_id] = [
                    {"role": "system", "content": SYSTEM_PROMPT}
                ]
        return self._active_conversations[conv_id]

    def _persist(self, conv_id: str, title: str = "") -> None:
        """将活跃会话写入 SQLite。"""
        messages = self._active_conversations.get(conv_id)
        if messages:
            _save_conversation(conv_id, messages, title)

    def list_conversations(self) -> list[dict]:
        _gc_conversations()
        return _list_conversations()

    def delete_conversation(self, conv_id: str) -> None:
        self._active_conversations.pop(conv_id, None)
        _delete_conversation(conv_id)

    # ---- 核心：LLM 调用 --------------------------------------------------

    async def _call_llm_stream(
        self,
        messages: list[dict],
        provider_id: str,
        model_id: str,
        tools: list[dict] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """流式调用 LLM，逐 token 产出。"""
        resolved_provider, resolved_model = self._resolve_model(provider_id, model_id)
        client = self._get_async_client(resolved_provider)

        if not client:
            raise ConfigError(
                f"Provider '{resolved_provider}' not configured. "
                "Please configure an API key in settings."
            )

        last_error: str | None = None
        for attempt in range(MAX_RETRIES):
            try:
                kwargs: dict[str, Any] = {
                    "model": resolved_model,
                    "messages": messages,
                    "temperature": 0.1,
                    "max_tokens": 4096,
                    "stream": True,
                    "stream_options": {"include_usage": True},
                }
                if tools:
                    kwargs["tools"] = tools
                    kwargs["tool_choice"] = "auto"

                stream = await client.chat.completions.create(**kwargs)

                # 收集函数调用（跨 chunk 聚合）
                tool_calls_accum: dict[int, dict] = {}
                async for chunk in stream:
                    delta = chunk.choices[0].delta
                    # 文本 token
                    if delta.content:
                        yield {"type": "token", "content": delta.content}

                    # 工具调用片段
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in tool_calls_accum:
                                tool_calls_accum[idx] = {
                                    "id": tc.id or "",
                                    "function": {"name": "", "arguments": ""},
                                }
                            if tc.id:
                                tool_calls_accum[idx]["id"] = tc.id
                            if tc.function:
                                if tc.function.name:
                                    tool_calls_accum[idx]["function"]["name"] += tc.function.name
                                if tc.function.arguments:
                                    tool_calls_accum[idx]["function"]["arguments"] += tc.function.arguments

                if tool_calls_accum:
                    yield {
                        "type": "tool_calls",
                        "tool_calls": sorted(tool_calls_accum.values(), key=lambda x: x.get("_idx", 0)),
                    }
                return

            except Exception as e:
                last_error = str(e)
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(BASE_RETRY_DELAY * (2 ** attempt))
                    self._async_client_cache.pop(resolved_provider, None)
                    client = self._get_async_client(resolved_provider)
                    if not client:
                        raise ConfigError("API key configuration expired.")

        raise LLMError(f"LLM call failed after {MAX_RETRIES} retries: {last_error}")

    # ---- 主对话接口 ------------------------------------------------------

    async def chat(
        self,
        message: str,
        conversation_id: str | None = None,
        provider_id: str | None = None,
        model_id: str | None = None,
        context_files: list[str] | None = None,
    ) -> dict[str, Any]:
        """非流式对话（内部使用 Function Calling 循环）。"""
        conv_id = conversation_id or str(uuid.uuid4())
        messages = self._ensure_conversation(conv_id)

        resolved_provider = provider_id or DEFAULT_PROVIDER
        resolved_model = model_id or DEFAULT_MODEL

        # 附加上下文文件
        from tools import read_file as _read_file

        context_addition = ""
        if context_files:
            file_contents = []
            for fp in context_files:
                try:
                    content = _read_file(fp)
                    file_contents.append(f"--- {fp} ---\n{content}\n")
                except Exception:
                    pass
            if file_contents:
                context_addition = "\n\nContext files:\n" + "\n".join(file_contents)

        messages.append({"role": "user", "content": message + context_addition})

        tool_results: list[ToolCallRecord] = []
        final_reply = ""

        for _ in range(MAX_TOOL_ITERATIONS):
            try:
                client = self._get_client(resolved_provider)
                if not client:
                    raise ConfigError(f"Provider '{resolved_provider}' not configured.")

                kwargs: dict[str, Any] = {
                    "model": resolved_model,
                    "messages": messages,
                    "temperature": 0.1,
                    "max_tokens": 4096,
                }
                kwargs["tools"] = TOOL_DEFINITIONS
                kwargs["tool_choice"] = "auto"

                response = client.chat.completions.create(**kwargs)
                choice = response.choices[0]
                assistant_msg = choice.message

                # 工具调用：先执行工具，再进入下一轮让 LLM 处理结果
                if assistant_msg.tool_calls:
                    tool_call_msgs = []
                    tool_results_batch: list[ToolCallRecord] = []
                    for tc in assistant_msg.tool_calls:
                        name = tc.function.name
                        try:
                            args = json.loads(tc.function.arguments)
                        except json.JSONDecodeError:
                            args = {}
                        result = await call_tool(name, args)
                        record = ToolCallRecord(name=name, args=args, result=result)
                        tool_results.append(record)
                        tool_results_batch.append(record)
                        tool_call_msgs.append({
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": name, "arguments": tc.function.arguments},
                        })

                    messages.append({
                        "role": "assistant",
                        "content": assistant_msg.content,
                        "tool_calls": tool_call_msgs,
                    })

                    for tc, record in zip(assistant_msg.tool_calls, tool_results_batch):
                        result_str = json.dumps(record.result, ensure_ascii=False)
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result_str,
                        })
                    continue  # 继续循环，让 LLM 处理工具结果

                # 无工具调用 = 对话结束
                if assistant_msg.content:
                    final_reply = assistant_msg.content
                    messages.append({"role": "assistant", "content": assistant_msg.content})
                break

            except AgentError:
                raise
            except Exception as e:
                raise LLMError(str(e)) from e

        # 截断过长会话
        if len(messages) > CONVERSATION_MAX_MESSAGES:
            system_msg = messages[0]
            recent = messages[-20:]
            messages = [system_msg] + recent
            self._active_conversations[conv_id] = messages

        # 提取代码块
        code_blocks = self._extract_code_blocks(final_reply)

        # 持久化
        title = self._extract_title(messages)
        self._persist(conv_id, title)

        return {
            "reply": final_reply,
            "conversation_id": conv_id,
            "tool_calls": [
                {
                    "tool": r.name,
                    "args": r.args,
                    "result": {"success": r.result["success"], "result": r.result.get("result"), "error": r.result.get("error")},
                }
                for r in tool_results
            ] if tool_results else None,
            "code_blocks": code_blocks if code_blocks else None,
        }

    async def chat_stream(
        self,
        message: str,
        conversation_id: str | None = None,
        provider_id: str | None = None,
        model_id: str | None = None,
        context_files: list[str] | None = None,
    ) -> AsyncGenerator[dict, None]:
        """流式对话（SSE），支持 Function Calling 与实时工具调用。"""
        conv_id = conversation_id or str(uuid.uuid4())
        messages = self._ensure_conversation(conv_id)

        resolved_provider = provider_id or DEFAULT_PROVIDER
        resolved_model = model_id or DEFAULT_MODEL

        from tools import read_file as _read_file

        context_addition = ""
        if context_files:
            file_contents = []
            for fp in context_files:
                try:
                    content = _read_file(fp)
                    file_contents.append(f"--- {fp} ---\n{content}\n")
                except Exception:
                    pass
            if file_contents:
                context_addition = "\n\nContext files:\n" + "\n".join(file_contents)

        messages.append({"role": "user", "content": message + context_addition})
        yield {"type": "meta", "conversation_id": conv_id}

        all_tool_results: list[ToolCallRecord] = []
        full_reply = ""

        current_messages = list(messages)

        for iteration in range(MAX_TOOL_ITERATIONS):
            reply_tokens: list[str] = []
            tool_calls_raw: list[dict] = []

            try:
                async for event in self._call_llm_stream(
                    current_messages, resolved_provider, resolved_model, TOOL_DEFINITIONS
                ):
                    if event["type"] == "token":
                        reply_tokens.append(event["content"])
                        yield {"type": "token", "content": event["content"]}
                    elif event["type"] == "tool_calls":
                        tool_calls_raw = event["tool_calls"]
            except ConfigError as e:
                yield {"type": "error", "error": str(e)}
                return
            except LLMError as e:
                yield {"type": "error", "error": str(e)}
                return

            reply_text = "".join(reply_tokens)
            full_reply = reply_text

            if not tool_calls_raw:
                break

            # 执行工具调用
            tool_call_msgs = []
            for tc in tool_calls_raw:
                name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    args = {}
                result = await call_tool(name, args)
                record = ToolCallRecord(name=name, args=args, result=result)
                all_tool_results.append(record)

                yield {
                    "type": "tool_call",
                    "tool_call": {
                        "tool": name,
                        "args": args,
                        "result": {
                            "success": result["success"],
                            "result": result.get("result"),
                            "error": result.get("error"),
                        },
                    },
                }

                tool_call_msgs.append({
                    "id": tc.get("id", ""),
                    "type": "function",
                    "function": {"name": name, "arguments": tc["function"]["arguments"]},
                })

            current_messages.append({
                "role": "assistant",
                "content": reply_text,
                "tool_calls": tool_call_msgs,
            })

            for tc_raw, record in zip(tool_calls_raw, all_tool_results[-len(tool_calls_raw):]):
                result_str = json.dumps(record.result, ensure_ascii=False)
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tc_raw.get("id", ""),
                    "content": result_str,
                })

        # 更新主消息列表
        self._active_conversations[conv_id] = current_messages

        if len(current_messages) > CONVERSATION_MAX_MESSAGES:
            self._active_conversations[conv_id] = [current_messages[0]] + current_messages[-20:]

        code_blocks = self._extract_code_blocks(full_reply)
        title = self._extract_title(current_messages)
        self._persist(conv_id, title)

        yield {
            "type": "done",
            "reply": full_reply,
            "conversation_id": conv_id,
            "tool_calls": [
                {
                    "tool": r.name,
                    "args": r.args,
                    "result": {"success": r.result["success"], "result": r.result.get("result"), "error": r.result.get("error")},
                }
                for r in all_tool_results
            ] if all_tool_results else None,
            "code_blocks": code_blocks if code_blocks else None,
        }

    # ---- 辅助方法 --------------------------------------------------------

    @staticmethod
    def _extract_code_blocks(text: str) -> list[dict]:
        blocks = []
        for match in CODE_BLOCK_PATTERN.finditer(text):
            lang = match.group(1) or "text"
            if lang == "tool":
                continue
            blocks.append({"language": lang, "code": match.group(2)})
        return blocks

    @staticmethod
    def _extract_title(messages: list[dict]) -> str:
        """取第一条用户消息的前 60 个字符作为会话标题。"""
        for m in messages:
            if m["role"] == "user":
                content = m["content"]
                # 去掉上下文文件前缀
                idx = content.find("\n\nContext files:")
                if idx > 0:
                    content = content[:idx]
                return content[:60]
        return ""


# 全局单例
engine = AgentEngine()