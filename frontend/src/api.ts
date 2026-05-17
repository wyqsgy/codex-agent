import type { FileItem, ExecuteResult } from './types'

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

interface ToolCallInfo {
  tool: string
  args: Record<string, unknown>
  result: { success: boolean; result?: unknown; error?: string }
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