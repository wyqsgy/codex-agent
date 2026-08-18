import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Language = 'zh' | 'en'

const STORAGE_KEY = 'codex-language'

// 翻译字典：key -> { zh, en }
const dict: Record<string, { zh: string; en: string }> = {
  // ---- 品牌 / 通用 ----
  'brand.short': { zh: 'CodeX', en: 'CodeX' },
  'brand.full': { zh: 'CodeX 安全 Agent', en: 'CodeX Security Agent' },
  'common.save': { zh: '保存', en: 'Save' },
  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.error': { zh: '错误', en: 'Error' },

  // ---- 顶部栏 / 导航 ----
  'nav.chats': { zh: '会话', en: 'Chats' },
  'nav.files': { zh: '文件', en: 'Files' },
  'nav.settings': { zh: '设置', en: 'Settings' },
  'nav.run': { zh: '运行', en: 'Run' },
  'nav.toggleSidebar': { zh: '切换侧边栏 (Ctrl+B)', en: 'Toggle sidebar (Ctrl+B)' },
  'nav.selectProvider': { zh: '选择提供商', en: 'Select provider' },
  'nav.selectModel': { zh: '选择模型', en: 'Select model' },
  'provider.noKey': { zh: '(未配置)', en: '(no key)' },
  'editor.tab.chat': { zh: '对话', en: 'Chat' },

  // ---- 新建文件弹窗 ----
  'newFile.title': { zh: '新建文件', en: 'Create New File' },
  'newFile.placeholder': { zh: '文件名.py', en: 'filename.py' },
  'newFile.create': { zh: '创建', en: 'Create' },

  // ---- 设置弹窗 ----
  'settings.title': { zh: '模型提供商', en: 'Model Providers' },
  'settings.configured': { zh: '已配置', en: 'Configured' },
  'settings.noKey': { zh: '未配置', en: 'No Key' },
  'settings.configure': { zh: '配置', en: 'Configure' },

  // ---- 提供商配置弹窗 ----
  'config.title': { zh: '配置 {name}', en: 'Configure {name}' },
  'config.baseUrl': { zh: 'API 地址', en: 'API Base URL' },
  'config.apiKey': { zh: 'API 密钥', en: 'API Key' },
  'config.apiKeyPlaceholder': { zh: '•••••••• (留空保持不变)', en: '•••••••• (leave blank to keep)' },
  'config.models': { zh: '可用模型', en: 'Available Models' },
  'config.envHint': { zh: '或在 .env 中设置 {env}', en: 'Or set {env} in .env' },
  'config.testSuccess': { zh: '\u2705 连接成功！', en: '\u2705 Connection successful!' },
  'config.test': { zh: '\u{1F50D} 测试连接', en: '\u{1F50D} Test Connection' },
  'config.testing': { zh: '测试中...', en: 'Testing...' },

  // ---- Toasts ----
  'toast.loadConvFailed': { zh: '加载会话失败', en: 'Failed to load conversation' },
  'toast.cancelled': { zh: '请求已取消', en: 'Request cancelled' },
  'toast.fileSaved': { zh: '文件已保存', en: 'File saved' },
  'toast.saveFailed': { zh: '保存失败：{msg}', en: 'Save failed: {msg}' },
  'toast.fileCreated': { zh: '文件已创建', en: 'File created' },
  'toast.createFailed': { zh: '创建失败：{msg}', en: 'Create failed: {msg}' },
  'toast.codeApplied': { zh: '代码已应用到文件', en: 'Code applied to file' },
  'toast.applyFailed': { zh: '应用失败：{msg}', en: 'Apply failed: {msg}' },
  'toast.execSuccess': { zh: '代码执行成功', en: 'Code executed successfully' },
  'toast.execFailed': { zh: '代码执行失败', en: 'Code execution failed' },
  'toast.execError': { zh: '执行错误：{msg}', en: 'Execution error: {msg}' },
  'toast.providerConfigured': { zh: '提供商已配置', en: 'Provider configured' },
  'toast.configFailed': { zh: '配置失败：{msg}', en: 'Config failed: {msg}' },

  // ---- 代码执行结果 ----
  'exec.label': { zh: '执行', en: 'Execute' },
  'exec.success': { zh: '成功', en: 'Success' },
  'exec.noOutput': { zh: '(无输出)', en: '(no output)' },
  'exec.failed': { zh: '失败', en: 'Failed' },
  'exec.unknownError': { zh: '未知错误', en: 'Unknown error' },

  // ---- 欢迎页 ----
  'welcome.subtitle': {
    zh: 'AI 驱动的应用安全审计助手。SAST 静态扫描、密钥检测、依赖漏洞检查与自动化安全修复。',
    en: 'AI-powered application security auditor. SAST scanning, secret detection, dependency vulnerability checks, and automated security code fixes.',
  },
  'suggest.audit.label': { zh: '安全审计', en: 'Security Audit' },
  'suggest.audit.text': { zh: '对工作区代码执行完整安全审计', en: 'Perform a complete security audit of the workspace code' },
  'suggest.secrets.label': { zh: '查找密钥', en: 'Find Secrets' },
  'suggest.secrets.text': { zh: '扫描硬编码的 API 密钥、令牌和密码', en: 'Scan for hardcoded API keys, tokens, and passwords' },
  'suggest.deps.label': { zh: '检查依赖', en: 'Check Dependencies' },
  'suggest.deps.text': { zh: '检查 requirements.txt 与 package.json 中的易受攻击依赖', en: 'Check for vulnerable dependencies in requirements.txt and package.json' },
  'suggest.server.label': { zh: '创建 Web 服务', en: 'Create a web server' },
  'suggest.server.text': { zh: '编写带输入验证的安全 Flask 服务', en: 'Write a secure Flask web server with proper input validation' },
  'suggest.fix.label': { zh: '修复漏洞', en: 'Fix a vulnerability' },
  'suggest.fix.text': { zh: '我的代码有 SQL 注入漏洞，帮我修复', en: 'I have a SQL injection vulnerability in my code, help me fix it' },
  'suggest.review.label': { zh: '代码审查', en: 'Code Review' },
  'suggest.review.text': { zh: '审查代码的安全问题与最佳实践', en: 'Review this code for security issues and best practices violations' },

  // ---- 输入区 ----
  'scan.button': { zh: '\u{1F6E1} 安全扫描', en: '\u{1F6E1} Security Scan' },
  'scan.title': { zh: '运行 SAST 扫描、密钥检测与依赖检查', en: 'Run SAST scan, secret detection, and dependency check' },
  'chat.placeholder': { zh: '向 CodeX 提问... (Shift+Enter 换行)', en: 'Ask CodeX anything... (Shift+Enter for new line)' },
  'chat.stop': { zh: '停止', en: 'Stop' },
  'chat.send': { zh: '发送', en: 'Send' },
  'chat.disclaimer': { zh: 'CodeX 可能生成不准确的信息，请核实重要输出。', en: 'CodeX may produce inaccurate information. Verify important outputs.' },
  'chat.exportMd': { zh: '导出 .md', en: 'Export .md' },
  'chat.exportJson': { zh: '导出 .json', en: 'Export .json' },

  // ---- 工具调用 ----
  'tool.args': { zh: '参数', en: 'Args' },
  'tool.result': { zh: '结果', en: 'Result' },
  'code.apply': { zh: '应用', en: 'Apply' },
  'code.copy': { zh: '复制', en: 'Copy' },
  'code.copied': { zh: '已复制！', en: 'Copied!' },

  // ---- 安全报告 ----
  'severity.critical': { zh: '严重', en: 'critical' },
  'severity.high': { zh: '高危', en: 'high' },
  'severity.medium': { zh: '中危', en: 'medium' },
  'severity.low': { zh: '低危', en: 'low' },
  'severity.info': { zh: '信息', en: 'info' },
  'sec.sast.title': { zh: 'SAST 扫描结果', en: 'SAST Scan Results' },
  'sec.files': { zh: '{n} 个文件', en: '{n} files' },
  'sec.findings': { zh: '{n} 处发现', en: '{n} findings' },
  'sec.sast.empty': { zh: '未发现漏洞，代码库干净。', en: 'No vulnerabilities detected. The codebase looks clean.' },
  'sec.secrets.title': { zh: '检测到硬编码密钥', en: 'Hardcoded Secrets Detected' },
  'sec.found': { zh: '{n} 处', en: '{n} found' },
  'sec.secrets.empty': { zh: '未发现硬编码密钥，凭证管理良好。', en: 'No hardcoded secrets found. Good credential hygiene.' },
  'sec.deps.title': { zh: '依赖漏洞', en: 'Dependency Vulnerabilities' },
  'sec.issues': { zh: '{n} 个问题', en: '{n} issues' },
  'sec.deps.empty': { zh: '未发现已知依赖漏洞。', en: 'No known dependency vulnerabilities detected.' },
  'sec.match': { zh: '匹配：', en: 'Match:' },
  'sec.source': { zh: '来源：{src}', en: 'Source: {src}' },
  'sec.unknown': { zh: '未知', en: 'Unknown' },
  'sec.export': { zh: '导出 HTML 报告', en: 'Export HTML Report' },

  // ---- 状态栏 ----
  'status.generating': { zh: '生成中...', en: 'Generating...' },
  'status.ready': { zh: '就绪', en: 'Ready' },
  'status.session': { zh: '会话：{id}', en: 'Session: {id}' },
  'status.messages': { zh: '{n} 条消息', en: '{n} messages' },
  'status.sidebar': { zh: '侧边栏', en: 'Sidebar' },
  'status.unknown': { zh: '未知', en: 'Unknown' },

  // ---- 会话侧边栏 ----
  'conv.title': { zh: '会话', en: 'Conversations' },
  'conv.new': { zh: '新建会话', en: 'New conversation' },
  'conv.search': { zh: '搜索...', en: 'Search...' },
  'conv.defaultTitle': { zh: '新对话', en: 'New Conversation' },
  'conv.delete': { zh: '删除', en: 'Delete' },
  'conv.confirmDelete': { zh: '再次点击确认', en: 'Click again to confirm' },
  'conv.noMatch': { zh: '无匹配的会话', en: 'No matching conversations' },
  'conv.empty': { zh: '暂无会话', en: 'No conversations yet' },
  'conv.start': { zh: '开始新对话', en: 'Start a new chat' },

  // ---- 文件浏览器 ----
  'file.title': { zh: '文件浏览器', en: 'File Explorer' },
  'file.new': { zh: '新建文件', en: 'New file' },
  'file.loading': { zh: '加载中...', en: 'Loading...' },
  'file.delete': { zh: '删除', en: 'Delete' },
  'file.empty': { zh: '工作区为空', en: 'Workspace is empty' },
  'file.emptyHint': { zh: '点击 + 创建文件', en: 'Click + to create a file' },
  'file.confirmDelete': { zh: '确定删除 {path}？', en: 'Delete {path}?' },

  // ---- 会话导出 ----
  'export.title': { zh: 'CodeX 安全审计会话', en: 'CodeX Security Audit Conversation' },
  'export.exportedAt': { zh: '导出于 {time}', en: 'Exported at {time}' },
  'export.you': { zh: '你', en: 'You' },
  'export.codex': { zh: 'CodeX', en: 'CodeX' },
  'export.toolCalls': { zh: '工具调用 ({n})', en: 'Tool Calls ({n})' },
  'export.markdown': { zh: '导出为 Markdown', en: 'Export as Markdown' },
  'export.json': { zh: '导出为 JSON', en: 'Export as JSON' },
}

interface I18nContextValue {
  lang: Language
  setLang: (l: Language) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (k) => k,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved === 'en' ? 'en' : 'zh'
    } catch {
      return 'zh'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch { /* ignore */ }
  }, [lang])

  const setLang = useCallback((l: Language) => setLangState(l), [])

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const entry = dict[key]
      let s = entry ? entry[lang] : key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          s = s.split(`{${k}}`).join(String(v))
        }
      }
      return s
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}