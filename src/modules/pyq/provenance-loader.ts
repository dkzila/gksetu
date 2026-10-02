/**
 * GKSetu — PYQ module: the batch provenance loader (SITE-S7)
 * docs/learning-platform-plan.md SITE-S7 — the ONE shared "Asked in …"
 * badge loader. Public payloads add provenance to a PAGE of items with a
 * single in-many query per kind (no N+1 — the SITE-S3 chips precedent):
 * the /mcq/ + /qna/ listings (practice-listing-service) and the knowledge
 * page's practice/Q&A layers (assessment question/qna services) both call
 * these; the pyq service reuses them for the year page's cards.
 *
 * Deliberately dependency-light (db only): every consumer stays decoupled
 * from the pyq service's locale machinery, and no runtime import cycle can
 * form (assessment ⇄ pyq imports are type-only where they cross).
 */
import { db } from '@/lib/db'

import type { PyqProvenanceBadge } from './types'

/** Deterministic badge order (§37): newest sitting first, then exam slug,
 * then paper — stable across calls for identical data. */
function sortBadges(badges: PyqProvenanceBadge[]): PyqProvenanceBadge[] {
  return badges.sort(
    (a, b) =>
      b.year - a.year ||
      a.examSlug.localeCompare(b.examSlug) ||
      a.paper.localeCompare(b.paper)
  )
}

/**
 * Loads the provenance badges of many questions in ONE query —
 * questionId → every appearance (all exams/years, newest first).
 */
export async function loadQuestionProvenanceMap(
  questionIds: string[]
): Promise<Map<string, PyqProvenanceBadge[]>> {
  const map = new Map<string, PyqProvenanceBadge[]>()
  if (questionIds.length === 0) return map
  const rows = await db.questionProvenance.findMany({
    where: { questionId: { in: questionIds } },
    select: {
      questionId: true,
      year: true,
      paper: true,
      exam: { select: { slug: true, name: true } },
    },
  })
  for (const row of rows) {
    const badges = map.get(row.questionId) ?? []
    badges.push({ examSlug: row.exam.slug, examName: row.exam.name, year: row.year, paper: row.paper })
    map.set(row.questionId, badges)
  }
  for (const [id, badges] of map) map.set(id, sortBadges(badges))
  return map
}

/** The QnA twin — qnaId → every appearance, ONE query. */
export async function loadQnaProvenanceMap(
  qnaIds: string[]
): Promise<Map<string, PyqProvenanceBadge[]>> {
  const map = new Map<string, PyqProvenanceBadge[]>()
  if (qnaIds.length === 0) return map
  const rows = await db.qnAProvenance.findMany({
    where: { qnaId: { in: qnaIds } },
    select: {
      qnaId: true,
      year: true,
      paper: true,
      exam: { select: { slug: true, name: true } },
    },
  })
  for (const row of rows) {
    const badges = map.get(row.qnaId) ?? []
    badges.push({ examSlug: row.exam.slug, examName: row.exam.name, year: row.year, paper: row.paper })
    map.set(row.qnaId, badges)
  }
  for (const [id, badges] of map) map.set(id, sortBadges(badges))
  return map
}
