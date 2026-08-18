import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import 'highlight.js/styles/github-dark.css'
import type { ChatMessage, ToolCall, CodeBlock } from '../types'
import type { StreamEvent } from '../api'
import MermaidDiagram from './MermaidDiagram'

// ---------------------------------------------------------------------------
// 会话导出工具
// ---------------------------------------------------------------------------
function exportConversation(messages: ChatMessage[], format: 'markdown' | 'json', title?: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `codex-export-${timestamp}.${format === 'json' ? 'json' : 'md'}`

  if (format === 'json') {
    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
    return
  }

  // Markdown export
  let md = `# CodeX Agent Conversation\n\n`
  if (title) md += `> ${title}\n\n`
  md += `_Exported at ${new Date().toLocaleString()}_\n\n---\n\n`
  for (const msg of messages) {
    if (msg.role === 'system') continue
    const role = msg.role === 'user' ? '**You**' : '**CodeX**'
    md += `### ${role}\n\n`
    if (msg.content) md += `${msg.content}\n\n`
    if (msg.toolCalls?.length) {
      md += `<details>\n<summary>Tool Calls (${msg.toolCalls.length})</summary>\n\n`
      for (const tc of msg.toolCalls) {
        md += `- **${tc.tool}** \`${tc.result?.success ? 'OK' : 'ERR'}\`\n`
        md += `  - Args: \`${JSON.stringify(tc.args)}\`\n`
        if (tc.result?.result) md += `  - Result: \`${JSON.stringify(tc.result.result).slice(0, 200)}\`\n`
        if (tc.result?.error) md += `  - Error: \`${tc.result.error}\`\n`
      }
      md += `\n</details>\n\n`
    }
    md += `---\n\n`
  }
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (message: string) => void
  loading: boolean
  onStop?: () => void
  onApplyCode?: (code: string, lang: string) => void
  conversationId?: string
}

// ---------------------------------------------------------------------------
// Tool Call Badge
// ---------------------------------------------------------------------------
const TOOL_ICONS: Record<string, string> = {
  list_files: '\u{1F4C2}', read_file: '\u{1F4D6}', write_file: '\u270F\uFE0F',
  delete_file: '\u{1F5D1}\uFE0F', execute_code: '\u25B6\uFE0F', search_files: '\u{1F50D}',
}

const ToolCallBadge = memo(function ToolCallBadge({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const isSuccess = call.result?.success
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs transition-all border ${
          isSuccess
            ? 'bg-[#22c55e]/5 border-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/10'
            : 'bg-[#ef4444]/5 border-[#ef4444]/20 text-[#ef4444] hover:bg-[#ef4444]/10'
        }`}
      >
        <span>{TOOL_ICONS[call.tool] || '\u{1F527}'}</span>
        <span className="font-medium">{call.tool}</span>
        <span className="text-[10px] opacity-70">{isSuccess ? 'OK' : 'ERR'}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-2 p-2.5 bg-[#0d0d14] border border-[#2a2a3e] rounded-lg text-xs font-mono overflow-x-auto max-h-52 overflow-y-auto">
          <div className="text-[#8888a0] mb-1">Args</div>
          <pre className="text-[#c0c0d0] text-[11px] leading-relaxed">{JSON.stringify(call.args, null, 2)}</pre>
          <div className="text-[#8888a0] mt-2 mb-1">Result</div>
          <pre className={`text-[11px] leading-relaxed ${isSuccess ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
            {typeof call.result?.result === 'string'
              ? call.result.result
              : JSON.stringify(call.result?.result ?? call.result?.error ?? call.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// Code Block View
// ---------------------------------------------------------------------------
const CodeBlockView = memo(function CodeBlockView({
  block,
  onApply,
}: {
  block: CodeBlock
  onApply?: (code: string, lang: string) => void
}) {
  const [copied, setCopied] = useState(false)

  // 使用 highlight.js 进行语法高亮
  const highlighted = useMemo(() => {
    const lang = block.language
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(block.code, { language: lang }).value
      } catch { /* fallthrough */ }
    }
    return null
  }, [block.code, block.language])

  const handleCopy = () => {
    navigator.clipboard.writeText(block.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-[#2a2a3e] bg-[#0d0d14]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1a2e] border-b border-[#2a2a3e]">
        <span className="text-[10px] uppercase tracking-wider text-[#8888a0]">{block.language}</span>
        <div className="flex gap-2">
          {onApply && (
            <button
              onClick={() => onApply(block.code, block.language)}
              className="text-[#6366f1] hover:text-[#818cf8] text-[10px] font-medium transition-colors"
            >
              Apply
            </button>
          )}
          <button
            onClick={handleCopy}
            className="text-[#8888a0] hover:text-[#e4e4ed] text-[10px] transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="p-3 text-[13px] leading-relaxed text-[#c0c0d0] overflow-x-auto max-h-[420px] overflow-y-auto">
        {highlighted ? (
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{block.code}</code>
        )}
      </pre>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Markdown Renderers
// ---------------------------------------------------------------------------
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Code blocks
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const isInline = !match
          if (isInline) {
            return (
              <code
                className="px-1.5 py-0.5 bg-[#1a1a2e] text-[#e4e4ed] rounded text-[13px] font-mono"
                {...props}
              >
                {children}
              </code>
            )
          }
          const lang = match[1]
          const code = String(children).replace(/\n$/, '')
          // Mermaid diagrams
          if (lang === 'mermaid') {
            return <MermaidDiagram code={code} />
          }
          return (
            <CodeBlockView
              block={{ language: lang, code }}
            />
          )
        },
        // Tables
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          )
        },
        th({ children }) {
          return (
            <th className="border border-[#2a2a3e] bg-[#1a1a2e] px-3 py-2 text-left font-medium text-[#e4e4ed]">
              {children}
            </th>
          )
        },
        td({ children }) {
          return (
            <td className="border border-[#2a2a3e] px-3 py-2 text-[#c0c0d0]">{children}</td>
          )
        },
        // Links
        a({ children, href }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#6366f1] hover:text-[#818cf8] underline underline-offset-2"
            >
              {children}
            </a>
          )
        },
        // Lists
        ul({ children }) {
          return <ul className="list-disc list-inside my-2 space-y-1 text-sm">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside my-2 space-y-1 text-sm">{children}</ol>
        },
        // Headings
        h1({ children }) {
          return <h1 className="text-lg font-bold text-[#e4e4ed] mt-4 mb-2">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-base font-bold text-[#e4e4ed] mt-3 mb-1.5">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold text-[#e4e4ed] mt-2 mb-1">{children}</h3>
        },
        // Blockquotes
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-[#6366f1] pl-3 my-2 text-sm text-[#8888a0] italic">
              {children}
            </blockquote>
          )
        },
        // Horizontal rule
        hr() {
          return <hr className="my-3 border-[#2a2a3e]" />
        },
        // Paragraphs
        p({ children }) {
          return <p className="text-sm leading-relaxed my-1.5">{children}</p>
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

// ---------------------------------------------------------------------------
// Message Bubble
// ---------------------------------------------------------------------------
const MessageBubble = memo(function MessageBubble({
  msg,
  onApplyCode,
}: {
  msg: ChatMessage
  onApplyCode?: (code: string, lang: string) => void
}) {
  const isUser = msg.role === 'user'
  const isEmpty = !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0)

  return (
    <div className={`mb-4 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white shadow-lg shadow-[#6366f1]/10'
            : 'bg-[#12121a] border border-[#2a2a3e]'
        }`}
      >
        {/* Assistant identity */}
        {!isUser && !isEmpty && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-full bg-[#6366f1]/20 flex items-center justify-center text-[10px]">
              {'\u{1F916}'}
            </div>
            <span className="text-[10px] text-[#8888a0] font-medium">CodeX</span>
          </div>
        )}

        {/* Tool calls */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {msg.toolCalls.map((call, i) => (
              <ToolCallBadge key={i} call={call} />
            ))}
          </div>
        )}

        {/* Content */}
        {msg.content && (
          <div className={isUser ? 'text-sm' : ''}>
            <MarkdownRenderer content={msg.content} />
          </div>
        )}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Loading indicator
// ---------------------------------------------------------------------------
const LoadingIndicator = memo(function LoadingIndicator() {
  return (
    <div className="mb-4 flex justify-start">
      <div className="rounded-2xl px-4 py-3 bg-[#12121a] border border-[#2a2a3e]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-[#6366f1]/20 flex items-center justify-center text-[10px]">
            {'\u{1F916}'}
          </div>
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
            <span className="w-1.5 h-1.5 bg-[#6366f1] rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
          </div>
        </div>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Empty / Welcome State
// ---------------------------------------------------------------------------
const WelcomeScreen = memo(function WelcomeScreen({ onSend }: { onSend: (msg: string) => void }) {
  const suggestions = [
    { icon: '\u{1F4BB}', label: 'Create a Python web server', text: 'Write a Flask web server with a /health endpoint' },
    { icon: '\u{1F4DD}', label: 'Explain this code', text: 'Explain how the Python GIL works with code examples' },
    { icon: '\u{1F50D}', label: 'Search workspace', text: 'List all files in the workspace' },
    { icon: '\u{1F527}', label: 'Debug a problem', text: 'I have a bug: my API returns 500 when calling /users' },
    { icon: '\u{1F4A1}', label: 'Generate algorithm', text: 'Implement a binary search tree with insert and search' },
    { icon: '\u{1F3D7}', label: 'Build a React component', text: 'Create a React counter component with TypeScript' },
  ]

  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#6366f1] to-[#4f46e5] flex items-center justify-center text-2xl mb-5 shadow-lg shadow-[#6366f1]/20">
        {'\u{1F916}'}
      </div>
      <h1 className="text-2xl font-bold text-[#e4e4ed] mb-2">CodeX Agent</h1>
      <p className="text-sm text-[#8888a0] max-w-md mb-8 leading-relaxed">
        Your AI-powered coding assistant. Write, debug, execute, and manage code with
        multi-model support and real-time streaming.
      </p>
      <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
        {suggestions.map((s) => (
          <button
            key={s.text}
            onClick={() => onSend(s.text)}
            className="flex items-center gap-2 px-3 py-2.5 bg-[#12121a] border border-[#2a2a3e] rounded-xl text-sm text-[#c0c0d0] hover:border-[#6366f1]/50 hover:bg-[#1a1a2e] transition-all text-left group"
          >
            <span className="text-base shrink-0 group-hover:scale-110 transition-transform">{s.icon}</span>
            <div>
              <div className="text-xs font-medium text-[#e4e4ed]">{s.label}</div>
              <div className="text-[10px] text-[#8888a0] truncate">{s.text}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Main ChatPanel
// ---------------------------------------------------------------------------
export default function ChatPanel({
  messages,
  onSendMessage,
  loading,
  onStop,
  onApplyCode,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSendMessage(trimmed)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [input, loading, onSendMessage])

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
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading ? (
          <WelcomeScreen onSend={onSendMessage} />
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onApplyCode={onApplyCode} />
            ))}
            {loading && <LoadingIndicator />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[#2a2a3e] p-3 bg-[#0a0a0f]">
        <div className="flex gap-2 items-end max-w-4xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask CodeX anything... (Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-[#12121a] border border-[#2a2a3e] rounded-2xl px-4 py-2.5 text-sm text-[#e4e4ed] placeholder-[#555570] resize-none focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]/20 transition-all"
            aria-label="Chat message input"
          />
          {loading ? (
            <button
              onClick={onStop}
              className="px-5 py-2.5 bg-[#ef4444] hover:bg-[#dc2626] text-white rounded-2xl text-sm font-medium transition-all shadow-lg shadow-[#ef4444]/20"
              aria-label="Stop generating"
              title="Stop generating"
            >
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 bg-white rounded-sm" />
                Stop
              </span>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-[#6366f1] to-[#4f46e5] hover:from-[#818cf8] hover:to-[#6366f1] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-medium transition-all shadow-lg shadow-[#6366f1]/20"
              aria-label="Send message"
            >
              <span className="flex items-center gap-1">
                Send <span className="text-[10px]">{'\u23CE'}</span>
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-[#555570]">
            CodeX may produce inaccurate information. Verify important outputs.
          </p>
          {messages.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => exportConversation(messages, 'markdown')}
                className="text-[10px] text-[#555570] hover:text-[#818cf8] transition-colors px-1"
                title="Export as Markdown"
              >
                Export .md
              </button>
              <span className="text-[#2a2a3e] text-[10px]">|</span>
              <button
                onClick={() => exportConversation(messages, 'json')}
                className="text-[10px] text-[#555570] hover:text-[#818cf8] transition-colors px-1"
                title="Export as JSON"
              >
                Export .json
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}