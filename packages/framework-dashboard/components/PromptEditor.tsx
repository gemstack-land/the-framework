import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ProjectSummary } from '@gemstack/framework'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { Editor, Range } from '@tiptap/core'
import { Token, MACRO_TOKENS, ACTION_TOKENS, type TokenSpec } from './prompt-editor/tokens.js'
import { makeTrigger } from './prompt-editor/suggestion.js'
import { tokenizeEditorDoc } from './prompt-editor/tokenize.js'
import type { SuggestionItem } from './prompt-editor/SuggestionList.js'

// The rich prompt editor (#470): a Tiptap surface that replaces the plain textarea. `/` opens
// commands (load a preset, insert an agent action like `showMultiSelect()`), `@` opens
// references (the repeated macro tags `<AWAIT>`/`<REVIEW_FILE>`… and the registered projects).
// Inserted tokens render as chips but serialize back to the exact prompt text the agent reads,
// so nothing downstream changes. Markdown is live (StarterKit shortcuts) and round-trips via
// tiptap-markdown. The editor is imperative for preset loading; text flows out via onChange.

export interface PromptEditorHandle {
  /** Replace the content with a preset/template string, chip-ifying its tokens. */
  loadTemplate: (text: string) => void
  clear: () => void
  focus: () => void
}

interface PromptEditorProps {
  onChange: (markdown: string) => void
  /** Cmd/Ctrl+Enter. */
  onSubmit: () => void
  /** A preset picked from the `/` menu (so the form can flip to a `prompt` run). */
  onPreset?: (label: string) => void
  /** A project referenced via `@` (so the form can add it to the run context). */
  onMentionProject?: (path: string) => void
  projects: ProjectSummary[]
  presets: { id: string; label: string; render: () => string }[]
  disabled?: boolean
  placeholder?: string
}

/** Insert a token chip at the suggestion range, followed by a space. */
function insertToken(editor: Editor, range: Range, spec: TokenSpec): void {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([{ type: 'token', attrs: { kind: spec.kind, label: spec.label, text: spec.text } }, { type: 'text', text: ' ' }])
    .run()
}

/**
 * Replace the editor content with a template and chip-ify its token strings. Takes the live
 * editor instance (not a captured one), so it works from the `/` menu — whose closures are
 * built once on first render, when the useEditor result is still null.
 */
function applyTemplate(editor: Editor, text: string): void {
  editor.commands.setContent(text)
  tokenizeEditorDoc(editor)
  editor.commands.focus('end')
}

export const PromptEditor = forwardRef<PromptEditorHandle, PromptEditorProps>(function PromptEditor(
  { onChange, onSubmit, onPreset, onMentionProject, projects, presets, disabled = false, placeholder = 'Describe what to build…  ( / commands · < tags · @ projects )' },
  ref,
) {
  const [isEmpty, setIsEmpty] = useState(true)

  // Refs so the once-built suggestion closures always see the latest props/editor.
  const projectsRef = useRef(projects)
  const presetsRef = useRef(presets)
  const onPresetRef = useRef(onPreset)
  const onMentionRef = useRef(onMentionProject)
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    projectsRef.current = projects
    presetsRef.current = presets
    onPresetRef.current = onPreset
    onMentionRef.current = onMentionProject
    onChangeRef.current = onChange
    onSubmitRef.current = onSubmit
  })

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      // breaks:true keeps a single newline as a hard break, so a preset's line-per-line
      // definition block (REVIEW_FILE: … / TODO_FILE: …) survives the markdown round-trip
      // instead of collapsing into one paragraph.
      Markdown.configure({ html: false, linkify: false, breaks: true, transformPastedText: true }),
      Token,
      // `/` — commands: presets (load a template) + agent actions (insert a call token).
      makeTrigger({
        char: '/',
        key: 'slash',
        items: query => {
          const presetItems: SuggestionItem[] = presetsRef.current
            .filter(p => p.id.includes(query) || p.label.toLowerCase().includes(query))
            .map(p => ({ id: `preset:${p.id}`, label: `/${p.id}`, hint: p.label, group: 'Presets' }))
          const actionItems: SuggestionItem[] = ACTION_TOKENS.filter(a => a.label.toLowerCase().includes(query)).map(a => ({
            id: `action:${a.text}`,
            label: a.label,
            hint: a.hint,
            group: 'Actions',
          }))
          return [...presetItems, ...actionItems]
        },
        onSelect: (item, { editor: ed, range }) => {
          if (item.id.startsWith('preset:')) {
            const preset = presetsRef.current.find(p => `preset:${p.id}` === item.id)
            if (preset) {
              applyTemplate(ed, preset.render())
              setIsEmpty(ed.isEmpty)
              onChangeRef.current(ed.storage.markdown.getMarkdown())
              onPresetRef.current?.(preset.label)
            }
            return
          }
          const action = ACTION_TOKENS.find(a => `action:${a.text}` === item.id)
          if (action) insertToken(ed, range, action)
        },
      }),
      // `<` — tags: the repeated macros, which all read as `<NAME>`. Typing `<` opens the
      // menu; a non-matching character or a space closes it (the suggestion ends on a space,
      // and the menu hides when nothing matches), so a stray `<` in prose is not a trap.
      makeTrigger({
        char: '<',
        key: 'tag',
        items: query =>
          MACRO_TOKENS.filter(m => m.label.toLowerCase().includes(query)).map(m => ({
            id: `macro:${m.text}`,
            label: m.label,
            hint: m.hint,
            group: 'Tags',
          })),
        onSelect: (item, { editor: ed, range }) => {
          const macro = MACRO_TOKENS.find(m => `macro:${m.text}` === item.id)
          if (macro) insertToken(ed, range, macro)
        },
      }),
      // `@` — references: the registered projects. A mention also focuses the run on that repo.
      makeTrigger({
        char: '@',
        key: 'at',
        items: query =>
          projectsRef.current
            .filter(p => p.name.toLowerCase().includes(query))
            .slice(0, 8)
            .map(p => ({ id: `project:${p.id}`, label: `@${p.name}`, hint: 'project', group: 'Projects' })),
        onSelect: (item, { editor: ed, range }) => {
          const project = projectsRef.current.find(p => `project:${p.id}` === item.id)
          if (project) {
            insertToken(ed, range, { kind: 'project', label: `@${project.name}`, text: `@${project.name}` })
            onMentionRef.current?.(project.path)
          }
        },
      }),
    ],
    editorProps: {
      attributes: { class: 'pe-prose focus:outline-none' },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault()
          onSubmitRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      setIsEmpty(ed.isEmpty)
      onChangeRef.current(ed.storage.markdown.getMarkdown())
    },
  })

  // Replace the content with a template and turn its token strings into chips.
  function loadTemplate(text: string): void {
    if (!editor) return
    applyTemplate(editor, text)
    setIsEmpty(editor.isEmpty)
    onChangeRef.current(editor.storage.markdown.getMarkdown())
  }

  useImperativeHandle(ref, () => ({
    loadTemplate,
    clear: () => {
      editor?.commands.clearContent()
      setIsEmpty(true)
      onChangeRef.current('')
    },
    focus: () => editor?.commands.focus('end'),
  }))

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  return (
    <div className="relative">
      <EditorContent
        editor={editor}
        className="max-h-64 min-h-[4.5rem] w-full overflow-y-auto rounded-md border border-border bg-transparent p-2 text-sm focus-within:ring-2 focus-within:ring-[var(--color-primary)]"
      />
      {isEmpty && (
        <span className="pointer-events-none absolute left-2 top-2 text-sm text-muted-foreground">{placeholder}</span>
      )}
    </div>
  )
})
