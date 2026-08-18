import { memo, useState } from 'react'
import type { SecurityFinding, ScanResult, DependencyResult, SecretFinding } from '../types'

// ---------------------------------------------------------------------------
// 严重级别颜色
// ---------------------------------------------------------------------------
const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  critical: { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]', border: 'border-[#ef4444]/30', dot: 'bg-[#ef4444]' },
  high:     { bg: 'bg-[#f97316]/10', text: 'text-[#f97316]', border: 'border-[#f97316]/30', dot: 'bg-[#f97316]' },
  medium:   { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]', border: 'border-[#f59e0b]/30', dot: 'bg-[#f59e0b]' },
  low:      { bg: 'bg-[#3b82f6]/10', text: 'text-[#3b82f6]', border: 'border-[#3b82f6]/30', dot: 'bg-[#3b82f6]' },
  info:     { bg: 'bg-[#6b7280]/10', text: 'text-[#6b7280]', border: 'border-[#6b7280]/30', dot: 'bg-[#6b7280]' },
}

function SeverityBadge({ severity }: { severity: string }) {
  const c = SEVERITY_COLORS[severity] || SEVERITY_COLORS.info
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${c.bg} ${c.text} border ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {severity}
    </span>
  )
}

// ---------------------------------------------------------------------------
// SAST 扫描结果
// ---------------------------------------------------------------------------
interface ScanResultViewProps {
  data: ScanResult
}

const ScanResultView = memo(function ScanResultView({ data }: ScanResultViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const grouped = groupBySeverity(data.findings)

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  return (
    <div className="my-2 rounded-lg border border-[#2a2a3e] bg-[#0a0a0f] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1a1a2e] border-b border-[#2a2a3e]">
        <div className="flex items-center gap-2">
          <span className="text-[14px]">🛡️</span>
          <span className="text-xs font-semibold text-[#e4e4ed]">SAST Scan Results</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#8888a0]">
          <span>{data.stats.files_scanned} files</span>
          <span>·</span>
          <span>{data.stats.total_findings} findings</span>
        </div>
      </div>

      {/* Severity Summary */}
      <div className="flex gap-3 px-4 py-2 bg-[#12121a] border-b border-[#2a2a3e]">
        {(['critical', 'high', 'medium', 'low'] as const).map(s => (
          <div key={s} className="flex items-center gap-1">
            <SeverityBadge severity={s} />
            <span className="text-[11px] text-[#8888a0]">{data.stats.severity_counts[s] || 0}</span>
          </div>
        ))}
      </div>

      {/* Findings */}
      {data.findings.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[#555570]">
          No vulnerabilities detected. The codebase looks clean.
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto divide-y divide-[#2a2a3e]/50">
          {data.findings.map((f, i) => (
            <div key={i} className="px-4 py-2">
              <div
                className="flex items-center gap-2 cursor-pointer select-none"
                onClick={() => toggle(i)}
              >
                <span className="text-[10px] text-[#555570] transition-transform"
                  style={{ transform: expanded.has(i) ? 'rotate(90deg)' : 'none' }}
                >
                  ▶
                </span>
                <SeverityBadge severity={f.severity} />
                <span className="text-xs text-[#e4e4ed] flex-1 truncate">
                  {f.category || f.type || 'Unknown'}
                </span>
                <span className="text-[10px] text-[#555570] font-mono">
                  {f.file}:{f.line}
                </span>
              </div>
              {expanded.has(i) && (
                <div className="mt-2 ml-5 pl-3 border-l border-[#2a2a3e] space-y-1.5">
                  {f.description && (
                    <p className="text-[11px] text-[#a0a0b8]">{f.description}</p>
                  )}
                  <pre className="text-[11px] text-[#8888a0] bg-[#12121a] px-2 py-1 rounded overflow-x-auto">
                    {f.snippet || f.context || ''}
                  </pre>
                  {f.source && f.source !== 'built-in patterns' && (
                    <span className="text-[10px] text-[#555570] italic">Source: {f.source}</span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// 密钥检测结果
// ---------------------------------------------------------------------------
interface SecretsResultViewProps {
  data: SecretFinding[]
}

const SecretsResultView = memo(function SecretsResultView({ data }: SecretsResultViewProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  return (
    <div className="my-2 rounded-lg border border-[#ef4444]/20 bg-[#0a0a0f] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#ef4444]/10 border-b border-[#ef4444]/20">
        <div className="flex items-center gap-2">
          <span className="text-[14px]">🔑</span>
          <span className="text-xs font-semibold text-[#ef4444]">Hardcoded Secrets Detected</span>
        </div>
        <span className="text-[10px] text-[#ef4444]/70">{data.length} found</span>
      </div>

      {data.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[#555570]">
          No hardcoded secrets found. Good credential hygiene.
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto divide-y divide-[#2a2a3e]/50">
          {data.map((f, i) => (
            <div key={i} className="px-4 py-2">
              <div
                className="flex items-center gap-2 cursor-pointer select-none"
                onClick={() => toggle(i)}
              >
                <span className="text-[10px] text-[#555570] transition-transform"
                  style={{ transform: expanded.has(i) ? 'rotate(90deg)' : 'none' }}
                >
                  ▶
                </span>
                <SeverityBadge severity={f.severity} />
                <span className="text-xs text-[#e4e4ed] flex-1 truncate">{f.type}</span>
                <span className="text-[10px] text-[#555570] font-mono">
                  {f.file}:{f.line}
                </span>
              </div>
              {expanded.has(i) && (
                <div className="mt-2 ml-5 pl-3 border-l border-[#ef4444]/20 space-y-1.5">
                  <div className="flex gap-2">
                    <span className="text-[10px] text-[#555570] shrink-0">Match:</span>
                    <code className="text-[11px] text-[#ef4444] break-all">{f.match}</code>
                  </div>
                  <pre className="text-[11px] text-[#8888a0] bg-[#12121a] px-2 py-1 rounded overflow-x-auto">
                    {f.context}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// 依赖漏洞结果
// ---------------------------------------------------------------------------
interface DepsResultViewProps {
  data: DependencyResult
}

const DepsResultView = memo(function DepsResultView({ data }: DepsResultViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const allFindings = [
    ...(data.builtin_check?.findings || []).map(f => ({ ...f, source: 'builtin' })),
    ...(data.python?.findings || []).map(f => ({ ...f, source: 'pip-audit' })),
    ...(data.nodejs?.findings || []).map(f => ({ ...f, source: 'npm-audit' })),
  ]

  return (
    <div className="my-2 rounded-lg border border-[#f59e0b]/20 bg-[#0a0a0f] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#f59e0b]/10 border-b border-[#f59e0b]/20">
        <div className="flex items-center gap-2">
          <span className="text-[14px]">📦</span>
          <span className="text-xs font-semibold text-[#f59e0b]">Dependency Vulnerabilities</span>
        </div>
        <span className="text-[10px] text-[#f59e0b]/70">{allFindings.length} issues</span>
      </div>

      {allFindings.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[#555570]">
          No known dependency vulnerabilities detected.
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto divide-y divide-[#2a2a3e]/50">
          {allFindings.map((f, i) => {
            const key = `${f.package}-${i}`
            const sev = f.severity || 'medium'
            return (
              <div key={key} className="px-4 py-2">
                <div
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => toggle(key)}
                >
                  <span className="text-[10px] text-[#555570] transition-transform"
                    style={{ transform: expanded.has(key) ? 'rotate(90deg)' : 'none' }}
                  >
                    ▶
                  </span>
                  <SeverityBadge severity={sev} />
                  <span className="text-xs text-[#e4e4ed] font-mono flex-1 truncate">{f.package}</span>
                  <span className="text-[10px] text-[#555570]">{f.source}</span>
                </div>
                {expanded.has(key) && (
                  <div className="mt-2 ml-5 pl-3 border-l border-[#f59e0b]/20 space-y-1.5">
                    <p className="text-[11px] text-[#f59e0b]">{f.vulnerability}</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// HTML 安全报告导出
// ---------------------------------------------------------------------------
function exportToHTML(
  scanResult: ScanResult | null,
  secretsResult: SecretFinding[] | null,
  depsResult: DependencyResult | null,
) {
  const now = new Date().toLocaleString()
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CodeX Security Report — ${now}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e4e4ed; padding: 2rem; }
    h1 { color: #6366f1; margin-bottom: .25rem; }
    .meta { color: #555570; font-size: .8rem; margin-bottom: 2rem; }
    .section { margin-bottom: 2rem; border: 1px solid #2a2a3e; border-radius: 8px; overflow: hidden; }
    .section-title { padding: .75rem 1rem; font-weight: 600; font-size: .9rem; }
    .finding { padding: .5rem 1rem; border-top: 1px solid #2a2a3e50; }
    .badge { display: inline-block; padding: .1rem .5rem; border-radius: 4px; font-size: .7rem; font-weight: 700; text-transform: uppercase; }
    .badge-critical { background: #ef444420; color: #ef4444; }
    .badge-high { background: #f9731620; color: #f97316; }
    .badge-medium { background: #f59e0b20; color: #f59e0b; }
    .badge-low { background: #3b82f620; color: #3b82f6; }
    pre { background: #12121a; padding: .5rem; border-radius: 4px; font-size: .75rem; overflow-x: auto; margin-top: .25rem; }
    .file { color: #8888a0; font-size: .75rem; font-family: monospace; }
  </style>
</head>
<body>
  <h1>🔒 CodeX Security Report</h1>
  <p class="meta">Generated: ${now}</p>`

  if (scanResult) {
    html += `
  <div class="section">
    <div class="section-title" style="background:#1a1a2e;">🛡️ SAST Scan — ${scanResult.stats.total_findings} findings in ${scanResult.stats.files_scanned} files</div>`
    for (const f of scanResult.findings) {
      html += `
    <div class="finding">
      <span class="badge badge-${f.severity}">${f.severity}</span>
      <strong>${f.category || f.type || ''}</strong>
      <span class="file">${f.file}:${f.line}</span>
      ${f.description ? `<p style="font-size:.8rem;color:#a0a0b8;">${f.description}</p>` : ''}
      ${f.snippet ? `<pre>${f.snippet}</pre>` : ''}
    </div>`
    }
    html += '\n  </div>'
  }

  if (secretsResult && secretsResult.length > 0) {
    html += `
  <div class="section">
    <div class="section-title" style="background:#ef444410;color:#ef4444;">🔑 Hardcoded Secrets — ${secretsResult.length} found</div>`
    for (const f of secretsResult) {
      html += `
    <div class="finding">
      <span class="badge badge-${f.severity}">${f.severity}</span>
      <strong>${f.type}</strong>
      <span class="file">${f.file}:${f.line}</span>
      <pre>${f.match}</pre>
    </div>`
    }
    html += '\n  </div>'
  }

  html += '\n</body>\n</html>'

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `codex-security-report-${new Date().toISOString().slice(0, 10)}.html`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
interface SecurityReportProps {
  scanResult?: ScanResult | null
  secretsResult?: SecretFinding[] | null
  depsResult?: DependencyResult | null
}

const SecurityReport = memo(function SecurityReport({
  scanResult,
  secretsResult,
  depsResult,
}: SecurityReportProps) {
  const hasData = scanResult || secretsResult || depsResult

  if (!hasData) return null

  return (
    <div className="my-2">
      {scanResult && <ScanResultView data={scanResult} />}
      {secretsResult && secretsResult.length > 0 && <SecretsResultView data={secretsResult} />}
      {depsResult && <DepsResultView data={depsResult} />}

      {/* Export button */}
      {(scanResult || secretsResult || depsResult) && (
        <div className="flex justify-end mt-1">
          <button
            onClick={() => exportToHTML(scanResult || null, secretsResult || null, depsResult || null)}
            className="text-[10px] text-[#555570] hover:text-[#818cf8] transition-colors px-2 py-1"
          >
            Export HTML Report
          </button>
        </div>
      )}
    </div>
  )
})

export default SecurityReport

// ---------------------------------------------------------------------------
// 辅助：按严重级别分组
// ---------------------------------------------------------------------------
function groupBySeverity(findings: SecurityFinding[]) {
  const groups: Record<string, SecurityFinding[]> = { critical: [], high: [], medium: [], low: [], info: [] }
  for (const f of findings) {
    (groups[f.severity] ??= []).push(f)
  }
  return groups
}