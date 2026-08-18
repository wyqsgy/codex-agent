"""工具层测试：safe_path、文件操作、搜索、代码执行。"""

from __future__ import annotations

import asyncio
import os
import tempfile

import pytest

from tools import call_tool, delete_file, list_files, read_file, safe_path, search_files, write_file


def _run(coro):
    return asyncio.run(coro)


class TestSafePath:
    def test_workspace_root(self):
        ws = os.environ["WORKSPACE_DIR"]
        assert os.path.abspath(safe_path("")) == os.path.abspath(ws)
        assert os.path.abspath(safe_path("/")) == os.path.abspath(ws)

    def test_subdirectory(self):
        result = safe_path("hello/world")
        assert result.endswith("hello" + os.sep + "world")

    def test_path_traversal_blocked(self):
        with pytest.raises(ValueError, match="traversal"):
            safe_path("../../../etc/passwd")


class TestFileOperations:
    def test_write_and_read(self):
        write_file("test.txt", "hello world")
        content = read_file("test.txt")
        assert content == "hello world"

    def test_read_binary_blocked(self):
        write_file("test.txt", "hello")
        # 重命名为 .exe 以触发二进制检测
        target = safe_path("test.txt")
        binary_target = os.path.join(os.path.dirname(target), "test.exe")
        os.rename(target, binary_target)
        with pytest.raises(ValueError, match="binary"):
            read_file("test.exe")

    def test_read_nonexistent(self):
        with pytest.raises(FileNotFoundError):
            read_file("nonexistent.txt")

    def test_write_empty_path(self):
        with pytest.raises(ValueError, match="empty"):
            write_file("", "content")

    def test_delete_file(self):
        write_file("to_delete.txt", "bye")
        delete_file("to_delete.txt")
        with pytest.raises(FileNotFoundError):
            read_file("to_delete.txt")

    def test_delete_directory(self):
        write_file("subdir/test.txt", "nested")
        delete_file("subdir")
        with pytest.raises(FileNotFoundError):
            read_file("subdir/test.txt")

    def test_list_files(self):
        write_file("a.txt", "a")
        write_file("b.py", "b")
        files = list_files()
        names = [f["name"] for f in files]
        assert "a.txt" in names
        assert "b.py" in names


class TestSearchFiles:
    def test_search_basic(self):
        write_file("search_test.py", "def hello():\n    return 'hello world'\n")
        results = search_files("hello world", "")
        assert len(results) > 0
        assert any(r["path"] == "search_test.py" for r in results)

    def test_search_empty_query(self):
        assert search_files("", "") == []


class TestCallTool:
    def test_unknown_tool(self):
        result = _run(call_tool("nonexistent_tool", {}))
        assert result["success"] is False
        assert "Unknown" in result["error"]

    def test_list_files_tool(self):
        write_file("tool_test.txt", "data")
        result = _run(call_tool("list_files", {"directory": ""}))
        assert result["success"] is True
        names = [f["name"] for f in result["result"]]
        assert "tool_test.txt" in names

    def test_read_file_tool(self):
        write_file("tool_read.txt", "readme")
        result = _run(call_tool("read_file", {"path": "tool_read.txt"}))
        assert result["success"] is True
        assert result["result"] == "readme"

    def test_write_file_tool(self):
        result = _run(call_tool("write_file", {"path": "tool_write.txt", "content": "written"}))
        assert result["success"] is True
        assert read_file("tool_write.txt") == "written"

    def test_delete_file_tool(self):
        write_file("tool_del.txt", "del")
        result = _run(call_tool("delete_file", {"path": "tool_del.txt"}))
        assert result["success"] is True

    def test_execute_code_tool(self):
        result = _run(call_tool("execute_code", {"code": "print('hello')", "language": "python"}))
        assert result["success"] is True
        assert "hello" in result["result"]["stdout"]

    def test_execute_code_unsupported_lang(self):
        result = _run(call_tool("execute_code", {"code": "x", "language": "ruby"}))
        assert result["success"] is True
        assert result["result"]["success"] is False
        assert "Unsupported" in result["result"]["output"]

    def test_execute_code_empty(self):
        result = _run(call_tool("execute_code", {"code": "", "language": "python"}))
        assert result["success"] is True
        assert result["result"]["success"] is False

    def test_execute_code_timeout(self):
        result = _run(call_tool("execute_code", {
            "code": "import time; time.sleep(60)",
            "language": "python",
            "timeout": 5,
        }))
        assert result["success"] is True
        assert result["result"]["success"] is False
        assert "timed out" in result["result"]["output"].lower()

    def test_execute_code_javascript(self):
        result = _run(call_tool("execute_code", {
            "code": "console.log('hello js')",
            "language": "javascript",
        }))
        assert result["success"] is True
        assert "hello js" in result["result"]["stdout"]

    def test_missing_required_args(self):
        result = _run(call_tool("read_file", {}))
        assert result["success"] is False

    def test_search_files_tool(self):
        write_file("search_me.py", "def test_func():\n    pass")
        result = _run(call_tool("search_files", {"query": "test_func", "directory": ""}))
        assert result["success"] is True
        assert any(r["path"] == "search_me.py" for r in result["result"])


class TestPathTraversalEdgeCases:
    def test_double_dot_traversal(self):
        with pytest.raises(ValueError, match="traversal"):
            safe_path("../..")

    def test_absolute_path_blocked(self):
        with pytest.raises(ValueError, match="traversal"):
            safe_path("C:\\Windows\\System32")

    def test_multiple_level_traversal(self):
        with pytest.raises(ValueError, match="traversal"):
            safe_path("../../../etc/passwd")

    def test_traversal_with_normal_path(self):
        with pytest.raises(ValueError, match="traversal"):
            safe_path("foo/../../../etc/shadow")


class TestLargeFileHandling:
    def test_write_overwrite(self):
        write_file("overwrite.txt", "v1")
        write_file("overwrite.txt", "v2")
        assert read_file("overwrite.txt") == "v2"

    def test_list_files_empty_dir(self):
        result = list_files("nonexistent_dir")
        assert result == []

    def test_read_file_with_unicode(self):
        write_file("unicode.txt", "你好世界 🌍")
        assert read_file("unicode.txt") == "你好世界 🌍"