"""pytest 配置。"""

from __future__ import annotations

import os
import sys
import tempfile

# 将 backend 目录加入 sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# 设置临时工作区
_temp_workspace = tempfile.mkdtemp(prefix="codex_test_")
os.environ["WORKSPACE_DIR"] = _temp_workspace
os.environ["DEFAULT_PROVIDER"] = "deepseek"
os.environ["DEFAULT_MODEL"] = "deepseek-chat"
os.environ["DEEPSEEK_API_KEY"] = "test-key"