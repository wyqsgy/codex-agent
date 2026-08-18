import type { FileItem, ExecuteResult, ChatMessage, ToolCall } from './types'

const BASE = '/api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

export interface ProviderInfo {
  id: string
  name: string
  base_url: string
  api_key_env: string
  api_key_set: boolean
  models: { id: string; name: string }[]
}

export interface StreamEvent {
  type: 'meta' | 'token' | 'tool_call' | 'done' | 'error'
  conversation_id?: string
  content?: string
  tool_call?: {
    tool: string
    args: Record<string, unknown>
    result: { success: boolean; result?: unknown; error?: string }
  }
  reply?: string
  tool_calls?: ToolCallInfo[]
  code_blocks?: { language: string; code: string }[]
  error?: boolean | string
}

interface ToolCallInfo {
  tool: string
  args: Record<string, unknown>
  result: { success: boolean; result?: unknown; error?: string }
}

export async function sendMessage(
  message: string,
  conversationId?: string,
  providerId?: string,
  model?: string,
  contextFiles?: string[],
) {
  return request<{
    reply: string
    conversation_id: string
    tool_calls?: ToolCallInfo[]
    code_blocks?: { language: string; code: string }[]
  }>('/chat', {
    method: 'POST',
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      provider_id: providerId,
      model,
      context_files: contextFiles,
    }),
  })
}

export async function sendMessageStream(
  message: string,
  conversationId: string | undefined,
  providerId: string,
  model: string,
  contextFiles: string[] | undefined,
  signal: AbortSignal,
  onToken: (token: string) => void,
  onToolCall: (tc: StreamEvent['tool_call']) => void,
): Promise<StreamEvent> {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      provider_id: providerId,
      model,
      context_files: contextFiles,
    }),
    signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let finalEvent: StreamEvent = { type: 'done' }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event: StreamEvent = JSON.parse(line.slice(6))
          if (event.type === 'token' && event.content) {
            onToken(event.content)
          } else if (event.type === 'tool_call' && event.tool_call) {
            onToolCall(event.tool_call)
          } else if (event.type === 'done' || event.type === 'error') {
            finalEvent = event
          }
        } catch {
          // skip parse errors
        }
      }
    }
  }

  return finalEvent
}

export async function fetchFiles(directory: string = ''): Promise<FileItem[]> {
  return request<FileItem[]>(`/files?directory=${encodeURIComponent(directory)}`)
}

export async function readFile(path: string): Promise<{ path: string; content: string }> {
  return request('/files/read', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export async function writeFile(path: string, content: string): Promise<{ success: boolean; message: string }> {
  return request('/files/write', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  })
}

export async function deleteFile(path: string): Promise<{ success: boolean; message: string }> {
  return request('/files/delete', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export async function executeCode(code: string, language: string = 'python', timeout: number = 30): Promise<ExecuteResult> {
  return request('/execute', {
    method: 'POST',
    body: JSON.stringify({ code, language, timeout }),
  })
}

export async function searchCode(query: string, directory: string = ''): Promise<{ path: string; line: number; content: string }[]> {
  return request(`/search?query=${encodeURIComponent(query)}&directory=${encodeURIComponent(directory)}`)
}

export async function getProviders(): Promise<ProviderInfo[]> {
  return request<ProviderInfo[]>('/providers')
}

export async function configureProvider(config: {
  id: string
  name?: string
  base_url?: string
  api_key?: string
  api_key_env?: string
  models?: { id: string; name: string }[]
}): Promise<{ success: boolean }> {
  return request('/providers/configure', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export async function deleteProvider(providerId: string): Promise<{ success: boolean }> {
  return request(`/providers/${providerId}`, {
    method: 'DELETE',
  })
}

export async function testProvider(providerId: string): Promise<{ success: boolean; error?: string; model?: string; response?: string }> {
  return request(`/providers/${providerId}/test`)
}

export interface ConversationInfo {
  id: string
  title: string
  created_at: number
  updated_at: number
}

export async function listConversations(): Promise<ConversationInfo[]> {
  return request('/conversations')
}

export async function getConversation(conversationId: string): Promise<{ id: string; messages: ChatMessage[] }> {
  const raw = await request<{ id: string; messages: RawMessage[] }>(`/conversations/${conversationId}`)
  return { id: raw.id, messages: convertRawMessages(raw.messages) }
}

export async function deleteConversation(conversationId: string): Promise<{ success: boolean }> {
  return request(`/conversations/${conversationId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// 后端 OpenAI 消息格式 -> 前端 ChatMessage 格式转换
// ---------------------------------------------------------------------------
interface RawToolCall {
  id: string
  type: string
  function: { name: string; arguments: string }
}

interface RawMessage {
  role: string
  content?: string | null
  tool_calls?: RawToolCall[]
  tool_call_id?: string
}

function convertRawMessages(raw: RawMessage[]): ChatMessage[] {
  const toolResults = new Map<string, ToolCall['result']>()

  // 第一遍：收集 tool 消息的结果
  for (const m of raw) {
    if (m.role === 'tool' && m.tool_call_id) {
      try {
        const parsed = JSON.parse(m.content || '')
        toolResults.set(m.tool_call_id, parsed)
      } catch {
        toolResults.set(m.tool_call_id, { success: true, result: m.content })
      }
    }
  }

  // 第二遍：构建前端消息
  const result: ChatMessage[] = []
  for (const m of raw) {
    if (m.role === 'system' || m.role === 'tool') continue
    if (m.role === 'user') {
      result.push({ role: 'user', content: m.content || '' })
    } else if (m.role === 'assistant') {
      const toolCalls: ToolCall[] = (m.tool_calls || []).map((tc) => {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.function.arguments || '{}')
        } catch {
          args = {}
        }
        return {
          tool: tc.function.name,
          args,
          result: toolResults.get(tc.id) || { success: true, result: undefined },
        }
      })
      result.push({
        role: 'assistant',
        content: m.content || '',
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })
    }
  }
  return result
}