/**
 * SITE-S25: Seed scraped gk-hindi.in MCQs into GKSetu.
 *
 * For each subject's scraped JSON:
 *   1. Ensures a Topic exists (or reuses existing) — the topicSlug from the
 *      scraper config (e.g. "india-gk", "science-technology", "state-gk-bihar").
 *   2. Ensures a KnowledgeUnit exists for the subject (one per subjectSlug —
 *      slug `gk-hindi-{subjectSlug}`, type CONCEPT, status VERIFIED).
 *   3. For each MCQ: creates a Question (Hindi) + QuestionRevision (revision 1)
 *      + publishedRevisionId pointer, status PUBLISHED.
 *
 * Identity (§11): (knowledgeUnitId, languageId, questionText) — findFirst-
 * then-create. Existing rows are NEVER overwritten (live edits win).
 *
 * Idempotent: re-runs only ADD missing questions.
 *
 * Run: bun scripts/s25-seed-questions.ts                  # seed all
 *      bun scripts/s25-seed-questions.ts --slug india-gk   # one subject
 *      bun scripts/s25-seed-questions.ts --limit 500       # cap per subject
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

const DATA_DIR = join(process.cwd(), 'scripts', 's25-data')

interface ScrapedMCQ {
  id: string
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
  subject: string
  subjectSlug: string
  topicSlug: string
  sourceUrl: string
  language: 'hi' | 'en'
}

// Topic canonicalName overrides — for the new state-specific topic slugs we
// invented. Existing topic slugs (science-technology, history, etc.) keep
// whatever canonical name they already have in the DB.
const TOPIC_NAMES: Record<string, string> = {
  'state-gk-bihar': 'Bihar State GK',
  'state-gk-haryana': 'Haryana State GK',
  'state-gk-himachal-pradesh': 'Himachal Pradesh State GK',
  'state-gk-jharkhand': 'Jharkhand State GK',
  'state-gk-karnataka': 'Karnataka State GK',
  'state-gk-maharashtra': 'Maharashtra State GK',
  'state-gk-madhya-pradesh': 'Madhya Pradesh State GK',
  'state-gk-rajasthan': 'Rajasthan State GK',
  'state-gk-uttar-pradesh': 'Uttar Pradesh State GK',
  'state-gk-delhi': 'Delhi State GK',
  'state-gk-chhattisgarh': 'Chhattisgarh State GK',
  'ssc-gk': 'SSC Exam GK',
  'upsc-gk': 'UPSC Exam GK',
  'bpsc-gk': 'BPSC Exam GK',
  'ctet-gk': 'CTET Exam GK',
  'bed-entrance-gk': 'B.Ed Entrance GK',
  'banking-gk': 'Banking Exam GK',
  'railway-gk': 'Railway Exam GK',
  'defence-gk': 'Defence Exam GK',
  'india-gk': 'India GK',
  'world-gk': 'World GK',
  'hindi-grammar': 'Hindi Grammar',
  'mathematics': 'Mathematics',
  'reasoning': 'Reasoning',
  'agriculture': 'Agriculture',
  'current-affairs': 'Current Affairs',
  'general-knowledge': 'General Knowledge',
  'static-gk': 'Static GK',
}

// Subject display names for KnowledgeUnit.canonicalName (English reference).
const SUBJECT_UNIT_NAMES: Record<string, string> = {
  'physics-gk': 'Physics GK — gk-hindi.in corpus',
  'physics-mcq-in-hindi': 'Physics MCQs — gk-hindi.in corpus',
  'physics-gk-in-english': 'Physics GK (English) — gk-hindi.in corpus',
  'chemistry-gk': 'Chemistry GK — gk-hindi.in corpus',
  'chemistry-gk-question': 'Chemistry GK Questions — gk-hindi.in corpus',
  'biology-gk': 'Biology GK — gk-hindi.in corpus',
  'science-gk': 'Science GK — gk-hindi.in corpus',
  'human-body-gk-in-hindi': 'Human Body GK — gk-hindi.in corpus',
  'technology-gk-in-hindi': 'Technology GK — gk-hindi.in corpus',
  'electronics-gk-in-hindi': 'Electronics GK — gk-hindi.in corpus',
  'computer-gk': 'Computer GK — gk-hindi.in corpus',
  'computer-in-hindi': 'Computer in Hindi — gk-hindi.in corpus',
  'isro-gk-in-hindi': 'ISRO GK — gk-hindi.in corpus',
  'chandrayan3-gk-in-hindi': 'Chandrayaan-3 GK — gk-hindi.in corpus',
  'india-gk': 'India GK — gk-hindi.in corpus',
  'indian-polity-gk-in-hindi': 'Indian Polity GK — gk-hindi.in corpus',
  'indian-polity-mcq': 'Indian Polity MCQ — gk-hindi.in corpus',
  'indian-political-gk-in-hindi': 'Indian Political GK — gk-hindi.in corpus',
  'political-gk': 'Political GK — gk-hindi.in corpus',
  'sanvidhan-gk': 'Constitution GK — gk-hindi.in corpus',
  'history-gk': 'History GK — gk-hindi.in corpus',
  'modern-history-quiz': 'Modern History Quiz — gk-hindi.in corpus',
  'geography-gk': 'Geography GK — gk-hindi.in corpus',
  'economics-gk': 'Economics GK — gk-hindi.in corpus',
  'accounting-concept': 'Accounting Concepts — gk-hindi.in corpus',
  'indian-culture-quiz': 'Indian Culture Quiz — gk-hindi.in corpus',
  'sports-gk': 'Sports GK — gk-hindi.in corpus',
  'ipl-gk-questions-in-hindi': 'IPL GK Questions — gk-hindi.in corpus',
  'bollywood-gk': 'Bollywood GK — gk-hindi.in corpus',
  'famous-person-gk-in-hindi': 'Famous Persons GK — gk-hindi.in corpus',
  'ramayan-gk': 'Ramayan GK — gk-hindi.in corpus',
  'special-day-gk-in-hindi': 'Important Days GK — gk-hindi.in corpus',
  'states-capitals-gk': 'States & Capitals GK — gk-hindi.in corpus',
  'static-gk-in-hindi': 'Static GK — gk-hindi.in corpus',
  'bihar-gk-in-hindi': 'Bihar GK — gk-hindi.in corpus',
  'haryana-gk-in-hindi': 'Haryana GK — gk-hindi.in corpus',
  'himachal-pradesh-gk-in-hindi': 'Himachal Pradesh GK — gk-hindi.in corpus',
  'jharkhand-gk-in-hindi': 'Jharkhand GK — gk-hindi.in corpus',
  'karnataka-gk-in-hindi': 'Karnataka GK — gk-hindi.in corpus',
  'maharashtra-gk-in-hindi': 'Maharashtra GK — gk-hindi.in corpus',
  'mp-gk-in-hindi': 'Madhya Pradesh GK — gk-hindi.in corpus',
  'rajasthan-gk-in-hindi': 'Rajasthan GK — gk-hindi.in corpus',
  'up-gk-in-hindi': 'Uttar Pradesh GK — gk-hindi.in corpus',
  'delhi-gk-in-hindi': 'Delhi GK — gk-hindi.in corpus',
  'chhattisgarh-gk-in-hindi': 'Chhattisgarh GK — gk-hindi.in corpus',
  'world-gk': 'World GK — gk-hindi.in corpus',
  'gk-questions': 'GK Questions — gk-hindi.in corpus',
  'gk-quiz': 'GK Quiz — gk-hindi.in corpus',
  'gk-in-english': 'GK in English — gk-hindi.in corpus',
  'gk-in-hindi-2024': 'GK in Hindi 2024 — gk-hindi.in corpus',
  'gk-in-hindi-2025': 'GK in Hindi 2025 — gk-hindi.in corpus',
  'general-knowledge-hindi': 'General Knowledge Hindi — gk-hindi.in corpus',
  'general-knowledge-in-hindi': 'General Knowledge in Hindi — gk-hindi.in corpus',
  'general-knowledge-questions': 'General Knowledge Questions — gk-hindi.in corpus',
  'general-knowledge-question-answer-in-hindi': 'GK Q&A in Hindi — gk-hindi.in corpus',
  'general-awareness': 'General Awareness — gk-hindi.in corpus',
  'general-awareness-in-hindi': 'General Awareness Hindi — gk-hindi.in corpus',
  'samany-gyan': 'Samanya Gyan — gk-hindi.in corpus',
  'samany-gyan-in-hindi': 'Samanya Gyan Hindi — gk-hindi.in corpus',
  'gk-1000': 'GK 1000 — gk-hindi.in corpus',
  'important-100-gk-in-hindi': 'Important 100 GK — gk-hindi.in corpus',
  'top-gk-questions-in-hindi': 'Top GK Questions — gk-hindi.in corpus',
  'best-gk-question-in-hindi': 'Best GK Questions — gk-hindi.in corpus',
  'one-line-gk': 'One Line GK — gk-hindi.in corpus',
  'gk-interesting-question-in-hindi': 'Interesting GK Questions — gk-hindi.in corpus',
  'gk-ka-janak-pita': 'GK ke Janak Pita — gk-hindi.in corpus',
  'gk-for-kids-in-hindi': 'GK for Kids — gk-hindi.in corpus',
  'gk-notes': 'GK Notes — gk-hindi.in corpus',
  'gk-test-in-hindi': 'GK Test — gk-hindi.in corpus',
  'gk-question-photo': 'GK Photo Questions — gk-hindi.in corpus',
  'brain-quiz': 'Brain Quiz — gk-hindi.in corpus',
  'whatsapp-gk': 'WhatsApp GK — gk-hindi.in corpus',
  'mcq-question-in-hindi': 'MCQ Questions Hindi — gk-hindi.in corpus',
  'ssc-gk-in-hindi': 'SSC GK — gk-hindi.in corpus',
  'ssc-gk-mcq-in-hindi': 'SSC GK MCQ — gk-hindi.in corpus',
  'ssc-model-practice-paper': 'SSC Model Paper 1 — gk-hindi.in corpus',
  'ssc-model-practice-paper2': 'SSC Model Paper 2 — gk-hindi.in corpus',
  'ssc-model-practice-paper3': 'SSC Model Paper 3 — gk-hindi.in corpus',
  'ssc-model-practice-paper4': 'SSC Model Paper 4 — gk-hindi.in corpus',
  'ssc-model-practice-paper5': 'SSC Model Paper 5 — gk-hindi.in corpus',
  'ssc-model-practice-paper6': 'SSC Model Paper 6 — gk-hindi.in corpus',
  'ssc-model-practice-paper7': 'SSC Model Paper 7 — gk-hindi.in corpus',
  'ssc-model-practice-paper8': 'SSC Model Paper 8 — gk-hindi.in corpus',
  'ssc-model-practice-paper9': 'SSC Model Paper 9 — gk-hindi.in corpus',
  'ssc-model-practice-paper10': 'SSC Model Paper 10 — gk-hindi.in corpus',
  'upsc-gk-in-hindi': 'UPSC GK — gk-hindi.in corpus',
  'ias-gk-question': 'IAS GK Questions — gk-hindi.in corpus',
  'bpsc-gk-in-hindi': 'BPSC GK — gk-hindi.in corpus',
  'ctet-gk-in-hindi': 'CTET GK — gk-hindi.in corpus',
  'bed-entrance-gk-in-hindi': 'B.Ed Entrance GK — gk-hindi.in corpus',
  'teaching-aptitude-in-hindi': 'Teaching Aptitude — gk-hindi.in corpus',
  'bank-gk': 'Bank GK — gk-hindi.in corpus',
  'rail-gk': 'Railway GK — gk-hindi.in corpus',
  'indian-army-gk-in-hindi': 'Indian Army GK — gk-hindi.in corpus',
  'indian-army-model-paper-in-hindi': 'Indian Army Model Paper — gk-hindi.in corpus',
  'kbc-gk-in-hindi': 'KBC GK — gk-hindi.in corpus',
  'khan-sir-gk': 'Khan Sir GK — gk-hindi.in corpus',
  'government-jobs-gk-in-hindi': 'Government Jobs GK — gk-hindi.in corpus',
  'lucent-gk-in-hindi': 'Lucent GK — gk-hindi.in corpus',
  'hindi-grammar-gk': 'Hindi Grammar GK — gk-hindi.in corpus',
  'hindi-grammar-gk-questions': 'Hindi Grammar Questions — gk-hindi.in corpus',
  'hindi-grammar-mcq': 'Hindi Grammar MCQ — gk-hindi.in corpus',
  'math-gk': 'Math GK — gk-hindi.in corpus',
  'reasoning-in-hindi': 'Reasoning Hindi — gk-hindi.in corpus',
  'agriculture-gk': 'Agriculture GK — gk-hindi.in corpus',
  'aadhar-card-gk-in-hindi': 'Aadhar Card GK — gk-hindi.in corpus',
  'current-affairs-in-hindi': 'Current Affairs Hindi — gk-hindi.in corpus',
  'daily-current-affairs-in-hindi': 'Daily Current Affairs — gk-hindi.in corpus',
  'online-gk-test-in-hindi': 'Online GK Test — gk-hindi.in corpus',
  'gk': 'GK — gk-hindi.in corpus',
}

function serializeOptions(opts: { A: string; B: string; C: string; D: string }): string {
  return JSON.stringify([
    { key: 'A', text: opts.A },
    { key: 'B', text: opts.B },
    { key: 'C', text: opts.C },
    { key: 'D', text: opts.D },
  ])
}

async function ensureTopic(slug: string): Promise<{ id: string }> {
  const existing = await prisma.topic.findUnique({ where: { slug } })
  if (existing) return { id: existing.id }
  const canonicalName = TOPIC_NAMES[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const created = await prisma.topic.create({
    data: {
      slug,
      canonicalName,
      description: `Topic for ${canonicalName} content scraped from gk-hindi.in (SITE-S25).`,
      type: 'TOPIC',
      status: 'ACTIVE',
      scope: 'GLOBAL',
    },
  })
  console.log(`  + topic: ${slug} → ${canonicalName}`)
  return { id: created.id }
}

async function ensureUnit(subjectSlug: string, topicId: string): Promise<{ id: string }> {
  const unitSlug = `gk-hindi-${subjectSlug}`
  const existing = await prisma.knowledgeUnit.findUnique({ where: { slug: unitSlug } })
  if (existing) return { id: existing.id }
  const canonicalName = SUBJECT_UNIT_NAMES[subjectSlug] ?? `gk-hindi.in ${subjectSlug} corpus`
  const created = await prisma.knowledgeUnit.create({
    data: {
      slug: unitSlug,
      canonicalName,
      canonicalSummary: `Multiple-choice GK questions in Hindi scraped from gk-hindi.in/${subjectSlug} (SITE-S25).`,
      canonicalBody: `This knowledge unit aggregates the multiple-choice general-knowledge questions scraped from https://gk-hindi.in/${subjectSlug} as part of SITE-S25. Each question carries 4 options (A/B/C/D), the correct answer, and source provenance back to the original page URL.`,
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'BASIC',
      scope: 'GLOBAL',
      topicId,
    },
  })
  console.log(`  + unit: ${unitSlug} → ${canonicalName}`)
  return { id: created.id }
}

async function seedSubject(
  mcqs: ScrapedMCQ[],
  adminId: string,
  hiId: string,
  enId: string,
  limit: number
): Promise<{ created: number; skipped: number; errors: number }> {
  let created = 0
  let skipped = 0
  let errors = 0
  if (mcqs.length === 0) return { created, skipped, errors }

  const first = mcqs[0]!
  const topic = await ensureTopic(first.topicSlug)
  const unit = await ensureUnit(first.subjectSlug, topic.id)
  const languageId = first.language === 'en' ? enId : hiId

  const slice = limit > 0 ? mcqs.slice(0, limit) : mcqs

  // Pre-fetch all existing question texts for this unit+language (one query).
  const existingRows = await prisma.question.findMany({
    where: { knowledgeUnitId: unit.id, languageId },
    select: { questionText: true },
  })
  const existingTexts = new Set(existingRows.map((r) => r.questionText))

  // Filter to only new MCQs.
  const newMcqs = slice.filter((m) => {
    if (!m.question || m.question.length < 5) { errors++; return false }
    if (!m.optionA || !m.optionB || !m.optionC || !m.optionD) { errors++; return false }
    if (!['A', 'B', 'C', 'D'].includes(m.correctAnswer)) { errors++; return false }
    if (existingTexts.has(m.question)) { skipped++; return false }
    return true
  })

  // Insert in batches (logs progress every 50 MCQs).
  const BATCH = 50
  for (let i = 0; i < newMcqs.length; i += BATCH) {
    const batch = newMcqs.slice(i, i + BATCH)
    for (const mcq of batch) {
      const explanation = `स्रोत: ${mcq.sourceUrl}\n\nसही उत्तर: ${mcq.correctAnswer}. (gk-hindi.in से संकलित — SITE-S25.)`
      const optionsJson = serializeOptions({ A: mcq.optionA, B: mcq.optionB, C: mcq.optionC, D: mcq.optionD })
      try {
        const question = await prisma.question.create({
          data: {
            knowledgeUnitId: unit.id,
            examVersionId: null,
            languageId,
            status: 'PUBLISHED',
            type: 'MCQ',
            difficulty: 'BASIC',
            questionText: mcq.question,
            optionsJson,
            correctAnswer: mcq.correctAnswer,
            explanation,
            aiAssisted: false,
            createdById: adminId,
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
            changeSummary: `SITE-S25 seed from gk-hindi.in/${mcq.subjectSlug}`,
            aiAssisted: false,
            publishedById: adminId,
            publishedAt: new Date(),
          },
        })
        await prisma.question.update({
          where: { id: question.id },
          data: { publishedRevisionId: revision.id },
        })
        created++
      } catch (e) {
        console.log(`  ! error seeding MCQ "${mcq.question.slice(0, 50)}…": ${(e as Error).message.slice(0, 100)}`)
        errors++
      }
    }
    if (i + BATCH < newMcqs.length) {
      console.log(`    ${first.subjectSlug}: ${Math.min(i + BATCH, newMcqs.length)}/${newMcqs.length} inserted`)
    }
  }
  return { created, skipped, errors }
}

async function main() {
  const argv = process.argv.slice(2)
  const onlySlug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const limitArg = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]!, 10) : 0

  console.log('SITE-S25 seeder: loading scraped MCQs…')

  // Resolve admin + language IDs
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } })
    ?? await prisma.user.findFirst({ where: { email: { contains: 'admin' } }, select: { id: true, email: true } })
    ?? await prisma.user.findFirst({ select: { id: true, email: true } })
  if (!admin) throw new Error('No admin user found — cannot seed')
  console.log(`  admin: ${admin.email}`)

  const hi = await prisma.language.findUnique({ where: { code: 'hi' } })
  const en = await prisma.language.findUnique({ where: { code: 'en' } })
  if (!hi || !en) throw new Error('Hindi or English language missing')

  // Load scraped files
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))
  console.log(`  found ${files.length} scraped files`)

  let totalCreated = 0
  let totalSkipped = 0
  let totalErrors = 0
  for (const file of files) {
    const subjectSlug = file.replace(/\.json$/, '')
    if (onlySlug && subjectSlug !== onlySlug) continue
    let mcqs: ScrapedMCQ[] = []
    try {
      mcqs = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8'))
    } catch {
      console.log(`  ! could not parse ${file}`)
      continue
    }
    if (!Array.isArray(mcqs) || mcqs.length === 0) {
      console.log(`  [skip] ${subjectSlug}: empty`)
      continue
    }
    console.log(`\n=== ${subjectSlug} (${mcqs.length} MCQs) ===`)
    const result = await seedSubject(mcqs, admin.id, hi.id, en.id, limitArg)
    totalCreated += result.created
    totalSkipped += result.skipped
    totalErrors += result.errors
    console.log(`  → created ${result.created}, skipped ${result.skipped}, errors ${result.errors}`)
  }

  console.log(`\n=== SEED COMPLETE ===`)
  console.log(`  Questions created: ${totalCreated}`)
  console.log(`  Questions skipped (already present): ${totalSkipped}`)
  console.log(`  Errors: ${totalErrors}`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) }).finally(() => prisma.$disconnect())
