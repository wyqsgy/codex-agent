# CodeX Agent

一个类似 OpenAI Codex 的消费级 AI 编程助手，支持代码生成、文件管理、代码执行和智能对话。

## 功能特性

- 🤖 **AI 对话** - 支持 GPT-4 / Claude 3 等多种模型
- 📝 **代码编辑器** - 基于 CodeMirror 6，支持多语言语法高亮
- 📂 **文件管理** - 浏览、创建、编辑、删除工作区文件
- ▶️ **代码执行** - 直接运行 Python / JavaScript / TypeScript 代码
- 🔧 **工具调用** - Agent 可自主调用工具完成任务
- 🔍 **代码搜索** - 在工作区中搜索代码内容
- 💬 **WebSocket** - 支持实时对话流

## 快速开始

### 前置要求

- Python 3.10+
- Node.js 18+

### 一键启动

```bash
# Windows
start.bat

# 或使用 Python 启动
python start.py
```

### 手动启动

1. 配置 API Key：
```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env 填入你的 API Key
```

2. 启动后端：
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

3. 启动前端：
```bash
cd frontend
npm install
npm run dev
```

4. 打开浏览器访问 http://localhost:5173

## 项目结构

```
codex-agent/
├── backend/
│   ├── main.py          # FastAPI 主服务
│   ├── agent.py         # Agent 引擎（工具调用循环）
│   ├── tools.py         # 工具实现（文件/执行/搜索）
│   ├── models.py        # 数据模型
│   ├── config.py        # 配置管理
│   ├── requirements.txt # Python 依赖
│   └── .env.example     # 环境变量模板
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # 主应用
│   │   ├── api.ts            # API 调用层
│   │   ├── types.ts          # 类型定义
│   │   ├── main.tsx          # 入口
│   │   ├── index.css         # 全局样式
│   │   └── components/
│   │       ├── ChatPanel.tsx     # AI 对话面板
│   │       ├── CodeEditor.tsx    # 代码编辑器
│   │       └── FileExplorer.tsx  # 文件浏览器
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── workspace/           # 工作区目录
├── start.bat           # Windows 启动脚本
└── start.py            # Python 启动脚本
```

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | AI 对话 |
| `/api/files` | GET | 列出文件 |
| `/api/files/read` | POST | 读取文件 |
| `/api/files/write` | POST | 写入文件 |
| `/api/files/delete` | POST | 删除文件 |
| `/api/execute` | POST | 执行代码 |
| `/api/search` | GET | 搜索代码 |
| `/ws/chat` | WebSocket | 实时对话 |

## 配置说明

在 `backend/.env` 中配置：

- `OPENAI_API_KEY` - OpenAI API 密钥
- `ANTHROPIC_API_KEY` - Anthropic API 密钥
- `DEFAULT_MODEL` - 默认模型 (默认: gpt-4)
- `PORT` - 后端端口 (默认: 8000)
- `WORKSPACE_DIR` - 工作区目录 (默认: ./workspace)