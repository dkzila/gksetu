/**
 * SITE-S25: Translate scraped MCQs to 9 Indian languages using the z-ai-web-dev-sdk LLM.
 *
 * Source: Hindi MCQs in scripts/s25-data/{slug}.json
 * Output: scripts/s25-data/translations/{slug}/{langCode}.json — array of {id, question, optionA..D, correctAnswer}
 *
 * Strategy:
 *  - Batch ~15 MCQs per LLM call (translating to ONE language per call).
 *  - LLM returns strict JSON; we parse defensively.
 *  - Idempotent: per-subject per-language JSON cache; missing MCQs only are translated.
 *  - Concurrency: 3 parallel LLM calls.
 *
 * Targets 9 languages: en, bn, gu, kn, ml, mr, or, ta, te (Hindi is the source).
 *
 * Run:
 *   bun scripts/s25-translate.ts                          # translate everything
 *   bun scripts/s25-translate.ts --slug india-gk          # one subject
 *   bun scripts/s25-translate.ts --lang en                # one language
 *   bun scripts/s25-translate.ts --limit 30               # cap MCQs per subject
 *   bun scripts/s25-translate.ts --batch-size 15          # MCQs per LLM call
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import ZAI from 'z-ai-web-dev-sdk'

const DATA_DIR = join(process.cwd(), 'scripts', 's25-data')
const TRANS_DIR = join(DATA_DIR, 'translations')

const TARGET_LANGS = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'or', name: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
]

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

interface TranslatedMCQ {
  id: string
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
}

const CONCURRENCY = 1  // serial LLM calls — the API has tight rate limits

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

function systemPrompt(langName: string, nativeName: string): string {
  return [
    `You are a professional translator producing a ${nativeName} (${langName}) DRAFT translation of Indian exam-preparation MCQs for the GKSetu platform.`,
    'Hard rules:',
    '1. Translate the question AND each of the 4 options faithfully — every fact, name, date, number must survive exactly. Never invent or omit.',
    '2. Keep the correct answer letter (A/B/C/D) UNCHANGED — it refers to the same option position.',
    '3. Translate domain terms using the standard target-language terminology where one exists (constitutional, scientific, geographical terms).',
    '4. Preserve the meaning exactly — do NOT add explanations or commentary.',
    '5. Output ONLY a JSON array. Each element: {"id": "...", "question": "...", "optionA": "...", "optionB": "...", "optionC": "...", "optionD": "...", "correctAnswer": "..."}.',
    '6. The "id" and "correctAnswer" fields MUST be copied verbatim from the input — never modify them.',
    '7. Do NOT wrap the JSON in markdown fences. Output raw JSON only.',
  ].join('\n')
}

function userPrompt(batch: ScrapedMCQ[], langName: string, nativeName: string): string {
  const input = batch.map((m, i) => ({
    id: m.id,
    question: m.question,
    optionA: m.optionA,
    optionB: m.optionB,
    optionC: m.optionC,
    optionD: m.optionD,
    correctAnswer: m.correctAnswer,
  }))
  return [
    `Translate the following ${batch.length} Hindi MCQs into ${nativeName} (${langName}).`,
    'Return a JSON array with the same number of elements, in the same order, preserving the id and correctAnswer fields verbatim.',
    '',
    'INPUT (JSON array):',
    JSON.stringify(input),
    '',
    'OUTPUT (JSON array only — no fences, no commentary):',
  ].join('\n')
}

function parseResult(content: string, expectedIds: string[]): TranslatedMCQ[] | null {
  // Strip markdown fences if present
  let candidate = content.trim()
  const fenced = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidate = fenced[1]!.trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown
    if (!Array.isArray(parsed)) return null
    const out: TranslatedMCQ[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      const r = item as Record<string, unknown>
      if (typeof r.id !== 'string' || typeof r.question !== 'string' || typeof r.optionA !== 'string'
        || typeof r.optionB !== 'string' || typeof r.optionC !== 'string' || typeof r.optionD !== 'string'
        || typeof r.correctAnswer !== 'string') continue
      if (!expectedIds.includes(r.id)) continue
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push({
        id: r.id,
        question: r.question as string,
        optionA: r.optionA as string,
        optionB: r.optionB as string,
        optionC: r.optionC as string,
        optionD: r.optionD as string,
        correctAnswer: r.correctAnswer as string,
      })
    }
    return out
  } catch {
    return null
  }
}

async function translateBatch(
  batch: ScrapedMCQ[],
  lang: { code: string; name: string; native: string }
): Promise<TranslatedMCQ[] | null> {
  const expectedIds = batch.map((m) => m.id)
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: systemPrompt(lang.name, lang.native) },
          { role: 'user', content: userPrompt(batch, lang.name, lang.native) },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.3,
      })
      const content = completion.choices?.[0]?.message?.content
      if (!content || !content.trim()) return null
      return parseResult(content, expectedIds)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('429') || msg.includes('Too many requests')) {
        const wait = 5000 * (attempt + 1) // 5s, 10s, 15s, 20s
        console.log(`    [429] ${lang.code}: backing off ${wait}ms (attempt ${attempt + 1}/4)`)
        await sleep(wait)
        continue
      }
      console.log(`    ! LLM error (${lang.code}): ${msg.slice(0, 100)}`)
      return null
    }
  }
  return null
}

async function translateSubjectToLang(
  subjectSlug: string,
  mcqs: ScrapedMCQ[],
  lang: { code: string; name: string; native: string },
  batchSize: number,
  limit: number
): Promise<{ translated: number; failed: number; cached: number }> {
  const outDir = join(TRANS_DIR, subjectSlug)
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, `${lang.code}.json`)

  // Load cached translations
  let cached: TranslatedMCQ[] = []
  if (existsSync(outFile)) {
    try { cached = JSON.parse(readFileSync(outFile, 'utf-8')) as TranslatedMCQ[] } catch { cached = [] }
  }
  const cachedIds = new Set(cached.map((m) => m.id))

  // Hindi MCQs only (we don't translate English-source pages)
  const source = mcqs.filter((m) => m.language === 'hi')
  const slice = limit > 0 ? source.slice(0, limit) : source
  const toTranslate = slice.filter((m) => !cachedIds.has(m.id))
  if (toTranslate.length === 0) {
    return { translated: 0, failed: 0, cached: cached.length }
  }

  console.log(`  ${subjectSlug} → ${lang.code}: ${toTranslate.length} MCQs to translate (${cached.length} cached)`)

  let translated = 0
  let failed = 0
  const allResults = [...cached]

  // Process in batches with concurrency control
  for (let i = 0; i < toTranslate.length; i += batchSize * CONCURRENCY) {
    const chunk = toTranslate.slice(i, i + batchSize * CONCURRENCY)
    const batches: ScrapedMCQ[][] = []
    for (let j = 0; j < chunk.length; j += batchSize) {
      batches.push(chunk.slice(j, j + batchSize))
    }
    const results = await Promise.all(
      batches.map(async (b) => translateBatch(b, lang))
    )
    for (let bi = 0; bi < results.length; bi++) {
      const r = results[bi]
      if (r && r.length > 0) {
        allResults.push(...r)
        translated += r.length
      } else {
        failed += batches[bi]!.length
      }
    }
    // Save intermediate progress
    writeFileSync(outFile, JSON.stringify(allResults, null, 2))
    if (i + batchSize * CONCURRENCY < toTranslate.length) await sleep(800)
  }

  // Deduplicate by id (keep last)
  const dedup = new Map<string, TranslatedMCQ>()
  for (const m of allResults) dedup.set(m.id, m)
  writeFileSync(outFile, JSON.stringify([...dedup.values()], null, 2))

  return { translated, failed, cached: cached.length }
}

async function main() {
  const argv = process.argv.slice(2)
  const onlySlug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const onlyLang = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null
  const limitArg = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]!, 10) : 0
  const batchSizeArg = argv.includes('--batch-size') ? parseInt(argv[argv.indexOf('--batch-size') + 1]!, 10) : 12

  mkdirSync(TRANS_DIR, { recursive: true })

  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))
  console.log(`SITE-S25 translator: ${files.length} subjects, batchSize=${batchSizeArg}, limit=${limitArg}`)

  const langs = onlyLang ? TARGET_LANGS.filter((l) => l.code === onlyLang) : TARGET_LANGS

  let totalTranslated = 0
  let totalCached = 0
  let totalFailed = 0
  for (const file of files) {
    const subjectSlug = file.replace(/\.json$/, '')
    if (onlySlug && subjectSlug !== onlySlug) continue
    let mcqs: ScrapedMCQ[] = []
    try { mcqs = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8')) } catch { continue }
    if (!Array.isArray(mcqs) || mcqs.length === 0) continue

    console.log(`\n=== ${subjectSlug} (${mcqs.length} MCQs) ===`)
    for (const lang of langs) {
      const r = await translateSubjectToLang(subjectSlug, mcqs, lang, batchSizeArg, limitArg)
      totalTranslated += r.translated
      totalCached += r.cached
      totalFailed += r.failed
      if (r.translated > 0) console.log(`    ✓ ${lang.code}: +${r.translated} (cache: ${r.cached}, failed: ${r.failed})`)
    }
  }

  console.log(`\n=== TRANSLATION COMPLETE ===`)
  console.log(`  Newly translated: ${totalTranslated}`)
  console.log(`  Cached (pre-existing): ${totalCached}`)
  console.log(`  Failed: ${totalFailed}`)
  console.log(`  Output: ${TRANS_DIR}/`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
