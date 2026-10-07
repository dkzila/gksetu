/**
 * GET /api/tutorials/progress/combined?exams=a,b,c — the aggregate progress
 * across multiple exams (SITE-S20). Used by the combined tutorials page to
 * show a "Combined progress" card alongside the per-exam progress cards.
 *
 * Bearer-authenticated. Returns: { combinedPercent, combinedCompleted, combinedTotal, perExam: [...] }
 */
import { NextResponse } from 'next/server'

import { ok, errors, fail } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { authenticateRequest } from '@/modules/identity-access'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface ExamProgress {
  examSlug: string
  completedCount: number
  totalCount: number
}

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`tutorials:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const examsParam = url.searchParams.get('exams') ?? ''
  const examSlugs = examsParam
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
    .slice(0, 8)

  if (examSlugs.length === 0) {
    return ok({ combinedPercent: 0, combinedCompleted: 0, combinedTotal: 0, perExam: [] })
  }

  try {
    const results = await Promise.allSettled(
      examSlugs.map(async (slug) => {
        const exam = await db.exam.findUnique({
          where: { slug },
          select: {
            id: true,
            slug: true,
            versions: {
              where: {
                effectiveFrom: { lte: new Date() },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
              },
              orderBy: { effectiveFrom: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        })
        if (!exam || !exam.versions[0]) {
          return { examSlug: slug, completedCount: 0, totalCount: 0 }
        }
        const versionId = exam.versions[0].id
        const [nodeCount, progressRows] = await Promise.all([
          db.syllabusNode.count({ where: { examVersionId: versionId } }),
          db.tutorialProgress.count({ where: { userId: context.user.id, examId: exam.id } }),
        ])
        return { examSlug: slug, completedCount: progressRows, totalCount: nodeCount }
      })
    )

    const perExam: ExamProgress[] = []
    let combinedCompleted = 0
    let combinedTotal = 0
    for (const result of results) {
      if (result.status === 'fulfilled') {
        perExam.push(result.value)
        combinedCompleted += result.value.completedCount
        combinedTotal += result.value.totalCount
      }
    }
    const combinedPercent = combinedTotal === 0 ? 0 : Math.round((combinedCompleted / combinedTotal) * 100)

    return ok({ combinedPercent, combinedCompleted, combinedTotal, perExam })
  } catch (error) {
    console.error('[tutorials/progress/combined] unexpected error:', error)
    return fail('Could not load combined progress', 'INTERNAL_ERROR', 500)
  }
}
