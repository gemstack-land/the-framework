import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'

// The prompt editor's tokens (#470). A token is an inline chip that reads as a pill in the
// editor but serializes back to the EXACT plain text the agent already parses today — an
// angle-bracket macro (`<AWAIT>`, `<REVIEW_FILE>`), an action call (`showMultiSelect()`), or
// a reference (`@my-app`). Because a chip flattens to its `text` verbatim, the prompt over
// the wire is unchanged: presets, the run contract, everything downstream stays the same.

/** What a token is, which drives its chip colour and which menu inserts it. */
export type TokenKind = 'macro' | 'action' | 'reference' | 'project'

/** One insertable token: how it reads (label) and how it serializes (text). */
export interface TokenSpec {
  kind: TokenKind
  /** The chip label shown in the editor. */
  label: string
  /** The exact string written to the prompt on submit. */
  text: string
  /** One-line menu hint. */
  hint?: string
}

/** Agent macros defined-and-referenced in the preset templates (#331/#326); the repeated tags. */
export const MACRO_TOKENS: TokenSpec[] = [
  { kind: 'macro', label: 'AWAIT', text: '<AWAIT>', hint: 'Stop and wait for the user' },
  { kind: 'macro', label: 'REVIEW_FILE', text: '<REVIEW_FILE>', hint: 'The review scratch file' },
  { kind: 'macro', label: 'TODO_FILE', text: '<TODO_FILE>', hint: 'The session TODO file' },
  { kind: 'macro', label: 'PLAN_FILE', text: '<PLAN_FILE>', hint: 'The session plan file' },
  { kind: 'macro', label: 'SESSION_NAME', text: '<SESSION_NAME>', hint: 'The sanitized branch slug' },
  { kind: 'macro', label: 'FUNCTION', text: '<FUNCTION>', hint: 'A function placeholder' },
]

/** Agent action calls that become turn-boundary gates (#339/#340). */
export const ACTION_TOKENS: TokenSpec[] = [
  { kind: 'action', label: 'showChoices()', text: 'showChoices()', hint: 'Single-select gate' },
  { kind: 'action', label: 'showMultiSelect()', text: 'showMultiSelect()', hint: 'Multi-select gate' },
  { kind: 'action', label: 'showMarkdown()', text: 'showMarkdown()', hint: 'Push a markdown view' },
]

/** Match any insertable token in free text, so a loaded preset can be chip-ified (tokenize.ts). */
export const TOKEN_PATTERN = /<[A-Z][A-Z0-9_]*>|show[A-Za-z]+\(\)/g

/**
 * The token spec for a matched string. A catalogued macro/action matches case-insensitively
 * and normalizes to its canonical form (so a typed `<await>` becomes the `<AWAIT>` the agent
 * expects); anything else keeps exactly what was typed.
 */
export function specForText(text: string): TokenSpec {
  const known = [...MACRO_TOKENS, ...ACTION_TOKENS].find(t => t.text.toLowerCase() === text.toLowerCase())
  if (known) return known
  if (text.endsWith('()')) return { kind: 'action', label: text, text }
  return { kind: 'macro', label: text.replace(/^<|>$/g, ''), text }
}

/**
 * The inline token node. It is an atom (edited as one unit, not character-by-character) that
 * carries its display `label` and its serialized `text`. `tiptap-markdown` serializes it by
 * writing `text` raw — no escaping — so `<AWAIT>` survives as `<AWAIT>` rather than `\<AWAIT\>`.
 */
export const Token = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'macro' as TokenKind },
      label: { default: '' },
      text: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-token]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-token': node.attrs.kind,
        class: 'pe-token',
      }),
      node.attrs.label || node.attrs.text,
    ]
  },

  // Plain-text extraction (editor.getText) — mirrors the markdown serialization below.
  renderText({ node }) {
    return node.attrs.text
  },

  // Auto-convert a fully typed token into a chip: `<NAME>` when the closing `>` lands, and
  // `showX()` when the closing `)` lands. specForText normalizes a known token's case.
  addInputRules() {
    const toAttrs = (match: RegExpMatchArray) => {
      const spec = specForText(match[0])
      return { kind: spec.kind, label: spec.label, text: spec.text }
    }
    return [
      nodeInputRule({ find: /<([A-Za-z][A-Za-z0-9_]*)>$/, type: this.type, getAttributes: toAttrs }),
      nodeInputRule({ find: /(show[A-Za-z]+\(\))$/, type: this.type, getAttributes: toAttrs }),
    ]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { text: string } }) {
          state.write(node.attrs.text)
        },
        parse: {},
      },
    }
  },
})
