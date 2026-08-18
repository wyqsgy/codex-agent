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

// Security scan finding types
export type Severity = "critical" | "high" | "medium" | "low" | "info"

export interface SecurityFinding {
  category?: string
  type?: string
  severity: Severity
  file: string
  line: number
  snippet?: string
  match?: string
  context?: string
  description?: string
  source?: string
}

export interface ScanResult {
  findings: SecurityFinding[]
  stats: {
    files_scanned: number
    total_findings: number
    severity_counts: Record<Severity, number>
  }
  bandit?: {
    success: boolean
    count?: number
    error?: string
  } | null
}

export interface DependencyResult {
  python?: {
    findings?: Array<{ package: string; version?: string; vulnerability: string; severity: string; source: string }>
    count?: number
    success?: boolean
    error?: string
  } | null
  nodejs?: {
    findings?: Array<{ package: string; severity: string; vulnerability: string; source: string }>
    count?: number
    success?: boolean
    error?: string
  } | null
  builtin_check?: {
    findings?: Array<{ package: string; severity: string; vulnerability: string; source: string }>
    count?: number
  } | null
}

export interface SecretFinding {
  type: string
  severity: Severity
  line: number
  match: string
  context: string
  file: string
}