import json
import re
import uuid
from typing import Optional
from openai import OpenAI
from config import (
    load_providers, get_provider_api_key, DEFAULT_PROVIDER, DEFAULT_MODEL,
)
from tools import (
    list_files, read_file, write_file, delete_file,
    execute_code, search_files,
)

SYSTEM_PROMPT = """You are Wsygqy Agent, an advanced AI coding assistant. You help users write, edit, debug, and understand code.

You have access to the following tools:
1. **list_files** - List files in a directory. Args: {"directory": "path"}
2. **read_file** - Read a file's content. Args: {"path": "filepath"}
3. **write_file** - Write content to a file. Args: {"path": "filepath", "content": "file content"}
4. **delete_file** - Delete a file or directory. Args: {"path": "filepath"}
5. **execute_code** - Execute code and return output. Args: {"code": "code string", "language": "python|javascript|typescript"}
6. **search_files** - Search for text in files. Args: {"query": "search text", "directory": "path"}

When you need to use a tool, output a JSON block in this exact format:
```tool
{"tool": "tool_name", "args": {"arg1": "value1"}}
```

You can use multiple tools in sequence. After getting tool results, analyze them and continue helping the user.

Important rules:
- Always read a file before modifying it
- When writing code, create complete, working files
- Explain what you're doing step by step
- If code execution fails, analyze the error and fix it
- Be concise but thorough
- The workspace directory is the root of all file operations
- Respond in the same language as the user's message
"""

TOOL_PATTERN = re.compile(r'```tool\s*\n(.*?)\n```', re.DOTALL)
CODE_BLOCK_PATTERN = re.compile(r'```(\w+)?\s*\n(.*?)\n```', re.DOTALL)


class AgentEngine:
    def __init__(self):
        self.conversations: dict[str, list[dict]] = {}
        self._client_cache: dict[str, OpenAI] = {}

    def _get_client(self, provider_id: str) -> Optional[OpenAI]:
        if provider_id in self._client_cache:
            return self._client_cache[provider_id]

        providers = load_providers()
        provider = next((p for p in providers if p["id"] == provider_id), None)
        if not provider:
            return None

        api_key = get_provider_api_key(provider)
        base_url = provider.get("base_url", "")

        if not api_key:
            return None

        client = OpenAI(
            api_key=api_key,
            base_url=base_url or None,
        )
        self._client_cache[provider_id] = client
        return client

    def _resolve_model(self, provider_id: str, model_id: str) -> tuple[str, str]:
        providers = load_providers()
        provider = next((p for p in providers if p["id"] == provider_id), None)

        if not provider:
            for p in providers:
                for m in p.get("models", []):
                    if m["id"] == model_id:
                        return p["id"], model_id
            return DEFAULT_PROVIDER, DEFAULT_MODEL

        if not model_id:
            models = provider.get("models", [])
            if models:
                return provider_id, models[0]["id"]
            return provider_id, DEFAULT_MODEL

        return provider_id, model_id

    def _call_llm(self, messages: list[dict], provider_id: str, model_id: str) -> str:
        resolved_provider, resolved_model = self._resolve_model(provider_id, model_id)
        client = self._get_client(resolved_provider)

        if not client:
            available = []
            for p in load_providers():
                key = get_provider_api_key(p)
                if key:
                    available.append(p["name"])
            if available:
                return f"[配置错误] 提供商 '{resolved_provider}' 未配置API Key。已配置的提供商: {', '.join(available)}。请在设置中配置API Key。"
            return "[配置错误] 未配置任何API Key。请在设置中添加提供商的API Key，或在 .env 文件中设置对应的环境变量。"

        try:
            response = client.chat.completions.create(
                model=resolved_model,
                messages=messages,
                temperature=0.1,
                max_tokens=4096,
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            error_msg = str(e)
            return f"[LLM调用失败] 提供商: {resolved_provider}, 模型: {resolved_model}\n错误: {error_msg}"

    def _execute_tool(self, tool_name: str, args: dict) -> dict:
        try:
            if tool_name == "list_files":
                return {"success": True, "result": list_files(args.get("directory", ""))}
            elif tool_name == "read_file":
                return {"success": True, "result": read_file(args["path"])}
            elif tool_name == "write_file":
                return {"success": True, "result": write_file(args["path"], args["content"])}
            elif tool_name == "delete_file":
                return {"success": True, "result": delete_file(args["path"])}
            elif tool_name == "execute_code":
                return {"success": True, "result": execute_code(
                    args["code"], args.get("language", "python"), args.get("timeout", 30)
                )}
            elif tool_name == "search_files":
                return {"success": True, "result": search_files(
                    args["query"], args.get("directory", "")
                )}
            else:
                return {"success": False, "error": f"Unknown tool: {tool_name}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _extract_tool_calls(self, text: str) -> list[dict]:
        calls = []
        for match in TOOL_PATTERN.finditer(text):
            try:
                call = json.loads(match.group(1))
                calls.append(call)
            except json.JSONDecodeError:
                continue
        return calls

    def _extract_code_blocks(self, text: str) -> list[dict]:
        blocks = []
        for match in CODE_BLOCK_PATTERN.finditer(text):
            lang = match.group(1) or "text"
            if lang == "tool":
                continue
            code = match.group(2)
            blocks.append({"language": lang, "code": code})
        return blocks

    async def chat(self, message: str, conversation_id: Optional[str] = None,
                   provider_id: Optional[str] = None, model_id: Optional[str] = None,
                   context_files: Optional[list[str]] = None) -> dict:
        if not conversation_id:
            conversation_id = str(uuid.uuid4())

        if conversation_id not in self.conversations:
            self.conversations[conversation_id] = [
                {"role": "system", "content": SYSTEM_PROMPT}
            ]

        resolved_provider = provider_id or DEFAULT_PROVIDER
        resolved_model = model_id or DEFAULT_MODEL

        context_addition = ""
        if context_files:
            file_contents = []
            for fp in context_files:
                try:
                    content = read_file(fp)
                    file_contents.append(f"--- {fp} ---\n{content}\n")
                except Exception:
                    pass
            if file_contents:
                context_addition = "\n\nContext files:\n" + "\n".join(file_contents)

        user_msg = message + context_addition
        self.conversations[conversation_id].append({"role": "user", "content": user_msg})

        tool_results = []
        max_iterations = 5
        for _ in range(max_iterations):
            messages = self.conversations[conversation_id]
            reply = self._call_llm(messages, resolved_provider, resolved_model)

            tool_calls = self._extract_tool_calls(reply)
            if not tool_calls:
                break

            for call in tool_calls:
                result = self._execute_tool(call["tool"], call.get("args", {}))
                tool_results.append({
                    "tool": call["tool"],
                    "args": call.get("args", {}),
                    "result": result,
                })

            self.conversations[conversation_id].append({"role": "assistant", "content": reply})

            tool_summary = "Tool execution results:\n"
            for tr in tool_results[-len(tool_calls):]:
                tool_summary += f"\n--- {tr['tool']} ---\n"
                tool_summary += json.dumps(tr["result"], indent=2, ensure_ascii=False) + "\n"

            self.conversations[conversation_id].append({"role": "user", "content": tool_summary})

        if len(self.conversations[conversation_id]) > 40:
            system_msg = self.conversations[conversation_id][0]
            recent = self.conversations[conversation_id][-20:]
            self.conversations[conversation_id] = [system_msg] + recent

        code_blocks = self._extract_code_blocks(reply)

        return {
            "reply": reply,
            "conversation_id": conversation_id,
            "tool_calls": tool_results if tool_results else None,
            "code_blocks": code_blocks if code_blocks else None,
        }


engine = AgentEngine()