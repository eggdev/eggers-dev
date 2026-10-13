'use client';
import { Button, cn } from '@repo/ui';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  className,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [slash, setSlash] = useState(false);
  const editor: Editor | null = useEditor({
    extensions: [StarterKit, Markdown, Placeholder.configure({ placeholder })],
    content: value,
    contentType: 'markdown',
    immediatelyRender: false,
    autofocus: autoFocus,
    editorProps: {
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!editor || !text || event.clipboardData?.getData('text/html')) return false;
        event.preventDefault();
        editor.commands.insertContent(text, { contentType: 'markdown' });
        return true;
      },
      attributes: {
        class: 'prose-editor min-h-28 px-3 py-3 outline-none',
        role: 'textbox',
        'aria-label': placeholder,
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getMarkdown());
      setSlash(editor.state.selection.$from.parent.textContent === '/');
    },
    onSelectionUpdate: ({ editor }) =>
      setSlash(editor.state.selection.$from.parent.textContent === '/'),
  });
  useEffect(() => {
    if (editor && value !== editor.getMarkdown())
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);
  const command = (type: string) => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    let chain = editor.chain().focus().deleteRange({ from: $from.start(), to: $from.end() });
    if (type === 'Heading') chain = chain.toggleHeading({ level: 2 });
    if (type === 'Bullets') chain = chain.toggleBulletList();
    if (type === 'Quote') chain = chain.toggleBlockquote();
    if (type === 'Code') chain = chain.toggleCodeBlock();
    chain.run();
    setSlash(false);
  };
  return (
    <div
      className={cn(
        'relative rounded-md border border-input bg-background focus-within:ring-1 focus-within:ring-ring',
        className,
      )}
    >
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu editor={editor}>
          <div className="flex rounded-md border bg-popover p-1 shadow-md">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              Bold
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              Italic
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                const url = window.prompt(
                  'Link URL',
                  editor.getAttributes('link').href ?? 'https://',
                );
                if (url !== null) {
                  if (!url) editor.chain().focus().unsetLink().run();
                  else if (/^https?:\/\//.test(url))
                    editor.chain().focus().setLink({ href: url }).run();
                }
              }}
            >
              Link
            </Button>
          </div>
        </BubbleMenu>
      )}
      {slash && (
        <div
          className="absolute left-3 z-20 flex flex-wrap gap-1 rounded-md border bg-popover p-2 shadow-md"
          role="toolbar"
          aria-label="Formatting commands"
        >
          {['Heading', 'Bullets', 'Quote', 'Code'].map((item) => (
            <Button
              type="button"
              key={item}
              variant="ghost"
              size="sm"
              onClick={() => command(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
