/**
 * SITE-S25: Seed translated MCQs into GKSetu.
 *
 * Reads scripts/s25-data/translations/{subjectSlug}/{langCode}.json and creates
 * translated Question rows (linked to the same KnowledgeUnit as the Hindi source)
 * + Translation provenance links (sourceContentType=QUESTION).
 *
 * Identity (§11): (knowledgeUnitId, languageId, questionText) — findFirst-
 * then-create. Existing rows are NEVER overwritten.
 *
 * Idempotent: re-runs only ADD missing translations.
 *
 * Run:
 *   bun scripts/s25-seed-translations.ts                # all subjects × all langs
 *   bun scripts/s25-seed-translations.ts --slug india-gk
 *   bun scripts/s25-seed-translations.ts --lang en
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

const TRANS_DIR = join(process.cwd(), 'scripts', 's25-data', 'translations')

interface TranslatedMCQ {
  id: string
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
}

const TARGET_LANG_CODES = ['en', 'bn', 'gu', 'kn', 'ml', 'mr', 'or', 'ta', 'te']

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
  const onlySlug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const onlyLang = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null

  console.log('SITE-S25 translation seeder: loading translated MCQs…')

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } })
    ?? await prisma.user.findFirst({ where: { email: { contains: 'admin' } }, select: { id: true, email: true } })
    ?? await prisma.user.findFirst({ select: { id: true, email: true } })
  if (!admin) throw new Error('No admin user found — cannot seed')
  console.log(`  admin: ${admin.email}`)

  const langs = await prisma.language.findMany({ where: { code: { in: [...TARGET_LANG_CODES, 'hi'] } } })
  const langByCode = new Map(langs.map((l) => [l.code, l]))

  if (!existsSync(TRANS_DIR)) {
    console.log(`  no translations directory — nothing to seed`)
    return
  }

  const subjectDirs = readdirSync(TRANS_DIR).filter((d) => {
    try {
      const stat = require('fs').statSync(join(TRANS_DIR, d))
      return stat.isDirectory()
    } catch { return false }
  })
  console.log(`  found ${subjectDirs.length} subject directories`)

  let totalCreated = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const subjectSlug of subjectDirs) {
    if (onlySlug && subjectSlug !== onlySlug) continue
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: `gk-hindi-${subjectSlug}` } })
    if (!unit) {
      console.log(`  ! unit not found for ${subjectSlug} — run seeder first; skipping`)
      continue
    }
    const langFiles = readdirSync(join(TRANS_DIR, subjectSlug)).filter((f) => f.endsWith('.json'))
    for (const langFile of langFiles) {
      const langCode = langFile.replace(/\.json$/, '')
      if (onlyLang && langCode !== onlyLang) continue
      if (!TARGET_LANG_CODES.includes(langCode)) continue
      const lang = langByCode.get(langCode)
      if (!lang) { console.log(`  ! language ${langCode} not in DB; skipping`); continue }

      let translations: TranslatedMCQ[] = []
      try { translations = JSON.parse(readFileSync(join(TRANS_DIR, subjectSlug, langFile), 'utf-8')) } catch { continue }
      if (!Array.isArray(translations) || translations.length === 0) continue

      let created = 0
      let skipped = 0
      let errors = 0
      let linksCreated = 0
      for (const t of translations) {
        if (!t.question || t.question.length < 3) { errors++; continue }
        if (!['A', 'B', 'C', 'D'].includes(t.correctAnswer)) { errors++; continue }

        // Identity check on translated Question
        let question = await prisma.question.findFirst({
          where: { knowledgeUnitId: unit.id, languageId: lang.id, questionText: t.question },
          select: { id: true, publishedRevisionId: true },
        })
        if (question) { skipped++; }
        else {
          // Find the source Hindi Question by its id (matches the translation id)
          // The translation id is "{subjectSlug}::{hindiQuestionText}"
          const sourceQuestionText = t.id.includes('::') ? t.id.split('::').slice(1).join('::') : null

          const explanation = `Source: gk-hindi.in/${subjectSlug} (Hindi)\nAI-translated to ${lang.name} (${lang.nativeName}) — SITE-S25.`

          try {
            question = await prisma.question.create({
              data: {
                knowledgeUnitId: unit.id,
                examVersionId: null,
                languageId: lang.id,
                status: 'PUBLISHED',
                type: 'MCQ',
                difficulty: 'BASIC',
                questionText: t.question,
                optionsJson: serializeOptions(t.optionA, t.optionB, t.optionC, t.optionD),
                correctAnswer: t.correctAnswer,
                explanation,
                aiAssisted: true, // §26 — machine-drafted
                createdById: admin.id,
              },
            })
            const revision = await prisma.questionRevision.create({
              data: {
                questionId: question.id,
                revisionNumber: 1,
                questionText: t.question,
                optionsJson: serializeOptions(t.optionA, t.optionB, t.optionC, t.optionD),
                correctAnswer: t.correctAnswer,
                explanation,
                difficulty: 'BASIC',
                changeSummary: `SITE-S25 AI translation (${lang.code}) from gk-hindi.in/${subjectSlug}`,
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
            console.log(`  ! error seeding translation "${t.question.slice(0, 50)}…" (${langCode}): ${(e as Error).message.slice(0, 100)}`)
            errors++
            continue
          }
        }

        // Create Translation provenance link if we can find the source Hindi Question
        const sourceQuestionText = t.id.includes('::') ? t.id.split('::').slice(1).join('::') : null
        const hiId = langByCode.get('hi')?.id
        if (sourceQuestionText && hiId) {
          const source = await prisma.question.findFirst({
            where: { knowledgeUnitId: unit.id, languageId: hiId, questionText: sourceQuestionText },
            select: { id: true, publishedRevisionId: true },
          })
          if (source) {
            const existingLink = await prisma.translation.findFirst({
              where: {
                sourceContentType: 'QUESTION',
                sourceContentId: source.id,
                languageId: lang.id,
              },
              select: { id: true },
            })
            if (!existingLink) {
              await prisma.translation.create({
                data: {
                  sourceContentType: 'QUESTION',
                  sourceContentId: source.id,
                  targetContentType: 'QUESTION',
                  targetContentId: question.id,
                  languageId: lang.id,
                  sourceRevisionNumber: 1,
                  status: 'PUBLISHED',
                  aiAssisted: true,
                  notes: `SITE-S25 AI translation: Hindi → ${lang.name}`,
                  createdById: admin.id,
                },
              })
              linksCreated++
            }
          }
        }
      }
      totalCreated += created
      totalSkipped += skipped
      totalErrors += errors
      console.log(`  ${subjectSlug} [${langCode}]: +${created} (skipped ${skipped}, errors ${errors}, links ${linksCreated})`)
    }
  }

  console.log(`\n=== TRANSLATION SEED COMPLETE ===`)
  console.log(`  Translated Questions created: ${totalCreated}`)
  console.log(`  Skipped (already present): ${totalSkipped}`)
  console.log(`  Errors: ${totalErrors}`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) }).finally(() => prisma.$disconnect())
