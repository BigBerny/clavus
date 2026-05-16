import { memo, useState, useMemo } from 'react'
import type { Tab } from '../../state/tabs.ts'

interface Props {
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onNewChat: () => void
  onCloseTab: (tabId: string) => void
  fileExplorerOpen?: boolean
  onToggleFileExplorer?: () => void
}

function fullDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

type GroupKey = 'today' | 'yesterday' | 'lastWeek' | 'older'

const GROUP_LABELS: Record<GroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  lastWeek: 'Last week',
  older: 'Older',
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function groupFor(timestamp: number, now: number): GroupKey {
  const today = startOfDay(new Date(now))
  const yesterday = today - 24 * 60 * 60 * 1000
  const sevenDaysAgo = today - 6 * 24 * 60 * 60 * 1000
  if (timestamp >= today) return 'today'
  if (timestamp >= yesterday) return 'yesterday'
  if (timestamp >= sevenDaysAgo) return 'lastWeek'
  return 'older'
}

function TabTypeIcon({ type }: { type: string }) {
  const className = "text-text-light-muted/60 dark:text-text-dark-muted/60"
  if (type === 'recipe') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
      </svg>
    )
  }
  if (type === 'marksense') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>
      </svg>
    )
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

export const DesktopSidebar = memo(function DesktopSidebar({ tabs, activeTabId, onSelectTab, onNewChat, onCloseTab, fileExplorerOpen, onToggleFileExplorer }: Props) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const now = Date.now()
    const sorted = [...tabs].sort((a, b) => (b.updatedAt - a.updatedAt) || (b.openedAt - a.openedAt))
    const groups: Record<GroupKey, Tab[]> = { today: [], yesterday: [], lastWeek: [], older: [] }
    for (const tab of sorted) {
      groups[groupFor(tab.updatedAt, now)].push(tab)
    }
    return groups
  }, [tabs])

  const groupOrder: GroupKey[] = ['today', 'yesterday', 'lastWeek', 'older']

  return (
    <div className="w-[260px] h-full flex flex-col bg-surface-light dark:bg-surface-dark border-r border-border-light dark:border-border-dark">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-light dark:border-border-dark">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-surface-light-2 dark:bg-surface-dark-3 flex items-center justify-center text-text-light-muted dark:text-text-dark-muted">
            <span className="text-sm font-medium">C</span>
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
          groupOrder.map(key => {
            const list = grouped[key]
            if (list.length === 0) return null
            return (
              <div key={key} className="pb-1">
                <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-text-light-muted dark:text-text-dark-muted select-none">
                  {GROUP_LABELS[key]}
                </div>
                {list.map((tab) => {
                  const isActive = tab.id === activeTabId
                  const isHovered = tab.id === hoveredTab
                  return (
                    <div
                      key={tab.id}
                      className="relative mx-1.5"
                      onMouseEnter={() => setHoveredTab(tab.id)}
                      onMouseLeave={() => setHoveredTab(null)}
                    >
                      {/* Row select button. Close button is a sibling overlay (avoids
                          invalid button-in-button nesting). */}
                      <button
                        onClick={() => onSelectTab(tab.id)}
                        title={fullDateTime(tab.updatedAt)}
                        className={`inline-btn w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left transition-colors ${
                          isActive
                            ? 'bg-surface-light-2 dark:bg-surface-dark-3 text-text-light dark:text-text-dark'
                            : 'text-text-light dark:text-text-dark hover:bg-surface-light-2/70 dark:hover:bg-surface-dark-2'
                        }`}
                      >
                        <TabTypeIcon type={tab.type} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] truncate pr-5">
                            {tab.title || 'Untitled'}
                          </div>
                        </div>
                      </button>
                      {isHovered && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id) }}
                          className="inline-btn absolute top-1/2 -translate-y-1/2 right-2 w-5 h-5 flex items-center justify-center rounded text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark hover:bg-surface-light-3 dark:hover:bg-surface-dark-2 transition-colors"
                          aria-label="Close tab"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-border-light dark:border-border-dark px-3 py-2">
        <button
          onClick={onToggleFileExplorer}
          className={`inline-btn w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left transition-colors ${
            fileExplorerOpen
              ? 'bg-surface-light-2 dark:bg-surface-dark-3 text-text-light dark:text-text-dark'
              : 'text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2/70 dark:hover:bg-surface-dark-2'
          }`}
          aria-label="Toggle file explorer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
          <span className="text-[13px]">Files</span>
        </button>
      </div>
    </div>
  )
})
