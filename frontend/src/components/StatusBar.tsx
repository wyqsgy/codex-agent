import { memo } from 'react'

interface StatusBarProps {
  provider: string
  model: string
  loading: boolean
  showSidebar: boolean
  conversationId?: string
  messageCount: number
}

const StatusBar = memo(function StatusBar({
  provider,
  model,
  loading,
  showSidebar,
  conversationId,
  messageCount,
}: StatusBarProps) {
  return (
    <div className="flex items-center justify-between px-4 h-6 bg-[#0d0d14] border-t border-[#2a2a3e] text-[10px] text-[#555570] shrink-0 select-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-[#f59e0b] animate-pulse' : 'bg-[#22c55e]'}`} />
          {loading ? 'Generating...' : 'Ready'}
        </span>
        <span className="text-[#2a2a3e]">|</span>
        <span>{provider} / {model}</span>
      </div>
      <div className="flex items-center gap-3">
        {conversationId && (
          <>
            <span>Session: {conversationId.slice(0, 8)}</span>
            <span className="text-[#2a2a3e]">|</span>
          </>
        )}
        <span>{messageCount} messages</span>
        {showSidebar && (
          <>
            <span className="text-[#2a2a3e]">|</span>
            <span>Sidebar</span>
          </>
        )}
      </div>
    </div>
  )
})

export default StatusBar