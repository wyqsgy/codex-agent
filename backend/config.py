import os
import json
from dotenv import load_dotenv

load_dotenv()

PORT = int(os.getenv("PORT", "8000"))
WORKSPACE_DIR = os.path.abspath(os.getenv("WORKSPACE_DIR", os.path.join(os.path.dirname(__file__), "..", "workspace")))
DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "deepseek")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "deepseek-chat")

PROVIDERS_FILE = os.path.join(os.path.dirname(__file__), "providers.json")
USER_PROVIDERS_FILE = os.path.join(os.path.dirname(__file__), "providers.user.json")

os.makedirs(WORKSPACE_DIR, exist_ok=True)


def load_providers() -> list[dict]:
    providers = []
    if os.path.exists(PROVIDERS_FILE):
        with open(PROVIDERS_FILE, "r", encoding="utf-8") as f:
            providers = json.load(f)
    if os.path.exists(USER_PROVIDERS_FILE):
        with open(USER_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            user_providers = json.load(f)
            existing_ids = {p["id"] for p in providers}
            for up in user_providers:
                idx = next((i for i, p in enumerate(providers) if p["id"] == up["id"]), None)
                if idx is not None:
                    providers[idx] = up
                else:
                    providers.append(up)
    return providers


def save_user_provider(provider: dict):
    user_providers = []
    if os.path.exists(USER_PROVIDERS_FILE):
        with open(USER_PROVIDERS_FILE, "r", encoding="utf-8") as f:
            user_providers = json.load(f)
    idx = next((i for i, p in enumerate(user_providers) if p["id"] == provider["id"]), None)
    if idx is not None:
        user_providers[idx] = provider
    else:
        user_providers.append(provider)
    with open(USER_PROVIDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(user_providers, f, ensure_ascii=False, indent=2)


def delete_user_provider(provider_id: str):
    if not os.path.exists(USER_PROVIDERS_FILE):
        return
    with open(USER_PROVIDERS_FILE, "r", encoding="utf-8") as f:
        user_providers = json.load(f)
    user_providers = [p for p in user_providers if p["id"] != provider_id]
    with open(USER_PROVIDERS_FILE, "w", encoding="utf-8") as f:
        json.dump(user_providers, f, ensure_ascii=False, indent=2)


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