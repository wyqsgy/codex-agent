import { useState, useRef, useEffect, useCallback, memo } from 'react'
import type { ChatMessage, ToolCall, CodeBlock } from '../types'
import type { StreamEvent } from '../api'
import { sendMessageStream } from '../api'

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (message: string) => void
  onStreamMessage: (
    message: string,
    onToken: (token: string) => void,
    onToolCall: (tc: StreamEvent['tool_call']) => void,
    signal: AbortSignal,
  ) => Promise<StreamEvent>
  loading: boolean
  onApplyCode?: (code: string, lang: string) => void
}

const TOOL_ICONS: Record<string, string> = {
  list_files: '\u{1F4C2}', read_file: '\u{1F4D6}', write_file: '\u270F\uFE0F',
  delete_file: '\u{1F5D1}\uFE0F', execute_code: '\u25B6\uFE0F', search_files: '\u{1F50D}',
}

const ToolCallBadge = memo(function ToolCallBadge({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#1a1a2e] border border-[#2a2a3e] text-xs text-[#c0c0d0] hover:bg-[#252538] transition-colors"
      >
        <span>{TOOL_ICONS[call.tool] || '\u{1F527}'}</span>
        <span>{call.tool}</span>
        <span className={call.result.success ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
          {call.result.success ? '\u2713' : '\u2717'}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 p-2 bg-[#1a1a2e] rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
          <div className="text-[#8888a0]">Args:</div>
          <pre className="text-[#c0c0d0]">{JSON.stringify(call.args, null, 2)}</pre>
          <div className="text-[#8888a0] mt-2">Result:</div>
          <pre className={call.result.success ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
            {JSON.stringify(call.result.result || call.result.error, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
})

const CodeBlockView = memo(function CodeBlockView({ block, onApply }: { block: CodeBlock; onApply?: (code: string, lang: string) => void }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(block.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-[#2a2a3e]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1a2e] border-b border-[#2a2a3e]">
        <span className="text-xs text-[#8888a0]">{block.language}</span>
        <div className="flex gap-2">
          {onApply && (
            <button onClick={() => onApply(block.code, block.language)} className="text-[#6366f1] hover:text-[#818cf8] text-xs">
              Apply
            </button>
          )}
          <button onClick={handleCopy} className="text-[#8888a0] hover:text-[#e4e4ed] text-xs">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="p-3 text-sm text-[#c0c0d0] bg-[#0d0d14] overflow-x-auto max-h-96 overflow-y-auto"><code>{block.code}</code></pre>
    </div>
  )
})

function MessageContent({ content, toolCalls, codeBlocks, onApplyCode }: {
  content: string
  toolCalls?: ToolCall[]
  codeBlocks?: CodeBlock[]
  onApplyCode?: (code: string, lang: string) => void
}) {
  const parts = content.split(/(```\w*\n[\s\S]*?\n```)/g)
  return (
    <div className="space-y-2">
      {toolCalls && toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {toolCalls.map((call, i) => <ToolCallBadge key={i} call={call} />)}
        </div>
      )}
      {parts.map((part, i) => {
        const codeMatch = part.match(/^```(\w*)\n([\s\S]*?)\n```$/)
        if (codeMatch) {
          return (
            <CodeBlockView
              key={i}
              block={{ language: codeMatch[1] || 'text', code: codeMatch[2] }}
              onApply={onApplyCode}
            />
          )
        }
        return <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed">{part}</div>
      })}
    </div>
  )
}

const PERSIST_KEY = 'wsygqy_conversations'

function loadPersistedConversations(): Record<string, ChatMessage[]> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function persistConversation(id: string, messages: ChatMessage[]) {
  try {
    const all = loadPersistedConversations()
    all[id] = messages
    localStorage.setItem(PERSIST_KEY, JSON.stringify(all))
  } catch {
    // storage full, ignore
  }
}

export default function ChatPanel({ messages, onSendMessage, onStreamMessage, loading, onApplyCode }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    if (abortRef.current) {
      abortRef.current.abort()
    }
    onSendMessage(trimmed)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, loading, onSendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape' && loading) {
      abortRef.current?.abort()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-4">{'\u{1F916}'}</div>
            <h2 className="text-xl font-bold text-[#e4e4ed] mb-2">Wsygqy</h2>
            <p className="text-sm text-[#8888a0] max-w-md">
              Your AI coding assistant. Write code, debug, analyze files, execute scripts.
              <br />Try "Create a Python Flask app" to get started!
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2 text-xs max-w-sm">
              {[
                'Write a quick sort algorithm',
                'List files in the workspace',
                'Create a React component',
                'Execute this Python code',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSendMessage(suggestion)}
                  className="px-3 py-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg text-[#c0c0d0] hover:border-[#6366f1] hover:text-[#818cf8] transition-colors text-left"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`mb-4 ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-[#12121a] border border-[#2a2a3e]'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs">{'\u{1F916}'}</span>
                  <span className="text-xs text-[#8888a0]">Wsygqy</span>
                </div>
              )}
              <MessageContent
                content={msg.content}
                toolCalls={msg.toolCalls}
                codeBlocks={msg.codeBlocks}
                onApplyCode={onApplyCode}
              />
            </div>
          </div>
        ))}
        {loading && (
          <div className="mb-4">
            <div className="max-w-[85%] rounded-xl px-4 py-3 bg-[#12121a] border border-[#2a2a3e]">
              <div className="flex items-center gap-2">
                <span className="text-xs">{'\u{1F916}'}</span>
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="ml-2 text-xs text-[#8888a0] hover:text-[#ef4444]"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-[#2a2a3e] p-3">
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for new line, Esc to stop)"
            rows={1}
            className="flex-1 bg-[#12121a] border border-[#2a2a3e] rounded-xl px-4 py-2.5 text-sm text-[#e4e4ed] placeholder-[#555570] resize-none focus:outline-none focus:border-[#6366f1] transition-colors"
            aria-label="Chat message input"
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-[#6366f1] hover:bg-[#818cf8] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
            aria-label="Send message"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

export { loadPersistedConversations, persistConversation }