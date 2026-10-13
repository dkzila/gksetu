/**
 * POST /api/import-translations — upload a translated MCQs JSON file and seed it.
 *
 * Body: multipart form data with:
 *   - file: the JSON file (format: gksetu-mcq-translations)
 *   - lang: target language code (en, bn, gu, kn, ml, mr, or, ta, te)
 *
 * Auth: question:manage permission (ADMIN or COUNTRY_ADMIN).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  // Auth check — requires question:manage permission
  const guard = await requireAnyPermission(request, ['question:manage'])
  if (guard instanceof NextResponse) return guard
  const user = guard.user

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const lang = formData.get('lang') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!lang) {
      return NextResponse.json({ error: 'No language code provided' }, { status: 400 })
    }

    // Parse JSON
    const text = await file.text()
    let data: { mcqs?: unknown[] }
    try {
      data = JSON.parse(text)
    } catch {
      return NextResponse.json({ error: 'Invalid JSON file' }, { status: 400 })
    }

    if (!data.mcqs || !Array.isArray(data.mcqs) || data.mcqs.length === 0) {
      return NextResponse.json({ error: 'No MCQs found in file' }, { status: 400 })
    }

    const mcqs = data.mcqs as Array<{
      id: string
      question: string
      optionA: string
      optionB: string
      optionC: string
      optionD: string
      correctAnswer: string
      subjectSlug: string
      topicSlug: string
    }>

    // Resolve language
    const language = await db.language.findUnique({ where: { code: lang.toLowerCase() } })
    if (!language) {
      return NextResponse.json({ error: `Language "${lang}" not found` }, { status: 404 })
    }

    // Process MCQs
    const topicCache = new Map<string, string>()
    const unitCache = new Map<string, string>()

    let created = 0
    let skipped = 0
    let errors = 0

    function serializeOptions(a: string, b: string, c: string, d: string): string {
      return JSON.stringify([
        { key: 'A', text: a },
        { key: 'B', text: b },
        { key: 'C', text: c },
        { key: 'D', text: d },
      ])
    }

    for (const mcq of mcqs) {
      if (!mcq.question || mcq.question.length < 3) { errors++; continue }
      if (!['A', 'B', 'C', 'D'].includes(mcq.correctAnswer)) { errors++; continue }
      if (!mcq.subjectSlug || !mcq.topicSlug) { errors++; continue }

      // Ensure topic exists
      let topicId = topicCache.get(mcq.topicSlug)
      if (!topicId) {
        const topic = await db.topic.findUnique({ where: { slug: mcq.topicSlug } })
        if (topic) {
          topicId = topic.id
        } else {
          const newTopic = await db.topic.create({
            data: {
              slug: mcq.topicSlug,
              canonicalName: mcq.topicSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              description: `Topic for ${mcq.topicSlug} (SITE-S26).`,
              type: 'TOPIC',
              status: 'ACTIVE',
              scope: 'GLOBAL',
            },
          })
          topicId = newTopic.id
        }
        topicCache.set(mcq.topicSlug, topicId)
      }

      // Ensure knowledge unit exists
      const unitSlug = `gk-hindi-${mcq.subjectSlug}`
      let unitId = unitCache.get(unitSlug)
      if (!unitId) {
        const unit = await db.knowledgeUnit.findUnique({ where: { slug: unitSlug } })
        if (unit) {
          unitId = unit.id
        } else {
          const newUnit = await db.knowledgeUnit.create({
            data: {
              slug: unitSlug,
              canonicalName: `gk-hindi.in ${mcq.subjectSlug} corpus`,
              canonicalSummary: `MCQ questions from gk-hindi.in/${mcq.subjectSlug} (SITE-S25).`,
              canonicalBody: `This knowledge unit aggregates MCQs from https://gk-hindi.in/${mcq.subjectSlug}.`,
              type: 'CONCEPT',
              status: 'VERIFIED',
              difficulty: 'BASIC',
              scope: 'GLOBAL',
              topicId,
            },
          })
          unitId = newUnit.id
        }
        unitCache.set(unitSlug, unitId)
      }

      // Check if question already exists
      const existing = await db.question.findFirst({
        where: { knowledgeUnitId: unitId, languageId: language.id, questionText: mcq.question },
        select: { id: true },
      })
      if (existing) { skipped++; continue }

      // Create question + revision
      const optionsJson = serializeOptions(mcq.optionA, mcq.optionB, mcq.optionC, mcq.optionD)
      const explanation = `Source: gk-hindi.in/${mcq.subjectSlug} (Hindi)\nAI-translated to ${language.name} — SITE-S26.`

      try {
        const question = await db.question.create({
          data: {
            knowledgeUnitId: unitId,
            languageId: language.id,
            status: 'PUBLISHED',
            type: 'MCQ',
            difficulty: 'BASIC',
            questionText: mcq.question,
            optionsJson,
            correctAnswer: mcq.correctAnswer,
            explanation,
            aiAssisted: true,
            createdById: user.id,
          },
        })
        const revision = await db.questionRevision.create({
          data: {
            questionId: question.id,
            revisionNumber: 1,
            questionText: mcq.question,
            optionsJson,
            correctAnswer: mcq.correctAnswer,
            explanation,
            difficulty: 'BASIC',
            changeSummary: `SITE-S26 import: ${language.code} translation`,
            aiAssisted: true,
            publishedById: user.id,
            publishedAt: new Date(),
          },
        })
        await db.question.update({
          where: { id: question.id },
          data: { publishedRevisionId: revision.id },
        })
        created++
      } catch {
        errors++
      }
    }

    return NextResponse.json({
      success: true,
      language: language.code,
      total: mcqs.length,
      created,
      skipped,
      errors,
    })
  } catch (error) {
    console.error('[import-translations] error:', error)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
