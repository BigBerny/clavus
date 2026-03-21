import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DATA_DIR = path.join(process.env.HOME || '', '.openclaw/clavus-data')
export const IMAGES_DIR = path.join(DATA_DIR, 'recipe-images')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true })

  db = new Database(path.join(DATA_DIR, 'recipes.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_url TEXT DEFAULT '',
      source_urls TEXT DEFAULT '[]',
      image_path TEXT DEFAULT '',
      prep_time_min INTEGER DEFAULT 0,
      cook_time_min INTEGER DEFAULT 0,
      total_time_min INTEGER DEFAULT 0,
      servings INTEGER DEFAULT 3,
      rating INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      last_cooked_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      amount REAL,
      unit TEXT DEFAULT '',
      group_name TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      instruction TEXT NOT NULL,
      duration_min INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
  `)

  // Migration: add source_urls column if missing
  try {
    db.exec(`ALTER TABLE recipes ADD COLUMN source_urls TEXT DEFAULT '[]'`)
  } catch { /* column already exists */ }

  // Migration: populate source_urls from source_url for existing recipes
  try {
    const rows = db.prepare(`SELECT id, source_url, source_urls FROM recipes WHERE source_url != '' AND source_url IS NOT NULL AND (source_urls = '[]' OR source_urls IS NULL OR source_urls = '')`).all() as any[]
    const stmt = db.prepare(`UPDATE recipes SET source_urls = ? WHERE id = ?`)
    for (const row of rows) {
      const urls = JSON.stringify([{ url: row.source_url, type: 'article' }])
      stmt.run(urls, row.id)
    }
  } catch { /* ok */ }

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
        title, notes, ingredients_text, steps_text, tags_text,
        content=''
      );
    `)
  } catch {
    // Already exists
  }

  return db
}

export interface IngredientInput {
  name: string
  amount?: number | null
  unit?: string
  group_name?: string
}

export interface StepInput {
  instruction: string
  duration_min?: number
}

export interface SourceUrl {
  url: string
  type: 'article' | 'video' | 'other'
}

export interface RecipeInput {
  title: string
  source_url?: string
  source_urls?: SourceUrl[]
  image_path?: string
  image_url?: string
  prep_time_min?: number
  cook_time_min?: number
  total_time_min?: number
  servings?: number
  rating?: number
  notes?: string
  ingredients?: IngredientInput[]
  steps?: StepInput[]
  tags?: string[]
  force?: boolean
}

function updateFtsIndex(db: Database.Database, recipeId: number) {
  try { db.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(recipeId) } catch { /* ok */ }

  const recipe = db.prepare('SELECT title, notes FROM recipes WHERE id = ?').get(recipeId) as any
  if (!recipe) return

  const ingredients = db.prepare('SELECT name FROM ingredients WHERE recipe_id = ? ORDER BY sort_order').all(recipeId) as any[]
  const steps = db.prepare('SELECT instruction FROM steps WHERE recipe_id = ? ORDER BY sort_order').all(recipeId) as any[]
  const tags = db.prepare('SELECT name FROM tags WHERE recipe_id = ?').all(recipeId) as any[]

  try {
    db.prepare('INSERT INTO recipes_fts (rowid, title, notes, ingredients_text, steps_text, tags_text) VALUES (?, ?, ?, ?, ?, ?)').run(
      recipeId, recipe.title, recipe.notes || '',
      ingredients.map(i => i.name).join(' '),
      steps.map(s => s.instruction).join(' '),
      tags.map(t => t.name).join(' ')
    )
  } catch { /* FTS may not be available */ }
}

export function checkDuplicate(title: string, sourceUrl?: string): { id: number; title: string; match: string } | null {
  const d = getDb()
  if (sourceUrl) {
    const byUrl = d.prepare('SELECT id, title FROM recipes WHERE source_url = ?').get(sourceUrl) as any
    if (byUrl) return { id: byUrl.id, title: byUrl.title, match: 'url' }
  }
  const normalized = title.trim().toLowerCase()
  const byTitle = d.prepare('SELECT id, title FROM recipes WHERE LOWER(TRIM(title)) = ?').get(normalized) as any
  if (byTitle) return { id: byTitle.id, title: byTitle.title, match: 'title' }
  return null
}

export function createRecipe(input: RecipeInput): number {
  const d = getDb()
  // Build source_urls: prefer explicit source_urls, fall back to source_url
  let sourceUrls: SourceUrl[] = input.source_urls || []
  if (!sourceUrls.length && input.source_url) {
    sourceUrls = [{ url: input.source_url, type: 'article' }]
  }
  const sourceUrl = input.source_url || (sourceUrls.length ? sourceUrls[0].url : '')

  const result = d.prepare(`
    INSERT INTO recipes (title, source_url, source_urls, image_path, prep_time_min, cook_time_min, total_time_min, servings, rating, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.title, sourceUrl, JSON.stringify(sourceUrls), input.image_path || '',
    input.prep_time_min || 0, input.cook_time_min || 0, input.total_time_min || 0,
    input.servings || 3, input.rating || 0, input.notes || ''
  )
  const recipeId = result.lastInsertRowid as number

  if (input.ingredients?.length) {
    const stmt = d.prepare('INSERT INTO ingredients (recipe_id, sort_order, name, amount, unit, group_name) VALUES (?, ?, ?, ?, ?, ?)')
    input.ingredients.forEach((ing, i) => {
      stmt.run(recipeId, i, ing.name, ing.amount ?? null, ing.unit || '', ing.group_name || '')
    })
  }

  if (input.steps?.length) {
    const stmt = d.prepare('INSERT INTO steps (recipe_id, sort_order, instruction, duration_min) VALUES (?, ?, ?, ?)')
    input.steps.forEach((step, i) => {
      stmt.run(recipeId, i, step.instruction, step.duration_min || 0)
    })
  }

  if (input.tags?.length) {
    const stmt = d.prepare('INSERT INTO tags (recipe_id, name) VALUES (?, ?)')
    input.tags.forEach(tag => stmt.run(recipeId, tag))
  }

  updateFtsIndex(d, recipeId)
  return recipeId
}

export function updateRecipe(id: number, input: Partial<RecipeInput>) {
  const d = getDb()
  const fields: string[] = []
  const values: any[] = []

  // Handle source_urls
  if (input.source_urls !== undefined) {
    fields.push('source_urls = ?')
    values.push(JSON.stringify(input.source_urls))
    // Keep source_url in sync (first URL)
    if (input.source_urls.length > 0 && input.source_url === undefined) {
      fields.push('source_url = ?')
      values.push(input.source_urls[0].url)
    }
  } else if (input.source_url !== undefined && input.source_urls === undefined) {
    // Backward compat: source_url string → convert to source_urls array
    fields.push('source_urls = ?')
    values.push(JSON.stringify(input.source_url ? [{ url: input.source_url, type: 'article' }] : []))
  }

  const simple = ['title', 'source_url', 'image_path', 'prep_time_min', 'cook_time_min', 'total_time_min', 'servings', 'rating', 'notes'] as const
  for (const f of simple) {
    if (input[f] !== undefined) { fields.push(`${f} = ?`); values.push(input[f]) }
  }

  if (fields.length) {
    fields.push("updated_at = datetime('now')")
    values.push(id)
    d.prepare(`UPDATE recipes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  if (input.ingredients !== undefined) {
    d.prepare('DELETE FROM ingredients WHERE recipe_id = ?').run(id)
    const stmt = d.prepare('INSERT INTO ingredients (recipe_id, sort_order, name, amount, unit, group_name) VALUES (?, ?, ?, ?, ?, ?)')
    input.ingredients.forEach((ing, i) => {
      stmt.run(id, i, ing.name, ing.amount ?? null, ing.unit || '', ing.group_name || '')
    })
  }

  if (input.steps !== undefined) {
    d.prepare('DELETE FROM steps WHERE recipe_id = ?').run(id)
    const stmt = d.prepare('INSERT INTO steps (recipe_id, sort_order, instruction, duration_min) VALUES (?, ?, ?, ?)')
    input.steps.forEach((step, i) => {
      stmt.run(id, i, step.instruction, step.duration_min || 0)
    })
  }

  if (input.tags !== undefined) {
    d.prepare('DELETE FROM tags WHERE recipe_id = ?').run(id)
    const stmt = d.prepare('INSERT INTO tags (recipe_id, name) VALUES (?, ?)')
    input.tags.forEach(tag => stmt.run(id, tag))
  }

  updateFtsIndex(d, id)
}

export function getRecipeWithDetails(id: number) {
  const d = getDb()
  const recipe = d.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as any
  if (!recipe) return null
  recipe.ingredients = d.prepare('SELECT * FROM ingredients WHERE recipe_id = ? ORDER BY sort_order').all(id)
  recipe.steps = d.prepare('SELECT * FROM steps WHERE recipe_id = ? ORDER BY sort_order').all(id)
  recipe.tags = d.prepare('SELECT name FROM tags WHERE recipe_id = ?').all(id).map((t: any) => t.name)
  // Parse source_urls JSON
  try {
    recipe.source_urls = recipe.source_urls ? JSON.parse(recipe.source_urls) : []
  } catch {
    recipe.source_urls = []
  }
  // Backward compat: ensure source_urls has at least source_url if empty
  if ((!recipe.source_urls || recipe.source_urls.length === 0) && recipe.source_url) {
    recipe.source_urls = [{ url: recipe.source_url, type: 'article' }]
  }
  return recipe
}

export function getAllRecipes() {
  const d = getDb()
  return d.prepare(`
    SELECT r.*, GROUP_CONCAT(DISTINCT t.name) as tag_list
    FROM recipes r LEFT JOIN tags t ON t.recipe_id = r.id
    GROUP BY r.id ORDER BY r.updated_at DESC
  `).all().map((r: any) => ({ ...r, tags: r.tag_list ? r.tag_list.split(',') : [] }))
}

export function searchRecipes(query: string) {
  const d = getDb()
  try {
    const ids = d.prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ? ORDER BY rank').all(query + '*').map((r: any) => r.rowid)
    if (!ids.length) return []
    const ph = ids.map(() => '?').join(',')
    return d.prepare(`
      SELECT r.*, GROUP_CONCAT(DISTINCT t.name) as tag_list
      FROM recipes r LEFT JOIN tags t ON t.recipe_id = r.id
      WHERE r.id IN (${ph}) GROUP BY r.id
    `).all(...ids).map((r: any) => ({ ...r, tags: r.tag_list ? r.tag_list.split(',') : [] }))
  } catch {
    // FTS fallback: LIKE search
    return d.prepare(`
      SELECT r.*, GROUP_CONCAT(DISTINCT t.name) as tag_list
      FROM recipes r LEFT JOIN tags t ON t.recipe_id = r.id
      WHERE r.title LIKE ? GROUP BY r.id
    `).all(`%${query}%`).map((r: any) => ({ ...r, tags: r.tag_list ? r.tag_list.split(',') : [] }))
  }
}

export function deleteRecipe(id: number) {
  const d = getDb()
  const recipe = d.prepare('SELECT image_path FROM recipes WHERE id = ?').get(id) as any
  if (recipe?.image_path) {
    const absImg = path.join(IMAGES_DIR, path.basename(recipe.image_path))
    if (fs.existsSync(absImg)) fs.unlinkSync(absImg)
  }
  try { d.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(id) } catch { /* ok */ }
  d.prepare('DELETE FROM recipes WHERE id = ?').run(id)
}

export function markCooked(id: number) {
  const d = getDb()
  d.prepare("UPDATE recipes SET last_cooked_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id)
}
