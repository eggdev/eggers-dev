import { defaultValueCtx, Editor, rootCtx } from '@milkdown/kit/core'
import { history } from '@milkdown/kit/plugin/history'
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener'
import {
  commonmark,
  toggleEmphasisCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import '@milkdown/kit/prose/view/style/prosemirror.css'
import { callCommand } from '@milkdown/kit/utils'
import { useEffect, useRef, useState } from 'react'

interface Props {
  documentId: string
  value: string
  onChange: (markdown: string) => void
}

interface EditorAction {
  label: string
  title: string
  run: (editor: Editor) => void
}

const actions: EditorAction[] = [
  {
    label: 'Text',
    title: 'Paragraph',
    run: (editor) => editor.action(callCommand(turnIntoTextCommand.key)),
  },
  {
    label: 'H2',
    title: 'Heading',
    run: (editor) => editor.action(callCommand(wrapInHeadingCommand.key, 2)),
  },
  {
    label: 'B',
    title: 'Bold',
    run: (editor) => editor.action(callCommand(toggleStrongCommand.key)),
  },
  {
    label: 'I',
    title: 'Italic',
    run: (editor) => editor.action(callCommand(toggleEmphasisCommand.key)),
  },
  {
    label: '• List',
    title: 'Bulleted list',
    run: (editor) => editor.action(callCommand(wrapInBulletListCommand.key)),
  },
  {
    label: '1. List',
    title: 'Numbered list',
    run: (editor) => editor.action(callCommand(wrapInOrderedListCommand.key)),
  },
  {
    label: 'Quote',
    title: 'Block quote',
    run: (editor) => editor.action(callCommand(wrapInBlockquoteCommand.key)),
  },
]

export function MarkdownEditor({ documentId, value, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const changeRef = useRef(onChange)
  const initialValueRef = useRef(value)
  const [ready, setReady] = useState(false)
  changeRef.current = onChange

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let disposed = false
    const editor = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, initialValueRef.current)
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previous) => {
          if (!disposed && markdown !== previous) changeRef.current(markdown)
        })
      })
      .use(commonmark)
      .use(history)
      .use(listener)

    editor
      .create()
      .then(() => {
        if (!disposed) {
          editorRef.current = editor
          setReady(true)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) console.error('Could not start the Markdown editor', error)
      })

    return () => {
      disposed = true
      editorRef.current = null
      void editor.destroy()
    }
    // App keys this component by document ID, so switching documents remounts it.
  }, [])

  return (
    <div className="markdown-editor" data-document-id={documentId}>
      <div className="markdown-toolbar" role="toolbar" aria-label="Text formatting">
        {actions.map((action) => (
          <button
            type="button"
            key={action.title}
            title={action.title}
            disabled={!ready}
            onMouseDown={(event) => {
              event.preventDefault()
              const editor = editorRef.current
              if (editor) action.run(editor)
            }}
          >
            {action.label}
          </button>
        ))}
        <span className="markdown-toolbar__hint">Markdown shortcuts work here</span>
      </div>
      <div className="markdown-editor__canvas" ref={rootRef} />
    </div>
  )
}
