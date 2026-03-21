export interface Ingredient {
  id: number
  recipe_id: number
  sort_order: number
  name: string
  amount: number | null
  unit: string
  group_name: string
}

export interface Step {
  id: number
  recipe_id: number
  sort_order: number
  instruction: string
  duration_min: number
}

export interface Recipe {
  id: number
  title: string
  source_url: string
  image_path: string
  prep_time_min: number
  cook_time_min: number
  total_time_min: number
  servings: number
  rating: number
  notes: string
  last_cooked_at: string | null
  created_at: string
  updated_at: string
  tags: string[]
  // Only on detail
  ingredients?: Ingredient[]
  steps?: Step[]
}

export async function fetchRecipes(): Promise<Recipe[]> {
  const res = await fetch('/api/recipes')
  if (!res.ok) throw new Error('Failed to fetch recipes')
  return res.json()
}

export async function fetchRecipe(id: number): Promise<Recipe> {
  const res = await fetch(`/api/recipes/${id}`)
  if (!res.ok) throw new Error('Failed to fetch recipe')
  return res.json()
}

export async function searchRecipes(query: string): Promise<Recipe[]> {
  const res = await fetch(`/api/recipes/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error('Search failed')
  return res.json()
}

export async function updateRecipe(id: number, data: Partial<Recipe>): Promise<Recipe> {
  const res = await fetch(`/api/recipes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Update failed')
  return res.json()
}

export async function markCooked(id: number): Promise<void> {
  await fetch(`/api/recipes/${id}/cook`, { method: 'POST' })
}

export async function addToBring(items: { name: string; spec: string }[]): Promise<{ ok: boolean; results: { item: string; ok: boolean; error?: string }[] }> {
  const res = await fetch('/api/recipes/bring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  return res.json()
}
