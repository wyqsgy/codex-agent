#!/usr/bin/env python3
"""Wsygqy Agent 一键启动脚本"""
import subprocess
import sys
import os
from pathlib import Path

ROOT = Path(__file__).parent

def check_command(cmd: str, name: str):
    try:
        subprocess.run([cmd, "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print(f"[错误] 未找到 {name}，请先安装")
        sys.exit(1)

def main():
    check_command("python", "Python 3.10+")
    check_command("node", "Node.js 18+")

    env_file = ROOT / "backend" / ".env"
    if not env_file.exists():
        example = ROOT / "backend" / ".env.example"
        print(f"[配置] 复制 {example.name} 为 .env ...")
        import shutil
        shutil.copy2(example, env_file)
        print("[重要] 请编辑 backend/.env 填入你的 API Key！\n")

    print("[1/4] 安装 Python 依赖...")
    subprocess.run([sys.executable, "-m", "pip", "install", "-r",
                    str(ROOT / "backend" / "requirements.txt"), "-q"])

    print("[2/4] 安装 Node.js 依赖...")
    frontend_dir = ROOT / "frontend"
    subprocess.run(["npm", "install"], cwd=str(frontend_dir))

    print("[3/4] 启动后端服务 (端口 8000)...")
    backend_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", "0.0.0.0", "--port", "8000", "--reload"],
        cwd=str(ROOT / "backend"),
    )

    print("[4/4] 启动前端服务 (端口 5173)...")
    frontend_proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(frontend_dir),
    )

    print("\n================================")
    print("  Wsygqy Agent 已启动！")
    print("  前端: http://localhost:5173")
    print("  后端: http://localhost:8000")
    print("  API文档: http://localhost:8000/docs")
    print("================================")

    try:
        backend_proc.wait()
        frontend_proc.wait()
    except KeyboardInterrupt:
        print("\n正在关闭服务...")
        backend_proc.terminate()
        frontend_proc.terminate()

if __name__ == "__main__":
    main()