import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SuggestionList, type SuggestionItem, type SuggestionListRef } from './SuggestionList.js'

// Wire @tiptap/suggestion (the `/` and `@` triggers, #470) to the floating SuggestionList.
// The suggestion plugin owns detection + positioning; this renders the React menu into a
// fixed portal at the caret and forwards key events to it. Each trigger gets its own
// PluginKey so the two menus never clash. The open menu also announces itself to assistive
// tech (#948): the editor gets aria-expanded + aria-activedescendant while it shows.
export interface TriggerConfig {
  /** The trigger character: `/` for commands, `@` for references. */
  char: string
  /** Unique plugin key name. */
  key: string
  /** Filter the menu items for the typed query (already lowercased is fine). */
  items: (query: string) => SuggestionItem[]
  /** Perform the insertion when an item is picked. */
  onSelect: (item: SuggestionItem, ctx: { editor: Editor; range: Range }) => void
  /** Shown when the source is empty on a fresh trigger (nothing typed yet). Without it an
   *  unloaded/empty source makes the trigger look broken — nothing appears at all (#948). */
  emptyNote?: string
}

/** Position a fixed portal just below the caret rect, flipping up near the viewport bottom. */
function place(el: HTMLElement, rect: DOMRect | null): void {
  if (!rect) return
  const below = window.innerHeight - rect.bottom
  el.style.left = `${rect.left}px`
  if (below < 320) {
    el.style.top = ''
    el.style.bottom = `${window.innerHeight - rect.top + 4}px`
  } else {
    el.style.bottom = ''
    el.style.top = `${rect.bottom + 4}px`
  }
}

type RenderProps = {
  items: SuggestionItem[]
  command: (item: SuggestionItem) => void
  clientRect?: (() => DOMRect | null) | null
  query?: string
  editor?: Editor
}

function makeRender(config: TriggerConfig) {
  let el: HTMLDivElement | null = null
  let root: Root | null = null
  let listRef: SuggestionListRef | null = null
  // The latest caret-rect getter, re-read on scroll/resize so the menu tracks the caret
  // instead of staying pinned where it first opened.
  let getRect: (() => DOMRect | null) | null = null
  // The editor's contenteditable, for the aria combobox wiring while the menu is open.
  let editorDom: HTMLElement | null = null

  const setActive = (id: string | null): void => {
    if (!editorDom) return
    if (id) editorDom.setAttribute('aria-activedescendant', id)
    else editorDom.removeAttribute('aria-activedescendant')
  }

  const draw = (props: RenderProps): void => {
    const { items, command } = props
    // An empty-source fresh trigger shows the note; a mistyped query closes the menu, so a
    // stray `<`/`@` in prose is not a trap. The plugin stays active — the menu reappears if
    // a later key matches.
    const note = items.length === 0 && !props.query ? config.emptyNote : undefined
    if (el) el.style.display = items.length === 0 && !note ? 'none' : ''
    root?.render(
      createElement(SuggestionList, {
        items,
        command,
        emptyNote: note,
        onActiveChange: setActive,
        ref: (r: SuggestionListRef | null) => {
          listRef = r
        },
      }),
    )
  }

  const reposition = (): void => {
    if (el) place(el, getRect?.() ?? null)
  }

  return {
    onStart(props: RenderProps) {
      el = document.createElement('div')
      el.style.position = 'fixed'
      el.style.zIndex = '50'
      document.body.appendChild(el)
      root = createRoot(el)
      getRect = props.clientRect ?? null
      editorDom = props.editor?.view.dom ?? null
      editorDom?.setAttribute('aria-expanded', 'true')
      reposition()
      draw(props)
      // Capture-phase scroll catches the editor's own scroll container, not just the window.
      window.addEventListener('scroll', reposition, true)
      window.addEventListener('resize', reposition)
    },
    onUpdate(props: RenderProps) {
      getRect = props.clientRect ?? null
      reposition()
      draw(props)
    },
    onKeyDown(props: { event: KeyboardEvent }) {
      if (props.event.key === 'Escape') return false
      return listRef?.onKeyDown(props.event) ?? false
    },
    onExit() {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      editorDom?.setAttribute('aria-expanded', 'false')
      setActive(null)
      editorDom = null
      root?.unmount()
      el?.remove()
      root = null
      el = null
      listRef = null
      getRect = null
    },
  }
}

/** An editor extension that adds one suggestion trigger. */
export function makeTrigger(config: TriggerConfig): Extension {
  return Extension.create({
    name: `suggestion-${config.key}`,
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: config.char,
          pluginKey: new PluginKey(config.key),
          items: ({ query }: { query: string }) => config.items(query.toLowerCase()),
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SuggestionItem }) =>
            config.onSelect(props, { editor, range }),
          render: () => makeRender(config),
        }),
      ]
    },
  })
}
