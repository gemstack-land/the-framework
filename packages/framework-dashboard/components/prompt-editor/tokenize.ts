import type { Editor } from '@tiptap/core'
import { TOKEN_PATTERN, specForText } from './tokens.js'

// Turn the plain token strings in the editor (e.g. from a just-loaded preset) into token
// chips (#470). Scans every text node for `<MACRO>` / `showX()` matches and replaces each
// with a token node in one transaction, applied back-to-front so earlier offsets stay valid.
export function tokenizeEditorDoc(editor: Editor): void {
  const tokenType = editor.schema.nodes.token
  if (!tokenType) return

  const matches: { from: number; to: number; text: string }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    // Leave tokens inside inline code untouched so a `path/<SESSION_NAME>.md` span stays a
    // single verbatim code span rather than being split around a chip.
    if (node.marks.some(mark => mark.type.name === 'code')) return
    for (const m of node.text.matchAll(TOKEN_PATTERN)) {
      const from = pos + (m.index ?? 0)
      matches.push({ from, to: from + m[0].length, text: m[0] })
    }
  })
  if (matches.length === 0) return

  const tr = editor.state.tr
  for (const match of matches.reverse()) {
    const spec = specForText(match.text)
    tr.replaceWith(match.from, match.to, tokenType.create({ kind: spec.kind, label: spec.label, text: spec.text }))
  }
  editor.view.dispatch(tr)
}
