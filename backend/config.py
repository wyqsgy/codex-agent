import os
import json
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("Wsygqy")

PORT = int(os.getenv("PORT", "8000"))
WORKSPACE_DIR = os.path.abspath(os.getenv("WORKSPACE_DIR", os.path.join(os.path.dirname(__file__), "..", "workspace")))
DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "deepseek")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "deepseek-chat")

PROVIDERS_FILE = os.path.join(os.path.dirname(__file__), "providers.json")
USER_PROVIDERS_FILE = os.path.join(os.path.dirname(__file__), "providers.user.json")

os.makedirs(WORKSPACE_DIR, exist_ok=True)


def _safe_load_json(filepath: str) -> list[dict]:
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


def _safe_save_json(filepath: str, data):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_providers() -> list[dict]:
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


def save_user_provider(provider: dict):
    user_providers = _safe_load_json(USER_PROVIDERS_FILE)
    idx = next((i for i, p in enumerate(user_providers) if p["id"] == provider["id"]), None)
    if idx is not None:
        user_providers[idx] = provider
    else:
        user_providers.append(provider)
    _safe_save_json(USER_PROVIDERS_FILE, user_providers)


def delete_user_provider(provider_id: str):
    user_providers = _safe_load_json(USER_PROVIDERS_FILE)
    user_providers = [p for p in user_providers if p["id"] != provider_id]
    _safe_save_json(USER_PROVIDERS_FILE, user_providers)


def get_provider_api_key(provider: dict) -> str:
    env_var = provider.get("api_key_env", "")
    if env_var:
        key = os.getenv(env_var, "")
        if key:
            return key
    return provider.get("api_key", "")


def resolve_api_key(provider_id: str, model_id: str = "") -> str:
    providers = load_providers()
    provider = next((p for p in providers if p["id"] == provider_id), None)
    if provider:
        return get_provider_api_key(provider)
    return ""