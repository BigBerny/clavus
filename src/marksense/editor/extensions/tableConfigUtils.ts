/**
 * Parsing and serialization utilities for `<TableConfig>` MDX tags.
 *
 * A TableConfig tag defines column types for the immediately following table:
 *
 *   <TableConfig
 *     status={["Todo", "In Progress", "Done"]}
 *     priority={{ options: ["High", "Medium", "Low"], nullable: true }}
 *     tags={{ multi: ["bug", "feature", "docs"] }}
 *     done="boolean"
 *   />
 *
 * Prop names can be bare identifiers or quoted strings for names with spaces:
 *   - `status={...}`           →  bare identifier
 *   - `"Internal only"={...}`  →  quoted name (required when name contains spaces)
 *
 * Prop formats:
 *   - Array  →  singleSelect  (e.g. `status={["A", "B"]}`)
 *   - Object with `multi` key  →  multiSelect shorthand  (e.g. `tags={{ multi: ["A", "B"] }}`)
 *   - Object with `options` key  →  expanded form  (e.g. `{{ options: ["A", "B"], nullable: true }}`)
 *   - String `"boolean"`  →  boolean  (e.g. `done="boolean"`)
 *
 * Nullable columns allow an empty value (shown as a "Clear" option in the
 * dropdown).  Use the expanded object form to set `nullable: true`.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SingleSelectConfig {
  type: "singleSelect"
  options: string[]
  nullable: boolean
}

export interface MultiSelectConfig {
  type: "multiSelect"
  options: string[]
  nullable: boolean
}

export interface BooleanConfig {
  type: "boolean"
  nullable: boolean
}

export type ColumnConfig = SingleSelectConfig | MultiSelectConfig | BooleanConfig

export type ParsedTableConfig = Record<string, ColumnConfig>

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a `<TableConfig ... />` tag string into a structured config object.
 *
 * Returns an empty object if the tag cannot be parsed.
 */
export function parseTableConfigTag(tagString: string): ParsedTableConfig {
  const result: ParsedTableConfig = {}

  // Strip the tag wrapper: <TableConfig ... /> → attribute region
  const stripped = tagString
    .replace(/^<TableConfig\s*/, "")
    .replace(/\/\s*>\s*$/, "")
    .trim()

  if (!stripped) return result

  // Tokenize into name=value pairs
  const props = tokenizeProps(stripped)

  for (const [name, rawValue] of props) {
    const config = parseValue(rawValue)
    if (config) {
      result[name] = config
    }
  }

  return result
}

/**
 * Tokenize a JSX attribute string into [name, rawValue] pairs.
 *
 * Handles:
 *   name="value"
 *   name={expression}
 *   name={{ object }}
 */
function tokenizeProps(attrString: string): [string, string][] {
  const pairs: [string, string][] = []
  let i = 0

  while (i < attrString.length) {
    // Skip whitespace
    while (i < attrString.length && /\s/.test(attrString[i])) i++
    if (i >= attrString.length) break

    // Read prop name — either quoted ("Name With Spaces") or bare (word chars + hyphens)
    let name: string
    if (attrString[i] === '"') {
      i++ // skip opening "
      const nameStart = i
      while (i < attrString.length && attrString[i] !== '"') {
        if (attrString[i] === "\\") i++ // skip escaped char
        i++
      }
      name = attrString.slice(nameStart, i)
      i++ // skip closing "
    } else {
      const nameStart = i
      while (i < attrString.length && /[\w-]/.test(attrString[i])) i++
      name = attrString.slice(nameStart, i)
    }
    if (!name) break

    // Skip whitespace around =
    while (i < attrString.length && /\s/.test(attrString[i])) i++
    if (attrString[i] !== "=") {
      // Boolean attribute without value — skip
      continue
    }
    i++ // skip =
    while (i < attrString.length && /\s/.test(attrString[i])) i++

    // Read value
    if (attrString[i] === '"') {
      // String literal: "value"
      i++ // skip opening "
      const valueStart = i
      while (i < attrString.length && attrString[i] !== '"') {
        if (attrString[i] === "\\") i++ // skip escaped char
        i++
      }
      const value = attrString.slice(valueStart, i)
      i++ // skip closing "
      pairs.push([name, `"${value}"`])
    } else if (attrString[i] === "{") {
      // Expression: { ... } — need to match braces
      const valueStart = i
      i++ // skip opening {
      let depth = 1
      while (i < attrString.length && depth > 0) {
        if (attrString[i] === "{") depth++
        else if (attrString[i] === "}") depth--
        else if (attrString[i] === '"') {
          i++ // skip opening "
          while (i < attrString.length && attrString[i] !== '"') {
            if (attrString[i] === "\\") i++
            i++
          }
        } else if (attrString[i] === "'") {
          i++ // skip opening '
          while (i < attrString.length && attrString[i] !== "'") {
            if (attrString[i] === "\\") i++
            i++
          }
        }
        i++
      }
      const value = attrString.slice(valueStart, i)
      pairs.push([name, value])
    }
  }

  return pairs
}

/**
 * Parse a single prop value into a ColumnConfig.
 *
 * - `"boolean"` → BooleanConfig
 * - `{["A", "B"]}` → SingleSelectConfig (not nullable)
 * - `{{ multi: ["A", "B"] }}` → MultiSelectConfig shorthand (not nullable)
 * - `{{ options: ["A", "B"], nullable: true }}` → SingleSelectConfig (nullable)
 * - `{{ options: ["A", "B"], multi: true, nullable: true }}` → MultiSelectConfig (nullable)
 */
function parseValue(rawValue: string): ColumnConfig | null {
  // String literal: "boolean"
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    const inner = rawValue.slice(1, -1)
    if (inner === "boolean") {
      return { type: "boolean", nullable: false }
    }
    return null
  }

  // Expression: { ... }
  if (rawValue.startsWith("{") && rawValue.endsWith("}")) {
    // Unwrap outer { }
    let inner = rawValue.slice(1, -1).trim()

    // Check for object: {{ ... }}
    if (inner.startsWith("{") && inner.endsWith("}")) {
      inner = inner.slice(1, -1).trim()
      return parseObjectValue(inner)
    }

    // Array: ["A", "B"]
    if (inner.startsWith("[")) {
      const options = parseJsonArray(inner)
      if (options) {
        return { type: "singleSelect", options, nullable: false }
      }
    }
  }

  return null
}

/**
 * Parse the inside of an object expression `{ ... }`.
 *
 * Supported forms:
 *   - `multi: ["A", "B"]`  → multiSelect shorthand
 *   - `options: ["A", "B"], nullable: true`  → singleSelect, nullable
 *   - `options: ["A", "B"], multi: true`  → multiSelect
 *   - `options: ["A", "B"], multi: true, nullable: true`  → multiSelect, nullable
 */
function parseObjectValue(inner: string): ColumnConfig | null {
  // Simple shorthand: `multi: [...]`
  const multiShorthand = inner.match(/^multi\s*:\s*(\[[\s\S]*\])$/)
  if (multiShorthand) {
    const options = parseJsonArray(multiShorthand[1])
    if (options) {
      return { type: "multiSelect", options, nullable: false }
    }
    return null
  }

  // Expanded form: parse key-value pairs
  const obj = parseSimpleObject(inner)
  if (!obj) return null

  const options = obj.options ? parseJsonArray(obj.options) : null
  const isMulti = obj.multi === "true"
  const isNullable = obj.nullable === "true"

  if (options) {
    return isMulti
      ? { type: "multiSelect", options, nullable: isNullable }
      : { type: "singleSelect", options, nullable: isNullable }
  }

  return null
}

/**
 * Very simple key-value parser for object contents like:
 *   `options: ["A", "B"], multi: true, nullable: true`
 *
 * Returns a Record<string, string> of raw value strings.
 */
function parseSimpleObject(inner: string): Record<string, string> | null {
  const result: Record<string, string> = {}

  let i = 0
  while (i < inner.length) {
    // Skip whitespace and commas
    while (i < inner.length && /[\s,]/.test(inner[i])) i++
    if (i >= inner.length) break

    // Read key
    const keyStart = i
    while (i < inner.length && /[\w]/.test(inner[i])) i++
    const key = inner.slice(keyStart, i)
    if (!key) return null

    // Skip whitespace and colon
    while (i < inner.length && /\s/.test(inner[i])) i++
    if (inner[i] !== ":") return null
    i++
    while (i < inner.length && /\s/.test(inner[i])) i++

    // Read value — either [...], true/false, or a string
    if (inner[i] === "[") {
      const valueStart = i
      let depth = 1
      i++
      while (i < inner.length && depth > 0) {
        if (inner[i] === "[") depth++
        else if (inner[i] === "]") depth--
        else if (inner[i] === '"' || inner[i] === "'") {
          const quote = inner[i]
          i++
          while (i < inner.length && inner[i] !== quote) {
            if (inner[i] === "\\") i++
            i++
          }
        }
        i++
      }
      result[key] = inner.slice(valueStart, i)
    } else {
      // Read until comma or end
      const valueStart = i
      while (i < inner.length && inner[i] !== "," && inner[i] !== "}") i++
      result[key] = inner.slice(valueStart, i).trim()
    }
  }

  return result
}

/**
 * Parse a JSON-compatible array string into a string array.
 * Accepts both double and single-quoted strings.
 */
function parseJsonArray(arrayStr: string): string[] | null {
  try {
    // Normalise single quotes to double quotes for JSON.parse
    const normalised = arrayStr.replace(/'/g, '"')
    const parsed = JSON.parse(normalised)
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
      return parsed
    }
  } catch {
    // Fall through
  }
  return null
}

// ─── Serialization ──────────────────────────────────────────────────────────

/** Returns the prop name quoted if it contains characters outside `[\w-]`. */
function serializePropName(name: string): string {
  return /^[\w-]+$/.test(name) ? name : `"${name}"`
}

export function serializeTableConfig(config: ParsedTableConfig): string {
  const props = Object.entries(config)
    .map(([name, cfg]) => {
      const key = serializePropName(name)
      switch (cfg.type) {
        case "boolean":
          return `${key}="boolean"`
        case "singleSelect":
          if (cfg.nullable) {
            return `${key}={{ options: ${JSON.stringify(cfg.options)}, nullable: true }}`
          }
          return `${key}={${JSON.stringify(cfg.options)}}`
        case "multiSelect":
          if (cfg.nullable) {
            return `${key}={{ options: ${JSON.stringify(cfg.options)}, multi: true, nullable: true }}`
          }
          return `${key}={{ multi: ${JSON.stringify(cfg.options)} }}`
      }
    })
    .join(" ")

  return `<TableConfig ${props} />`
}
