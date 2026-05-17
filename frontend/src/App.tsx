import { useState, useCallback, useEffect } from 'react'
import ChatPanel from './components/ChatPanel'
import CodeEditor from './components/CodeEditor'
import FileExplorer from './components/FileExplorer'
import { sendMessage, writeFile, executeCode, getProviders, configureProvider, testProvider } from './api'
import type { ChatMessage, CodeBlock } from './types'
import type { ProviderInfo } from './api'

type Tab = 'chat' | 'editor'

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [fileModified, setFileModified] = useState(false)
  const [showExplorer, setShowExplorer] = useState(true)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string>('deepseek')
  const [selectedModel, setSelectedModel] = useState<string>('deepseek-chat')
  const [newFileName, setNewFileName] = useState('')
  const [showNewFile, setShowNewFile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [configProvider, setConfigProvider] = useState<ProviderInfo | null>(null)
  const [configApiKey, setConfigApiKey] = useState('')
  const [configBaseUrl, setConfigBaseUrl] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const refreshProviders = useCallback(async () => {
    try {
      const list = await getProviders()
      setProviders(list)
    } catch (e) {
      console.error('Failed to load providers:', e)
    }
  }, [])

  useEffect(() => {
    refreshProviders()
  }, [refreshProviders])

  const currentProvider = providers.find(p => p.id === selectedProvider)
  const availableModels = currentProvider?.models || []

  const handleSendMessage = useCallback(async (message: string) => {
    const userMsg: ChatMessage = { role: 'user', content: message }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const contextFiles = currentFile ? [currentFile] : undefined
      const result = await sendMessage(message, conversationId, selectedProvider, selectedModel, contextFiles)
      setConversationId(result.conversation_id)

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.reply,
        toolCalls: result.tool_calls?.map((tc) => ({
          tool: tc.tool,
          args: tc.args,
          result: tc.result,
        })),
        codeBlocks: result.code_blocks || undefined,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch (e: any) {
      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `❌ 错误: ${e.message}`,
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }, [conversationId, selectedProvider, selectedModel, currentFile])

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
    } catch (e) {
      console.error('Save failed:', e)
    }
  }, [currentFile, fileContent])

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
    } catch (e) {
      console.error('Create file failed:', e)
    }
  }, [newFileName])

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
    } catch (e) {
      console.error('Apply code failed:', e)
    }
  }, [])

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
        content: `▶️ 执行 ${currentFile}\n\n${
          result.success
            ? `✅ 执行成功\n\`\`\`\n${result.stdout || '(无输出)'}\n\`\`\``
            : `❌ 执行失败\n\`\`\`\n${result.stderr || result.output || '未知错误'}\n\`\`\``
        }`,
      }
      setMessages((prev) => [...prev, outputMsg])
      setActiveTab('chat')
    } catch (e: any) {
      console.error('Execute failed:', e)
    } finally {
      setLoading(false)
    }
  }, [fileContent, currentFile])

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
    } catch (e) {
      console.error('Save config failed:', e)
    }
  }, [configProvider, configBaseUrl, configApiKey, refreshProviders])

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
    } catch (e: any) {
      setTestResult({ success: false, error: e.message })
    } finally {
      setTesting(false)
    }
  }, [configProvider, configApiKey, configBaseUrl])

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部导航栏 */}
      <header className="flex items-center justify-between px-4 h-11 bg-[#12121a] border-b border-[#2a2a3e] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg">⚡</span>
          <span className="font-bold text-sm text-[#e4e4ed]">Wsygqy</span>
          <div className="flex items-center gap-1">
            <select
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value)
                const p = providers.find(pr => pr.id === e.target.value)
                if (p && p.models.length > 0) {
                  setSelectedModel(p.models[0].id)
                }
              }}
              className="bg-[#1a1a2e] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-[#c0c0d0] focus:outline-none focus:border-[#6366f1] max-w-[120px]"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.api_key_set ? '✓' : '⚠'}
                </option>
              ))}
            </select>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-[#1a1a2e] border border-[#2a2a3e] rounded px-2 py-1 text-xs text-[#c0c0d0] focus:outline-none focus:border-[#6366f1] max-w-[160px]"
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
          >
            文件
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1 rounded text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors"
          >
            ⚙ 设置
          </button>
          <button
            onClick={handleRunCode}
            disabled={!fileContent}
            className="px-3 py-1 bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-40 text-white rounded text-xs font-medium transition-colors"
          >
            ▶ 运行
          </button>
        </div>
      </header>

      {/* 主体内容 */}
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
              >
                📄 {currentFile.split('/').pop()}
                {fileModified && <span className="ml-1 text-[#f59e0b]">●</span>}
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`px-3 py-1 rounded-t text-xs transition-colors ${
                  activeTab === 'chat'
                    ? 'bg-[#0a0a0f] text-[#e4e4ed] border-t border-x border-[#2a2a3e]'
                    : 'text-[#8888a0] hover:text-[#e4e4ed]'
                }`}
              >
                💬 对话
              </button>
              <div className="flex-1" />
              <button
                onClick={handleSaveFile}
                disabled={!fileModified}
                className="px-2 py-0.5 text-xs text-[#8888a0] hover:text-[#e4e4ed] disabled:opacity-40 transition-colors"
              >
                保存
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
                loading={loading}
              />
            )}
          </div>
        </div>
      </div>

      {/* 新建文件对话框 */}
      {showNewFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-xl p-6 w-96">
            <h3 className="text-sm font-bold text-[#e4e4ed] mb-4">新建文件</h3>
            <input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
              placeholder="文件名 (例如: main.py)"
              className="w-full bg-[#1a1a2e] border border-[#2a2a3e] rounded-lg px-3 py-2 text-sm text-[#e4e4ed] placeholder-[#555570] focus:outline-none focus:border-[#6366f1]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFile(false)} className="px-4 py-2 text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors">取消</button>
              <button onClick={handleCreateFile} className="px-4 py-2 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg text-xs font-medium transition-colors">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 设置对话框 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-xl p-6 w-[560px] max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#e4e4ed]">⚙ 模型提供商设置</h3>
              <button onClick={() => setShowSettings(false)} className="text-[#8888a0] hover:text-[#e4e4ed] text-lg">✕</button>
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
                        {p.api_key_set ? '已配置' : '未配置'}
                      </span>
                    </div>
                    <div className="text-xs text-[#8888a0] mt-0.5 truncate">{p.base_url}</div>
                    <div className="text-xs text-[#555570] mt-0.5">
                      {p.models.length} 个模型: {p.models.slice(0, 3).map(m => m.name).join(', ')}{p.models.length > 3 ? '...' : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleOpenConfig(p)}
                    className="px-3 py-1.5 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded text-xs font-medium transition-colors shrink-0"
                  >
                    配置
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 提供商配置对话框 */}
      {configProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-[#12121a] border border-[#2a2a3e] rounded-xl p-6 w-[480px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[#e4e4ed]">配置 {configProvider.name}</h3>
              <button onClick={() => { setShowSettings(true); setConfigProvider(null); }} className="text-[#8888a0] hover:text-[#e4e4ed] text-lg">✕</button>
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
                  placeholder={configProvider.api_key_set ? '已配置 (留空保持不变)' : '输入 API Key'}
                />
                <p className="text-xs text-[#555570] mt-1">
                  环境变量: {configProvider.api_key_env} (也可在 .env 文件中设置)
                </p>
              </div>

              <div>
                <label className="block text-xs text-[#8888a0] mb-1">可用模型</label>
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
                  {testResult.success ? '✅ 连接成功！模型响应正常。' : `❌ 连接失败: ${testResult.error}`}
                </div>
              )}

              <div className="flex justify-between">
                <button
                  onClick={handleTestProvider}
                  disabled={testing}
                  className="px-4 py-2 bg-[#1a1a2e] border border-[#2a2a3e] text-[#c0c0d0] hover:text-[#e4e4ed] rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                >
                  {testing ? '测试中...' : '🔍 测试连接'}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowSettings(true); setConfigProvider(null); }}
                    className="px-4 py-2 text-xs text-[#8888a0] hover:text-[#e4e4ed] transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    className="px-4 py-2 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    保存
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