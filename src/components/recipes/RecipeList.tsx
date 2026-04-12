import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useUIStore } from '../../state/ui'
import { fetchRecipes, searchRecipes as searchApi } from '../../api/recipes'
import { RecipeDetail } from './RecipeDetail'
import type { Recipe } from '../../api/recipes'

type SortMode = 'recent' | 'last_opened' | 'rating' | 'alpha' | 'added'

function formatDuration(mins: number): string {
  if (!mins) return ''
  if (mins < 60) return `${mins} Min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
          fill={i <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
          className={i <= rating ? 'text-amber-400' : 'text-text-light-muted/20 dark:text-text-dark-muted/20'}
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      ))}
    </div>
  )
}

function RecipeCard({ recipe, onClick }: { recipe: Recipe; onClick: () => void }) {
  const duration = recipe.total_time_min || (recipe.prep_time_min + recipe.cook_time_min)
  const imageUrl = recipe.image_path
    ? (recipe.image_path.startsWith('/') || recipe.image_path.startsWith('http') ? recipe.image_path : `/recipe-images/${recipe.image_path}`)
    : null

  return (
    <button
      onClick={onClick}
      className="group w-full text-left rounded-2xl overflow-hidden bg-surface-light-2/50 dark:bg-surface-dark-2/80 border border-surface-light-3/50 dark:border-surface-dark-3/50 hover:border-accent/20 active:scale-[0.97] transition-all duration-200"
    >
      {imageUrl ? (
        <div className="aspect-[16/10] w-full overflow-hidden bg-surface-light-3 dark:bg-surface-dark-3">
          <img
            src={imageUrl}
            alt={recipe.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="aspect-[16/10] w-full bg-gradient-to-br from-amber-500/10 to-orange-500/5 dark:from-amber-500/15 dark:to-orange-500/10 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500/30 dark:text-amber-400/20">
            <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
          </svg>
        </div>
      )}
      <div className="p-3 space-y-1.5">
        <h3 className="text-[14px] font-semibold text-text-light dark:text-text-dark leading-tight line-clamp-2 group-hover:text-accent transition-colors">
          {recipe.title}
        </h3>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {duration > 0 && (
              <span className="text-[11px] text-text-light-muted dark:text-text-dark-muted flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {formatDuration(duration)}
              </span>
            )}
          </div>
          {recipe.rating > 0 && <StarRating rating={recipe.rating} />}
        </div>
        {recipe.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recipe.tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/8 dark:bg-accent/12 text-accent/80 dark:text-accent/70 font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'recent', label: 'Zuletzt gekocht' },
  { value: 'last_opened', label: 'Zuletzt geöffnet' },
  { value: 'rating', label: 'Bewertung' },
  { value: 'alpha', label: 'A-Z' },
  { value: 'added', label: 'Neu hinzugefügt' },
]

export function RecipeList({ onSelectRecipe, isInline }: { onSelectRecipe?: (id: number) => void; isInline?: boolean } = {}) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortMode>('added')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const setSelectedRecipeId = useUIStore(s => s.setSelectedRecipeId)

  useEffect(() => {
    setLoading(true)
    fetchRecipes().then(setRecipes).finally(() => setLoading(false))
  }, [])

  // Search with debounce
  useEffect(() => {
    if (!search.trim()) {
      fetchRecipes().then(setRecipes)
      return
    }
    const timeout = setTimeout(() => {
      searchApi(search).then(setRecipes)
    }, 300)
    return () => clearTimeout(timeout)
  }, [search])

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    recipes.forEach(r => r.tags.forEach(t => tagSet.add(t)))
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'de'))
  }, [recipes])

  const toggleTag = useCallback((tag: string) => {
    setActiveTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }, [])

  // Filter by tags, then sort
  const filtered = useMemo(() => {
    if (activeTags.size === 0) return recipes
    return recipes.filter(r => {
      for (const tag of activeTags) {
        if (!r.tags.includes(tag)) return false
      }
      return true
    })
  }, [recipes, activeTags])

  const sorted = useMemo(() => {
    const list = [...filtered]
    switch (sort) {
      case 'recent':
        return list.sort((a, b) => {
          if (!a.last_cooked_at && !b.last_cooked_at) return 0
          if (!a.last_cooked_at) return 1
          if (!b.last_cooked_at) return -1
          return new Date(b.last_cooked_at).getTime() - new Date(a.last_cooked_at).getTime()
        })
      case 'last_opened':
        return list.sort((a, b) => {
          if (!a.last_opened_at && !b.last_opened_at) return 0
          if (!a.last_opened_at) return 1
          if (!b.last_opened_at) return -1
          return new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime()
        })
      case 'rating':
        return list.sort((a, b) => b.rating - a.rating)
      case 'alpha':
        return list.sort((a, b) => a.title.localeCompare(b.title, 'de'))
      case 'added':
        return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
  }, [filtered, sort])

  const [detailRecipeId, setDetailRecipeId] = useState<number | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)

  const openRecipe = useCallback((id: number) => {
    if (onSelectRecipe) {
      setSelectedRecipeId(id)
      onSelectRecipe(id)
      return
    }
    setSelectedRecipeId(id)
    setDetailRecipeId(id)
    // Trigger slide-in after a frame so CSS transition fires
    requestAnimationFrame(() => setDetailVisible(true))
  }, [setSelectedRecipeId, onSelectRecipe])

  const closeDetail = useCallback(() => {
    setDetailVisible(false)
    // Wait for slide-out animation to finish
    setTimeout(() => setDetailRecipeId(null), 300)
  }, [])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />
      <div className="flex items-center gap-3 px-4 py-3">
        {!isInline && (
          <button
            onClick={() => setCurrentView('home')}
            className="inline-btn w-9 h-9 flex items-center justify-center rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light dark:text-text-dark"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        )}
        <h1 className="text-lg font-semibold text-text-light dark:text-text-dark">Rezepte</h1>
      </div>

      {/* Search */}
      <div className="px-4 pb-2">
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light-muted/50 dark:text-text-dark-muted/50"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rezepte suchen..."
            className="w-full pl-9 pr-4 py-2.5 text-[14px] rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted/50 dark:placeholder:text-text-dark-muted/50 border border-transparent focus:border-accent/30 focus:outline-none transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="inline-btn absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Tag filter chips */}
      {allTags.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`inline-btn whitespace-nowrap text-[11px] font-medium px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 ${
                  activeTags.has(tag)
                    ? 'bg-accent/15 dark:bg-accent/22 text-accent ring-1 ring-accent/30'
                    : 'bg-surface-light-2/60 dark:bg-surface-dark-2/60 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-3 dark:hover:bg-surface-dark-3'
                }`}
              >
                {tag}
              </button>
            ))}
            {activeTags.size > 0 && (
              <button
                onClick={() => setActiveTags(new Set())}
                className="inline-btn whitespace-nowrap text-[11px] font-medium px-2.5 py-1.5 rounded-lg text-red-400/70 hover:text-red-400 transition-colors flex-shrink-0"
              >
                ✕ Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sort */}
      <div className="px-4 pb-3">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSort(opt.value)}
              className={`inline-btn whitespace-nowrap text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                sort === opt.value
                  ? 'bg-accent/12 dark:bg-accent/18 text-accent'
                  : 'bg-surface-light-2/60 dark:bg-surface-dark-2/60 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-3 dark:hover:bg-surface-dark-3'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto overscroll-none px-4 pb-24" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="voice-spinner" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/8 dark:bg-amber-500/12 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500/50"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>
            </div>
            <p className="text-[14px] text-text-light-muted dark:text-text-dark-muted">
              {search || activeTags.size > 0 ? 'Keine Rezepte gefunden' : 'Noch keine Rezepte'}
            </p>
            {!search && activeTags.size === 0 && (
              <p className="text-[12px] text-text-light-muted/60 dark:text-text-dark-muted/60 text-center max-w-[240px]">
                Sende Jane eine URL oder ein Foto, um Rezepte hinzuzufügen.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {sorted.map(recipe => (
              <RecipeCard key={recipe.id} recipe={recipe} onClick={() => openRecipe(recipe.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Slide-in Recipe Detail */}
      {detailRecipeId !== null && (
        <SlideInDetail visible={detailVisible} onClose={closeDetail} />
      )}
    </div>
  )
}

function SlideInDetail({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const [translateX, setTranslateX] = useState(0)
  const isDragging = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isDragging.current = false
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (!isDragging.current) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5 && dx > 0) {
        isDragging.current = true
      } else if (Math.abs(dy) > 10) {
        return
      } else {
        return
      }
    }
    if (isDragging.current && dx > 0) {
      setTranslateX(dx)
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (isDragging.current && translateX > 80) {
      onClose()
    }
    setTranslateX(0)
    isDragging.current = false
  }, [translateX, onClose])

  return (
    <div className="absolute inset-0 z-30">
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="absolute inset-0 bg-surface-light dark:bg-surface-dark transition-transform duration-300 ease-out flex flex-col"
        style={{
          transform: visible
            ? `translateX(${translateX}px)`
            : 'translateX(100%)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <RecipeDetail onBack={onClose} />
      </div>
    </div>
  )
}
