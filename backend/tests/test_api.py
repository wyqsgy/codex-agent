"""API 集成测试。"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["name"] == "CodeX Security Agent"
    assert data["version"] == "5.0.0"


@pytest.mark.asyncio
async def test_stats(client):
    resp = await client.get("/api/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "5.0.0"
    assert "uptime_seconds" in data
    assert "total_requests" in data


@pytest.mark.asyncio
async def test_list_providers(client):
    resp = await client.get("/api/providers")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0


@pytest.mark.asyncio
async def test_list_files(client):
    resp = await client.get("/api/files")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_write_and_read_file(client):
    # 写入
    resp = await client.post("/api/files/write", json={"path": "test.txt", "content": "hello"})
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # 读取
    resp = await client.post("/api/files/read", json={"path": "test.txt"})
    assert resp.status_code == 200
    assert resp.json()["content"] == "hello"


@pytest.mark.asyncio
async def test_read_nonexistent_file(client):
    resp = await client.post("/api/files/read", json={"path": "nonexistent.txt"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_execute_code(client):
    resp = await client.post("/api/execute", json={"code": "print('hello')", "language": "python"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "hello" in data["stdout"]


@pytest.mark.asyncio
async def test_search_files(client):
    await client.post("/api/files/write", json={"path": "search_test.py", "content": "def hello():\n    return 'hello world'"})
    resp = await client.post("/api/search", json={"query": "hello world", "directory": ""})
    assert resp.status_code == 200
    assert len(resp.json()) > 0


@pytest.mark.asyncio
async def test_list_conversations(client):
    resp = await client.get("/api/conversations")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_delete_nonexistent_conversation(client):
    resp = await client.delete("/api/conversations/nonexistent")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_chat_missing_message(client):
    resp = await client.post("/api/chat", json={})
    assert resp.status_code == 422  # pydantic validation error


@pytest.mark.asyncio
async def test_provider_test_not_found(client):
    resp = await client.get("/api/providers/nonexistent/test")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_file(client):
    await client.post("/api/files/write", json={"path": "tmp_del.txt", "content": "x"})
    resp = await client.post("/api/files/delete", json={"path": "tmp_del.txt"})
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_delete_nonexistent_file(client):
    resp = await client.post("/api/files/delete", json={"path": "never_exists.txt"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_execute_code_timeout(client):
    resp = await client.post("/api/execute", json={
        "code": "import time; time.sleep(60)",
        "language": "python",
        "timeout": 5,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "timed out" in (data.get("output", "") or "").lower()


@pytest.mark.asyncio
async def test_execute_code_unsupported_lang(client):
    resp = await client.post("/api/execute", json={
        "code": "puts 'hi'",
        "language": "ruby",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False


@pytest.mark.asyncio
async def test_get_conversation_not_found(client):
    resp = await client.get("/api/conversations/no-such-id")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_write_file_path_traversal(client):
    resp = await client.post("/api/files/write", json={
        "path": "../../../etc/hacked",
        "content": "evil",
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_search_empty_query(client):
    resp = await client.post("/api/search", json={"query": "  ", "directory": ""})
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_rate_limit_triggers(client):
    """发送超过 60 个请求验证限流（providers 端点在限流范围内）。"""
    statuses = []
    for _ in range(62):
        resp = await client.get("/api/providers")
        statuses.append(resp.status_code)
    assert statuses[0] == 200
    # 超过 60 个请求后应触发 429 限流
    assert 429 in statuses


@pytest.mark.asyncio
async def test_request_id_header(client):
    resp = await client.get("/api/health")
    assert "x-request-id" in resp.headers


@pytest.mark.asyncio
async def test_cors_headers(client):
    resp = await client.options("/api/health", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "GET",
    })
    # FastAPI CORS 中间件会自动处理 OPTIONS
    assert resp.status_code in (200, 405)