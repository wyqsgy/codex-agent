import { useState, useRef, useEffect, useCallback } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { go } from '@codemirror/lang-go'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'

const langCompartment = new Compartment()

function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'javascript': case 'typescript': case 'jsx': case 'tsx': return javascript({ jsx: true, typescript: lang.includes('typescript') || lang.includes('tsx') })
    case 'python': case 'py': return python()
    case 'java': return java()
    case 'cpp': case 'c': case 'h': return cpp()
    case 'go': return go()
    case 'rust': return rust()
    case 'json': return json()
    case 'markdown': case 'md': return markdown()
    default: return []
  }
}

function detectLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
    py: 'python', java: 'java', c: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp',
    go: 'go', rs: 'rust', json: 'json', md: 'markdown',
  }
  return map[ext] || 'text'
}

interface CodeEditorProps {
  value: string
  language?: string
  filename?: string
  onChange?: (value: string) => void
  onSave?: () => void
  readOnly?: boolean
}

export default function CodeEditor({ value, language, filename, onChange, onSave, readOnly }: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const lang = language || (filename ? detectLang(filename) : 'text')

  const createState = useCallback((doc: string) => {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        bracketMatching(),
        closeBrackets(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          ...(onSave ? [{
            key: 'Mod-s',
            run: () => { onSave(); return true }
          }] : []),
        ]),
        langCompartment.of(getLanguageExtension(lang)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        EditorState.readOnly.of(readOnly || false),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    })
  }, [lang, onSave, readOnly])

  useEffect(() => {
    if (!editorRef.current) return
    if (viewRef.current) {
      viewRef.current.destroy()
    }
    viewRef.current = new EditorView({
      state: createState(value),
      parent: editorRef.current,
    })
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [lang])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      })
    }
  }, [value])

  return <div ref={editorRef} className="h-full w-full" />
}