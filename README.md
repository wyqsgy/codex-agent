# CodeX Agent

<p align="center">
  <strong>全栈 AI 编程助手 — 基于 Function Calling 的自主 Agent，支持多模型、流式对话、代码沙箱执行与文件管理。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue?logo=python" alt="Python" />
  <img src="https://img.shields.io/badge/fastapi-0.115-green?logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/react-18-blue?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/typescript-5-blue?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/vite-5-purple?logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/sqlite-3-blue?logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/docker-2496ED?logo=docker" alt="Docker" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
  <a href="https://github.com/wyqsgy/codex-agent/actions"><img src="https://github.com/wyqsgy/codex-agent/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
</p>

---

## 项目概述

CodeX Agent 是一个从零构建的全栈 AI 编程助手，核心是一个 **Agent 引擎**：LLM 通过 **原生 Function Calling** 自主调用工具（读写文件、执行代码、搜索工作区）来完成任务，而非简单的对话补全。

该项目展示了完整的 **全栈工程能力**：从 Python 后端的 Agent 架构设计、SQLite 持久化、流式 SSE 传输，到 React/TypeScript 前端的 CodeMirror 代码编辑器、react-markdown 渲染、多会话管理，再到 Docker 容器化部署与 GitHub Actions CI/CD。

## 核心特性

- **Agent 工具调用循环** — LLM 通过 Function Calling 自主规划并执行多步工具调用，最大 8 轮迭代，指数退避重试
- **流式输出 (SSE)** — 实时 token 级流式响应 + 工具调用状态推送，支持中断取消
- **多模型支持** — 内置 10+ 提供商（DeepSeek、OpenAI、智谱 GLM、通义千问、Moonshot、百川等），支持自定义 OpenAI 兼容端点
- **代码编辑器** — 基于 CodeMirror 6，支持 8 种语言语法高亮、自动补全、括号匹配
- **沙箱代码执行** — asyncio 子进程安全执行 Python / JavaScript / TypeScript，带超时与输出限制
- **会话持久化** — SQLite 存储会话历史，支持多会话切换、恢复与删除
- **Markdown 渲染** — 基于 react-markdown + remark-gfm，支持表格、代码高亮、引用块
- **安全防护** — 路径穿越拦截、频率限制、CORS、密钥环境变量隔离、Docker 非 root 运行

## 技术架构

```
┌─────────────────────────────────────────────────────┐
│                    前端 (React + TypeScript + Vite)   │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐ │
│  │ ChatPanel│  │ CodeEditor │  │ ConversationList │ │
│  │ (Markdown│  │ (CodeMirror│  │  (Sidebar)       │ │
│  │  Render) │  │     6)     │  │                  │ │
│  └────┬─────┘  └─────┬──────┘  └────────┬─────────┘ │
│       │               │                  │           │
│       └───────────────┼──────────────────┘           │
│                       │ SSE / HTTP                    │
└───────────────────────┼──────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────┐
│                    后端 (FastAPI + Uvicorn)            │
│  ┌────────────────────┴───────────────────────────┐  │
│  │              Agent Engine                       │  │
│  │  ┌──────────────┐  ┌────────────────────────┐  │  │
│  │  │ Function     │  │  Tool Executor          │  │  │
│  │  │ Calling Loop │──│  (File/Execute/Search)  │  │  │
│  │  └──────────────┘  └────────────────────────┘  │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────┼───────────────────────────┐  │
│  │   Provider Manager │  SQLite Conversation Store │  │
│  │   (10+ LLM APIs)   │  (Persistent Sessions)    │  │
│  └────────────────────┴───────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## 快速开始

### 前置要求

- Python 3.11+
- Node.js 18+
- （可选）Docker & Docker Compose

### Docker 部署（推荐）

```bash
# 1. 配置 API Key
cp backend/.env.example backend/.env
# 编辑 backend/.env 填入你的 API Key

# 2. 启动
docker compose up --build
```

访问 `http://localhost:8000/docs` 查看 API 文档。

### 本地开发

```bash
# 后端
cd backend
pip install -r requirements.txt
cp .env.example .env  # 编辑填入 API Key
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 前端（新终端）
cd frontend
npm install
npm run dev
```

前端默认访问 `http://localhost:5173`，通过 Vite proxy 转发 `/api` 到后端。

## 项目结构

```
codex-agent/
├── backend/                    # FastAPI 后端
│   ├── main.py                 # 路由、中间件、WebSocket
│   ├── agent.py                # Agent 引擎（Function Calling 循环）
│   ├── tools.py                # 工具实现（文件/执行/搜索）
│   ├── config.py               # 配置与提供商管理
│   ├── models.py               # Pydantic 数据模型
│   ├── providers.json          # 内置模型提供商
│   ├── requirements.txt        # Python 依赖
│   ├── requirements-dev.txt    # 开发依赖（pytest 等）
│   └── tests/                  # 单元测试 & 集成测试
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── App.tsx             # 主应用（布局/状态管理）
│   │   ├── api.ts              # API 客户端 + SSE 流式处理
│   │   ├── types.ts            # TypeScript 类型定义
│   │   └── components/
│   │       ├── ChatPanel.tsx         # 聊天面板（react-markdown）
│   │       ├── ConversationSidebar.tsx  # 会话历史侧边栏
│   │       ├── CodeEditor.tsx        # 代码编辑器（CodeMirror 6）
│   │       ├── FileExplorer.tsx      # 文件浏览器
│   │       ├── ErrorBoundary.tsx     # 错误边界
│   │       └── Toast.tsx             # 通知组件
│   ├── package.json
│   └── vite.config.ts
├── .github/workflows/ci.yml    # CI/CD（pytest + tsc + build）
├── Dockerfile                  # 多阶段构建
├── docker-compose.yml          # 一键部署
└── workspace/                  # 默认工作区目录
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 对话（非流式） |
| `POST` | `/api/chat/stream` | 对话（SSE 流式） |
| `GET` | `/api/conversations` | 会话列表 |
| `GET` | `/api/conversations/{id}` | 会话详情 |
| `DELETE` | `/api/conversations/{id}` | 删除会话 |
| `GET` | `/api/files` | 文件列表 |
| `POST` | `/api/files/read` | 读取文件 |
| `POST` | `/api/files/write` | 写入文件 |
| `POST` | `/api/files/delete` | 删除文件 |
| `POST` | `/api/execute` | 执行代码 |
| `POST` | `/api/search` | 搜索代码 |
| `GET` | `/api/providers` | 提供商列表 |
| `POST` | `/api/providers/configure` | 配置提供商 |
| `GET` | `/api/stats` | 服务统计（请求数、运行时间、活跃连接） |
| `WS` | `/ws/chat` | WebSocket 对话 |

## 配置

在 `backend/.env` 中配置：

```env
DEFAULT_PROVIDER=deepseek
DEFAULT_MODEL=deepseek-chat
DEEPSEEK_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
# ... 其他提供商
PORT=8000
WORKSPACE_DIR=./workspace
```

## 测试

```bash
cd backend
pip install -r requirements-dev.txt
pytest                          # 单元测试 + 集成测试
pytest --cov=. --cov-report=term  # 带覆盖率
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+N` | 新建文件 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+E` | 切换编辑器/聊天 |
| `Ctrl+K` | 新建会话 |
| `Enter` | 发送消息 |
| `Shift+Enter` | 换行 |

## 技术栈

| 层 | 技术 |
|----|------|
| 后端框架 | FastAPI · Uvicorn |
| AI/LLM | OpenAI SDK (Function Calling) |
| 数据库 | SQLite (aiosqlite) |
| 前端框架 | React 18 · TypeScript 5 |
| 构建工具 | Vite 5 |
| 代码编辑器 | CodeMirror 6 |
| 样式 | Tailwind CSS 3 |
| Markdown | react-markdown · remark-gfm |
| 部署 | Docker · Docker Compose |
| CI/CD | GitHub Actions |

## License

[MIT](LICENSE) © 2025 wyqsgy