import { memo } from 'react'
import { useI18n } from '../i18n'

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
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-between px-4 h-6 bg-[#0d0d14] border-t border-[#2a2a3e] text-[10px] text-[#555570] shrink-0 select-none">
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-[#f59e0b] animate-pulse' : 'bg-[#22c55e]'}`} />
          {loading ? t('status.generating') : t('status.ready')}
        </span>
        <span className="text-[#2a2a3e]">|</span>
        <span className="truncate">{provider} / {model}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {conversationId && (
          <>
            <span>{t('status.session', { id: conversationId.slice(0, 8) })}</span>
            <span className="text-[#2a2a3e]">|</span>
          </>
        )}
        <span>{t('status.messages', { n: messageCount })}</span>
        {showSidebar && (
          <>
            <span className="text-[#2a2a3e]">|</span>
            <span>{t('status.sidebar')}</span>
          </>
        )}
      </div>
    </div>
  )
})

export default StatusBar