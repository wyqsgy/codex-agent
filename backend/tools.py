import os
import json
import subprocess
import tempfile
import platform
from typing import Optional
from config import WORKSPACE_DIR


def safe_path(path: str) -> str:
    if not path or path == "/":
        return os.path.abspath(WORKSPACE_DIR)
    resolved = os.path.normpath(os.path.join(WORKSPACE_DIR, path))
    abs_workspace = os.path.abspath(WORKSPACE_DIR)
    if not resolved.startswith(abs_workspace):
        raise ValueError(f"Path traversal detected: {path}")
    return resolved


def list_files(directory: str = "") -> list[dict]:
    target = safe_path(directory)
    if not os.path.isdir(target):
        return []
    result = []
    for entry in sorted(os.listdir(target)):
        full = os.path.join(target, entry)
        rel = os.path.relpath(full, WORKSPACE_DIR).replace("\\", "/")
        result.append({
            "name": entry,
            "path": rel,
            "is_dir": os.path.isdir(full),
            "size": os.path.getsize(full) if os.path.isfile(full) else 0,
        })
    return result


def read_file(path: str) -> str:
    target = safe_path(path)
    if not os.path.isfile(target):
        raise FileNotFoundError(f"File not found: {path}")
    with open(target, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def write_file(path: str, content: str) -> str:
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
        import shutil
        shutil.rmtree(target)
        return f"Directory deleted: {path}"
    raise FileNotFoundError(f"Not found: {path}")


def execute_code(code: str, language: str = "python", timeout: int = 30) -> dict:
    ext_map = {"python": ".py", "javascript": ".js", "typescript": ".ts"}
    cmd_map = {
        "python": ["python", "-u"],
        "javascript": ["node"],
        "typescript": ["npx", "ts-node"],
    }

    ext = ext_map.get(language, ".txt")
    cmd = cmd_map.get(language)
    if not cmd:
        return {"success": False, "output": f"Unsupported language: {language}"}

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
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout[:10000],
            "stderr": result.stderr[:10000],
            "return_code": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "output": f"Execution timed out after {timeout}s"}
    except Exception as e:
        return {"success": False, "output": str(e)}
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def search_files(query: str, directory: str = "") -> list[dict]:
    target = safe_path(directory)
    results = []
    for root, dirs, files in os.walk(target):
        for fname in files:
            fpath = os.path.join(root, fname)
            try:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    for i, line in enumerate(f, 1):
                        if query.lower() in line.lower():
                            rel = os.path.relpath(fpath, WORKSPACE_DIR).replace("\\", "/")
                            results.append({
                                "path": rel,
                                "line": i,
                                "content": line.strip()[:200],
                            })
                            if len(results) >= 50:
                                return results
            except Exception:
                continue
    return results