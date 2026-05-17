export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
  toolCalls?: ToolCall[]
  codeBlocks?: CodeBlock[]
}

export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  result: {
    success: boolean
    result?: unknown
    error?: string
  }
}

export interface CodeBlock {
  language: string
  code: string
}

export interface FileItem {
  name: string
  path: string
  is_dir: boolean
  size: number
}

export interface ExecuteResult {
  success: boolean
  stdout?: string
  stderr?: string
  output?: string
  return_code?: number
}