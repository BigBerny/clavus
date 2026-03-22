import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useUIStore } from '../../state/ui'
import { fetchRecipe, updateRecipe as updateRecipeApi, markCooked, markOpened, addToBring } from '../../api/recipes'
import type { Recipe, Ingredient, SourceUrl } from '../../api/recipes'

function formatDuration(mins: number): string {
  if (!mins) return ''
  if (mins < 60) return `${mins} Min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function StarRating({ rating, onChange }: { rating: number; onChange?: (r: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          onClick={() => onChange?.(i === rating ? 0 : i)}
          className="inline-btn p-0.5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
            fill={i <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"
            className={`transition-colors ${i <= rating ? 'text-amber-400' : 'text-text-light-muted/25 dark:text-text-dark-muted/25'}`}
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
      ))}
    </div>
  )
}

function HighlightedInstruction({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2)
          return (
            <span key={i} className="inline px-1 py-0 rounded bg-amber-500/12 dark:bg-amber-500/18 text-amber-700 dark:text-amber-300 font-semibold text-[13px]">
              {inner}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

function scaleAmount(amount: number | null, defaultServings: number, currentServings: number): string {
  if (amount === null || amount === undefined) return ''
  const scaled = (amount / defaultServings) * currentServings
  if (scaled === Math.floor(scaled)) return String(scaled)
  if (Math.abs(scaled - 0.25) < 0.01) return '¼'
  if (Math.abs(scaled - 0.33) < 0.01) return '⅓'
  if (Math.abs(scaled - 0.5) < 0.01) return '½'
  if (Math.abs(scaled - 0.67) < 0.01) return '⅔'
  if (Math.abs(scaled - 0.75) < 0.01) return '¾'
  return scaled.toFixed(1).replace(/\.0$/, '')
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SourceLinkIcon({ type }: { type: SourceUrl['type'] }) {
  if (type === 'video') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    )
  }
  if (type === 'article') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
    )
  }
  // "other"
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  )
}

// Bring! Modal
function BringModal({ ingredients, servings, defaultServings, onClose }: {
  ingredients: Ingredient[]
  servings: number
  defaultServings: number
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(ingredients.map(i => i.id)))
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSend = async () => {
    setSending(true)
    const items = ingredients
      .filter(i => selected.has(i.id))
      .map(i => ({
        name: i.name,
        spec: i.amount !== null
          ? `${scaleAmount(i.amount, defaultServings, servings)}${i.unit ? ' ' + i.unit : ''}`
          : ''
      }))
    try {
      await addToBring(items)
      setDone(true)
      setTimeout(onClose, 400)
    } catch {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-surface-light dark:bg-surface-dark rounded-t-3xl max-h-[80vh] flex flex-col animate-[slideUp_0.3s_ease-out]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-light-3/50 dark:border-surface-dark-3/50">
          <div>
            <h3 className="text-[16px] font-semibold text-text-light dark:text-text-dark">Zu Bring! hinzufügen</h3>
            <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted mt-0.5">
              {selected.size} von {ingredients.length} ausgewählt
            </p>
          </div>
          <button onClick={onClose} className="inline-btn w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-light-2 dark:hover:bg-surface-dark-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {ingredients.map(ing => {
            const isSelected = selected.has(ing.id)
            return (
              <button
                key={ing.id}
                onClick={() => toggle(ing.id)}
                className={`inline-btn w-full flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all text-left ${isSelected ? 'bg-green-500/8 dark:bg-green-500/12' : 'opacity-50'}`}
              >
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${isSelected ? 'bg-green-500 border-green-500' : 'border-surface-light-3 dark:border-surface-dark-3'}`}>
                  {isSelected && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] text-text-light dark:text-text-dark">
                    {ing.amount !== null && (
                      <span className="font-semibold text-amber-600 dark:text-amber-400 mr-1">
                        {scaleAmount(ing.amount, defaultServings, servings)}{ing.unit ? ` ${ing.unit}` : ''}
                      </span>
                    )}
                    {ing.name}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
        <div className="px-5 py-4 border-t border-surface-light-3/50 dark:border-surface-dark-3/50">
          <button
            onClick={handleSend}
            disabled={sending || done || selected.size === 0}
            className={`w-full py-3.5 rounded-2xl font-semibold text-[15px] transition-all ${
              done
                ? 'bg-green-500 text-white'
                : 'bg-green-500/90 hover:bg-green-500 text-white disabled:opacity-40'
            }`}
          >
            {done ? '✓ Hinzugefügt!' : sending ? 'Wird gesendet...' : `${selected.size} Zutaten zu Bring! senden`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RecipeDetail({ onBack: onBackProp }: { onBack?: () => void } = {}) {
  const selectedRecipeId = useUIStore(s => s.selectedRecipeId)
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [servings, setServings] = useState(3)
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set())
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesText, setNotesText] = useState('')
  const [showBring, setShowBring] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!selectedRecipeId) return
    setLoading(true)
    fetchRecipe(selectedRecipeId)
      .then(r => {
        setRecipe(r)
        setServings(r.servings || 3)
        setNotesText(r.notes || '')
        // Track that the recipe was opened
        markOpened(selectedRecipeId).catch(() => {})
      })
      .finally(() => setLoading(false))
  }, [selectedRecipeId])

  const handleRating = useCallback(async (newRating: number) => {
    if (!recipe) return
    setRecipe(prev => prev ? { ...prev, rating: newRating } : null)
    await updateRecipeApi(recipe.id, { rating: newRating } as any)
  }, [recipe])

  const toggleIngredient = useCallback((id: number) => {
    setCheckedIngredients(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleNotesEdit = useCallback(() => {
    setEditingNotes(true)
    setTimeout(() => notesRef.current?.focus(), 50)
  }, [])

  const handleNotesSave = useCallback(async () => {
    setEditingNotes(false)
    if (!recipe) return
    if (notesText !== recipe.notes) {
      setRecipe(prev => prev ? { ...prev, notes: notesText } : null)
      await updateRecipeApi(recipe.id, { notes: notesText } as any)
    }
  }, [recipe, notesText])

  const goBack = useCallback(() => {
    if (onBackProp) {
      onBackProp()
    } else {
      setCurrentView('recipes')
    }
  }, [setCurrentView, onBackProp])

  const startCooking = useCallback(async () => {
    if (!recipe) return
    await markCooked(recipe.id)
    setCurrentView('cook-mode')
  }, [recipe, setCurrentView])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-light dark:bg-surface-dark">
        <div className="voice-spinner" />
      </div>
    )
  }

  if (!recipe) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-surface-light dark:bg-surface-dark gap-3">
        <p className="text-text-light-muted dark:text-text-dark-muted">Rezept nicht gefunden</p>
        <button onClick={goBack} className="inline-btn text-accent text-sm font-medium">Zurück</button>
      </div>
    )
  }

  const duration = recipe.total_time_min || (recipe.prep_time_min + recipe.cook_time_min)
  const imageUrl = recipe.image_path
    ? (recipe.image_path.startsWith('/') || recipe.image_path.startsWith('http') ? recipe.image_path : `/recipe-images/${recipe.image_path}`)
    : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-light dark:bg-surface-dark">
      <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />

      <div className="flex-1 overflow-y-auto overscroll-none" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Hero */}
        <div className="relative">
          {imageUrl ? (
            <div className="aspect-[16/9] w-full overflow-hidden bg-surface-light-3 dark:bg-surface-dark-3">
              <img src={imageUrl} alt={recipe.title} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="aspect-[16/9] w-full bg-gradient-to-br from-amber-500/15 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/12 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500/30 dark:text-amber-400/25">
                <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
              </svg>
            </div>
          )}
          <button
            onClick={goBack}
            className="inline-btn absolute top-3 left-3 w-9 h-9 flex items-center justify-center rounded-full bg-black/30 dark:bg-black/50 backdrop-blur-sm text-white hover:bg-black/50 dark:hover:bg-black/70 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>

        <div className="px-5 pb-8">
          {/* Title + meta */}
          <div className="pt-4 pb-3">
            <h1 className="text-xl font-bold text-text-light dark:text-text-dark leading-tight mb-2">{recipe.title}</h1>
            <div className="flex items-center gap-3 flex-wrap mb-3">
              {duration > 0 && (
                <span className="flex items-center gap-1.5 text-[13px] text-text-light-muted dark:text-text-dark-muted">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {formatDuration(duration)}
                </span>
              )}
              <StarRating rating={recipe.rating} onChange={handleRating} />
            </div>

            {/* Tags */}
            {recipe.tags && recipe.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {recipe.tags.map(tag => (
                  <span key={tag} className="text-[11px] px-2 py-1 rounded-lg bg-accent/8 dark:bg-accent/14 text-accent/80 dark:text-accent/70 font-medium">{tag}</span>
                ))}
              </div>
            )}

            {/* Source links */}
            {((recipe.source_urls && recipe.source_urls.length > 0) || recipe.source_url) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">
                {(recipe.source_urls && recipe.source_urls.length > 0
                  ? recipe.source_urls
                  : recipe.source_url ? [{ url: recipe.source_url, type: 'article' as const }] : []
                ).map((src, i) => (
                  <a
                    key={i}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[13px] text-accent/70 hover:text-accent transition-colors"
                  >
                    <SourceLinkIcon type={src.type} />
                    {getDomain(src.url)}
                  </a>
                ))}
              </div>
            )}

            {/* Notes - editable */}
            <div className="mb-3">
              {editingNotes ? (
                <div className="space-y-2">
                  <textarea
                    ref={notesRef}
                    value={notesText}
                    onChange={e => setNotesText(e.target.value)}
                    onBlur={handleNotesSave}
                    placeholder="Notizen hinzufügen..."
                    className="w-full p-3 rounded-xl bg-amber-500/6 dark:bg-amber-500/10 border border-amber-500/20 dark:border-amber-500/25 text-[13px] text-text-light dark:text-text-dark placeholder:text-text-light-muted/50 dark:placeholder:text-text-dark-muted/50 resize-none focus:outline-none focus:border-amber-500/40 min-h-[80px]"
                    rows={3}
                  />
                </div>
              ) : (
                <button
                  onClick={handleNotesEdit}
                  className="inline-btn w-full text-left p-3 rounded-xl bg-amber-500/6 dark:bg-amber-500/10 border border-amber-500/10 dark:border-amber-500/15 hover:border-amber-500/25 transition-colors group"
                >
                  {notesText ? (
                    <p className="text-[12px] text-amber-700 dark:text-amber-300/80 leading-relaxed">
                      📝 {notesText}
                      <span className="ml-2 text-amber-500/40 group-hover:text-amber-500/70 text-[10px]">✎</span>
                    </p>
                  ) : (
                    <p className="text-[12px] text-text-light-muted/50 dark:text-text-dark-muted/50">
                      📝 Notizen hinzufügen...
                    </p>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Servings calculator */}
          <div className="flex items-center justify-between py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50">
            <span className="text-[14px] font-medium text-text-light dark:text-text-dark">Portionen</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setServings(s => Math.max(1, s - 1))} className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 text-text-light dark:text-text-dark font-medium transition-colors">−</button>
              <span className="text-[16px] font-semibold text-text-light dark:text-text-dark w-6 text-center tabular-nums">{servings}</span>
              <button onClick={() => setServings(s => Math.min(20, s + 1))} className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 text-text-light dark:text-text-dark font-medium transition-colors">+</button>
            </div>
          </div>

          {/* Ingredients */}
          {recipe.ingredients && recipe.ingredients.length > 0 && (
            <div className="py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[15px] font-semibold text-text-light dark:text-text-dark">Zutaten</h2>
                <button
                  onClick={() => setShowBring(true)}
                  className="inline-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 dark:bg-green-500/15 text-green-600 dark:text-green-400 text-[12px] font-medium hover:bg-green-500/20 transition-colors"
                >
                  🛒 Zu Bring!
                </button>
              </div>
              <div className="space-y-1">
                {recipe.ingredients.map(ing => {
                  const checked = checkedIngredients.has(ing.id)
                  return (
                    <button
                      key={ing.id}
                      onClick={() => toggleIngredient(ing.id)}
                      className={`inline-btn w-full flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all duration-150 text-left ${checked ? 'bg-surface-light-2/40 dark:bg-surface-dark-2/40' : 'hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60'}`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150 ${checked ? 'bg-accent border-accent' : 'border-surface-light-3 dark:border-surface-dark-3'}`}>
                        {checked && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[14px] transition-all duration-150 ${checked ? 'line-through text-text-light-muted/50 dark:text-text-dark-muted/50' : 'text-text-light dark:text-text-dark'}`}>
                          {ing.amount !== null && (
                            <span className="font-semibold text-amber-600 dark:text-amber-400 mr-1">
                              {scaleAmount(ing.amount, recipe.servings, servings)}{ing.unit ? ` ${ing.unit}` : ''}
                            </span>
                          )}
                          {ing.name}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Instructions */}
          {recipe.steps && recipe.steps.length > 0 && (
            <div className="py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50">
              <h2 className="text-[15px] font-semibold text-text-light dark:text-text-dark mb-3">Zubereitung</h2>
              <div className="space-y-4">
                {recipe.steps.map((step, idx) => (
                  <div key={step.id} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-accent/10 dark:bg-accent/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[12px] font-bold text-accent">{idx + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-text-light dark:text-text-dark leading-relaxed">
                        <HighlightedInstruction text={step.instruction} />
                      </p>
                      {step.duration_min > 0 && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-[11px] text-text-light-muted dark:text-text-dark-muted bg-surface-light-2 dark:bg-surface-dark-2 px-2 py-0.5 rounded-md">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          {formatDuration(step.duration_min)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Start Cooking button */}
          {recipe.steps && recipe.steps.length > 0 && (
            <div className="pt-4 pb-4">
              <button
                onClick={startCooking}
                className="w-full py-3.5 rounded-2xl bg-accent text-white font-semibold text-[15px] hover:bg-accent/90 active:scale-[0.98] transition-all"
              >
                🍳 Kochen starten
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bring! Modal */}
      {showBring && recipe.ingredients && (
        <BringModal
          ingredients={recipe.ingredients}
          servings={servings}
          defaultServings={recipe.servings}
          onClose={() => setShowBring(false)}
        />
      )}
    </div>
  )
}
