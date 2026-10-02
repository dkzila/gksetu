/**
 * GKSetu — Tutorials module: the progress service (SITE-S8)
 * docs/learning-platform-plan.md SITE-S8 — the ONLY persisted tutorial state
 * is the user's syllabus walk (TutorialProgress): one row per user ×
 * chapter marked "learned" (§9 explicit signal — deliberately NOT
 * MasteryState, which is attempt-fed only, and NOT SavedItem, which is
 * bookmarks).
 *
 * Master Plan §14 (progress reads only the exam's own current tree),
 * §31 (reversible — the toggle deletes on un-complete), §37 (client-agnostic
 * DTO, deterministic DFS ordering, typed errors), §30 (Bearer-authenticated
 * at the route boundary; NEVER cached — per-user state, the payload-cache
 * scope discipline).
 */
import { z } from 'zod'

import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'
import { windowContains } from '@/modules/exams-syllabus'

import { buildNodeTree } from './service'
import type { TutorialExamProgress } from './types'

// ---------- Typed errors (mapped to HTTP by the route handler, §37) ----------

export type TutorialsProgressErrorCode = 'NODE_NOT_FOUND'

const ERROR_STATUS: Record<TutorialsProgressErrorCode, number> = {
  NODE_NOT_FOUND: 404,
}

export class TutorialsProgressError extends Error {
  readonly code: TutorialsProgressErrorCode
  readonly status: number

  constructor(code: TutorialsProgressErrorCode, message: string) {
    super(message)
    this.name = 'TutorialsProgressError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown TutorialsProgressError to envelope data (§37); null for others. */
export function toTutorialsProgressErrorResponse(
  error: unknown
): { message: string; code: TutorialsProgressErrorCode; status: number } | null {
  if (error instanceof TutorialsProgressError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Query schemas ----------

/** GET /api/tutorials/progress?exam={slug} — the per-exam walk read. */
export const progressGetQuerySchema = z.object({
  exam: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Exam must be kebab-case (a-z, 0-9, hyphens)'),
})

export type ProgressGetQuery = z.infer<typeof progressGetQuerySchema>

/** POST /api/tutorials/progress — the learn/unlearn toggle. */
export const setChapterProgressSchema = z.object({
  /** The SyllabusNode id (a cuid — the client passes what the TOC/tree shipped). */
  nodeId: z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'nodeId must be a valid id'),
  completed: z.boolean(),
})

export type SetChapterProgressInput = z.infer<typeof setChapterProgressSchema>

// ---------- Reads ----------

/**
 * The user's syllabus-walk progress for one exam (never cached — per-user).
 * `totalNodes` = ALL nodes of the current version — progress is about the
 * syllabus walk, not only content-rich chapters; `completedNodeIds` is in
 * DFS reading order (the TOC's order — "continue where you left" resolves
 * the first uncompleted chapter). Rows of superseded versions' nodes never
 * count (the walk is against the CURRENT tree). Unknown exam or no current
 * version → the honest empty shape (0/0), never an error.
 */
export async function getExamProgress(userId: string, examSlug: string): Promise<TutorialExamProgress> {
  const exam = await db.exam.findUnique({
    where: { slug: examSlug.toLowerCase() },
    select: {
      id: true,
      slug: true,
      versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
    },
  })
  if (!exam) return { examSlug, completedNodeIds: [], totalNodes: 0, percent: 0 }

  const version = exam.versions.find((row) => windowContains(row)) ?? null
  if (!version) return { examSlug: exam.slug, completedNodeIds: [], totalNodes: 0, percent: 0 }

  const [nodeRows, progressRows] = await Promise.all([
    db.syllabusNode.findMany({
      where: { examVersionId: version.id },
      select: { id: true, parentId: true, name: true, priority: true },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }], // the loadVersionNodes order (§37)
    }),
    db.tutorialProgress.findMany({
      where: { userId, examId: exam.id },
      select: { nodeId: true },
    }),
  ])

  // The current tree's ids — progress rows pinned to superseded versions'
  // nodes (or anything else) never count toward the CURRENT walk.
  const tree = buildNodeTree(nodeRows)
  const currentNodeIds = new Set(tree.dfs.map((node) => node.id))
  const marked = new Set(progressRows.map((row) => row.nodeId))

  // DFS reading order — deterministic (§37) and "continue where you left"-ready.
  const completedNodeIds = tree.dfs
    .filter((node) => marked.has(node.id))
    .map((node) => node.id)

  const totalNodes = tree.dfs.length
  const percent = totalNodes === 0 ? 0 : Math.round((completedNodeIds.length / totalNodes) * 100)
  return { examSlug: exam.slug, completedNodeIds, totalNodes, percent }
}

// ---------- Writes ----------

/**
 * The learn/unlearn toggle: completed=true upserts the (userId, nodeId) row
 * (re-marking refreshes completedAt); completed=false deletes it (§31
 * reversible). Validates the node exists and resolves its exam from the
 * node's version (the denormalised examId is written from the same source).
 * Returns the REFRESHED getExamProgress for that exam.
 */
export async function setChapterProgress(
  actor: Pick<Actor, 'userId'>,
  input: SetChapterProgressInput
): Promise<TutorialExamProgress> {
  const node = await db.syllabusNode.findUnique({
    where: { id: input.nodeId },
    select: {
      id: true,
      examVersion: { select: { examId: true, exam: { select: { slug: true } } } },
    },
  })
  if (!node) {
    throw new TutorialsProgressError('NODE_NOT_FOUND', 'Chapter not found — no syllabus node exists for this id')
  }

  if (input.completed) {
    await db.tutorialProgress.upsert({
      where: { userId_nodeId: { userId: actor.userId, nodeId: node.id } },
      create: { userId: actor.userId, nodeId: node.id, examId: node.examVersion.examId },
      update: { completedAt: new Date(), examId: node.examVersion.examId },
    })
  } else {
    await db.tutorialProgress.deleteMany({ where: { userId: actor.userId, nodeId: node.id } })
  }

  return getExamProgress(actor.userId, node.examVersion.exam.slug)
}
