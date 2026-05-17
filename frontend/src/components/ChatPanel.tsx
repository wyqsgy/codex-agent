import { useState, useRef, useEffect } from 'react'
import type { ChatMessage, ToolCall, CodeBlock } from '../types'

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (message: string) => void
  loading: boolean
}

function ToolCallBadge({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const toolIcons: Record<string, string> = {
    list_files: '📂', read_file: '📖', write_file: '✏️',
    delete_file: '🗑️', execute_code: '▶️', search_files: '🔍',
  }
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="tool-call-badge hover:bg-[#252538] transition-colors"
      >
        <span>{toolIcons[call.tool] || '🔧'}</span>
        <span>{call.tool}</span>
        <span>{call.result.success ? '✓' : '✗'}</span>
      </button>
      {expanded && (
        <div className="mt-1 ml-4 p-2 bg-[#1a1a2e] rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
          <div className="text-[#8888a0]">参数:</div>
          <pre className="text-[#c0c0d0]">{JSON.stringify(call.args, null, 2)}</pre>
          <div className="text-[#8888a0] mt-2">结果:</div>
          <pre className={call.result.success ? 'text-[#22c55e]' : 'text-[#ef4444]'}>
            {JSON.stringify(call.result.result || call.result.error, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function CodeBlockView({ block, onApply }: { block: CodeBlock; onApply?: (code: string, lang: string) => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(block.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span>{block.language}</span>
        <div className="flex gap-2">
          {onApply && (
            <button
              onClick={() => onApply(block.code, block.language)}
              className="text-[#6366f1] hover:text-[#818cf8] text-xs"
            >
              应用
            </button>
          )}
          <button onClick={handleCopy} className="text-[#8888a0] hover:text-[#e4e4ed] text-xs">
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      <pre className="text-[#c0c0d0]">{block.code}</pre>
    </div>
  )
}

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
          {toolCalls.map((call, i) => (
            <ToolCallBadge key={i} call={call} />
          ))}
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
        return (
          <div key={i} className="whitespace-pre-wrap text-sm leading-relaxed">
            {part}
          </div>
        )
      })}
    </div>
  )
}

export default function ChatPanel({ messages, onSendMessage, loading }: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSendMessage(trimmed)
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
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
            <div className="text-4xl mb-4">🤖</div>
            <h2 className="text-xl font-bold text-[#e4e4ed] mb-2">Wsygqy</h2>
            <p className="text-sm text-[#8888a0] max-w-md">
              你的AI编程助手。可以帮你写代码、调试、分析文件、执行脚本。
              <br />试试输入 "帮我创建一个Python Flask应用" 开始吧！
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2 text-xs">
              {[
                '帮我写一个快速排序',
                '查看当前工作区文件',
                '创建一个React组件',
                '执行这段Python代码',
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
          <div
            key={i}
            className={`mb-4 fade-in ${msg.role === 'user' ? 'flex justify-end' : ''}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-[#6366f1] text-white'
                  : 'bg-[#12121a] border border-[#2a2a3e]'
              }`}
            >
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs">🤖</span>
                  <span className="text-xs text-[#8888a0]">Wsygqy</span>
                </div>
              )}
              <MessageContent
                content={msg.content}
                toolCalls={msg.toolCalls}
                codeBlocks={msg.codeBlocks}
              />
            </div>
          </div>
        ))}
        {loading && (
          <div className="mb-4 fade-in">
            <div className="max-w-[85%] rounded-xl px-4 py-3 bg-[#12121a] border border-[#2a2a3e]">
              <div className="flex items-center gap-2">
                <span className="text-xs">🤖</span>
                <div className="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
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
            placeholder="输入消息... (Shift+Enter换行)"
            rows={1}
            className="flex-1 bg-[#12121a] border border-[#2a2a3e] rounded-xl px-4 py-2.5 text-sm text-[#e4e4ed] placeholder-[#555570] resize-none focus:outline-none focus:border-[#6366f1] transition-colors"
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-[#6366f1] hover:bg-[#818cf8] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}