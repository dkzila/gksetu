/**
 * SITE-S19: seed demo books + magazines into the store, linked to exams.
 * Idempotent — skips books that already exist (by slug).
 *
 * Creates 4 demo books + links them to UPSC CSE, SSC CGL, AFCAT:
 *   1. "Indian Polity — Master Notes Compilation" (NOTE_COMPILATION, UPSC CSE)
 *   2. "SSC CGL General Awareness — Complete Guide" (BOOK, SSC CGL)
 *   3. "GKSetu Monthly — October 2026" (MAGAZINE, all exams)
 *   4. "AFCAT General Knowledge — Defence Edition" (BOOK, AFCAT)
 *
 * Each book gets 2 editions (PDF + Print) in English + Hindi.
 *
 * Run: `bun scripts/s19-seed-demo-books.ts`
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const ADMIN_USER_ID = 'cmuhqvuf3000ij1ysl9e4986x' // admin@gksetu.dev

interface DemoBook {
  slug: string
  title: string
  subtitle: string
  type: 'BOOK' | 'MAGAZINE' | 'NOTE_COMPILATION' | 'CURRENT_AFFAIRS_DIGEST'
  description: string
  category: string
  author: string
  countryIso: string
  examSlugs: Array<{ slug: string; relevance: 'primary' | 'supplementary' }>
  editions: Array<{
    format: 'PDF' | 'PRINT'
    languageCode: string
    price: number
    pageCount: number
  }>
}

const DEMO_BOOKS: DemoBook[] = [
  {
    slug: 'upsc-polity-master-notes',
    title: 'Indian Polity — Master Notes Compilation',
    subtitle: 'Pattern Briefs, Cheat Sheets, Worked PYQs + Revision Notes for every UPSC CSE Polity chapter',
    type: 'NOTE_COMPILATION',
    description: 'A complete compilation of GKSetu\'s premium ExamNotes for the UPSC Civil Services Examination\'s Polity chapters.\n\nEvery chapter — Indian Polity and Governance, Indian Constitution (historical underpinnings), Fundamental Rights and Duties — gets all four editorial layers:\n\n**Pattern Brief** — UPSC-specific weightage + question style (13-17 questions per year, "Consider the following statements" format)\n\n**Cheat Sheet** — 1-page condensed revision (articles, schedules, amendments, constitutional bodies)\n\n**Worked MCQs** — real PYQs with step-by-step explanations + pattern alerts (the traps UPSC sets)\n\n**Revision Notes** — last-night revision mind-maps (Preamble keywords, 6 FR categories, Article 21 expansion, 5 writs, basic structure doctrine)\n\nCompiled from the same ExamNotes that render on your tutorial chapter pages — always in sync with the latest published content.',
    category: 'Polity',
    author: 'GKSetu Editorial Board',
    countryIso: 'IN',
    examSlugs: [{ slug: 'upsc-civil-services', relevance: 'primary' }],
    editions: [
      { format: 'PDF', languageCode: 'en', price: 9900, pageCount: 120 },
      { format: 'PDF', languageCode: 'hi', price: 9900, pageCount: 120 },
      { format: 'PRINT', languageCode: 'en', price: 29900, pageCount: 120 },
    ],
  },
  {
    slug: 'ssc-cgl-ga-complete-guide',
    title: 'SSC CGL General Awareness — Complete Guide',
    subtitle: 'Polity, History, Geography, Economy + Current Affairs — fact-recall ready',
    type: 'BOOK',
    description: 'The complete General Awareness guide for SSC CGL Tier-I.\n\nSSC\'s GA section is 25 questions worth 50 marks. Polity alone contributes 4-6 questions every year. This guide covers:\n\n- **Indian Polity + Constitution** — all important articles, schedules, amendments\n- **History** — Ancient, Medieval, Modern + Freedom Struggle\n- **Geography** — Physical, Indian, World\n- **Economy** — Banking, Budget, Schemes\n- **General Science** — Physics, Chemistry, Biology basics\n- **Current Affairs** — last 6 months\n\nDesigned for SSC\'s fact-recall pattern — single-shot questions, no multi-statement analysis. Every fact you need, none you don\'t.',
    category: 'General Awareness',
    author: 'GKSetu Editorial Board',
    countryIso: 'IN',
    examSlugs: [
      { slug: 'ssc-cgl', relevance: 'primary' },
      { slug: 'upsc-civil-services', relevance: 'supplementary' },
    ],
    editions: [
      { format: 'PDF', languageCode: 'en', price: 14900, pageCount: 250 },
      { format: 'PDF', languageCode: 'hi', price: 14900, pageCount: 250 },
      { format: 'PRINT', languageCode: 'en', price: 39900, pageCount: 250 },
      { format: 'PRINT', languageCode: 'hi', price: 39900, pageCount: 250 },
    ],
  },
  {
    slug: 'gksetu-monthly-october-2026',
    title: 'GKSetu Monthly — October 2026',
    subtitle: 'Current Affairs Digest + Practice Questions + Exam Updates',
    type: 'MAGAZINE',
    description: 'The October 2026 issue of GKSetu\'s monthly magazine.\n\n**In this issue:**\n\n- **Current Affairs** — every major national + international event from October 2026\n- **Exam Updates** — upcoming exam notifications, syllabus changes, result dates\n- **Practice Questions** — 50 MCQs based on this month\'s current affairs\n- **Special Feature** — The 2026 Nobel Prize winners (Physics, Chemistry, Medicine, Literature, Peace, Economics)\n- **Defence News** — Indian Armed Forces updates (relevant for AFCAT/CDS/NDA aspirants)\n\nPerfect for last-month revision before your exam. Available in PDF (instant download) + Print (shipped).',
    category: 'Current Affairs',
    author: 'GKSetu Editorial Board',
    countryIso: 'IN',
    examSlugs: [
      { slug: 'upsc-civil-services', relevance: 'supplementary' },
      { slug: 'ssc-cgl', relevance: 'supplementary' },
      { slug: 'afcat', relevance: 'supplementary' },
    ],
    editions: [
      { format: 'PDF', languageCode: 'en', price: 4900, pageCount: 80 },
      { format: 'PRINT', languageCode: 'en', price: 9900, pageCount: 80 },
    ],
  },
  {
    slug: 'afcat-gk-defence-edition',
    title: 'AFCAT General Knowledge — Defence Edition',
    subtitle: 'Polity + History + Geography + Defence awareness — AFCAT-specific',
    type: 'BOOK',
    description: 'A complete GK guide tailored for the Air Force Common Admission Test (AFCAT).\n\nAFCAT\'s General Awareness contributes 25-30 questions out of 100. This guide covers:\n\n- **Indian Polity** — the Constitution, important articles, constitutional bodies (President as Supreme Commander of the Armed Forces, the CDS post, the Agnipath scheme)\n- **History** — Ancient, Medieval, Modern + Freedom Struggle\n- **Geography** — Physical, Indian, World (with aviation-relevant topics)\n- **Defence Awareness** — Indian Air Force history, aircraft, missions, ranks, the Chief of Defence Staff\n- **Current Affairs** — last 6 months of defence + national news\n\nDesigned for AFCAT\'s fact-recall pattern. Includes 50 practice MCQs in the AFCAT style.',
    category: 'General Awareness',
    author: 'GKSetu Editorial Board',
    countryIso: 'IN',
    examSlugs: [{ slug: 'afcat', relevance: 'primary' }],
    editions: [
      { format: 'PDF', languageCode: 'en', price: 9900, pageCount: 180 },
      { format: 'PRINT', languageCode: 'en', price: 24900, pageCount: 180 },
    ],
  },
]

async function main() {
  console.log('SITE-S19: seeding demo books…\n')

  let created = 0
  let skipped = 0

  for (const demo of DEMO_BOOKS) {
    const existing = await db.book.findUnique({ where: { slug: demo.slug }, select: { id: true } })
    if (existing) {
      console.log(`  ${demo.slug}: already exists — skipping.`)
      skipped += 1
      continue
    }

    // Find the country.
    const country = await db.country.findUnique({ where: { isoCode: demo.countryIso }, select: { id: true } })
    if (!country) {
      console.log(`  ${demo.slug}: country ${demo.countryIso} not found — skipping.`)
      continue
    }

    // Create the book as PUBLISHED.
    const book = await db.book.create({
      data: {
        slug: demo.slug,
        type: demo.type,
        status: 'PUBLISHED',
        title: demo.title,
        subtitle: demo.subtitle,
        description: demo.description,
        category: demo.category,
        author: demo.author,
        countryId: country.id,
        createdById: ADMIN_USER_ID,
        publishedAt: new Date(),
        sortOrder: created,
      },
    })

    // Create the editions.
    for (const edition of demo.editions) {
      const language = await db.language.findUnique({ where: { code: edition.languageCode }, select: { id: true } })
      if (!language) {
        console.log(`  ${demo.slug}: language ${edition.languageCode} not found — skipping edition.`)
        continue
      }
      await db.bookEdition.create({
        data: {
          bookId: book.id,
          format: edition.format,
          languageId: language.id,
          price: edition.price,
          pageCount: edition.pageCount,
          isActive: true,
          fileUrl: demo.type === 'NOTE_COMPILATION' ? null : `https://gksetu.in/store/${book.slug}/download`,
        },
      })
    }

    // Link exams.
    for (const examLink of demo.examSlugs) {
      const exam = await db.exam.findUnique({ where: { slug: examLink.slug }, select: { id: true } })
      if (!exam) {
        console.log(`  ${demo.slug}: exam ${examLink.slug} not found — skipping link.`)
        continue
      }
      await db.bookExamLink.create({
        data: {
          bookId: book.id,
          examId: exam.id,
          relevance: examLink.relevance,
        },
      })
    }

    console.log(`  ${demo.slug}: created + published (${demo.editions.length} editions, ${demo.examSlugs.length} exam links)`)
    created += 1
  }

  console.log(`\n=== PARITY REPORT ===`)
  console.log(`Created: ${created}`)
  console.log(`Skipped (already existed): ${skipped}`)

  // Final census.
  const totalBooks = await db.book.count()
  const totalEditions = await db.bookEdition.count()
  const totalLinks = await db.bookExamLink.count()
  console.log(`\nFinal census: ${totalBooks} books, ${totalEditions} editions, ${totalLinks} exam links`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error('FAILED:', e); await db.$disconnect(); process.exit(1) })
