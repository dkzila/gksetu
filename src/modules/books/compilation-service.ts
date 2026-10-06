/**
 * GKSetu — Book Compilation Service (SITE-S16)
 *
 * Generates a print-ready HTML document from an exam's PUBLISHED ExamNotes
 * (Pattern Brief + Cheat Sheet + Worked MCQs + Revision Notes for every
 * chapter). The HTML carries a print stylesheet — the user opens it in a new
 * tab and uses the browser's "Save as PDF" (or the server-side puppeteer render
 * when wired — see the compilation-route's comment block for the exact fetch).
 *
 * The compilation is on-the-fly (no caching needed — the ExamNotes are already
 * 60s-cached on the read path). For NOTE_COMPILATION books, the "Download"
 * button on the book detail page opens this compiled HTML.
 *
 * §14: the compilation is exam-scoped (one exam's notes → one compilation).
 * §35: the language follows the edition's language (the ExamNotes are language-
 * agnostic today — they're authored in the canonical language; future: per-
 * language note variants).
 */
import { db } from '@/lib/db'
import { findExam } from '@/modules/exams-syllabus'
import { EXAM_NOTE_KIND_LABELS } from '@/modules/exam-notes'
import type { ExamNoteKind } from '@prisma/client'

/** The kind order in the compilation (Pattern Brief first, Revision Notes last). */
const KIND_ORDER: ExamNoteKind[] = ['PATTERN_BRIEF', 'CHEAT_SHEET', 'WORKED_MCQ', 'REVISION_NOTES']

export interface CompilationResult {
  html: string
  chapterCount: number
  noteCount: number
  examName: string
  examSlug: string
}

/**
 * Compiles an exam's PUBLISHED ExamNotes into a single HTML document.
 * Used by:
 *   - GET /api/store/{slug}/download (the public download — checks UserBookAccess)
 *   - POST /api/books/admin/{id}/compile (the Console's "Compile" validation)
 */
export async function compileExamNotes(
  examRef: string,
  options: { languageCode?: string } = {}
): Promise<CompilationResult | null> {
  const exam = await findExam(examRef)
  if (!exam) return null

  // Load all PUBLISHED ExamNotes for this exam, grouped by chapter.
  const notes = await db.examNote.findMany({
    where: { examId: exam.id, status: 'PUBLISHED' },
    select: {
      id: true,
      kind: true,
      body: true,
      syllabusNode: {
        select: { id: true, name: true, slug: true, depth: true, parentId: true },
      },
    },
    orderBy: [{ syllabusNode: { priority: 'asc' } }, { kind: 'asc' }],
  })

  if (notes.length === 0) return null

  // Group by chapter (syllabusNode).
  const chapters = new Map<string, { name: string; slug: string | null; notes: typeof notes }>()
  for (const note of notes) {
    const nodeId = note.syllabusNode.id
    if (!chapters.has(nodeId)) {
      chapters.set(nodeId, {
        name: note.syllabusNode.name,
        slug: note.syllabusNode.slug,
        notes: [],
      })
    }
    chapters.get(nodeId)!.notes.push(note)
  }

  // Build the HTML.
  const chapterList = [...chapters.values()]
  const toc = chapterList
    .map((ch, i) => `<li><a href="#chapter-${i + 1}">${escapeHtml(ch.name)}</a></li>`)
    .join('\n')

  const chaptersHtml = chapterList
    .map((ch, i) => {
      const notesHtml = ch.notes
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
        .map((note) => {
          const label = EXAM_NOTE_KIND_LABELS[note.kind]
          return `
          <div class="note-block note-${note.kind.toLowerCase().replace(/_/g, '-')}">
            <h3 class="note-kind">${escapeHtml(label.label)}</h3>
            <div class="note-body">${renderMarkdown(note.body)}</div>
          </div>`
        })
        .join('\n')
      return `
        <div class="chapter" id="chapter-${i + 1}">
          <h2 class="chapter-title">${escapeHtml(ch.name)}</h2>
          ${notesHtml}
        </div>`
    })
    .join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(exam.name)} — Exam Notes Compilation | GKSetu</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; color: #1a1a1a; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 28px; margin-bottom: 8px; color: #047857; }
    h2.chapter-title { font-size: 22px; margin-top: 32px; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 2px solid #d1fae5; color: #065f46; }
    h3.note-kind { font-size: 16px; margin-top: 16px; margin-bottom: 6px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.05em; }
    .note-body { font-size: 14px; margin-bottom: 16px; white-space: pre-wrap; }
    .note-body h1, .note-body h2, .note-body h3, .note-body h4 { font-size: 15px; margin-top: 12px; margin-bottom: 4px; }
    .note-body strong { font-weight: bold; }
    .note-body em { font-style: italic; }
    .note-body ul, .note-body ol { margin-left: 20px; margin-bottom: 8px; }
    .note-body li { margin-bottom: 2px; }
    .cover { text-align: center; padding: 60px 20px; page-break-after: always; }
    .cover h1 { font-size: 36px; margin-bottom: 16px; }
    .cover .subtitle { font-size: 18px; color: #6b7280; margin-bottom: 24px; }
    .cover .brand { font-size: 14px; color: #9ca3af; margin-top: 40px; }
    .toc { page-break-after: always; }
    .toc h2 { font-size: 20px; margin-bottom: 12px; }
    .toc ol { list-style: decimal; margin-left: 20px; }
    .toc li { margin-bottom: 4px; }
    .toc a { text-decoration: none; color: #065f46; }
    .chapter { page-break-before: always; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    @media print { body { max-width: none; padding: 20px; } .chapter { page-break-before: always; } }
  </style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(exam.name)}</h1>
    <p class="subtitle">Exam Notes Compilation — Pattern Briefs, Cheat Sheets, Worked MCQs & Revision Notes</p>
    <p class="brand">GKSetu — the GK learning platform</p>
  </div>
  <div class="toc">
    <h2>Table of Contents</h2>
    <ol>
      ${toc}
    </ol>
  </div>
  ${chaptersHtml}
  <div class="footer">
    <p>Compiled by GKSetu — ${new Date().toLocaleDateString('en-IN')}</p>
    <p>${chapterList.length} chapters · ${notes.length} notes</p>
  </div>
</body>
</html>`

  return {
    html,
    chapterCount: chapterList.length,
    noteCount: notes.length,
    examName: exam.name,
    examSlug: exam.slug,
  }
}

// ---------- Helpers ----------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Minimal markdown → HTML (headings, bold, italic, lists, code). */
function renderMarkdown(md: string): string {
  let html = escapeHtml(md)
  // Headings (## → <h2>, ### → <h3>, etc.)
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
  // Bold + italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Code blocks
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
  // Paragraphs (double newline → paragraph break)
  html = html.replace(/\n\n/g, '</p><p>')
  html = `<p>${html}</p>`
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '')
  return html
}
