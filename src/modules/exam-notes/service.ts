/**
 * GKSetu — Exam Notes: domain service (SITE-S13)
 *
 * The exam-pattern-specific editorial overlay. Three responsibilities:
 *
 * 1. Public read: `getExamNotesForChapter(examRef, syllabusNodeId, userId)`
 *    returns the chapter-page payload — PUBLISHED notes with the body unlocked
 *    (or a 100-char preview when gated) + the gating state.
 * 2. Admin CRUD: create/update/transition (the editorial workflow — DRAFT →
 *    PUBLISHED → INACTIVE → PUBLISHED; revisions are append-only §36).
 * 3. The gating primitive: `toPublicExamNote(note, hasAccess, gatingEnabled)`
 *    projects the note's body or its preview based on the access decision.
 *
 * §14: every note belongs to exactly ONE exam (the home-market exam). The
 * syllabusNodeId links to the tutorial chapter (one note per chapter per
 * kind per exam — the unique constraint enforces it).
 *
 * §19/§36: DRAFT → PUBLISHED (note:publish — editor+), PUBLISHED → INACTIVE,
 * INACTIVE → PUBLISHED. The published body is denormalised onto ExamNote.body
 * for the fast public read; the revisions table is the immutable history.
 */
import type { Prisma, ExamNote, ExamNoteKind, ExamNoteStatus } from '@prisma/client'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
  type AuditRequestMeta,
} from '@/modules/audit'
import { findExam } from '@/modules/exams-syllabus'
import { canAccessExamNotes } from '@/modules/premium'

import {
  EXAM_NOTE_EDITABILITY,
  EXAM_NOTE_TRANSITIONS,
} from './types'
import type {
  AdminExamNote,
  AdminExamNoteDetail,
  AdminExamNoteListResult,
  ExamNoteTransitionAction,
  PublicExamNote,
  PublicExamNotesResult,
} from './types'
import type {
  AdminExamNoteListQuery,
  ExamNoteCreateInput,
  ExamNoteTransitionInput,
  ExamNoteUpdateInput,
} from './validation'

// ---------- Typed domain errors ----------

export type ExamNoteErrorCode =
  | 'NOTE_NOT_FOUND'
  | 'EXAM_NOT_FOUND'
  | 'CHAPTER_NOT_FOUND'
  | 'CHAPTER_EXAM_MISMATCH'
  | 'DUPLICATE_KIND_PER_CHAPTER'
  | 'STATE_LOCKED'
  | 'INVALID_TRANSITION'
  | 'COUNTRY_MISMATCH'

const ERROR_STATUS: Record<ExamNoteErrorCode, number> = {
  NOTE_NOT_FOUND: 404,
  EXAM_NOT_FOUND: 404,
  CHAPTER_NOT_FOUND: 404,
  CHAPTER_EXAM_MISMATCH: 400,
  DUPLICATE_KIND_PER_CHAPTER: 409,
  STATE_LOCKED: 409,
  INVALID_TRANSITION: 409,
  COUNTRY_MISMATCH: 403,
}

export class ExamNoteError extends Error {
  readonly code: ExamNoteErrorCode
  readonly status: number

  constructor(code: ExamNoteErrorCode, message: string) {
    super(message)
    this.name = 'ExamNoteError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toExamNoteErrorResponse(
  error: unknown
): { message: string; code: ExamNoteErrorCode; status: number } | null {
  if (error instanceof ExamNoteError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** The 100-char preview shown when a note is gated (the paywall CTA copy). */
const PREVIEW_LENGTH = 100
function bodyPreview(body: string): string {
  const trimmed = body.trim()
  if (trimmed.length <= PREVIEW_LENGTH) return trimmed
  return `${trimmed.slice(0, PREVIEW_LENGTH).trimEnd()}…`
}

/** The §16 canonical anchor on the chapter page (e.g. "#note-pattern-brief"). */
function anchorOf(kind: ExamNoteKind): string {
  return `#note-${kind.toLowerCase().replace(/_/g, '-')}`
}

// ---------- Public read (the chapter-page payload) ----------

/**
 * GET /api/exams/{ref}/notes?chapter={nodeId} — the public chapter-page
 * payload. Returns PUBLISHED notes with the body unlocked (or a 100-char
 * preview when gated) + the gating state.
 *
 * 60s cached on the gating-OFF path (the common case today — every learner
 * sees the same payload). When gating is ON, the cache key includes the
 * caller's access state (entitled or not) so the two payloads never collide.
 */
export async function getExamNotesForChapter(input: {
  examRef: string
  syllabusNodeId: string
  userId: string | null
}): Promise<PublicExamNotesResult> {
  const exam = await findExam(input.examRef)
  if (!exam) throw new ExamNoteError('EXAM_NOT_FOUND', 'Exam not found')

  const node = await db.syllabusNode.findUnique({
    where: { id: input.syllabusNodeId },
    select: { id: true, name: true, examVersionId: true, examVersion: { select: { examId: true } } },
  })
  if (!node) throw new ExamNoteError('CHAPTER_NOT_FOUND', 'Chapter (syllabus node) not found')
  if (node.examVersion.examId !== exam.id) {
    throw new ExamNoteError('CHAPTER_EXAM_MISMATCH', 'This chapter does not belong to this exam')
  }

  const { gatingEnabled, hasAccess } = await canAccessExamNotes(input.userId, exam.id)

  const cacheKey = `exam-notes:public:${exam.id}:${node.id}:${gatingEnabled ? (hasAccess ? 'unlocked' : 'locked') : 'open'}`
  return cachedPayload(cacheKey, () => loadExamNotesForChapter(exam, node, gatingEnabled, hasAccess))
}

async function loadExamNotesForChapter(
  exam: { id: string; slug: string; name: string; code: string },
  node: { id: string; name: string },
  gatingEnabled: boolean,
  hasAccess: boolean
): Promise<PublicExamNotesResult> {
  const notes = await db.examNote.findMany({
    where: { examId: exam.id, syllabusNodeId: node.id, status: 'PUBLISHED' },
    orderBy: [{ kind: 'asc' }], // PATTERN_BRIEF < CHEAT_SHEET < REVISION_NOTES < WORKED_MCQ (alpha)
    select: { id: true, kind: true, status: true, body: true, updatedAt: true },
  })

  const unlocked = !gatingEnabled || hasAccess

  return {
    exam: { slug: exam.slug, name: exam.name, code: exam.code },
    chapter: { id: node.id, name: node.name },
    notes: notes.map((note) => toPublicExamNote(note, unlocked, gatingEnabled, hasAccess)),
    gatingEnabled,
    hasAccess,
  }
}

function toPublicExamNote(
  note: Pick<ExamNote, 'id' | 'kind' | 'status' | 'body' | 'updatedAt'>,
  unlocked: boolean,
  gatingEnabled: boolean,
  hasAccess: boolean
): PublicExamNote {
  if (unlocked) {
    return {
      id: note.id,
      kind: note.kind,
      status: note.status,
      body: note.body,
      isLocked: false,
      paywallReason: null,
      canonicalAnchor: anchorOf(note.kind),
      updatedAt: note.updatedAt.toISOString(),
    }
  }
  // Locked — show the preview + the paywall reason.
  let paywallReason: PublicExamNote['paywallReason']
  if (!gatingEnabled) paywallReason = null // never reached (unlocked is true)
  else if (!hasAccess) paywallReason = 'NO_ENTITLEMENT'
  else paywallReason = 'EXPIRED' // entitlement existed but expired (defensive — hasAccess checks this)
  return {
    id: note.id,
    kind: note.kind,
    status: note.status,
    body: bodyPreview(note.body),
    isLocked: true,
    paywallReason: gatingEnabled ? paywallReason : null,
    canonicalAnchor: anchorOf(note.kind),
    updatedAt: note.updatedAt.toISOString(),
  }
}

// ---------- Admin reads ----------

export async function getAdminExamNotes(
  actor: Actor,
  query: AdminExamNoteListQuery
): Promise<AdminExamNoteListResult> {
  assertCan(actor, 'note:manage')

  const where: Prisma.ExamNoteWhereInput = {}
  if (query.status) where.status = query.status
  if (query.kind) where.kind = query.kind
  if (query.exam) {
    // exam ref (slug or id) — resolve via the exam relation
    where.exam = CUID_PATTERN.test(query.exam) ? { id: query.exam } : { slug: query.exam.toLowerCase() }
  }
  if (query.q) {
    where.OR = [
      { body: { contains: query.q, mode: 'insensitive' } },
      { exam: { name: { contains: query.q, mode: 'insensitive' } } },
      { syllabusNode: { name: { contains: query.q, mode: 'insensitive' } } },
    ]
  }

  // Country-scoped for COUNTRY_ADMIN (the exam:manage precedent).
  if (actor.role === 'COUNTRY_ADMIN') {
    if (!actor.countryId) throw new ExamNoteError('COUNTRY_MISMATCH', 'No country scope on your account')
    where.exam = { ...((where.exam as object) ?? {}), countryId: actor.countryId }
  }

  const [rows, total] = await Promise.all([
    db.examNote.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        exam: { select: { slug: true, name: true, countryId: true } },
        syllabusNode: { select: { id: true, name: true } },
        authoredBy: { select: { email: true } },
        _count: { select: { revisions: true } },
      },
    }),
    db.examNote.count({ where }),
  ])

  const notes: AdminExamNote[] = rows.map((row) => toAdminExamNote(row, actor))
  return {
    notes,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getAdminExamNote(actor: Actor, id: string): Promise<AdminExamNoteDetail> {
  assertCan(actor, 'note:manage')
  const note = await db.examNote.findUnique({
    where: { id },
    include: {
      exam: { select: { slug: true, name: true, countryId: true } },
      syllabusNode: { select: { id: true, name: true } },
      authoredBy: { select: { email: true } },
      _count: { select: { revisions: true } },
      revisions: {
        orderBy: { publishedAt: 'desc' },
        take: 20,
        include: { publishedBy: { select: { email: true } } },
      },
    },
  })
  if (!note) throw new ExamNoteError('NOTE_NOT_FOUND', 'Exam note not found')
  // COUNTRY_ADMIN scope check
  if (actor.role === 'COUNTRY_ADMIN' && note.exam.countryId !== actor.countryId) {
    throw new ExamNoteError('COUNTRY_MISMATCH', 'This note belongs to another market')
  }
  const base = toAdminExamNote(note, actor)
  return {
    ...base,
    revisions: note.revisions.map((r) => ({
      id: r.id,
      bodyPreview: bodyPreview(r.body),
      publishedByEmail: r.publishedBy?.email ?? null,
      publishedAt: r.publishedAt.toISOString(),
    })),
  }
}

function toAdminExamNote(
  row: ExamNote & {
    exam: { slug: string; name: string; countryId: string }
    syllabusNode: { id: string; name: string }
    authoredBy: { email: string } | null
    _count: { revisions: number }
  },
  _actor: Actor
): AdminExamNote {
  return {
    id: row.id,
    examId: row.examId,
    examSlug: row.exam.slug,
    examName: row.exam.name,
    syllabusNodeId: row.syllabusNodeId,
    syllabusNodeName: row.syllabusNode.name,
    kind: row.kind,
    status: row.status,
    body: row.body,
    bodyPreview: bodyPreview(row.body),
    revisionCount: row._count.revisions,
    authoredByEmail: row.authoredBy?.email ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    allowedTransitions: Object.keys(
      EXAM_NOTE_TRANSITIONS[row.status as ExamNoteStatus]
    ) as ExamNoteTransitionAction[],
  }
}

// ---------- Admin writes ----------

export async function createExamNote(
  actor: Actor,
  input: ExamNoteCreateInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamNoteDetail> {
  assertCan(actor, 'note:manage')

  const exam = await findExam(input.examRef)
  if (!exam) throw new ExamNoteError('EXAM_NOT_FOUND', `Exam "${input.examRef}" not found`)

  // COUNTRY_ADMIN scope
  if (actor.role === 'COUNTRY_ADMIN' && exam.countryId !== actor.countryId) {
    throw new ExamNoteError('COUNTRY_MISMATCH', 'You can only manage notes for exams in your own country')
  }

  // Verify the chapter belongs to this exam.
  const node = await db.syllabusNode.findUnique({
    where: { id: input.syllabusNodeId },
    select: { id: true, name: true, examVersionId: true, examVersion: { select: { examId: true } } },
  })
  if (!node) throw new ExamNoteError('CHAPTER_NOT_FOUND', 'Chapter (syllabus node) not found')
  if (node.examVersion.examId !== exam.id) {
    throw new ExamNoteError('CHAPTER_EXAM_MISMATCH', 'This chapter does not belong to this exam')
  }

  // Unique constraint: one note per chapter per kind per exam.
  const existing = await db.examNote.findFirst({
    where: { examId: exam.id, syllabusNodeId: node.id, kind: input.kind },
    select: { id: true },
  })
  if (existing) {
    throw new ExamNoteError(
      'DUPLICATE_KIND_PER_CHAPTER',
      `A ${input.kind} note already exists for this chapter — open it to edit instead.`
    )
  }

  const note = await db.examNote.create({
    data: {
      examId: exam.id,
      syllabusNodeId: node.id,
      kind: input.kind,
      body: input.body,
      status: 'DRAFT',
      authoredById: actor.userId,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examNoteCreate,
    objectType: AUDIT_OBJECT_TYPES.examNote,
    objectId: note.id,
    objectLabel: `${exam.slug} · ${node.name} · ${note.kind}`,
    before: null,
    after: { kind: note.kind, status: note.status, bodyLength: note.body.length },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminExamNote(actor, note.id)
}

export async function updateExamNote(
  actor: Actor,
  id: string,
  input: ExamNoteUpdateInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamNoteDetail> {
  assertCan(actor, 'note:manage')
  const existing = await db.examNote.findUnique({
    where: { id },
    select: { id: true, status: true, examId: true, kind: true, body: true, exam: { select: { countryId: true, slug: true, name: true } }, syllabusNode: { select: { name: true } } },
  })
  if (!existing) throw new ExamNoteError('NOTE_NOT_FOUND', 'Exam note not found')

  // COUNTRY_ADMIN scope
  if (actor.role === 'COUNTRY_ADMIN' && existing.exam.countryId !== actor.countryId) {
    throw new ExamNoteError('COUNTRY_MISMATCH', 'This note belongs to another market')
  }

  const editability = EXAM_NOTE_EDITABILITY[existing.status as ExamNoteStatus]
  if (editability === 'none') {
    throw new ExamNoteError('STATE_LOCKED', 'Published notes are immutable — unpublish to edit (a new revision is created on re-publish)')
  }

  const updated = await db.examNote.update({
    where: { id },
    data: { body: input.body },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examNoteUpdate,
    objectType: AUDIT_OBJECT_TYPES.examNote,
    objectId: id,
    objectLabel: `${existing.exam.slug} · ${existing.syllabusNode.name} · ${existing.kind}`,
    before: { bodyLength: existing.body.length },
    after: { bodyLength: updated.body.length },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminExamNote(actor, id)
}

export async function transitionExamNote(
  actor: Actor,
  id: string,
  input: ExamNoteTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamNoteDetail> {
  const existing = await db.examNote.findUnique({
    where: { id },
    select: { id: true, status: true, body: true, kind: true, examId: true, exam: { select: { slug: true, name: true, countryId: true } }, syllabusNode: { select: { name: true } } },
  })
  if (!existing) throw new ExamNoteError('NOTE_NOT_FOUND', 'Exam note not found')

  // COUNTRY_ADMIN scope
  if (actor.role === 'COUNTRY_ADMIN' && existing.exam.countryId !== actor.countryId) {
    throw new ExamNoteError('COUNTRY_MISMATCH', 'This note belongs to another market')
  }

  const target = EXAM_NOTE_TRANSITIONS[existing.status as ExamNoteStatus][input.action as ExamNoteTransitionAction]
  if (!target) {
    throw new ExamNoteError('INVALID_TRANSITION', `Cannot ${input.action} a ${existing.status} note`)
  }

  // The publish transition needs the publish permission (the editorial gate).
  if (input.action === 'publish' && !can(actor, 'note:publish', { countryId: existing.exam.countryId })) {
    throw new ExamNoteError('COUNTRY_MISMATCH', 'You do not have permission to publish exam notes')
  }

  // Publishing creates a revision (§36 append-only) + updates the body snapshot.
  if (input.action === 'publish') {
    await db.$transaction(async (tx) => {
      const revision = await tx.examNoteRevision.create({
        data: {
          noteId: id,
          body: existing.body,
          publishedById: actor.userId,
        },
      })
      await tx.examNote.update({
        where: { id },
        data: { status: target, publishedRevisionId: revision.id, body: existing.body },
      })
    })
  } else {
    // unpublish / retire → just flip the status
    await db.examNote.update({ where: { id }, data: { status: target } })
  }

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examNoteTransition,
    objectType: AUDIT_OBJECT_TYPES.examNote,
    objectId: id,
    objectLabel: `${existing.exam.slug} · ${existing.syllabusNode.name} · ${existing.kind}`,
    before: { status: existing.status },
    after: { status: target, action: input.action, reason: input.reason ?? null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminExamNote(actor, id)
}

// ---------- Audit snapshot (used by other modules if needed) ----------

export function examNoteSnapshot(note: Pick<ExamNote, 'kind' | 'status' | 'body'>) {
  return { kind: note.kind, status: note.status, bodyLength: note.body.length }
}
