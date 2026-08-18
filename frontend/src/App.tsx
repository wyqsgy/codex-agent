import { useState, useCallback, useEffect, useRef } from 'react'
import ChatPanel from './components/ChatPanel'
import ConversationSidebar from './components/ConversationSidebar'
import CodeEditor from './components/CodeEditor'
import FileExplorer from './components/FileExplorer'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider, useToast } from './components/Toast'
import {
  sendMessageStream, writeFile, executeCode, getProviders,
  configureProvider, testProvider, getConversation,
  type StreamEvent, type ProviderInfo,
} from './api'
import type { ChatMessage } from './types'

type ViewMode = 'chat' | 'editor'
type SidebarPanel = 'conversations' | 'files'

function AppContent() {
  // ---- Core State ----
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0)

  // ---- View State ----
  const [viewMode, setViewMode] = useState<ViewMode>('chat')
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>('conversations')
  const [showSidebar, setShowSidebar] = useState(true)

  // ---- Editor State ----
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileModified, setFileModified] = useState(false)

  // ---- Provider State ----
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selectedProvider, setSelectedProvider] = useState('deepseek')
  const [selectedModel, setSelectedModel] = useState('deepseek-chat')
  const [showSettings, setShowSettings] = useState(false)
  const [configProvider, setConfigProvider] = useState<ProviderInfo | null>(null)
  const [configApiKey, setConfigApiKey] = useState('')
  const [configBaseUrl, setConfigBaseUrl] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  // ---- New File State ----
  const [showNewFile, setShowNewFile] = useState(false)
  const [newFileName, setNewFileName] = useState('')

  const abortRef = useRef<AbortController | null>(null)
  const { addToast } = useToast()

  // ---- Load Providers ----
  const refreshProviders = useCallback(async () => {
    try {
      const list = await getProviders()
      setProviders(list)
      if (list.length > 0 && !list.find(p => p.id === selectedProvider)) {
        const first = list[0]
        setSelectedProvider(first.id)
        if (first.models.length > 0) setSelectedModel(first.models[0].id)
      }
    } catch { /* silent */ }
  }, [selectedProvider])

  useEffect(() => { refreshProviders() }, [refreshProviders])

  const currentProvider = providers.find(p => p.id === selectedProvider)
  const availableModels = currentProvider?.models || []

  // ---- Conversation Switching ----
  const handleSelectConversation = useCallback(async (id: string) => {
    if (id === conversationId) return
    setLoading(true)
    try {
      const { messages: convMessages } = await getConversation(id)
      setConversationId(id)
      setMessages(convMessages)
      setViewMode('chat')
    } catch {
      addToast('Failed to load conversation', 'error')
    } finally {
      setLoading(false)
    }
  }, [conversationId, addToast])

  const handleNewConversation = useCallback(() => {
    setMessages([])
    setConversationId(undefined)
    setViewMode('chat')
    setSidebarRefreshKey(k => k + 1)
  }, [])

  const handleRefreshSidebar = useCallback(() => {
    setSidebarRefreshKey(k => k + 1)
  }, [])

  // ---- Streaming Message ----
  const handleStreamMessage = useCallback(async (
    message: string,
    onToken: (token: string) => void,
    onToolCall: (tc: StreamEvent['tool_call']) => void,
    signal: AbortSignal,
  ): Promise<StreamEvent> => {
    const contextFiles = currentFile ? [currentFile] : undefined
    return sendMessageStream(
      message, conversationId, selectedProvider, selectedModel, contextFiles,
      signal, onToken, onToolCall,
    )
  }, [conversationId, selectedProvider, selectedModel, currentFile])

  // ---- Send Message ----
  const handleSendMessage = useCallback(async (message: string) => {
    const userMsg: ChatMessage = { role: 'user', content: message }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    let streamedContent = ''
    const toolCalls: StreamEvent['tool_call'][] = []

    setMessages((prev) => [...prev, {
      role: 'assistant',
      content: '',
      toolCalls: [],
      codeBlocks: [],
    }])

    try {
      const finalEvent = await handleStreamMessage(
        message,
        (token) => {
          streamedContent += token
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
              next[next.length - 1] = { ...last, content: streamedContent }
            }
            return next
          })
        },
        (tc) => {
          toolCalls.push(tc)
          setMessages((prev) => {
            const next = [...prev]
            const last = next[next.length - 1]
            if (last && last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                toolCalls: toolCalls.filter((t): t is NonNullable<typeof t> => t != null).map(t => ({
                  tool: t.tool,
                  args: t.args || {},
                  result: t.result,
                })),
              }
            }
            return next
          })
        },
        controller.signal,
      )

      if (finalEvent.conversation_id) {
        setConversationId(finalEvent.conversation_id)
        handleRefreshSidebar()
      }

      if (finalEvent.type === 'error') {
        const errMsg = typeof finalEvent.error === 'string' ? finalEvent.error : 'Unknown error'
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, content: `**Error:** ${errMsg}` }
          }
          return next
        })
        addToast(errMsg, 'error')
      } else {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') {
            next[next.length - 1] = {
              ...last,
              content: finalEvent.reply || streamedContent,
              codeBlocks: finalEvent.code_blocks as ChatMessage['codeBlocks'],
            }
          }
          return next
        })
      }
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') {
        addToast('Request cancelled', 'info')
      } else {
        const msg = (e as Error).message || 'Unknown error'
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, content: `**Error:** ${msg}` }
          }
          return next
        })
        addToast(msg, 'error')
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [handleStreamMessage, addToast, handleRefreshSidebar])

  // ---- File Operations ----
  const handleFileSelect = useCallback((path: string, content: string) => {
    setCurrentFile(path)
    setFileContent(content)
    setFileModified(false)
    setViewMode('editor')
  }, [])

  const handleFileChange = useCallback((value: string) => {
    setFileContent(value)
    setFileModified(true)
  }, [])

  const handleSaveFile = useCallback(async () => {
    if (!currentFile) return
    try {
      await writeFile(currentFile, fileContent)
      setFileModified(false)
      addToast('File saved', 'success')
    } catch (e: unknown) {
      addToast(`Save failed: ${(e as Error).message}`, 'error')
    }
  }, [currentFile, fileContent, addToast])

  const handleFileDeleted = useCallback(() => {
    setCurrentFile(null)
    setFileContent('')
    setFileModified(false)
  }, [])

  const handleNewFile = useCallback(() => {
    setShowNewFile(true)
    setNewFileName('')
  }, [])

  const handleCreateFile = useCallback(async () => {
    if (!newFileName.trim()) return
    try {
      await writeFile(newFileName.trim(), '')
      setCurrentFile(newFileName.trim())
      setFileContent('')
      setFileModified(false)
      setViewMode('editor')
      setShowNewFile(false)
      setNewFileName('')
      addToast('File created', 'success')
    } catch (e: unknown) {
      addToast(`Create failed: ${(e as Error).message}`, 'error')
    }
  }, [newFileName, addToast])

  // ---- Code Actions ----
  const handleApplyCode = useCallback(async (code: string, lang: string) => {
    const extMap: Record<string, string> = {
      python: '.py', javascript: '.js', typescript: '.ts',
      java: '.java', cpp: '.cpp', go: '.go', rust: '.rs',
      json: '.json', html: '.html', css: '.css', markdown: '.md',
    }
    const filename = `generated_${Date.now()}${extMap[lang] || '.txt'}`
    try {
      await writeFile(filename, code)
      setCurrentFile(filename)
      setFileContent(code)
      setFileModified(false)
      setViewMode('editor')
      addToast('Code applied to file', 'success')
    } catch (e: unknown) {
      addToast(`Apply failed: ${(e as Error).message}`, 'error')
    }
  }, [addToast])

  const handleRunCode = useCallback(async () => {
    if (!fileContent) return
    const langMap: Record<string, string> = {
      py: 'python', js: 'javascript', ts: 'typescript',
    }
    const ext = currentFile?.split('.').pop() || ''
    const lang = langMap[ext] || 'python'

    setLoading(true)
    try {
      const result = await executeCode(fileContent, lang)
      const outputMsg: ChatMessage = {
        role: 'assistant',
        content: `**\u25B6\uFE0F Execute:** \`${currentFile}\`\n\n${
          result.success
            ? `\u2705 **Success**\n\`\`\`\n${result.stdout || '(no output)'}\n\`\`\``
            : `\u274C **Failed**\n\`\`\`\n${result.stderr || result.output || 'Unknown error'}\n\`\`\``
        }`,
      }
      setMessages((prev) => [...prev, outputMsg])
      setViewMode('chat')
      addToast(result.success ? 'Code executed successfully' : 'Code execution failed', result.success ? 'success' : 'error')
    } catch (e: unknown) {
      addToast(`Execution error: ${(e as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileContent, currentFile, addToast])

  // ---- Provider Config ----
  const handleOpenConfig = useCallback((provider: ProviderInfo) => {
    setConfigProvider(provider)
    setConfigBaseUrl(provider.base_url)
    setConfigApiKey('')
    setTestResult(null)
    setShowSettings(true)
  }, [])

  const handleSaveConfig = useCallback(async () => {
    if (!configProvider) return
    try {
      await configureProvider({
        id: configProvider.id,
        base_url: configBaseUrl || undefined,
        api_key: configApiKey || undefined,
      })
      await refreshProviders()
      setShowSettings(false)
      setConfigProvider(null)
      addToast('Provider configured', 'success')
    } catch (e: unknown) {
      addToast(`Config failed: ${(e as Error).message}`, 'error')
    }
  }, [configProvider, configBaseUrl, configApiKey, refreshProviders, addToast])

  const handleTestProvider = useCallback(async () => {
    if (!configProvider) return
    setTesting(true)
    setTestResult(null)
    try {
      if (configApiKey) {
        await configureProvider({
          id: configProvider.id,
          api_key: configApiKey,
          base_url: configBaseUrl || undefined,
        })
      }
      const result = await testProvider(configProvider.id)
      setTestResult(result)
    } catch (e: unknown) {
      setTestResult({ success: false, error: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }, [configProvider, configApiKey, configBaseUrl])

  // ---- Keyboard Shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 's') {
        e.preventDefault()
        if (currentFile && fileModified) handleSaveFile()
      }
      if (mod && e.key === 'n') {
        e.preventDefault()
        handleNewFile()
      }
      if (mod && e.key === 'b') {
        e.preventDefault()
        setShowSidebar((v) => !v)
      }
      if (mod && e.key === 'e') {
        e.preventDefault()
        setViewMode((v) => v === 'editor' ? 'chat' : 'editor')
      }
      if (mod && e.key === 'k') {
        e.preventDefault()
        handleNewConversation()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentFile, fileModified, handleSaveFile, handleNewFile, handleNewConversation])

  // ---- Render ----
  return (
    <div className="h-screen flex flex-col bg-[#0a0a0f]">
      {/* === Header === */}
      <header className="flex items-center justify-between px-4 h-11 bg-[#0d0d14] border-b border-[#2a2a3e] shrink-0">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#6366f1] to-[#4f46e5] flex items-center justify-center text-[11px] shadow-sm">
              CX
            </div>
            <span className="font-bold text-sm text-[#e4e4ed]">CodeX</span>
          </div>

          {/* Separator */}
          <div className="w-px h-4 bg-[#2a2a3e]" />

          {/* Provider & Model Selectors */}
          <div className="flex items-center gap-1">
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value)
                const p = providers.find(pr => pr.id === e.target.value)
                if (p && p.models.length > 0) setSelectedModel(p.models[0].id)
              }}
              className="bg-[#12121a] border border-[#2a2a3e] rounded-lg px-2 py-1 text-xs text-[#c0c0d0] focus:outline-none focus:border-[#6366f1] max-w-[130px] appearance-none cursor-pointer"
              aria-label="Select provider"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.api_key_set ? '' : '(no key)'}
                </option>
              ))}
            </select>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-[#12121a] border border-[#2a2a3e] rounded-lg px-2 py-1 text-xs text-[#c0c0d0] focus:outline-none focus:border-[#6366f1] max-w-[150px] appearance-none cursor-pointer"
              aria-label="Select model"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1">
          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`px-2 py-1 rounded-lg text-xs transition-all ${
              showSidebar ? 'bg-[#6366f1]/15 text-[#818cf8]' : 'text-[#8888a0] hover:text-[#e4e4ed]'
            }`}
            title="Toggle sidebar (Ctrl+B)"
          >
            {showSidebar ? '\u25C0' : '\u25B6'}
          </button>

          {/* Sidebar panel switcher */}
          <div className="flex bg-[#12121a] rounded-lg border border-[#2a2a3e] overflow-hidden">
            <button
              onClick={() => setSidebarPanel('conversations')}
              className={`px-2 py-1 text-xs transition-colors ${
                sidebarPanel === 'conversations'
                  ? 'bg-[#6366f1] text-white'
                  : 'text-[#8888a0] hover:text-[#e4e4ed]'
              }`}
            >
              Chats
            </button>
            <button
              onClick={() => setSidebarPanel('files')}
              className={`px-2 py-1 text-xs transition-colors ${
                sidebarPanel === 'files'
                  ? 'bg-[#6366f1] text-white'
                  : 'text-[#8888a0] hover:text-[#e4e4ed]'
              }`}
            >
              Files
            </button>
          </div>

          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1 rounded-lg text-xs text-[#8888a0] hover:text-[#e4e4ed] hover:bg-[#12121a] transition-all"
            title="Settings"
          >
            {'\u2699'}
          </button>

          {/* Run */}
          <button
            onClick={handleRunCode}
            disabled={!fileContent}
            className="px-3 py-1 bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
            title="Run code"
          >
            {'\u25B6'} Run
          </button>
        </div>
      </header>

      {/* === Body === */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        {showSidebar && (
          <div className="w-64 shrink-0 flex flex-col">
            {sidebarPanel === 'conversations' ? (
              <ConversationSidebar
                activeId={conversationId}
                onSelect={handleSelectConversation}
                onNew={handleNewConversation}
                onRefresh={handleRefreshSidebar}
                refreshKey={sidebarRefreshKey}
              />
            ) : (
              <FileExplorer
                currentFile={currentFile}
                onFileSelect={handleFileSelect}
                onFileDeleted={handleFileDeleted}
                onNewFile={handleNewFile}
              />
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor Tabs (when file is open) */}
          {currentFile && (
            <div className="flex items-center gap-1 px-2 h-9 bg-[#0d0d14] border-b border-[#2a2a3e] shrink-0">
              <button
                onClick={() => setViewMode('editor')}
                className={`px-3 py-1 rounded-t-lg text-xs transition-all ${
                  viewMode === 'editor'
                    ? 'bg-[#0a0a0f] text-[#e4e4ed] border-t border-x border-[#2a2a3e]'
                    : 'text-[#8888a0] hover:text-[#e4e4ed]'
                }`}
              >
                {'\u{1F4C4}'} {currentFile.split('/').pop()}
                {fileModified && <span className="ml-1.5 text-[#f59e0b]">{'\u25CF'}</span>}
              </button>
              <button
                onClick={() => setViewMode('chat')}
                className={`px-3 py-1 rounded-t-lg text-xs transition-all ${
                  viewMode === 'chat'
                    ? 'bg-[#0a0a0f] text-[#e4e4ed] border-t border-x border-[#2a2a3e]'
                    : 'text-[#8888a0] hover:text-[#e4e4ed]'
                }`}
              >
                {'\u{1F4AC}'} Chat
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSaveFile}
                disabled={!fileModified}
                className="px-2 py-0.5 text-xs text-[#8888a0] hover:text-[#e4e4ed] disabled:opacity-30 transition-colors"
              >
                Save
              </button>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {viewMode === 'editor' && currentFile ? (
              <CodeEditor
                value={fileContent}
                filename={currentFile}
                onChange={handleFileChange}
                onSave={handleSaveFile}
              />
            ) : (
              <ChatPanel
                messages={messages}
                onSendMessage={handleSendMessage}
                loading={loading}
                onApplyCode={handleApplyCode}
                conversationId={conversationId}
              />
            )}
          </div>
        </div>
      </div>

      {/* === New File Modal === */}
      {showNewFile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" role="dialog" aria-label="New file">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl p-6 w-96 shadow-2xl">
            <h3 className="text-sm font-bold text-[#e4e4ed] mb-4">Create New File</h3>
            <input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
              placeholder="filename.py"
              className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl px-3 py-2.5 text-sm text-[#e4e4ed] placeholder-[#555570] focus:outline-none focus:border-[#6366f1] transition-colors"
              autoFocus
              aria-label="New file name"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFile(false)} className="px-4 py-2 text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors">Cancel</button>
              <button onClick={handleCreateFile} className="px-4 py-2 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-xl text-xs font-medium transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* === Settings Modal === */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" role="dialog" aria-label="Settings">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl p-6 w-[560px] max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#e4e4ed]">{'\u2699'} Model Providers</h3>
              <button onClick={() => setShowSettings(false)} className="text-[#8888a0] hover:text-[#e4e4ed] text-lg transition-colors">{'\u2715'}</button>
            </div>

            <div className="space-y-2">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 bg-[#1a1a2e] rounded-xl border border-[#2a2a3e] hover:border-[#6366f1]/50 transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#e4e4ed] font-medium">{p.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        p.api_key_set ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-[#f59e0b]/10 text-[#f59e0b]'
                      }`}>
                        {p.api_key_set ? 'Configured' : 'No Key'}
                      </span>
                    </div>
                    <div className="text-xs text-[#8888a0] mt-0.5 truncate">{p.base_url}</div>
                  </div>
                  <button
                    onClick={() => handleOpenConfig(p)}
                    className="px-3 py-1.5 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg text-xs font-medium transition-colors shrink-0 ml-3"
                  >
                    Configure
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === Provider Config Modal === */}
      {configProvider && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]" role="dialog" aria-label="Provider config">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-2xl p-6 w-[480px] shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#e4e4ed]">Configure {configProvider.name}</h3>
              <button onClick={() => setConfigProvider(null)} className="text-[#8888a0] hover:text-[#e4e4ed] text-lg transition-colors">{'\u2715'}</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[#8888a0] mb-1 font-medium">API Base URL</label>
                <input
                  value={configBaseUrl}
                  onChange={(e) => setConfigBaseUrl(e.target.value)}
                  className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl px-3 py-2.5 text-sm text-[#e4e4ed] focus:outline-none focus:border-[#6366f1] transition-colors"
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8888a0] mb-1 font-medium">API Key</label>
                <input
                  value={configApiKey}
                  onChange={(e) => setConfigApiKey(e.target.value)}
                  type="password"
                  className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl px-3 py-2.5 text-sm text-[#e4e4ed] focus:outline-none focus:border-[#6366f1] transition-colors"
                  placeholder={configProvider.api_key_set ? '•••••••• (leave blank to keep)' : 'sk-...'}
                />
                <p className="text-xs text-[#555570] mt-1">
                  Or set <code className="px-1 py-0.5 bg-[#1a1a2e] rounded">{configProvider.api_key_env}</code> in .env
                </p>
              </div>

              <div>
                <label className="block text-xs text-[#8888a0] mb-1 font-medium">Available Models</label>
                <div className="flex flex-wrap gap-1">
                  {configProvider.models.map((m) => (
                    <span key={m.id} className="px-2 py-1 bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg text-xs text-[#c0c0d0]">
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>

              {testResult && (
                <div className={`p-3 rounded-xl text-xs border ${
                  testResult.success
                    ? 'bg-[#22c55e]/5 border-[#22c55e]/20 text-[#22c55e]'
                    : 'bg-[#ef4444]/5 border-[#ef4444]/20 text-[#ef4444]'
                }`}>
                  {testResult.success ? '\u2705 Connection successful!' : `\u274C ${testResult.error}`}
                </div>
              )}

              <div className="flex justify-between pt-1">
                <button
                  onClick={handleTestProvider}
                  disabled={testing}
                  className="px-4 py-2 bg-[#1a1a2e] border border-[#2a2a3e] text-[#c0c0d0] hover:text-[#e4e4ed] rounded-xl text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {testing ? 'Testing...' : '\u{1F50D} Test Connection'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfigProvider(null)}
                    className="px-4 py-2 text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    className="px-4 py-2 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-xl text-xs font-medium transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  )
}