import { useState, useCallback, useEffect, useRef } from 'react'
import ChatPanel, { loadPersistedConversations, persistConversation } from './components/ChatPanel'
import CodeEditor from './components/CodeEditor'
import FileExplorer from './components/FileExplorer'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider, useToast } from './components/Toast'
import {
  sendMessageStream, writeFile, executeCode, getProviders,
  configureProvider, testProvider, type StreamEvent,
} from './api'
import type { ChatMessage } from './types'
import type { ProviderInfo } from './api'

type Tab = 'chat' | 'editor'

function AppContent() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadPersistedConversations()
    const keys = Object.keys(saved)
    if (keys.length > 0) return saved[keys[0]] || []
    return []
  })
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => Object.keys(loadPersistedConversations())[0] || undefined
  )
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileModified, setFileModified] = useState(false)
  const [showExplorer, setShowExplorer] = useState(true)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selectedProvider, setSelectedProvider] = useState('deepseek')
  const [selectedModel, setSelectedModel] = useState('deepseek-chat')
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [configProvider, setConfigProvider] = useState<ProviderInfo | null>(null)
  const [configApiKey, setConfigApiKey] = useState('')
  const [configBaseUrl, setConfigBaseUrl] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const { addToast } = useToast()

  const refreshProviders = useCallback(async () => {
    try {
      const list = await getProviders()
      setProviders(list)
    } catch {
      // silent
    }
  }, [])

  useEffect(() => { refreshProviders() }, [refreshProviders])

  const currentProvider = providers.find(p => p.id === selectedProvider)
  const availableModels = currentProvider?.models || []

  const persistMessages = useCallback((convId: string, msgs: ChatMessage[]) => {
    if (convId && msgs.length > 0) {
      persistConversation(convId, msgs)
    }
  }, [])

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
                toolCalls: toolCalls.map(t => ({
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
      }

      if (finalEvent.type === 'error') {
        const errMsg = typeof finalEvent.error === 'string' ? finalEvent.error : 'Unknown error'
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant') {
            next[next.length - 1] = { ...last, content: `Error: ${errMsg}` }
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
          if (finalEvent.conversation_id) {
            persistConversation(finalEvent.conversation_id, next)
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
            next[next.length - 1] = { ...last, content: `Error: ${msg}` }
          }
          return next
        })
        addToast(msg, 'error')
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [handleStreamMessage, addToast])

  const handleFileSelect = useCallback((path: string, content: string) => {
    setCurrentFile(path)
    setFileContent(content)
    setFileModified(false)
    setActiveTab('editor')
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
      setActiveTab('editor')
      setShowNewFile(false)
      setNewFileName('')
      addToast('File created', 'success')
    } catch (e: unknown) {
      addToast(`Create failed: ${(e as Error).message}`, 'error')
    }
  }, [newFileName, addToast])

  const handleApplyCode = useCallback(async (code: string, lang: string) => {
    const extMap: Record<string, string> = {
      python: '.py', javascript: '.js', typescript: '.ts',
      java: '.java', cpp: '.cpp', go: '.go', rust: '.rs',
      json: '.json', html: '.html', css: '.css',
    }
    const filename = `generated_${Date.now()}${extMap[lang] || '.txt'}`
    try {
      await writeFile(filename, code)
      setCurrentFile(filename)
      setFileContent(code)
      setFileModified(false)
      setActiveTab('editor')
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
        content: `\u25B6\uFE0F Execute ${currentFile}\n\n${
          result.success
            ? `\u2705 Success\n\`\`\`\n${result.stdout || '(no output)'}\n\`\`\``
            : `\u274C Failed\n\`\`\`\n${result.stderr || result.output || 'Unknown error'}\n\`\`\``
        }`,
      }
      setMessages((prev) => [...prev, outputMsg])
      setActiveTab('chat')
      if (result.success) {
        addToast('Code executed successfully', 'success')
      } else {
        addToast('Code execution failed', 'error')
      }
    } catch (e: unknown) {
      addToast(`Execution error: ${(e as Error).message}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [fileContent, currentFile, addToast])

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
        setShowExplorer((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentFile, fileModified, handleSaveFile, handleNewFile])

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-4 h-11 bg-[#12121a] border-b border-[#2a2a3e] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg">{'\u26A1'}</span>
          <span className="font-bold text-sm text-[#e4e4ed]">Wsygqy</span>
          <div className="flex items-center gap-1">
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value)
                const p = providers.find(pr => pr.id === e.target.value)
                if (p && p.models.length > 0) setSelectedModel(p.models[0].id)
              }}
              className="bg-[#1a1a2e] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-[#c0c0d0] focus:outline-none focus:border-[#6366f1] max-w-[120px]"
              aria-label="Select provider"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.api_key_set ? '\u2713' : '\u26A0'}
                </option>
              ))}
            </select>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-[#1a1a2e] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-[#c0c0d0] focus:outline-none focus:border-[#6366f1] max-w-[160px]"
              aria-label="Select model"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className={`px-2 py-1 rounded text-xs transition-colors ${
              showExplorer ? 'bg-[#6366f1] text-white' : 'text-[#8888a0] hover:text-[#e4e4ed]'
            }`}
            title="Toggle file explorer (Ctrl+B)"
            aria-label="Toggle file explorer"
          >
            Files
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1 rounded text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors"
            aria-label="Open settings"
          >
            {'\u2699'} Settings
          </button>
          <button
            onClick={handleRunCode}
            disabled={!fileContent}
            className="px-3 py-1 bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-40 text-white rounded text-xs font-medium transition-colors"
            aria-label="Run code"
          >
            {'\u25B6'} Run
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {showExplorer && (
          <div className="w-56 shrink-0">
            <FileExplorer
              currentFile={currentFile}
              onFileSelect={handleFileSelect}
              onFileDeleted={handleFileDeleted}
              onNewFile={handleNewFile}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {currentFile && (
            <div className="flex items-center gap-1 px-2 h-9 bg-[#12121a] border-b border-[#2a2a3e] shrink-0">
              <button
                onClick={() => setActiveTab('editor')}
                className={`px-3 py-1 rounded-t text-xs transition-colors ${
                  activeTab === 'editor'
                    ? 'bg-[#0a0a0f] text-[#e4e4ed] border-t border-x border-[#2a2a3e]'
                    : 'text-[#8888a0] hover:text-[#e4e4ed]'
                }`}
                aria-label="Editor tab"
              >
                {'\u{1F4C4}'} {currentFile.split('/').pop()}
                {fileModified && <span className="ml-1 text-[#f59e0b]">{'\u25CF'}</span>}
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`px-3 py-1 rounded-t text-xs transition-colors ${
                  activeTab === 'chat'
                    ? 'bg-[#0a0a0f] text-[#e4e4ed] border-t border-x border-[#2a2a3e]'
                    : 'text-[#8888a0] hover:text-[#e4e4ed]'
                }`}
                aria-label="Chat tab"
              >
                {'\u{1F4AC}'} Chat
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSaveFile}
                disabled={!fileModified}
                className="px-2 py-0.5 text-xs text-[#8888a0] hover:text-[#e4e4ed] disabled:opacity-40 transition-colors"
                aria-label="Save file"
              >
                Save
              </button>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {activeTab === 'editor' && currentFile ? (
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
                onStreamMessage={handleStreamMessage}
                loading={loading}
                onApplyCode={handleApplyCode}
              />
            )}
          </div>
        </div>
      </div>

      {showNewFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-label="New file">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-xl p-6 w-96">
            <h3 className="text-sm font-bold text-[#e4e4ed] mb-4">New File</h3>
            <input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
              placeholder="Filename (e.g. main.py)"
              className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm text-[#e4e4ed] placeholder-[#555570] focus:outline-none focus:border-[#6366f1]"
              autoFocus
              aria-label="New file name"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFile(false)} className="px-4 py-2 text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors">Cancel</button>
              <button onClick={handleCreateFile} className="px-4 py-2 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg text-xs font-medium transition-colors">Create</button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-label="Settings">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-xl p-6 w-[560px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#e4e4ed]">{'\u2699'} Model Providers</h3>
              <button onClick={() => setShowSettings(false)} className="text-[#8888a0] hover:text-[#e4e4ed] text-lg" aria-label="Close settings">{'\u2715'}</button>
            </div>

            <div className="space-y-2">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 bg-[#1a1a2e] rounded-lg border border-[#2a2a3e] hover:border-[#6366f1] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[#e4e4ed] font-medium">{p.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        p.api_key_set ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'bg-[#f59e0b]/20 text-[#f59e0b]'
                      }`}>
                        {p.api_key_set ? 'Configured' : 'Not configured'}
                      </span>
                    </div>
                    <div className="text-xs text-[#8888a0] mt-0.5 truncate">{p.base_url}</div>
                    <div className="text-xs text-[#555570] mt-0.5">
                      {p.models.length} models: {p.models.slice(0, 3).map(m => m.name).join(', ')}{p.models.length > 3 ? '...' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleOpenConfig(p)}
                    className="px-3 py-1.5 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded text-xs font-medium transition-colors shrink-0"
                  >
                    Configure
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {configProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" role="dialog" aria-label="Provider config">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-xl p-6 w-[480px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#e4e4ed]">Configure {configProvider.name}</h3>
              <button onClick={() => { setShowSettings(true); setConfigProvider(null); }} className="text-[#8888a0] hover:text-[#e4e4ed] text-lg" aria-label="Close">{'\u2715'}</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[#8888a0] mb-1">API Base URL</label>
                <input
                  value={configBaseUrl}
                  onChange={(e) => setConfigBaseUrl(e.target.value)}
                  className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm text-[#e4e4ed] focus:outline-none focus:border-[#6366f1]"
                  placeholder="https://api.example.com/v1"
                />
              </div>

              <div>
                <label className="block text-xs text-[#8888a0] mb-1">API Key</label>
                <input
                  value={configApiKey}
                  onChange={(e) => setConfigApiKey(e.target.value)}
                  type="password"
                  className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm text-[#e4e4ed] focus:outline-none focus:border-[#6366f1]"
                  placeholder={configProvider.api_key_set ? 'Configured (leave blank to keep)' : 'Enter API Key'}
                />
                <p className="text-xs text-[#555570] mt-1">
                  Env var: {configProvider.api_key_env} (or set in .env file)
                </p>
              </div>

              <div>
                <label className="block text-xs text-[#8888a0] mb-1">Available Models</label>
                <div className="flex flex-wrap gap-1">
                  {configProvider.models.map((m) => (
                    <span key={m.id} className="px-2 py-1 bg-[#1a1a2e] border border-[#2a2a3e] rounded text-xs text-[#c0c0d0]">
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>

              {testResult && (
                <div className={`p-3 rounded-lg text-xs ${
                  testResult.success ? 'bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/30' : 'bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/30'
                }`}>
                  {testResult.success ? '\u2705 Connection successful!' : `\u274C Connection failed: ${testResult.error}`}
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={handleTestProvider}
                  disabled={testing}
                  className="px-4 py-2 bg-[#1a1a2e] border border-[#2a2a3e] text-[#c0c0d0] hover:text-[#e4e4ed] rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {testing ? 'Testing...' : '\u{1F50D} Test Connection'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowSettings(true); setConfigProvider(null); }}
                    className="px-4 py-2 text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    className="px-4 py-2 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg text-xs font-medium transition-colors"
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