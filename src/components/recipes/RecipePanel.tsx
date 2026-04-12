import { useState, useCallback } from 'react'
import { useUIStore } from '../../state/ui'
import { RecipeList } from './RecipeList'
import { RecipeDetail } from './RecipeDetail'
import { CookMode } from './CookMode'

type PanelView = 'list' | 'detail' | 'cook'

export function RecipePanel({ recipeId, isVisible }: { recipeId?: number; isVisible: boolean }) {
  const [view, setView] = useState<PanelView>(recipeId ? 'detail' : 'list')
  const setSelectedRecipeId = useUIStore(s => s.setSelectedRecipeId)

  const openRecipe = useCallback((id: number) => {
    setSelectedRecipeId(id)
    setView('detail')
  }, [setSelectedRecipeId])

  const goBack = useCallback(() => {
    setView('list')
  }, [])

  const startCooking = useCallback(() => {
    setView('cook')
  }, [])

  const exitCookMode = useCallback(() => {
    setView('detail')
  }, [])

  if (!isVisible) {
    // Still render but simplified when not active
    return <div className="flex-1 min-h-0" />
  }

  if (view === 'cook') {
    return <CookModeInline onExit={exitCookMode} />
  }

  if (view === 'detail') {
    return <RecipeDetail onBack={goBack} onStartCooking={startCooking} />
  }

  return <RecipeListInline onSelectRecipe={openRecipe} />
}

// Wrapper that passes onSelectRecipe instead of using setCurrentView
function RecipeListInline({ onSelectRecipe }: { onSelectRecipe: (id: number) => void }) {
  return <RecipeList onSelectRecipe={onSelectRecipe} isInline />
}

// Wrapper for CookMode that uses callback instead of setCurrentView
function CookModeInline({ onExit }: { onExit: () => void }) {
  return <CookMode onExit={onExit} isInline />
}
