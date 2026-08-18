"""配置管理。

从环境变量与 JSON 文件加载模型提供商配置，支持用户自定义提供商。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("CodeX.Config")

PORT = int(os.getenv("PORT", "8000"))
WORKSPACE_DIR = os.path.abspath(
    os.getenv("WORKSPACE_DIR", os.path.join(os.path.dirname(__file__), "..", "workspace"))
)
DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "deepseek")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "deepseek-chat")

# 兼容早期命名
DEFAULT_PROVIDER_ID = DEFAULT_PROVIDER
DEFAULT_MODEL_ID = DEFAULT_MODEL

_BASE_DIR = Path(__file__).parent
PROVIDERS_FILE = _BASE_DIR / "providers.json"
USER_PROVIDERS_FILE = _BASE_DIR / "providers.user.json"

os.makedirs(WORKSPACE_DIR, exist_ok=True)


def _safe_load_json(filepath: Path) -> list[dict]:
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, list):
                logger.warning(f"Invalid JSON structure in {filepath}, expected list")
                return []
            return data
    except FileNotFoundError:
        return []
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse {filepath}: {e}")
        return []


def _safe_save_json(filepath: Path, data: object) -> None:
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_providers() -> list[dict]:
    """合并默认提供商与用户自定义提供商（用户配置优先）。"""
    providers = _safe_load_json(PROVIDERS_FILE)
    user_providers = _safe_load_json(USER_PROVIDERS_FILE)
    existing_ids = {p["id"] for p in providers}
    for up in user_providers:
        idx = next((i for i, p in enumerate(providers) if p["id"] == up["id"]), None)
        if idx is not None:
            providers[idx] = up
        else:
            providers.append(up)
    return providers


def save_user_provider(provider: dict) -> None:
    user_providers = _safe_load_json(USER_PROVIDERS_FILE)
    idx = next((i for i, p in enumerate(user_providers) if p["id"] == provider["id"]), None)
    if idx is not None:
        user_providers[idx] = provider
    else:
        user_providers.append(provider)
    _safe_save_json(USER_PROVIDERS_FILE, user_providers)


def delete_user_provider(provider_id: str) -> None:
    user_providers = _safe_load_json(USER_PROVIDERS_FILE)
    user_providers = [p for p in user_providers if p["id"] != provider_id]
    _safe_save_json(USER_PROVIDERS_FILE, user_providers)


def get_provider_api_key(provider: dict) -> str:
    """优先从环境变量读取 API Key，其次使用配置内的 api_key。"""
    env_var = provider.get("api_key_env", "")
    if env_var:
        key = os.getenv(env_var, "")
        if key:
            return key
    return provider.get("api_key", "")