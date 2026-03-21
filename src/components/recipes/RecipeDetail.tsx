import { useState, useEffect, useMemo, useCallback } from 'react'
import { useUIStore } from '../../state/ui'
import { fetchRecipe, updateRecipe as updateRecipeApi } from '../../api/recipes'
import type { Recipe, Ingredient } from '../../api/recipes'

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

// Highlight quantities in instruction text with colored badges
function HighlightedInstruction({ text }: { text: string }) {
  // Match patterns like: **250g**, **2 EL**, **200ml**, **1/2 TL**, bold markdown quantities
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2)
          return (
            <span
              key={i}
              className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber-500/12 dark:bg-amber-500/18 text-amber-700 dark:text-amber-300 font-semibold text-[13px] mx-0.5"
            >
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
  // Nice formatting
  if (scaled === Math.floor(scaled)) return String(scaled)
  // Handle common fractions
  if (Math.abs(scaled - 0.25) < 0.01) return '¼'
  if (Math.abs(scaled - 0.33) < 0.01) return '⅓'
  if (Math.abs(scaled - 0.5) < 0.01) return '½'
  if (Math.abs(scaled - 0.67) < 0.01) return '⅔'
  if (Math.abs(scaled - 0.75) < 0.01) return '¾'
  return scaled.toFixed(1).replace(/\.0$/, '')
}

export function RecipeDetail() {
  const selectedRecipeId = useUIStore(s => s.selectedRecipeId)
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [servings, setServings] = useState(3)
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!selectedRecipeId) return
    setLoading(true)
    fetchRecipe(selectedRecipeId)
      .then(r => {
        setRecipe(r)
        setServings(r.servings || 3)
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

  const goBack = useCallback(() => {
    setCurrentView('recipes')
  }, [setCurrentView])

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

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-surface-light dark:bg-surface-dark">
      {/* Floating back button over hero */}
      <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />

      <div className="flex-1 overflow-y-auto overscroll-none" style={{ WebkitOverflowScrolling: 'touch' }}>
        {/* Hero image or placeholder */}
        <div className="relative">
          {recipe.image_path ? (
            <div className="aspect-[16/9] w-full overflow-hidden bg-surface-light-3 dark:bg-surface-dark-3">
              <img
                src={recipe.image_path}
                alt={recipe.title}
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <div className="aspect-[16/9] w-full bg-gradient-to-br from-amber-500/15 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/12 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500/30 dark:text-amber-400/25">
                <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
              </svg>
            </div>
          )}
          {/* Back button overlay */}
          <button
            onClick={goBack}
            className="inline-btn absolute top-3 left-3 w-9 h-9 flex items-center justify-center rounded-full bg-black/30 dark:bg-black/50 backdrop-blur-sm text-white hover:bg-black/50 dark:hover:bg-black/70 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>

        <div className="px-5 pb-24">
          {/* Title + meta */}
          <div className="pt-4 pb-3">
            <h1 className="text-xl font-bold text-text-light dark:text-text-dark leading-tight mb-2">
              {recipe.title}
            </h1>

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
                  <span key={tag} className="text-[11px] px-2 py-1 rounded-lg bg-accent/8 dark:bg-accent/14 text-accent/80 dark:text-accent/70 font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            {recipe.notes && (
              <div className="p-3 rounded-xl bg-amber-500/6 dark:bg-amber-500/10 border border-amber-500/10 dark:border-amber-500/15 mb-3">
                <p className="text-[12px] text-amber-700 dark:text-amber-300/80 leading-relaxed">
                  📝 {recipe.notes}
                </p>
              </div>
            )}
          </div>

          {/* Servings calculator */}
          <div className="flex items-center justify-between py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50">
            <span className="text-[14px] font-medium text-text-light dark:text-text-dark">Portionen</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setServings(s => Math.max(1, s - 1))}
                className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 text-text-light dark:text-text-dark font-medium transition-colors"
              >
                −
              </button>
              <span className="text-[16px] font-semibold text-text-light dark:text-text-dark w-6 text-center tabular-nums">
                {servings}
              </span>
              <button
                onClick={() => setServings(s => Math.min(20, s + 1))}
                className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 text-text-light dark:text-text-dark font-medium transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* Ingredients */}
          {recipe.ingredients && recipe.ingredients.length > 0 && (
            <div className="py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50">
              <h2 className="text-[15px] font-semibold text-text-light dark:text-text-dark mb-3">Zutaten</h2>
              <div className="space-y-1">
                {recipe.ingredients.map(ing => {
                  const checked = checkedIngredients.has(ing.id)
                  return (
                    <button
                      key={ing.id}
                      onClick={() => toggleIngredient(ing.id)}
                      className={`inline-btn w-full flex items-center gap-3 py-2.5 px-3 rounded-xl transition-all duration-150 text-left ${
                        checked
                          ? 'bg-surface-light-2/40 dark:bg-surface-dark-2/40'
                          : 'hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all duration-150 ${
                        checked
                          ? 'bg-accent border-accent'
                          : 'border-surface-light-3 dark:border-surface-dark-3'
                      }`}>
                        {checked && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[14px] transition-all duration-150 ${
                          checked
                            ? 'line-through text-text-light-muted/50 dark:text-text-dark-muted/50'
                            : 'text-text-light dark:text-text-dark'
                        }`}>
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

          {/* Start Cooking button (placeholder) */}
          <div className="pt-4 pb-8">
            <button
              disabled
              className="w-full py-3.5 rounded-2xl bg-accent/80 text-white font-semibold text-[15px] opacity-50 cursor-not-allowed"
            >
              🍳 Kochen starten
            </button>
            <p className="text-center text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50 mt-2">
              Koch-Modus kommt bald
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
