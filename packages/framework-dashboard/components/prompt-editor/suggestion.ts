import { Extension, type Editor, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SuggestionList, type SuggestionItem, type SuggestionListRef } from './SuggestionList.js'

// Wire @tiptap/suggestion (the `/` and `@` triggers, #470) to the floating SuggestionList.
// The suggestion plugin owns detection + positioning; this renders the React menu into a
// fixed portal at the caret and forwards key events to it. Each trigger gets its own
// PluginKey so the two menus never clash.
export interface TriggerConfig {
  /** The trigger character: `/` for commands, `@` for references. */
  char: string
  /** Unique plugin key name. */
  key: string
  /** Filter the menu items for the typed query (already lowercased is fine). */
  items: (query: string) => SuggestionItem[]
  /** Perform the insertion when an item is picked. */
  onSelect: (item: SuggestionItem, ctx: { editor: Editor; range: Range }) => void
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

function makeRender() {
  let el: HTMLDivElement | null = null
  let root: Root | null = null
  let listRef: SuggestionListRef | null = null

  const draw = (items: SuggestionItem[], command: (item: SuggestionItem) => void): void => {
    root?.render(
      createElement(SuggestionList, {
        items,
        command,
        ref: (r: SuggestionListRef | null) => {
          listRef = r
        },
      }),
    )
  }

  return {
    onStart(props: { items: SuggestionItem[]; command: (item: SuggestionItem) => void; clientRect?: (() => DOMRect | null) | null }) {
      el = document.createElement('div')
      el.style.position = 'fixed'
      el.style.zIndex = '50'
      document.body.appendChild(el)
      root = createRoot(el)
      place(el, props.clientRect?.() ?? null)
      draw(props.items, props.command)
    },
    onUpdate(props: { items: SuggestionItem[]; command: (item: SuggestionItem) => void; clientRect?: (() => DOMRect | null) | null }) {
      if (el) place(el, props.clientRect?.() ?? null)
      draw(props.items, props.command)
    },
    onKeyDown(props: { event: KeyboardEvent }) {
      if (props.event.key === 'Escape') return false
      return listRef?.onKeyDown(props.event) ?? false
    },
    onExit() {
      root?.unmount()
      el?.remove()
      root = null
      el = null
      listRef = null
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
          render: makeRender,
        }),
      ]
    },
  })
}
