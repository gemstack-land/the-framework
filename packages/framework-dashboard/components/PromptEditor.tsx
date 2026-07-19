import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ProjectSummary, CustomPreset } from '@gemstack/framework'
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
  /** A file referenced via `#` (so the form can add its repo-relative path to the run context). */
  onMentionFile?: (relPath: string) => void
  projects: ProjectSummary[]
  /** The current project's files, repo-relative, for the `#` picker (#504). */
  files?: string[]
  presets: { id: string; label: string; render: () => string }[]
  /** The user's saved presets (#626), loaded verbatim from the `/` menu (#722). */
  customPresets?: CustomPreset[]
  /** Open the create panel from the `/` menu's "New preset…" (#722). Omit where there is no panel
   *  (the compact navbar launch), which also drops the item. */
  onNewPreset?: () => void
  disabled?: boolean
  placeholder?: string
  /** A shorter surface for the navbar quick-launch (#723): starts one line tall instead of ~three. */
  compact?: boolean
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
  { onChange, onSubmit, onPreset, onMentionProject, onMentionFile, projects, files = [], presets, customPresets = [], onNewPreset, disabled = false, placeholder = 'Describe what to build…  ( / commands · < tags · @ projects · # files )', compact = false },
  ref,
) {
  const [isEmpty, setIsEmpty] = useState(true)

  // Refs so the once-built suggestion closures always see the latest props/editor.
  const projectsRef = useRef(projects)
  const filesRef = useRef(files)
  const presetsRef = useRef(presets)
  const customPresetsRef = useRef(customPresets)
  const onNewPresetRef = useRef(onNewPreset)
  const onPresetRef = useRef(onPreset)
  const onMentionRef = useRef(onMentionProject)
  const onMentionFileRef = useRef(onMentionFile)
  const onChangeRef = useRef(onChange)
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    projectsRef.current = projects
    filesRef.current = files
    presetsRef.current = presets
    customPresetsRef.current = customPresets
    onNewPresetRef.current = onNewPreset
    onPresetRef.current = onPreset
    onMentionRef.current = onMentionProject
    onMentionFileRef.current = onMentionFile
    onChangeRef.current = onChange
    onSubmitRef.current = onSubmit
  })

  // Load a template into the live editor and sync the derived state (the empty flag + the
  // markdown out). Takes the editor as an argument so the `/` menu — whose closures are built
  // once, before useEditor resolves — can call it too, not only the imperative handle.
  const loadTemplateInto = (ed: Editor, text: string): void => {
    // Loading a preset replaces the whole editor, so guard typed work (#695/U11): a non-empty
    // editor gets one confirm before its content is discarded. An empty editor loads silently.
    if (!ed.isEmpty && typeof window !== 'undefined' && !window.confirm('Replace your current prompt with this preset?')) return
    applyTemplate(ed, text)
    setIsEmpty(ed.isEmpty)
    onChangeRef.current(ed.storage.markdown.getMarkdown())
  }

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
          const q = query.toLowerCase()
          const presetItems: SuggestionItem[] = presetsRef.current
            .filter(p => p.id.includes(query) || p.label.toLowerCase().includes(q))
            .map(p => ({ id: `preset:${p.id}`, label: `/${p.id}`, hint: p.label, group: 'Presets' }))
          // The user's saved presets (#626) load verbatim; they live in the same `/` group as the
          // built-ins now that the standalone Presets dropdown is gone (#722).
          const customItems: SuggestionItem[] = customPresetsRef.current
            .filter(p => p.label.toLowerCase().includes(q))
            .map(p => ({ id: `custom-preset:${p.id}`, label: p.label, hint: 'saved preset', group: 'Presets' }))
          // "New preset…" to capture the current prompt (#722), only where the create panel exists
          // (the full composer, not the compact navbar launch, which passes no onNewPreset).
          const newPresetItem: SuggestionItem[] =
            onNewPresetRef.current && 'new preset'.includes(q)
              ? [{ id: 'new-preset', label: 'New preset…', hint: 'save the current prompt', group: 'Presets' }]
              : []
          const actionItems: SuggestionItem[] = ACTION_TOKENS.filter(a => a.label.toLowerCase().includes(q)).map(a => ({
            id: `action:${a.text}`,
            label: a.label,
            hint: a.hint,
            group: 'Actions',
          }))
          return [...presetItems, ...customItems, ...newPresetItem, ...actionItems]
        },
        onSelect: (item, { editor: ed, range }) => {
          if (item.id.startsWith('preset:')) {
            const preset = presetsRef.current.find(p => `preset:${p.id}` === item.id)
            if (preset) {
              loadTemplateInto(ed, preset.render())
              onPresetRef.current?.(preset.label)
            }
            return
          }
          if (item.id.startsWith('custom-preset:')) {
            const preset = customPresetsRef.current.find(p => `custom-preset:${p.id}` === item.id)
            if (preset) {
              loadTemplateInto(ed, preset.prompt)
              onPresetRef.current?.(preset.label)
            }
            return
          }
          if (item.id === 'new-preset') {
            // Drop the `/query` trigger so the create panel captures the real prompt, not the slash.
            ed.chain().focus().deleteRange(range).run()
            onNewPresetRef.current?.()
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
      // `#` — files: the finer-grained sibling of `@` (#504). Type to filter the project's
      // files (git ls-files); picking one focuses the run on that file via the Context line.
      makeTrigger({
        char: '#',
        key: 'hash',
        items: query =>
          filesRef.current
            .filter(f => f.toLowerCase().includes(query.toLowerCase()))
            .slice(0, 8)
            .map(f => ({ id: `file:${f}`, label: `#${f}`, hint: 'file', group: 'Files' })),
        onSelect: (item, { editor: ed, range }) => {
          const rel = item.id.slice('file:'.length)
          insertToken(ed, range, { kind: 'file', label: `#${rel}`, text: `#${rel}` })
          onMentionFileRef.current?.(rel)
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

  useImperativeHandle(ref, () => ({
    loadTemplate: (text: string) => {
      if (editor) loadTemplateInto(editor, text)
    },
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
        className={`w-full overflow-y-auto rounded-md border border-border bg-transparent p-2 text-sm focus-within:ring-2 focus-within:ring-[var(--color-primary)] ${
          compact ? 'max-h-32 min-h-9' : 'max-h-64 min-h-[4.5rem]'
        }`}
      />
      {isEmpty && (
        <span className="pointer-events-none absolute left-2 top-2 text-sm text-muted-foreground">{placeholder}</span>
      )}
    </div>
  )
})
