"""Agent 引擎测试（不依赖真实 LLM）。"""

from __future__ import annotations

import pytest

from agent import AgentEngine, CODE_BLOCK_PATTERN, _init_db, _get_db


class TestAgentEngine:
    def setup_method(self):
        self.engine = AgentEngine()

    def test_engine_initialized(self):
        assert self.engine is not None
        # 数据库应已初始化
        _init_db()
        with _get_db() as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
            ).fetchall()
        assert len(tables) == 1

    def test_list_conversations_empty(self):
        convs = self.engine.list_conversations()
        assert isinstance(convs, list)

    def test_delete_nonexistent_conversation(self):
        # 不应抛出异常
        self.engine.delete_conversation("nonexistent_id")

    def test_extract_code_blocks(self):
        text = '''Here is some code:
```python
print("hello")
```
And another:
```javascript
console.log("hi");
```'''
        blocks = self.engine._extract_code_blocks(text)
        assert len(blocks) == 2
        assert blocks[0] == {"language": "python", "code": 'print("hello")'}
        assert blocks[1] == {"language": "javascript", "code": 'console.log("hi");'}

    def test_extract_code_blocks_skips_tool(self):
        text = """```tool
{"tool": "read_file", "args": {"path": "test.txt"}}
```"""
        blocks = self.engine._extract_code_blocks(text)
        assert len(blocks) == 0

    def test_extract_title(self):
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "帮我写一个快速排序算法，要求时间复杂度 O(n log n)"},
        ]
        title = self.engine._extract_title(messages)
        assert "快速排序" in title

    def test_extract_title_strips_context(self):
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "帮我写代码\n\nContext files:\n--- test.py ---\nprint(1)"},
        ]
        title = self.engine._extract_title(messages)
        assert "Context files" not in title
        assert title == "帮我写代码"

    def test_resolve_model_default(self):
        provider, model = self.engine._resolve_model("nonexistent", "")
        # 应该回退到默认值
        assert provider is not None
        assert model is not None