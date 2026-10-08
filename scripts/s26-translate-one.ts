/**
 * SITE-S26: Robust translation runner — processes ONE subject × ONE language
 * per invocation. Designed to be called by the wrapper script (s26-run-translator.sh)
 * which loops over all subjects × all languages.
 *
 * Why per-invocation: long-running Bun processes crash on SDK 400/429 errors
 * (unhandled rejections escape our try/catch in some edge cases). By running
 * each subject×lang as a separate short-lived process, we guarantee:
 *   - Each invocation does at most ~50 LLM calls (a few minutes).
 *   - A crash only loses the current batch, not the whole run.
 *   - The wrapper script can continue to the next subject×lang.
 *
 * Usage:
 *   bun scripts/s26-translate-one.ts --slug biology-gk --lang ta --limit 50 --batch-size 8
 *
 * Exit code 0 = success (all batches processed, even if some failed).
 * Exit code 1 = fatal error (couldn't even start).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import ZAI from 'z-ai-web-dev-sdk'

const DATA_DIR = join(process.cwd(), 'scripts', 's25-data')
const TRANS_DIR = join(DATA_DIR, 'translations')

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

const LANGS: Record<string, { name: string; native: string }> = {
  en: { name: 'English', native: 'English' },
  bn: { name: 'Bengali', native: 'বাংলা' },
  gu: { name: 'Gujarati', native: 'ગુજરાતી' },
  kn: { name: 'Kannada', native: 'ಕನ್ನಡ' },
  ml: { name: 'Malayalam', native: 'മലയാളം' },
  mr: { name: 'Marathi', native: 'मराठी' },
  or: { name: 'Odia', native: 'ଓଡ଼ିଆ' },
  ta: { name: 'Tamil', native: 'தமிழ்' },
  te: { name: 'Telugu', native: 'తెలుగు' },
}

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

function systemPrompt(langName: string, nativeName: string): string {
  return [
    `You are a professional translator producing a ${nativeName} (${langName}) DRAFT translation of Indian exam-preparation MCQs for the GKSetu platform.`,
    'Hard rules:',
    '1. Translate the question AND each of the 4 options faithfully — every fact, name, date, number must survive exactly. Never invent or omit.',
    '2. Keep the correct answer letter (A/B/C/D) UNCHANGED — it refers to the same option position.',
    '3. Translate domain terms using the standard target-language terminology where one exists.',
    '4. Preserve the meaning exactly — do NOT add explanations or commentary.',
    '5. Output ONLY a JSON array. Each element: {"id": "...", "question": "...", "optionA": "...", "optionB": "...", "optionC": "...", "optionD": "...", "correctAnswer": "..."}.',
    '6. The "id" and "correctAnswer" fields MUST be copied verbatim from the input — never modify them.',
    '7. Do NOT wrap the JSON in markdown fences. Output raw JSON only.',
  ].join('\n')
}

function userPrompt(batch: ScrapedMCQ[], langName: string, nativeName: string): string {
  const input = batch.map((m) => ({
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
  langCode: string,
  langInfo: { name: string; native: string }
): Promise<TranslatedMCQ[] | null> {
  const expectedIds = batch.map((m) => m.id)
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: systemPrompt(langInfo.name, langInfo.native) },
          { role: 'user', content: userPrompt(batch, langInfo.name, langInfo.native) },
        ],
        thinking: { type: 'disabled' },
        temperature: 0.3,
      })
      const content = completion.choices?.[0]?.message?.content
      if (!content || !content.trim()) return null
      return parseResult(content, expectedIds)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      // 429 rate limit — back off and retry
      if (msg.includes('429') || msg.includes('Too many requests')) {
        const wait = 5000 * (attempt + 1)
        console.log(`    [429] ${langCode}: backoff ${wait}ms (${attempt + 1}/4)`)
        await sleep(wait)
        continue
      }
      // 400 content filter — soft fail
      if (msg.includes('400') && (msg.includes('contentFilter') || msg.includes('1301'))) {
        console.log(`    [content-filter] ${langCode}: skipped ${batch.length} MCQs`)
        return null
      }
      // Other errors — log and return null (don't crash)
      console.log(`    [err] ${langCode}: ${msg.slice(0, 80)}`)
      return null
    }
  }
  return null
}

async function main() {
  const argv = process.argv.slice(2)
  const slug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const langCode = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null
  const limit = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]!, 10) : 50
  const batchSize = argv.includes('--batch-size') ? parseInt(argv[argv.indexOf('--batch-size') + 1]!, 10) : 8

  if (!slug || !langCode || !LANGS[langCode]) {
    console.error('Usage: bun scripts/s26-translate-one.ts --slug <slug> --lang <code> [--limit N] [--batch-size N]')
    process.exit(1)
  }

  const langInfo = LANGS[langCode]!
  const inFile = join(DATA_DIR, `${slug}.json`)
  if (!existsSync(inFile)) {
    console.log(`  [skip] ${slug}: no scraped data`)
    process.exit(0)
  }

  let mcqs: ScrapedMCQ[] = []
  try { mcqs = JSON.parse(readFileSync(inFile, 'utf-8')) } catch { process.exit(0) }
  if (!Array.isArray(mcqs) || mcqs.length === 0) process.exit(0)

  const source = mcqs.filter((m) => m.language === 'hi')
  const slice = source.slice(0, limit)

  const outDir = join(TRANS_DIR, slug)
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, `${langCode}.json`)

  // Load cached translations
  let cached: TranslatedMCQ[] = []
  if (existsSync(outFile)) {
    try { cached = JSON.parse(readFileSync(outFile, 'utf-8')) } catch { cached = [] }
  }
  const cachedIds = new Set(cached.map((m) => m.id))
  const toTranslate = slice.filter((m) => !cachedIds.has(m.id))

  if (toTranslate.length === 0) {
    console.log(`  ${slug} → ${langCode}: all ${slice.length} cached`)
    process.exit(0)
  }

  console.log(`  ${slug} → ${langCode}: ${toTranslate.length} to translate (${cached.length} cached)`)

  let translated = 0
  let failed = 0
  const allResults = [...cached]

  // Serial batch processing (CONCURRENCY = 1)
  for (let i = 0; i < toTranslate.length; i += batchSize) {
    const batch = toTranslate.slice(i, i + batchSize)
    const result = await translateBatch(batch, langCode, langInfo)
    if (result && result.length > 0) {
      allResults.push(...result)
      translated += result.length
    } else {
      failed += batch.length
    }
    // Save progress after each batch
    writeFileSync(outFile, JSON.stringify(allResults, null, 2))
    // Small delay between batches to avoid 429
    if (i + batchSize < toTranslate.length) await sleep(300)
  }

  // Deduplicate by id (keep last)
  const dedup = new Map<string, TranslatedMCQ>()
  for (const m of allResults) dedup.set(m.id, m)
  writeFileSync(outFile, JSON.stringify([...dedup.values()], null, 2))

  console.log(`  ✓ ${slug} → ${langCode}: +${translated} (failed ${failed}, total cached ${dedup.size})`)
  process.exit(0)
}

// Prevent unhandled rejections from killing the process
process.on('unhandledRejection', (reason) => {
  console.log(`  [unhandled-rejection] ${String(reason).slice(0, 100)} — continuing`)
})
process.on('uncaughtException', (err) => {
  console.log(`  [uncaught-exception] ${String(err?.message ?? err).slice(0, 100)} — continuing`)
})

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
