import type { FileSearchFilter } from '../../file-search.js'

/**
 * Translate a typed `FileSearchFilter` (OpenAI-shaped) into Gemini's
 * `metadataFilter` string syntax (#B8.5).
 *
 * - `{ type: 'eq',  key, value }` → `key = value`
 * - `{ type: 'ne',  key, value }` → `key != value`
 * - `{ type: 'gt',  key, value }` → `key > value`
 * - `{ type: 'gte', key, value }` → `key >= value`
 * - `{ type: 'lt',  key, value }` → `key < value`
 * - `{ type: 'lte', key, value }` → `key <= value`
 * - `{ type: 'and', filters }`    → `(f1) AND (f2) AND ...`
 * - `{ type: 'or',  filters }`    → `(f1) OR (f2) OR ...`
 *
 * String values are wrapped in double quotes with `"` and `\` escaped.
 * Numbers and booleans render bare.
 *
 * Exported for unit testing — see `google-vector-stores.test.ts`.
 *
 * @internal
 */
export function filterToGeminiString(filter: FileSearchFilter): string {
  switch (filter.type) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const op = GEMINI_FILTER_OP[filter.type]
      return `${filter.key} ${op} ${formatGeminiValue(filter.value)}`
    }
    case 'and':
    case 'or': {
      if (filter.filters.length === 0) {
        throw new Error(
          `[ai-sdk] Gemini metadataFilter: ${filter.type.toUpperCase()} requires at least one sub-filter.`,
        )
      }
      const joiner = filter.type === 'and' ? ' AND ' : ' OR '
      return filter.filters.map(f => `(${filterToGeminiString(f)})`).join(joiner)
    }
  }
}

const GEMINI_FILTER_OP: Record<'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte', string> = {
  eq:  '=',
  ne:  '!=',
  gt:  '>',
  gte: '>=',
  lt:  '<',
  lte: '<=',
}

function formatGeminiValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return String(value)
}
