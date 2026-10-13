/**
 * SITE-S26: Import translated MCQs from a JSON file into the DB.
 *
 * Reads a JSON file with translated MCQs (same format as export) and
 * seeds them into the Question + QuestionRevision + Translation tables.
 *
 * The file format:
 * {
 *   "format": "gksetu-mcq-translations",
 *   "sourceLanguage": "hi",
 *   "targetLanguage": "en",
 *   "mcqs": [
 *     {
 *       "id": "geography-gk::भारत नाम...",
 *       "question": "The origin of the name India is related to which king...",
 *       "optionA": "Maharana Pratap",
 *       "optionB": "Chandragupta Maurya",
 *       "optionC": "Bharata Chakravarti",
 *       "optionD": "Ashoka Maurya",
 *       "correctAnswer": "C",
 *       "subjectSlug": "india-gk",
 *       "topicSlug": "india-gk"
 *     }
 *   ]
 * }
 *
 * Usage:
 *   bun scripts/s26-import-translations.ts --file translated-en.json --lang en
 *   bun scripts/s26-import-translations.ts --file translated-bn.json --lang bn
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

interface TranslatedMCQ {
  id: string
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
  subjectSlug: string
  topicSlug: string
}

interface TranslatedFile {
  format?: string
  sourceLanguage?: string
  targetLanguage?: string
  mcqs: TranslatedMCQ[]
}

function serializeOptions(a: string, b: string, c: string, d: string): string {
  return JSON.stringify([
    { key: 'A', text: a },
    { key: 'B', text: b },
    { key: 'C', text: c },
    { key: 'D', text: d },
  ])
}

async function main() {
  const argv = process.argv.slice(2)
  const fileArg = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null
  const langArg = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null

  if (!fileArg || !langArg) {
    console.error('Usage: bun scripts/s26-import-translations.ts --file <file.json> --lang <code>')
    console.error('Example: bun scripts/s26-import-translations.ts --file translated-en.json --lang en')
    process.exit(1)
  }

  console.log(`SITE-S26 Import: Loading ${fileArg} for language ${langArg}...`)

  let data: TranslatedFile
  try {
    data = JSON.parse(readFileSync(fileArg, 'utf-8'))
  } catch (e) {
    console.error(`Could not read file: ${fileArg}`)
    process.exit(1)
  }

  if (!data.mcqs || !Array.isArray(data.mcqs) || data.mcqs.length === 0) {
    console.error('Invalid file format: missing "mcqs" array')
    process.exit(1)
  }

  console.log(`  Found ${data.mcqs.length} MCQs to import`)

  // Resolve language
  const language = await prisma.language.findUnique({ where: { code: langArg.toLowerCase() } })
  if (!language) {
    console.error(`Language "${langArg}" not found in DB`)
    process.exit(1)
  }

  // Resolve admin
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } })
    ?? await prisma.user.findFirst({ select: { id: true, email: true } })
  if (!admin) {
    console.error('No admin user found')
    process.exit(1)
  }
  console.log(`  Admin: ${admin.email}, Language: ${language.code} (${language.nativeName})`)

  // Cache: topic slug → topic id, unit slug → unit id
  const topicCache = new Map<string, string>()
  const unitCache = new Map<string, string>()

  let created = 0
  let skipped = 0
  let errors = 0
  const BATCH_SIZE = 50

  for (let i = 0; i < data.mcqs.length; i += BATCH_SIZE) {
    const batch = data.mcqs.slice(i, i + BATCH_SIZE)

    for (const mcq of batch) {
      if (!mcq.question || mcq.question.length < 3) { errors++; continue }
      if (!['A', 'B', 'C', 'D'].includes(mcq.correctAnswer)) { errors++; continue }
      if (!mcq.subjectSlug || !mcq.topicSlug) { errors++; continue }

      // Ensure topic exists
      let topicId = topicCache.get(mcq.topicSlug)
      if (!topicId) {
        const topic = await prisma.topic.findUnique({ where: { slug: mcq.topicSlug } })
        if (topic) {
          topicId = topic.id
          topicCache.set(mcq.topicSlug, topicId)
        } else {
          // Create topic
          const newTopic = await prisma.topic.create({
            data: {
              slug: mcq.topicSlug,
              canonicalName: mcq.topicSlug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
              description: `Topic for ${mcq.topicSlug} content (SITE-S26).`,
              type: 'TOPIC',
              status: 'ACTIVE',
              scope: 'GLOBAL',
            },
          })
          topicId = newTopic.id
          topicCache.set(mcq.topicSlug, topicId)
        }
      }

      // Ensure knowledge unit exists
      const unitSlug = `gk-hindi-${mcq.subjectSlug}`
      let unitId = unitCache.get(unitSlug)
      if (!unitId) {
        const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: unitSlug } })
        if (unit) {
          unitId = unit.id
          unitCache.set(unitSlug, unitId)
        } else {
          const newUnit = await prisma.knowledgeUnit.create({
            data: {
              slug: unitSlug,
              canonicalName: `gk-hindi.in ${mcq.subjectSlug} corpus`,
              canonicalSummary: `MCQ questions scraped from gk-hindi.in/${mcq.subjectSlug} (SITE-S25).`,
              canonicalBody: `This knowledge unit aggregates multiple-choice questions from https://gk-hindi.in/${mcq.subjectSlug}.`,
              type: 'CONCEPT',
              status: 'VERIFIED',
              difficulty: 'BASIC',
              scope: 'GLOBAL',
              topicId,
            },
          })
          unitId = newUnit.id
          unitCache.set(unitSlug, unitId)
        }
      }

      // Check if question already exists (identity: unitId + languageId + questionText)
      const existing = await prisma.question.findFirst({
        where: { knowledgeUnitId: unitId, languageId: language.id, questionText: mcq.question },
        select: { id: true },
      })
      if (existing) { skipped++; continue }

      // Create the translated question
      const optionsJson = serializeOptions(mcq.optionA, mcq.optionB, mcq.optionC, mcq.optionD)
      const explanation = `Source: gk-hindi.in/${mcq.subjectSlug} (Hindi)\nAI-translated to ${language.name} — SITE-S26.`

      try {
        const question = await prisma.question.create({
          data: {
            knowledgeUnitId: unitId,
            examVersionId: null,
            languageId: language.id,
            status: 'PUBLISHED',
            type: 'MCQ',
            difficulty: 'BASIC',
            questionText: mcq.question,
            optionsJson,
            correctAnswer: mcq.correctAnswer,
            explanation,
            aiAssisted: true,
            createdById: admin.id,
          },
        })
        const revision = await prisma.questionRevision.create({
          data: {
            questionId: question.id,
            revisionNumber: 1,
            questionText: mcq.question,
            optionsJson,
            correctAnswer: mcq.correctAnswer,
            explanation,
            difficulty: 'BASIC',
            changeSummary: `SITE-S26 import: ${language.code} translation from file`,
            aiAssisted: true,
            publishedById: admin.id,
            publishedAt: new Date(),
          },
        })
        await prisma.question.update({
          where: { id: question.id },
          data: { publishedRevisionId: revision.id },
        })
        created++
      } catch (e) {
        console.log(`  ! Error: ${(e as Error).message.slice(0, 80)}`)
        errors++
      }
    }

    console.log(`  Progress: ${Math.min(i + BATCH_SIZE, data.mcqs.length)}/${data.mcqs.length} (created: ${created}, skipped: ${skipped}, errors: ${errors})`)
  }

  console.log(`\n=== IMPORT COMPLETE ===`)
  console.log(`  Language: ${language.code} (${language.name})`)
  console.log(`  Questions created: ${created}`)
  console.log(`  Skipped (already present): ${skipped}`)
  console.log(`  Errors: ${errors}`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) }).finally(() => prisma.$disconnect())
