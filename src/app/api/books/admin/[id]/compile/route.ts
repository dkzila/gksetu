/**
 * POST /api/books/admin/{id}/compile — the Console's "Compile" action (SITE-S16).
 * Validates that the book is a NOTE_COMPILATION + has enough PUBLISHED ExamNotes
 * to compile. Returns the compilation stats (chapter count, note count, exam name).
 *
 * NOTE: this route validates + previews — the actual HTML is generated on-the-fly
 * by the download route (GET /api/store/{slug}/download). No file is stored; the
 * compilation is always fresh (the ExamNotes are 60s-cached on the read path).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { db } from '@/lib/db'
import { compileExamNotes } from '@/modules/books/compilation-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const book = await db.book.findUnique({
    where: { id },
    select: { id: true, slug: true, title: true, type: true, status: true, examLinks: { select: { exam: { select: { slug: true, name: true } } } } },
  })
  if (!book) return fail('Book not found', 'BOOK_NOT_FOUND', 404)

  if (book.type !== 'NOTE_COMPILATION') {
    return fail('Only NOTE_COMPILATION books can be compiled', 'INVALID_TYPE', 400)
  }

  // Find the primary linked exam (the compilation source).
  const primaryLink = book.examLinks.find((l) => l.exam.slug)
  if (!primaryLink) {
    return fail('This book has no linked exam — link an exam first (the compilation source)', 'NO_EXAM_LINKED', 400)
  }

  const result = await compileExamNotes(primaryLink.exam.slug)
  if (!result) {
    return fail('No PUBLISHED ExamNotes found for this exam — author notes first', 'NO_NOTES', 404)
  }

  return ok({
    compilation: {
      examName: result.examName,
      examSlug: result.examSlug,
      chapterCount: result.chapterCount,
      noteCount: result.noteCount,
      htmlLength: result.html.length,
      downloadUrl: `/api/store/${book.slug}/download?edition=preview`,
    },
  })
}
