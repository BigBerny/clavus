import { memo, useState } from 'react'
import type { Tab, ChatTab } from '../../state/tabs.ts'

interface Props {
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onNewChat: () => void
  onCloseTab: (tabId: string) => void
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return 'now'
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function TabTypeIcon({ type }: { type: string }) {
  if (type === 'recipe') return <span className="text-[11px]">🍳</span>
  if (type === 'marksense') return <span className="text-[11px]">📝</span>
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/50 dark:text-text-dark-muted/50">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

export const DesktopSidebar = memo(function DesktopSidebar({ tabs, activeTabId, onSelectTab, onNewChat, onCloseTab }: Props) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  return (
    <div className="w-[260px] h-full flex flex-col bg-surface-light dark:bg-[#0d0f14] border-r border-surface-light-3/20 dark:border-surface-dark-3/20">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-light-3/15 dark:border-surface-dark-3/15">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
            <span className="text-sm font-bold text-accent">C</span>
          </div>
          <span className="text-[14px] font-semibold text-text-light dark:text-text-dark">Clavus</span>
        </div>
        <button
          onClick={onNewChat}
          className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
          aria-label="New chat"
          title="New chat"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </button>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {tabs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-text-light-muted/40 dark:text-text-dark-muted/40">No conversations yet</p>
          </div>
        ) : (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            const isHovered = tab.id === hoveredTab
            return (
              <div
                key={tab.id}
                className="relative"
                onMouseEnter={() => setHoveredTab(tab.id)}
                onMouseLeave={() => setHoveredTab(null)}
              >
                <button
                  onClick={() => onSelectTab(tab.id)}
                  className={`inline-btn w-full flex items-center gap-2.5 px-3 py-2 mx-1.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-accent/10 dark:bg-accent/15'
                      : 'hover:bg-surface-light-2 dark:hover:bg-surface-dark-2/50'
                  }`}
                  style={{ width: 'calc(100% - 12px)' }}
                >
                  <TabTypeIcon type={tab.type} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] truncate ${
                      isActive
                        ? 'text-accent font-medium'
                        : 'text-text-light dark:text-text-dark'
                    }`}>
                      {tab.title || 'Untitled'}
                    </div>
                  </div>
                  <span className="text-[10px] text-text-light-muted/40 dark:text-text-dark-muted/40 shrink-0">
                    {relativeTime(tab.updatedAt)}
                  </span>
                </button>
                {/* Close button on hover */}
                {isHovered && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id) }}
                    className="inline-btn absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-text-light-muted/30 dark:text-text-dark-muted/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    aria-label="Close tab"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
})
