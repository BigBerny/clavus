import { useState, useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '../../state/ui'
import { fetchRecipe } from '../../api/recipes'
import type { Recipe, Ingredient, Step } from '../../api/recipes'

function formatDuration(mins: number): string {
  if (!mins) return ''
  if (mins < 60) return `${mins} Min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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

function HighlightedInstruction({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2)
          return (
            <span key={i} className="inline-flex items-center px-2 py-1 rounded-lg bg-amber-500/15 dark:bg-amber-500/25 text-amber-600 dark:text-amber-300 font-bold text-[18px] mx-1">
              {inner}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

interface TimerState {
  id: string
  stepIndex: number
  label: string
  totalSeconds: number
  remainingSeconds: number
  paused: boolean
  done: boolean
}

// Alarm sound using Web Audio API
function playAlarm() {
  try {
    const ctx = new AudioContext()
    const playBeep = (time: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, time)
      gain.gain.exponentialRampToValueAtTime(0.01, time + dur)
      osc.start(time)
      osc.stop(time + dur)
    }
    // 3 beeps
    for (let i = 0; i < 3; i++) {
      playBeep(ctx.currentTime + i * 0.4, 880, 0.3)
    }
    // Repeat after 1.5s
    setTimeout(() => {
      for (let i = 0; i < 3; i++) {
        playBeep(ctx.currentTime + i * 0.4, 880, 0.3)
      }
    }, 1500)
  } catch { /* Audio not available */ }
}

// Ingredients Overlay
function IngredientsOverlay({ ingredients, servings, defaultServings, onClose }: {
  ingredients: Ingredient[]
  servings: number
  defaultServings: number
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-surface-light dark:bg-surface-dark rounded-t-3xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-light-3/50 dark:border-surface-dark-3/50">
          <h3 className="text-[18px] font-bold text-text-light dark:text-text-dark">Zutaten</h3>
          <button onClick={onClose} className="inline-btn w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface-light-2 dark:hover:bg-surface-dark-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {ingredients.map(ing => (
            <div key={ing.id} className="flex items-center gap-3 py-2 px-1">
              <span className="text-[16px] text-text-light dark:text-text-dark">
                {ing.amount !== null && (
                  <span className="font-bold text-amber-600 dark:text-amber-400 mr-1.5">
                    {scaleAmount(ing.amount, defaultServings, servings)}{ing.unit ? ` ${ing.unit}` : ''}
                  </span>
                )}
                {ing.name}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CookMode() {
  const selectedRecipeId = useUIStore(s => s.selectedRecipeId)
  const setCurrentView = useUIStore(s => s.setCurrentView)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentStep, setCurrentStep] = useState(0)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set())
  const [timers, setTimers] = useState<TimerState[]>([])
  const [showIngredients, setShowIngredients] = useState(false)
  const [servings, setServings] = useState(3)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Acquire Wake Lock
  useEffect(() => {
    async function acquireWakeLock() {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
        }
      } catch { /* not supported or denied */ }
    }
    acquireWakeLock()

    // Re-acquire on visibility change
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') acquireWakeLock()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Timer tick
  useEffect(() => {
    timerIntervalRef.current = setInterval(() => {
      setTimers(prev => prev.map(t => {
        if (t.paused || t.done) return t
        const newRemaining = t.remainingSeconds - 1
        if (newRemaining <= 0) {
          playAlarm()
          return { ...t, remainingSeconds: 0, done: true }
        }
        return { ...t, remainingSeconds: newRemaining }
      }))
    }, 1000)
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [])

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

  const exitCookMode = useCallback(() => {
    setCurrentView('recipe-detail')
  }, [setCurrentView])

  const toggleStepDone = useCallback((idx: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const startTimer = useCallback((stepIndex: number, minutes: number, label: string) => {
    const id = `timer-${stepIndex}-${Date.now()}`
    setTimers(prev => [...prev, {
      id,
      stepIndex,
      label: `Schritt ${stepIndex + 1}: ${label}`,
      totalSeconds: minutes * 60,
      remainingSeconds: minutes * 60,
      paused: false,
      done: false,
    }])
  }, [])

  const startManualTimer = useCallback((stepIndex: number) => {
    const minutes = parseInt(prompt('Timer in Minuten:') || '0')
    if (minutes > 0) {
      startTimer(stepIndex, minutes, `${minutes} Min`)
    }
  }, [startTimer])

  const togglePauseTimer = useCallback((id: string) => {
    setTimers(prev => prev.map(t => t.id === id ? { ...t, paused: !t.paused } : t))
  }, [])

  const addTimeToTimer = useCallback((id: string, seconds: number) => {
    setTimers(prev => prev.map(t => t.id === id ? { ...t, remainingSeconds: t.remainingSeconds + seconds, done: false } : t))
  }, [])

  const removeTimer = useCallback((id: string) => {
    setTimers(prev => prev.filter(t => t.id !== id))
  }, [])

  if (loading || !recipe) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950">
        <div className="voice-spinner" />
      </div>
    )
  }

  const steps = recipe.steps || []
  const step = steps[currentStep]
  const totalSteps = steps.length
  const progress = totalSteps > 0 ? (completedSteps.size / totalSteps) * 100 : 0
  const activeTimers = timers.filter(t => !t.done)
  const doneTimers = timers.filter(t => t.done)

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-gray-950 text-white">
      <div className="safe-area-top bg-gray-950" />

      {/* Timer Bar */}
      {timers.length > 0 && (
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 space-y-1.5 max-h-[35vh] overflow-y-auto">
          {doneTimers.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-500/20 border border-red-500/30 animate-pulse">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-red-300 font-medium truncate">{t.label}</p>
                <p className="text-[18px] font-bold text-red-400">⏰ Fertig!</p>
              </div>
              <button onClick={() => removeTimer(t.id)} className="inline-btn px-3 py-1.5 rounded-lg bg-red-500/30 text-red-300 text-[12px] font-medium">OK</button>
            </div>
          ))}
          {activeTimers.map(t => (
            <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-gray-800/80">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-gray-400 truncate">{t.label}</p>
                <p className="text-[20px] font-bold tabular-nums text-white">{formatTimer(t.remainingSeconds)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => togglePauseTimer(t.id)} className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">
                  {t.paused ? '▶' : '⏸'}
                </button>
                <button onClick={() => addTimeToTimer(t.id, 60)} className="inline-btn px-2 h-8 flex items-center justify-center rounded-lg bg-gray-700 text-gray-300 text-[11px] font-medium hover:bg-gray-600">+1m</button>
                <button onClick={() => removeTimer(t.id)} className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 text-[14px]">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-950">
        <button onClick={exitCookMode} className="inline-btn flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          <span className="text-[14px] font-medium">Fertig</span>
        </button>
        <div className="text-center">
          <p className="text-[12px] text-gray-500 font-medium">Schritt {currentStep + 1} / {totalSteps}</p>
        </div>
        <div className="w-16" /> {/* spacer */}
      </div>

      {/* Progress bar */}
      <div className="px-4 pb-3">
        <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Current Step */}
      <div className="flex-1 overflow-y-auto px-5 pb-8" style={{ WebkitOverflowScrolling: 'touch' }}>
        {step && (
          <div className="py-6">
            {/* Step number badge */}
            <div className="flex items-center gap-3 mb-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-[20px] font-bold transition-all ${completedSteps.has(currentStep) ? 'bg-green-500 text-white' : 'bg-accent/20 text-accent'}`}>
                {completedSteps.has(currentStep) ? '✓' : currentStep + 1}
              </div>
              {step.duration_min > 0 && (
                <span className="flex items-center gap-1.5 text-[14px] text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  {formatDuration(step.duration_min)}
                </span>
              )}
            </div>

            {/* Instruction text - large */}
            <div className="text-[20px] leading-relaxed text-gray-100 mb-6">
              <HighlightedInstruction text={step.instruction} />
            </div>

            {/* Timer buttons */}
            <div className="flex flex-col gap-2">
              {step.duration_min > 0 && (
                <button
                  onClick={() => startTimer(currentStep, step.duration_min, `${formatDuration(step.duration_min)}`)}
                  className="inline-btn w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500/15 text-amber-400 text-[15px] font-medium hover:bg-amber-500/25 transition-colors"
                >
                  ⏱ Timer starten ({formatDuration(step.duration_min)})
                </button>
              )}
              <button
                onClick={() => startManualTimer(currentStep)}
                className="inline-btn w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gray-800 text-gray-300 text-[15px] font-medium hover:bg-gray-700 transition-colors"
              >
                ⏱ Eigener Timer
              </button>
            </div>

            {/* Mark step done */}
            <button
              onClick={() => toggleStepDone(currentStep)}
              className={`inline-btn mt-6 w-full py-3 rounded-xl text-[15px] font-medium transition-all ${
                completedSteps.has(currentStep)
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {completedSteps.has(currentStep) ? '✓ Erledigt' : 'Als erledigt markieren'}
            </button>
          </div>
        )}

        {/* Step dots overview */}
        <div className="flex flex-wrap gap-2 mt-4 justify-center">
          {steps.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentStep(idx)}
              className={`inline-btn w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-all ${
                idx === currentStep
                  ? 'bg-accent text-white scale-110'
                  : completedSteps.has(idx)
                  ? 'bg-green-500/30 text-green-400'
                  : 'bg-gray-800 text-gray-500 hover:bg-gray-700'
              }`}
            >
              {completedSteps.has(idx) ? '✓' : idx + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation buttons - large, touch-friendly */}
      <div className="flex gap-3 px-5 py-4 bg-gray-950 border-t border-gray-800">
        <button
          onClick={() => setCurrentStep(s => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          className="inline-btn flex-1 py-4 rounded-2xl bg-gray-800 text-gray-300 text-[16px] font-semibold disabled:opacity-30 hover:bg-gray-700 active:scale-[0.97] transition-all"
        >
          ← Zurück
        </button>
        <button
          onClick={() => {
            if (currentStep < totalSteps - 1) {
              setCurrentStep(s => s + 1)
            } else {
              exitCookMode()
            }
          }}
          className="inline-btn flex-1 py-4 rounded-2xl bg-accent text-white text-[16px] font-semibold hover:bg-accent/90 active:scale-[0.97] transition-all"
        >
          {currentStep >= totalSteps - 1 ? '✓ Fertig' : 'Weiter →'}
        </button>
      </div>

      {/* Floating ingredients button */}
      <button
        onClick={() => setShowIngredients(true)}
        className="inline-btn fixed bottom-24 right-5 w-14 h-14 rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/30 flex items-center justify-center text-[22px] hover:bg-amber-600 active:scale-90 transition-all z-40"
      >
        🧾
      </button>

      {/* Ingredients overlay */}
      {showIngredients && recipe.ingredients && (
        <IngredientsOverlay
          ingredients={recipe.ingredients}
          servings={servings}
          defaultServings={recipe.servings}
          onClose={() => setShowIngredients(false)}
        />
      )}

      <div className="safe-area-bottom bg-gray-950" />
    </div>
  )
}
