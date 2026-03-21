import { useState, useEffect, useCallback, useMemo } from 'react'
import { useThreadsStore, loadThreadMessages } from '../../state/threads'
import { useChatStore } from '../../state/chat'
import { useUIStore } from '../../state/ui'
import { fetchRecipes } from '../../api/recipes'
import type { Recipe } from '../../api/recipes'
import type { Thread } from '../../state/threads'

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return 'just now'
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface QuickActionsProps {
  onCompose?: (channel: 'messaging' | 'slack' | 'email') => void
}

function QuickActions({ onCompose }: QuickActionsProps) {
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  return (
    <div className="px-5 pt-1 pb-1 space-y-3">
      {/* App shortcuts — icon only, compact */}
      <div className="flex items-center gap-2">
        <a
          href="https://mac-mini-von-janis.taild2ad59.ts.net:3700/"
          target="_blank"
          rel="noopener noreferrer"
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="Marksense"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
        </a>
        <button
          onClick={() => setCurrentView('recipes')}
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="Rezepte"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>
        </button>
      </div>

      {/* Compose buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onCompose?.('messaging')}
          className="group flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-gradient-to-br from-emerald-500/10 to-green-500/5 dark:from-emerald-500/15 dark:to-green-500/8 border border-emerald-400/15 dark:border-emerald-400/20 hover:border-emerald-400/35 active:scale-[0.97] transition-all duration-200"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <span className="text-[11px] font-medium text-text-light-muted dark:text-text-dark-muted">Messaging</span>
        </button>
        <button
          onClick={() => onCompose?.('slack')}
          className="group flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-gradient-to-br from-purple-500/10 to-fuchsia-500/5 dark:from-purple-500/15 dark:to-fuchsia-500/8 border border-purple-400/15 dark:border-purple-400/20 hover:border-purple-400/35 active:scale-[0.97] transition-all duration-200"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center text-white shadow-md shadow-purple-500/20 group-hover:scale-105 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="3" height="8" x="13" y="2" rx="1.5"/><path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5"/><rect width="3" height="8" x="8" y="14" rx="1.5"/><path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5"/><rect width="8" height="3" x="14" y="13" rx="1.5"/><path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5"/><rect width="8" height="3" x="2" y="8" rx="1.5"/><path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5"/></svg>
          </div>
          <span className="text-[11px] font-medium text-text-light-muted dark:text-text-dark-muted">Slack</span>
        </button>
        <button
          onClick={() => onCompose?.('email')}
          className="group flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-gradient-to-br from-blue-500/10 to-cyan-500/5 dark:from-blue-500/15 dark:to-cyan-500/8 border border-blue-400/15 dark:border-blue-400/20 hover:border-blue-400/35 active:scale-[0.97] transition-all duration-200"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          </div>
          <span className="text-[11px] font-medium text-text-light-muted dark:text-text-dark-muted">E-Mail</span>
        </button>
      </div>
    </div>
  )
}

function ChatItem({ thread, onSelect }: { thread: Thread; onSelect: () => void }) {
  const messageCount = useMemo(() => {
    const msgs = loadThreadMessages(thread.id)
    return msgs.length
  }, [thread.id])

  if (messageCount === 0) return null

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:scale-[0.98] transition-all duration-150 text-left group"
    >
      <div className="w-9 h-9 rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/10 dark:group-hover:bg-accent/15 transition-colors duration-150">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted group-hover:text-accent transition-colors"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[14px] font-medium text-text-light dark:text-text-dark truncate group-hover:text-accent transition-colors">
            {thread.title}
          </p>
          <span className="text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40 flex-shrink-0 tabular-nums">
            {relativeTime(thread.updatedAt)}
          </span>
        </div>
        {thread.lastMessagePreview && (
          <p className="text-[12px] text-text-light-muted/70 dark:text-text-dark-muted/70 truncate mt-0.5 leading-snug">
            {thread.lastMessagePreview}
          </p>
        )}
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-light-muted/20 dark:text-text-dark-muted/20 group-hover:text-accent/50 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  )
}

function RecipeItem({ recipe, onSelect }: { recipe: Recipe; onSelect: () => void }) {
  const imageUrl = recipe.image_path
    ? (recipe.image_path.startsWith('/') || recipe.image_path.startsWith('http') ? recipe.image_path : `/recipe-images/${recipe.image_path}`)
    : null

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:scale-[0.98] transition-all duration-150 text-left group"
    >
      {imageUrl ? (
        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0">
          <img src={imageUrl} alt={recipe.title} className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 dark:bg-amber-500/15 flex items-center justify-center flex-shrink-0 group-hover:bg-amber-500/20 transition-colors duration-150">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500/70 dark:text-amber-400/60">
            <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[14px] font-medium text-text-light dark:text-text-dark truncate group-hover:text-amber-500 transition-colors">
            {recipe.title}
          </p>
          {recipe.rating > 0 && (
            <span className="text-[11px] text-amber-400 flex-shrink-0">{'★'.repeat(recipe.rating)}</span>
          )}
        </div>
        {recipe.tags.length > 0 && (
          <p className="text-[12px] text-text-light-muted/70 dark:text-text-dark-muted/70 truncate mt-0.5 leading-snug">
            {recipe.tags.slice(0, 3).join(' · ')}
          </p>
        )}
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-light-muted/20 dark:text-text-dark-muted/20 group-hover:text-amber-500/50 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  )
}

export function HomeScreen({ onSend, onCompose }: { onSend: (message: string) => void; onCompose?: (channel: 'messaging' | 'slack' | 'email') => void }) {
  const threads = useThreadsStore((s) => s.threads)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const loadThread = useChatStore((s) => s.loadThread)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const setSelectedRecipeId = useUIStore((s) => s.setSelectedRecipeId)
  const [showAll, setShowAll] = useState(false)
  const [recentRecipes, setRecentRecipes] = useState<Recipe[]>([])

  useEffect(() => {
    fetchRecipes().then(recipes => {
      // Show most recently updated/cooked recipes
      const sorted = recipes
        .sort((a, b) => {
          const aTime = a.last_cooked_at ? new Date(a.last_cooked_at).getTime() : new Date(a.updated_at).getTime()
          const bTime = b.last_cooked_at ? new Date(b.last_cooked_at).getTime() : new Date(b.updated_at).getTime()
          return bTime - aTime
        })
        .slice(0, 5)
      setRecentRecipes(sorted)
    }).catch(() => {})
  }, [])

  const now = Date.now()
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000

  const sortedThreads = useMemo(() =>
    [...threads]
      .filter(t => {
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0 || t.lastMessagePreview
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  )

  const recentThreads = useMemo(() =>
    showAll ? sortedThreads : sortedThreads.filter(t => t.updatedAt > twentyFourHoursAgo),
    [sortedThreads, showAll, twentyFourHoursAgo]
  )

  const hasOlder = sortedThreads.some(t => t.updatedAt <= twentyFourHoursAgo)

  const handleSelectThread = useCallback((id: string) => {
    switchThread(id)
    loadThread(id)
    setCurrentView('chat')
  }, [switchThread, loadThread, setCurrentView])

  const handleSelectRecipe = useCallback((id: number) => {
    setSelectedRecipeId(id)
    setCurrentView('recipe-detail')
  }, [setSelectedRecipeId, setCurrentView])

  return (
    <div className="flex-1 overflow-y-auto overscroll-y-contain min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[760px] mx-auto pb-4">
        <div className="pt-6">
          <QuickActions onCompose={onCompose} />
        </div>

        {recentRecipes.length > 0 && (
          <div className="px-5 pt-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-text-light-muted/50 dark:text-text-dark-muted/50 uppercase tracking-widest">
                Rezepte
              </p>
            </div>
            <div className="space-y-0.5">
              {recentRecipes.map(recipe => (
                <RecipeItem key={recipe.id} recipe={recipe} onSelect={() => handleSelectRecipe(recipe.id)} />
              ))}
            </div>
          </div>
        )}

        {recentThreads.length > 0 && (
          <div className="px-5 pt-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-text-light-muted/50 dark:text-text-dark-muted/50 uppercase tracking-widest">
                Recent Chats
              </p>
            </div>
            <div className="space-y-0.5">
              {recentThreads.map((thread) => (
                <ChatItem
                  key={thread.id}
                  thread={thread}
                  onSelect={() => handleSelectThread(thread.id)}
                />
              ))}
            </div>
            {!showAll && hasOlder && (
              <button
                onClick={() => setShowAll(true)}
                className="inline-btn w-full mt-3 py-2.5 text-[13px] text-accent/80 hover:text-accent font-medium transition-colors rounded-xl hover:bg-accent/5"
              >
                Show older conversations
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
