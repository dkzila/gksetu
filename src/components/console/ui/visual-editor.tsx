'use client'

/**
 * GKSetu — Visual Rich Text Editor (SITE-S19).
 *
 * A WYSIWYG editor that replaces the markdown textareas across the Console.
 * Uses @mdxeditor/editor (a React rich text editor that outputs markdown —
 * the content is stored as markdown in the DB, but the writer sees a visual
 * editor, NOT markdown code).
 *
 * Features: headings (H1-H4), bold, italic, lists (bullet + numbered), code
 * blocks, blockquotes, tables, links. The toolbar is at the top — WordPress-
 * style. The content area is a clean editing surface.
 *
 * Used by:
 *   - exam-notes-page.tsx (the ExamNote create/edit dialog body field)
 *   - books-page.tsx (the book description field)
 *   - posts-parts.tsx (the content representation body field)
 *   - pages-page.tsx (the static page body field)
 *   - exam-detail-parts.tsx (the exam notes field)
 *   - pyq-page.tsx (the sitting-details notes field)
 *   - Any other Console textarea that carries rich text.
 */
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  BoldItalicUnderlineToggles,
  ListsToggle,
  CreateLink,
  BlockTypeSelect,
  toolbarPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  tablePlugin,
  InsertTable,
  UndoRedo,
  Separator,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

export interface VisualEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** The minimum height of the editing area (default: 200px). */
  minHeight?: number
  /** When true, the editor is read-only (for the published-note view). */
  readOnly?: boolean
}

export function VisualEditor({
  value,
  onChange,
  placeholder = 'Start writing…',
  minHeight = 200,
  readOnly = false,
}: VisualEditorProps) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100" style={{ minHeight: `${minHeight}px` }}>
      <MDXEditor
        markdown={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        contentEditableClassName="prose prose-sm prose-zinc max-w-none min-w-full"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          markdownShortcutPlugin(),
          codeBlockPlugin(),
          codeMirrorPlugin(),
          tablePlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertTable />
              </>
            ),
          }),
        ]}
      />
    </div>
  )
}
