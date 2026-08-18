import { useState, useEffect, useCallback, memo } from 'react'
import { format } from 'date-fns'
import { listConversations, deleteConversation } from '../api'

export interface ConversationInfo {
  id: string
  title: string
  created_at: number
  updated_at: number
}

interface Props {
  activeId: string | undefined
  onSelect: (id: string) => void
  onNew: () => void
  onRefresh: () => void
  refreshKey: number
}

const ConversationItem = memo(function ConversationItem({
  conv,
  isActive,
  onSelect,
  onDelete,
}: {
  conv: ConversationInfo
  isActive: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [confirming, setConfirming] = useState(false)

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirming) {
      onDelete(conv.id)
      setConfirming(false)
    } else {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
    }
  }

  return (
    <button
      onClick={() => onSelect(conv.id)}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150 group ${
        isActive
          ? 'bg-[#6366f1]/15 border border-[#6366f1]/30 text-[#e4e4ed]'
          : 'hover:bg-[#1a1a2e] border border-transparent text-[#c0c0d0]'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs mt-0.5 shrink-0">{'\u{1F4AC}'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{conv.title || 'New Conversation'}</div>
          <div className="text-[10px] text-[#555570] mt-0.5">
            {format(new Date(conv.updated_at * 1000), 'MM/dd HH:mm')}
          </div>
        </div>
        <button
          onClick={handleDelete}
          className={`shrink-0 text-xs transition-all ${
            confirming
              ? 'text-[#ef4444]'
              : 'text-[#555570] opacity-0 group-hover:opacity-100 hover:text-[#ef4444]'
          }`}
          title={confirming ? 'Click again to confirm' : 'Delete'}
        >
          {confirming ? '\u2717' : '\u{1F5D1}'}
        </button>
      </div>
    </button>
  )
})

export default function ConversationSidebar({ activeId, onSelect, onNew, onRefresh, refreshKey }: Props) {
  const [conversations, setConversations] = useState<ConversationInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listConversations()
      setConversations(data)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeId === id) {
        onNew()
      }
      onRefresh()
    } catch {
      // silent
    }
  }, [activeId, onNew, onRefresh])

  const filtered = search
    ? conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
    : conversations

  return (
    <div className="h-full flex flex-col bg-[#0d0d14] border-r border-[#2a2a3e]">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[#2a2a3e]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[#8888a0] uppercase tracking-wider">
            Conversations
          </span>
          <button
            onClick={onNew}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-[#6366f1] hover:bg-[#818cf8] text-white text-sm transition-colors"
            title="New conversation"
          >
            +
          </button>
        </div>
        <div className="relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-[#12121a] border border-[#2a2a3e] rounded-lg px-2.5 py-1.5 text-xs text-[#e4e4ed] placeholder-[#555570] focus:outline-none focus:border-[#6366f1] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#555570] hover:text-[#e4e4ed] text-xs"
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex flex-col gap-2 p-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 bg-[#1a1a2e] rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-2xl mb-2">{'\u{1F4AD}'}</div>
            <p className="text-xs text-[#8888a0]">
              {search ? 'No matching conversations' : 'No conversations yet'}
            </p>
            <button
              onClick={onNew}
              className="mt-3 px-3 py-1.5 bg-[#6366f1] hover:bg-[#818cf8] text-white rounded-lg text-xs transition-colors"
            >
              Start a new chat
            </button>
          </div>
        ) : (
          filtered.map((conv) => (
            <ConversationItem
              key={conv.id}
              conv={conv}
              isActive={conv.id === activeId}
              onSelect={onSelect}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}