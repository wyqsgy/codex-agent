import os
import json
import subprocess
import tempfile
import platform
import shutil
from typing import Optional
from config import WORKSPACE_DIR

MAX_FILE_SIZE = 5 * 1024 * 1024
MAX_SEARCH_FILES = 200
MAX_SEARCH_RESULTS = 50
MAX_SEARCH_LINE_LENGTH = 500
BINARY_EXTENSIONS = {'.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.pyc', '.pyo',
                     '.zip', '.tar', '.gz', '.7z', '.rar', '.jpg', '.jpeg', '.png',
                     '.gif', '.bmp', '.ico', '.mp3', '.mp4', '.avi', '.mov', '.pdf'}

ALLOWED_EXEC_LANGUAGES = {"python": ["python", "-u"],
                          "javascript": ["node"],
                          "typescript": ["npx", "ts-node"]}
EXEC_TIMEOUT_MAX = 120
EXEC_OUTPUT_MAX = 50000


def safe_path(path: str) -> str:
    if not path or path == "/":
        return os.path.abspath(WORKSPACE_DIR)
    resolved = os.path.normpath(os.path.join(WORKSPACE_DIR, path))
    abs_workspace = os.path.abspath(WORKSPACE_DIR)
    if not os.path.normcase(resolved).startswith(os.path.normcase(abs_workspace + os.sep)):
        if resolved != abs_workspace:
            raise ValueError(f"Path traversal blocked: {path}")
    return resolved


def list_files(directory: str = "") -> list[dict]:
    target = safe_path(directory)
    if not os.path.isdir(target):
        return []
    result = []
    try:
        entries = sorted(os.listdir(target))
    except PermissionError:
        return []
    for entry in entries:
        full = os.path.join(target, entry)
        rel = os.path.relpath(full, WORKSPACE_DIR).replace("\\", "/")
        try:
            size = os.path.getsize(full) if os.path.isfile(full) else 0
        except OSError:
            size = 0
        result.append({
            "name": entry,
            "path": rel,
            "is_dir": os.path.isdir(full),
            "size": size,
            "ext": os.path.splitext(entry)[1].lower() if os.path.isfile(full) else "",
        })
    return result


def read_file(path: str) -> str:
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
    if not path or path.strip() == "":
        raise ValueError("Path cannot be empty")
    target = safe_path(path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        f.write(content)
    return f"File written: {path}"


def delete_file(path: str) -> str:
    target = safe_path(path)
    if os.path.isfile(target):
        os.remove(target)
        return f"File deleted: {path}"
    elif os.path.isdir(target):
        shutil.rmtree(target)
        return f"Directory deleted: {path}"
    raise FileNotFoundError(f"Not found: {path}")


def execute_code(code: str, language: str = "python", timeout: int = 30) -> dict:
    if language not in ALLOWED_EXEC_LANGUAGES:
        return {"success": False, "output": f"Unsupported language: {language}. Supported: {', '.join(ALLOWED_EXEC_LANGUAGES.keys())}"}

    if not code or not code.strip():
        return {"success": False, "output": "No code provided"}

    timeout = min(max(timeout, 5), EXEC_TIMEOUT_MAX)
    cmd = ALLOWED_EXEC_LANGUAGES[language]

    ext_map = {"python": ".py", "javascript": ".js", "typescript": ".ts"}
    ext = ext_map.get(language, ".txt")

    with tempfile.NamedTemporaryFile(mode="w", suffix=ext, delete=False, encoding="utf-8") as f:
        f.write(code)
        tmp_path = f.name

    try:
        result = subprocess.run(
            cmd + [tmp_path],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=WORKSPACE_DIR,
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
        stdout = (result.stdout or "")[:EXEC_OUTPUT_MAX]
        stderr = (result.stderr or "")[:EXEC_OUTPUT_MAX]
        return {
            "success": result.returncode == 0,
            "stdout": stdout,
            "stderr": stderr,
            "return_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "output": f"Execution timed out after {timeout}s", "return_code": -1}
    except FileNotFoundError:
        return {"success": False, "output": f"Runtime not found for {language}. Make sure it is installed.", "return_code": -1}
    except Exception as e:
        return {"success": False, "output": str(e), "return_code": -1}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def search_files(query: str, directory: str = "") -> list[dict]:
    if not query or not query.strip():
        return []
    target = safe_path(directory)
    results = []
    files_scanned = 0
    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', '.git')]
        for fname in files:
            if files_scanned >= MAX_SEARCH_FILES:
                return results
            ext = os.path.splitext(fname)[1].lower()
            if ext in BINARY_EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            files_scanned += 1
            try:
                fsize = os.path.getsize(fpath)
                if fsize > MAX_FILE_SIZE:
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