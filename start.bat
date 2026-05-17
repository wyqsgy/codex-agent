@echo off
echo ================================
echo   Wsygqy Agent - 启动脚本
echo ================================
echo.

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

if not exist "backend\.env" (
    echo [配置] 复制 .env.example 为 .env ...
    copy "backend\.env.example" "backend\.env"
    echo [重要] 请编辑 backend\.env 填入你的 API Key！
    echo.
)

echo [1/4] 安装 Python 依赖...
cd backend
pip install -r requirements.txt -q
cd ..

echo [2/4] 安装 Node.js 依赖...
cd frontend
call npm install
cd ..

echo [3/4] 启动后端服务 (端口 8000)...
start "Wsygqy Backend" cmd /k "cd backend && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

echo [4/4] 启动前端服务 (端口 5173)...
start "Wsygqy Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ================================
echo   Wsygqy Agent 已启动！
echo   前端: http://localhost:5173
echo   后端: http://localhost:8000
echo   API文档: http://localhost:8000/docs
echo ================================
pause