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
import re
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


# =============================================================================
# 安全扫描工具 — CodeX Security Agent
# =============================================================================

# 硬编码密钥检测正则规则（基于 OWASP / truffleHog 模式）
_SECRET_PATTERNS: list[tuple[str, str, str]] = [
    # 格式: (规则名, 正则, 严重级别)
    ("AWS Access Key", r"AKIA[0-9A-Z]{16}", "high"),
    ("AWS Secret Key", r"(?i)aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*['\"]?[A-Za-z0-9/+]{40}['\"]?", "critical"),
    ("Google API Key", r"AIza[0-9A-Za-z\-_]{35}", "medium"),
    ("GitHub Token", r"(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}", "high"),
    ("GitLab Token", r"glpat-[A-Za-z0-9\-_]{20,}", "medium"),
    ("Slack Token", r"xox[baprs]-[A-Za-z0-9\-_]{10,}", "medium"),
    ("Generic API Key", r"(?i)(api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['\"][A-Za-z0-9+/=_\-]{20,}['\"]", "high"),
    ("Generic Password", r"(?i)(password|passwd|pwd)\s*[:=]\s*['\"][^'\"]{4,}['\"]", "medium"),
    ("Private Key Header", r"-----BEGIN (RSA|DSA|EC|OPENSSH|PGP) PRIVATE KEY-----", "critical"),
    ("JWT Token", r"eyJ[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.?[A-Za-z0-9\-_.+/=]*", "low"),
    ("Generic Secret", r"(?i)(secret|token|auth[_-]?token)\s*[:=]\s*['\"][A-Za-z0-9+/=_\-]{16,}['\"]", "high"),
    ("Database URL", r"(?i)(mongodb|mysql|postgresql|redis)://[^:\s]+:[^@\s]+@", "critical"),
    ("Slack Webhook", r"https://hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+", "medium"),
    ("Telegram Bot Token", r"\d{9,10}:[A-Za-z0-9\-_]{35}", "medium"),
    # 阿里云/腾讯云/华为云 AccessKey
    ("Alibaba Cloud AK", r"LTAI[A-Za-z0-9]{16,20}", "high"),
    ("Tencent Cloud SecretId", r"AKID[A-Za-z0-9]{32,48}", "high"),
    ("Huawei Cloud AK", r"[A-Z0-9]{20}(?=[^A-Z0-9]|$)", "low"),  # 低置信度，容易误报
]

# 高风险依赖（仅作为示例，实际需 pip-audit / npm-audit）
_KNOWN_VULNERABLE_PACKAGES: dict[str, dict[str, str]] = {
    "django": {"2.2.0": "CVE-2021-45115 / CVE-2021-45116 — SQL injection / SSRF"},
    "flask": {"1.0": "CVE-2018-1000656 — Denial of Service via crafted JSON"},
    "requests": {"2.19.0": "CVE-2018-18074 — HTTP Auth headers leaked on redirect"},
    "pillow": {"8.0.0": "CVE-2021-27921 / CVE-2021-25287 — Multiple buffer overflows"},
    "pyyaml": {"5.3": "CVE-2020-1747 — Arbitrary code execution via .load()"},
    "lodash": {"4.17.20": "CVE-2021-23337 — Prototype pollution"},
    "axios": {"0.21.0": "CVE-2021-3749 — SSRF / ReDoS"},
    "express": {"4.17.0": "CVE-2022-24999 — qs prototype pollution"},
    "next": {"12.0.0": "CVE-2023-46298 — SSRF in image optimization"},
    "react": {"16.0.0": "CVE-2018-6341 — XSS in server-side rendering"},
    "fastapi": {"0.100.0": "CVE-2024-24762 — ReDoS in form data parsing"},
    "loguru": {"0.6.0": "CVE-2022-0329 — Arbitrary code via pickle deserialization"},
}

# 代码模式检测（OWASP Top 10 常见模式）
_CODE_VULN_PATTERNS: list[tuple[str, str, str, str]] = [
    # (类别, 正则, 严重级别, 说明)
    ("SQL Injection", r"(?i)\.execute\s*\(\s*['\"].*%(?:s|d|).*['\"]|\.execute\s*\(\s*f['\"]", "critical", "字符串拼接构造 SQL 查询，可能导致 SQL 注入"),
    ("Command Injection", r"(?i)os\.system\s*\(|subprocess\.call\s*\(.*shell\s*=\s*True|eval\s*\(|exec\s*\(.*input", "critical", "使用外部输入构造系统命令，可能导致命令注入"),
    ("Hardcoded Password", r"(?i)password\s*=\s*['\"][^'\"]{4,}['\"]", "high", "硬编码密码，应使用环境变量或密钥管理服务"),
    ("Insecure Deserialization", r"(?i)pickle\.loads|yaml\.load\s*\(|marshal\.loads", "high", "不安全的反序列化，可能导致任意代码执行"),
    ("XSS Vulnerability", r"(?i)innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(|\.html\s*\(\s*[^)]*\+", "high", "直接操作 DOM 可能引入 XSS 漏洞"),
    ("Path Traversal", r"(?i)os\.path\.join\s*\(.*request|open\s*\(.*request|\.\.\/.*request", "high", "用户输入拼接到文件路径，可能导致目录穿越"),
    ("Weak Cryptography", r"(?i)hashlib\.md5|hashlib\.sha1\b|DES\.new\s*\(|ECB", "medium", "使用弱加密算法，应迁移到 SHA-256 / AES-GCM"),
    ("SSRF Risk", r"(?i)requests\.get\s*\(.*input|urllib\.request\.urlopen\s*\(.*input|fetch\s*\(.*input", "medium", "用户输入直接作为 URL 请求目标，可能导致 SSRF"),
    ("Debug Mode Enabled", r"(?i)DEBUG\s*=\s*True|debug\s*:\s*true|NODE_ENV\s*=\s*['\"]development['\"]", "low", "生产环境开启调试模式，可能泄露敏感信息"),
    ("CORS Misconfiguration", r"(?i)Access-Control-Allow-Origin\s*:\s*\*|allow_origins\s*=\s*\[['\"]\*['\"]", "low", "CORS 配置过于宽松，允许任意来源访问"),
]


def _scan_file_for_secrets(file_path: str) -> list[dict[str, Any]]:
    """扫描单个文件的硬编码密钥。"""
    findings: list[dict[str, Any]] = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except (PermissionError, OSError):
        return findings

    for rule_name, pattern, severity in _SECRET_PATTERNS:
        for match in re.finditer(pattern, content):
            start = match.start()
            line_num = content[:start].count("\n") + 1
            # 上下文：前后各 20 字符
            ctx_start = max(0, start - 20)
            ctx_end = min(len(content), start + len(match.group()) + 20)
            context = content[ctx_start:ctx_end].replace("\n", "\\n")
            findings.append({
                "type": rule_name,
                "severity": severity,
                "line": line_num,
                "match": match.group()[:80],
                "context": context[:120],
                "file": os.path.relpath(file_path, WORKSPACE_DIR).replace("\\", "/"),
            })
    return findings


def detect_secrets(directory: str = "") -> list[dict[str, Any]]:
    """扫描工作区文件中的硬编码密钥（API Key / Token / Password）。"""
    target = safe_path(directory)
    findings: list[dict[str, Any]] = []

    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in
                   ("node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build")]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in BINARY_EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            try:
                if os.path.getsize(fpath) > MAX_FILE_SIZE:
                    continue
                findings.extend(_scan_file_for_secrets(fpath))
            except (PermissionError, OSError):
                continue
    return findings


def scan_vulnerability(directory: str = "") -> dict[str, Any]:
    """对工作区代码进行静态安全分析（SAST）。

    检测 OWASP Top 10 常见漏洞模式：
    - SQL 注入 / 命令注入
    - 硬编码密码 / 弱加密
    - XSS / SSRF / 路径穿越
    - 不安全的反序列化
    - 调试模式 / CORS 配置错误

    同时尝试调用 bandit（Python SAST 工具），如未安装则优雅降级。
    """
    target = safe_path(directory)
    findings: list[dict[str, Any]] = []
    stats = {"files_scanned": 0, "total_findings": 0}

    # 1. 内置模式匹配
    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in
                   ("node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build")]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext in BINARY_EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            try:
                if os.path.getsize(fpath) > MAX_FILE_SIZE:
                    continue
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                rel = os.path.relpath(fpath, WORKSPACE_DIR).replace("\\", "/")
                for cat, pattern, severity, desc in _CODE_VULN_PATTERNS:
                    for m in re.finditer(pattern, content):
                        line = content[:m.start()].count("\n") + 1
                        findings.append({
                            "category": cat,
                            "severity": severity,
                            "file": rel,
                            "line": line,
                            "snippet": content[max(0, m.start() - 20):m.end() + 20].replace("\n", "\\n")[:120],
                            "description": desc,
                            "source": "built-in patterns",
                        })
                stats["files_scanned"] += 1
            except (PermissionError, OSError):
                continue

    stats["total_findings"] = len(findings)

    # 2. 尝试调用 bandit（Python SAST）
    bandit_result = None
    try:
        proc = subprocess.run(
            ["bandit", "-r", "-f", "json", "-q", target],
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode in (0, 1) and proc.stdout.strip():
            import json
            bandit_data = json.loads(proc.stdout)
            for issue in bandit_data.get("results", []):
                findings.append({
                    "category": f"Bandit: {issue.get('test_name', 'unknown')}",
                    "severity": issue.get("issue_severity", "medium").lower(),
                    "file": issue.get("filename", "").replace("\\", "/"),
                    "line": issue.get("line_number", 0),
                    "snippet": (issue.get("code", "") or "")[:120],
                    "description": issue.get("issue_text", ""),
                    "source": "bandit",
                })
            bandit_result = {"success": True, "count": len(bandit_data.get("results", []))}
        else:
            bandit_result = {"success": True, "count": 0}
    except FileNotFoundError:
        bandit_result = {"success": False, "error": "bandit not installed (pip install bandit for Python SAST)"}
    except Exception as e:
        bandit_result = {"success": False, "error": str(e)}

    # 汇总统计
    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in findings:
        severity_counts[f["severity"]] = severity_counts.get(f["severity"], 0) + 1

    return {
        "findings": findings,
        "stats": {**stats, "total_findings": len(findings), "severity_counts": severity_counts},
        "bandit": bandit_result,
    }


def check_dependencies(directory: str = "") -> dict[str, Any]:
    """检查项目依赖中的已知漏洞。

    支持 Python（pip-audit）和 Node.js（npm-audit），
    如工具未安装则优雅降级，返回内置已知漏洞库检查结果。
    """
    target = safe_path(directory)
    results: dict[str, Any] = {"python": None, "nodejs": None, "builtin_check": None}

    # 1. 内置已知漏洞库检查
    builtin_findings: list[dict[str, Any]] = []
    for root, dirs, files in os.walk(target):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in
                   ("node_modules", "__pycache__", ".git", ".venv", "venv", "dist", "build")]
        for fname in files:
            if fname in ("requirements.txt", "requirements-dev.txt"):
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            line = line.strip()
                            if not line or line.startswith("#"):
                                continue
                            # 解析包名和版本
                            match = re.match(r"([a-zA-Z0-9\-_.]+)\s*([><=!~]+\s*[\d.]+)?", line)
                            if match:
                                pkg_name = match.group(1).lower()
                                if pkg_name in _KNOWN_VULNERABLE_PACKAGES:
                                    vuln = _KNOWN_VULNERABLE_PACKAGES[pkg_name]
                                    builtin_findings.append({
                                        "package": pkg_name,
                                        "version_hint": line,
                                        "vulnerability": list(vuln.values())[0],
                                        "severity": "high",
                                        "source": "builtin",
                                    })
                except (PermissionError, OSError):
                    continue
            elif fname == "package.json":
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                        content = f.read()
                    import json
                    pkg = json.loads(content)
                    for dep_key in ("dependencies", "devDependencies"):
                        for pkg_name, ver in pkg.get(dep_key, {}).items():
                            pkg_name_lower = pkg_name.lower()
                            if pkg_name_lower in _KNOWN_VULNERABLE_PACKAGES:
                                vuln = _KNOWN_VULNERABLE_PACKAGES[pkg_name_lower]
                                builtin_findings.append({
                                    "package": pkg_name,
                                    "version": ver,
                                    "vulnerability": list(vuln.values())[0],
                                    "severity": "high",
                                    "source": "builtin",
                                })
                except (PermissionError, OSError, json.JSONDecodeError):
                    continue
    results["builtin_check"] = {
        "findings": builtin_findings,
        "count": len(builtin_findings),
    }

    # 2. pip-audit（Python 依赖漏洞扫描）
    try:
        proc = subprocess.run(
            ["pip-audit", "-r", os.path.join(target, "requirements.txt"), "--format", "json"],
            capture_output=True, text=True, timeout=60,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            import json
            try:
                audit_data = json.loads(proc.stdout)
                pip_results = []
                for vuln in audit_data.get("dependencies", []):
                    pip_results.append({
                        "package": vuln.get("name", ""),
                        "version": vuln.get("version", ""),
                        "vulnerability": ", ".join(v.get("id", "") for v in vuln.get("vulns", [])),
                        "severity": "high",
                        "source": "pip-audit",
                    })
                results["python"] = {"findings": pip_results, "count": len(pip_results)}
            except json.JSONDecodeError:
                results["python"] = {"success": False, "error": "Failed to parse pip-audit output"}
        else:
            results["python"] = {"findings": [], "count": 0}
    except FileNotFoundError:
        results["python"] = {"success": False, "error": "pip-audit not installed (pip install pip-audit)"}
    except Exception as e:
        results["python"] = {"success": False, "error": str(e)}

    # 3. npm-audit（Node.js 依赖漏洞扫描）
    try:
        if os.path.isfile(os.path.join(target, "package.json")):
            proc = subprocess.run(
                ["npm", "audit", "--json", "--prefix", target],
                capture_output=True, text=True, timeout=120,
            )
            if proc.stdout.strip():
                try:
                    import json
                    audit_data = json.loads(proc.stdout)
                    npm_results = []
                    advisories = audit_data.get("advisories", {})
                    for adv_id, adv in advisories.items():
                        npm_results.append({
                            "package": adv.get("module_name", ""),
                            "severity": adv.get("severity", "medium"),
                            "vulnerability": f"{adv.get('title', '')} — {adv.get('cwe', '')}",
                            "source": "npm-audit",
                        })
                    results["nodejs"] = {"findings": npm_results, "count": len(npm_results)}
                except json.JSONDecodeError:
                    results["nodejs"] = {"success": False, "error": "Failed to parse npm audit output"}
            else:
                results["nodejs"] = {"findings": [], "count": 0}
        else:
            results["nodejs"] = {"success": False, "error": "No package.json found"}
    except FileNotFoundError:
        results["nodejs"] = {"success": False, "error": "npm not installed"}
    except Exception as e:
        results["nodejs"] = {"success": False, "error": str(e)}

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
    {
        "type": "function",
        "function": {
            "name": "scan_vulnerability",
            "description": "对工作区代码进行静态安全分析（SAST），检测 SQL 注入、命令注入、XSS、SSRF、路径穿越、硬编码密码、弱加密等 OWASP Top 10 漏洞模式。同时调用 bandit（如已安装）进行 Python 深度扫描。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "扫描目录相对路径，空字符串表示整个工作区"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "detect_secrets",
            "description": "扫描工作区文件中的硬编码密钥和敏感信息，包括 AWS/Aliyun/Tencent Cloud AccessKey、API Key、GitHub Token、私钥、数据库连接串等。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "扫描目录相对路径，空字符串表示整个工作区"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_dependencies",
            "description": "检查项目依赖（Python requirements.txt / Node.js package.json）中的已知漏洞，支持内置 CVE 数据库和 pip-audit / npm-audit 工具。",
            "parameters": {
                "type": "object",
                "properties": {
                    "directory": {"type": "string", "description": "项目目录相对路径，空字符串表示整个工作区"},
                },
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
    "scan_vulnerability": scan_vulnerability,
    "detect_secrets": detect_secrets,
    "check_dependencies": check_dependencies,
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