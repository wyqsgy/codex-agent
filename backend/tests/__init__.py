"""tests 初始化。"""

from __future__ import annotations

import os
import sys
import tempfile

# 将 backend 目录加入 sys.path，确保可以 import agent, tools, config 等
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# 设置临时工作区目录，避免污染真实文件系统
_temp_workspace = tempfile.mkdtemp(prefix="codex_test_")
os.environ["WORKSPACE_DIR"] = _temp_workspace
os.environ["DEFAULT_PROVIDER"] = "deepseek"
os.environ["DEFAULT_MODEL"] = "deepseek-chat"