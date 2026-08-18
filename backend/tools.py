"""工作区文件与代码执行工具。

提供 Agent 可调用的底层能力：
- 安全路径解析（防目录穿越）
- 文件读写删除、目录列举、代码搜索
- 沙箱化代码执行（Python / JavaScript / TypeScript）

所有文件操作都限制在 WORKSPACE_DIR 内，防止任意路径访问。
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from config import WORKSPACE_DIR

# 单文件读取上限（字节）
MAX_FILE_SIZE = 5 * 1024 * 1024
# 搜索最多扫描的文件数 / 最多返回结果数
MAX_SEARCH_FILES = 200
MAX_SEARCH_RESULTS = 50
MAX_SEARCH_LINE_LENGTH = 500

# 二进制文件扩展名，读写时跳过，避免乱码
BINARY_EXTENSIONS = {
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat", ".pyc", ".pyo",
    ".zip", ".tar", ".gz", ".7z", ".rar", ".jpg", ".jpeg", ".png",
    ".gif", ".bmp", ".ico", ".mp3", ".mp4", ".avi", ".mov", ".pdf",
}

ALLOWED_EXEC_LANGUAGES: dict[str, list[str]] = {
    "python": ["python", "-u"],
    "javascript": ["node"],
    "typescript": ["npx", "ts-node"],
}
EXEC_TIMEOUT_MAX = 120
EXEC_OUTPUT_MAX = 50000


def safe_path(path: str) -> str:
    """将用户提供的相对路径解析到工作区内，阻止目录穿越攻击。"""
    if not path or path == "/":
        return os.path.abspath(WORKSPACE_DIR)

    resolved = os.path.normpath(os.path.join(WORKSPACE_DIR, path))
    abs_workspace = os.path.abspath(WORKSPACE_DIR)

    if not os.path.normcase(resolved).startswith(os.path.normcase(abs_workspace + os.sep)):
        if resolved != abs_workspace:
            raise ValueError(f"Path traversal blocked: {path}")
    return resolved


def list_files(directory: str = "") -> list[dict[str, Any]]:
    """列举目录内容（仅一层），返回名称、类型、大小等信息。"""
    target = safe_path(directory)
    if not os.path.isdir(target):
        return []

    try:
        entries = sorted(os.listdir(target))
    except PermissionError:
        return []

    result: list[dict[str, Any]] = []
    for entry in entries:
        full = os.path.join(target, entry)
        rel = os.path.relpath(full, WORKSPACE_DIR).replace("\\", "/")
        is_file = os.path.isfile(full)
        try:
            size = os.path.getsize(full) if is_file else 0
        except OSError:
            size = 0
        result.append({
            "name": entry,
            "path": rel,
            "is_dir": not is_file,
            "size": size,
            "ext": os.path.splitext(entry)[1].lower() if is_file else "",
        })
    return result


def read_file(path: str) -> str:
    """读取文本文件内容，拒绝二进制与大文件。"""
    target = safe_path(path)
    if not os.path.isfile(target):
        raise FileNotFoundError(f"File not found: {path}")

    ext = os.path.splitext(path)[1].lower()
    if ext in BINARY_EXTENSIONS:
        raise ValueError(f"Cannot read binary file: {path}")

    file_size = os.path.getsize(target)
    if file_size > MAX_FILE_SIZE:
        raise ValueError(f"File too large ({file_size} bytes). Max: {MAX_FILE_SIZE} bytes")

    with open(target, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def write_file(path: str, content: str) -> str:
    """写入文件（自动创建父目录），返回结果描述。"""
    if not path or not path.strip():
        raise ValueError("Path cannot be empty")
    target = safe_path(path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        f.write(content)
    return f"File written: {path}"


def delete_file(path: str) -> str:
    """删除文件或目录。"""
    target = safe_path(path)
    if os.path.isfile(target):
        os.remove(target)
        return f"File deleted: {path}"
    if os.path.isdir(target):
        shutil.rmtree(target)
        return f"Directory deleted: {path}"
    raise FileNotFoundError(f"Not found: {path}")


async def execute_code(code: str, language: str = "python", timeout: int = 30) -> dict[str, Any]:
    """异步执行代码片段，返回 stdout/stderr/return_code。

    使用 asyncio 子进程避免阻塞事件循环，并对执行时间与输出长度做限制。
    """
    if language not in ALLOWED_EXEC_LANGUAGES:
        supported = ", ".join(ALLOWED_EXEC_LANGUAGES)
        return {"success": False, "output": f"Unsupported language: {language}. Supported: {supported}"}

    if not code or not code.strip():
        return {"success": False, "output": "No code provided"}

    timeout = min(max(timeout, 5), EXEC_TIMEOUT_MAX)
    cmd = ALLOWED_EXEC_LANGUAGES[language]
    ext_map = {"python": ".py", "javascript": ".js", "typescript": ".ts"}
    ext = ext_map.get(language, ".txt")

    # 写入临时文件供解释器/运行时执行
    with tempfile.NamedTemporaryFile(mode="w", suffix=ext, delete=False, encoding="utf-8") as f:
        f.write(code)
        tmp_path = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=WORKSPACE_DIR,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {"success": False, "output": f"Execution timed out after {timeout}s", "return_code": -1}

        stdout = (stdout_b.decode("utf-8", errors="replace") or "")[:EXEC_OUTPUT_MAX]
        stderr = (stderr_b.decode("utf-8", errors="replace") or "")[:EXEC_OUTPUT_MAX]
        return {
            "success": proc.returncode == 0,
            "stdout": stdout,
            "stderr": stderr,
            "return_code": proc.returncode,
        }
    except FileNotFoundError:
        return {
            "success": False,
            "output": f"Runtime not found for {language}. Make sure it is installed.",
            "return_code": -1,
        }
    except Exception as e:
        return {"success": False, "output": str(e), "return_code": -1}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def search_files(query: str, directory: str = "") -> list[dict[str, Any]]:
    """在工作区内按关键字搜索文本文件（忽略大小写）。"""
    if not query or not query.strip():
        return []

    target = safe_path(directory)
    results: list[dict[str, Any]] = []
    files_scanned = 0

    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "__pycache__", ".git")]
        for fname in files:
            if files_scanned >= MAX_SEARCH_FILES:
                return results
            if os.path.splitext(fname)[1].lower() in BINARY_EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            files_scanned += 1
            try:
                if os.path.getsize(fpath) > MAX_FILE_SIZE:
                    continue
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    for i, line in enumerate(f, 1):
                        if query.lower() in line.lower():
                            rel = os.path.relpath(fpath, WORKSPACE_DIR).replace("\\", "/")
                            results.append({
                                "path": rel,
                                "line": i,
                                "content": line.strip()[:MAX_SEARCH_LINE_LENGTH],
                            })
                            if len(results) >= MAX_SEARCH_RESULTS:
                                return results
            except (PermissionError, OSError):
                continue
    return results


# ---------------------------------------------------------------------------
# 函数调用（Function Calling）——供 Agent 引擎使用的工具定义与分派
# ---------------------------------------------------------------------------

# 每个工具的 OpenAI Function Calling 参数 Schema
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "列举工作区目录下的文件与子目录（仅一层）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "目录相对路径，空字符串表示工作区根目录"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取工作区内文本文件的完整内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件相对路径"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "创建或覆盖写入工作区内的文本文件，父目录会自动创建。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件相对路径"},
                    "content": {"type": "string", "description": "要写入的完整文件内容"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_file",
            "description": "删除工作区内的文件或目录。",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "要删除的文件或目录相对路径"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_code",
            "description": "在沙箱中执行代码片段，返回 stdout/stderr 与退出码。支持 python/javascript/typescript。",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "要执行的完整代码"},
                    "language": {"type": "string", "enum": ["python", "javascript", "typescript"], "description": "代码语言，默认 python"},
                    "timeout": {"type": "integer", "description": "执行超时秒数（5-120），默认 30"},
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "在工作区内按关键字搜索文本内容，返回匹配的文件路径、行号与内容片段。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键字（忽略大小写）"},
                    "directory": {"type": "string", "description": "搜索目录相对路径，空字符串表示整个工作区"},
                },
                "required": ["query"],
            },
        },
    },
]

# 工具名 -> 实现函数的映射
_TOOL_EXECUTORS = {
    "list_files": list_files,
    "read_file": read_file,
    "write_file": write_file,
    "delete_file": delete_file,
    "execute_code": execute_code,
    "search_files": search_files,
}


async def call_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """执行指定工具并统一返回 {"success": bool, "result" | "error"}。

    同步工具直接调用，异步工具（如 execute_code）被 await，异常统一捕获。
    """
    executor = _TOOL_EXECUTORS.get(name)
    if executor is None:
        return {"success": False, "error": f"Unknown tool: {name}"}

    try:
        result = executor(**args)
        if asyncio.iscoroutine(result):
            result = await result
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}