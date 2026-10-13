/**
 * SITE-S26: Export all untranslated Hindi MCQs to a JSON file.
 *
 * For each Hindi MCQ that doesn't have an English translation cached,
 * export it with full metadata (id, question, options, correctAnswer,
 * subjectSlug, topicSlug) so another AI can translate it.
 *
 * Output: scripts/s26-export/untranslated-en.json
 *
 * Run: bun scripts/s26-export-untranslated.ts
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { readdirSync, statSync } from 'fs'

const DATA_DIR = join(process.cwd(), 'scripts', 's25-data')
const OUTPUT_DIR = join(process.cwd(), 'scripts', 's26-export')

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

interface ExportMCQ {
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

function getEnCached(slug: string): Set<string> {
  const f = join(DATA_DIR, 'translations', slug, 'en.json')
  try {
    const d = JSON.parse(readFileSync(f, 'utf-8'))
    if (Array.isArray(d)) return new Set(d.map((m: { id: string }) => m.id))
  } catch {}
  return new Set()
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const allMCQs: ExportMCQ[] = []
  let subjectsProcessed = 0

  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json')) continue
    const slug = f.replace(/\.json$/, '')
    const filePath = join(DATA_DIR, f)

    let mcqs: ScrapedMCQ[]
    try { mcqs = JSON.parse(readFileSync(filePath, 'utf-8')) } catch { continue }
    if (!Array.isArray(mcqs) || mcqs.length === 0) continue

    const hindiMCQs = mcqs.filter((m) => m.language === 'hi')
    if (hindiMCQs.length === 0) continue

    const enCached = getEnCached(slug)
    const untranslated = hindiMCQs.filter((m) => !enCached.has(m.id))

    for (const m of untranslated) {
      allMCQs.push({
        id: m.id,
        question: m.question,
        optionA: m.optionA,
        optionB: m.optionB,
        optionC: m.optionC,
        optionD: m.optionD,
        correctAnswer: m.correctAnswer,
        subjectSlug: m.subjectSlug,
        topicSlug: m.topicSlug,
      })
    }

    subjectsProcessed++
    if (subjectsProcessed % 10 === 0) {
      console.log(`  Processed ${subjectsProcessed} subjects, ${allMCQs.length} untranslated MCQs so far...`)
    }
  }

  const outputFile = join(OUTPUT_DIR, 'untranslated-en.json')
  writeFileSync(outputFile, JSON.stringify({
    format: 'gksetu-mcq-translations',
    sourceLanguage: 'hi',
    targetLanguage: 'en',
    totalMCQs: allMCQs.length,
    instructions: 'Translate only the question, optionA, optionB, optionC, optionD fields. Keep id, correctAnswer, subjectSlug, topicSlug UNCHANGED. Return the same JSON array format.',
    mcqs: allMCQs,
  }, null, 2))

  console.log(`\nExport complete!`)
  console.log(`  Total untranslated MCQs: ${allMCQs.length}`)
  console.log(`  Output: ${outputFile}`)

  // Also export per-subject for easier translation
  const bySubject = new Map<string, ExportMCQ[]>()
  for (const m of allMCQs) {
    const arr = bySubject.get(m.subjectSlug) ?? []
    arr.push(m)
    bySubject.set(m.subjectSlug, arr)
  }
  console.log(`  Subjects: ${bySubject.size}`)

  // Save per-subject files too
  for (const [slug, mcqs] of bySubject) {
    const subjFile = join(OUTPUT_DIR, `by-subject`, `${slug}.json`)
    mkdirSync(join(OUTPUT_DIR, 'by-subject'), { recursive: true })
    writeFileSync(subjFile, JSON.stringify({
      format: 'gksetu-mcq-translations',
      sourceLanguage: 'hi',
      targetLanguage: 'en',
      subjectSlug: slug,
      totalMCQs: mcqs.length,
      instructions: 'Translate only question, optionA, optionB, optionC, optionD. Keep id, correctAnswer, subjectSlug, topicSlug UNCHANGED.',
      mcqs,
    }, null, 2))
  }
  console.log(`  Per-subject files: scripts/s26-export/by-subject/`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
