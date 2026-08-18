import { useState, useEffect, useRef, memo } from 'react'
import mermaid from 'mermaid'

// 初始化 mermaid（全局配置一次）
let mermaidInitialized = false
function initMermaid() {
  if (mermaidInitialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      primaryColor: '#6366f1',
      primaryTextColor: '#e4e4ed',
      primaryBorderColor: '#2a2a3e',
      lineColor: '#818cf8',
      secondaryColor: '#1a1a2e',
      tertiaryColor: '#0d0d14',
      background: '#0a0a0f',
      mainBkg: '#12121a',
      nodeBorder: '#2a2a3e',
      clusterBkg: '#12121a',
      clusterBorder: '#2a2a3e',
      titleColor: '#e4e4ed',
      edgeLabelBackground: '#12121a',
    },
  })
  mermaidInitialized = true
}

interface MermaidDiagramProps {
  code: string
}

const MermaidDiagram = memo(function MermaidDiagram({ code }: MermaidDiagramProps) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`)

  useEffect(() => {
    initMermaid()
    const render = async () => {
      try {
        const { svg } = await mermaid.render(idRef.current, code)
        setSvg(svg)
        setError(null)
      } catch (e: unknown) {
        setError((e as Error).message || 'Mermaid render error')
        setSvg(null)
      }
    }
    render()
  }, [code])

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/5 p-3">
        <div className="text-[10px] text-[#ef4444] font-medium mb-1">Mermaid Diagram Error</div>
        <pre className="text-[11px] text-[#8888a0] whitespace-pre-wrap">{error}</pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className="my-2 rounded-lg border border-[#2a2a3e] bg-[#12121a] p-4 flex items-center justify-center">
        <span className="text-xs text-[#8888a0]">Rendering diagram...</span>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-[#2a2a3e] bg-[#0a0a0f]">
      <div className="flex items-center px-3 py-1.5 bg-[#1a1a2e] border-b border-[#2a2a3e]">
        <span className="text-[10px] text-[#8888a0] uppercase tracking-wider">Diagram</span>
      </div>
      <div
        ref={containerRef}
        className="p-4 flex justify-center overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
})

export default MermaidDiagram