/**
 * SITE-S24 v3: Scrape gk-hindi.in — extract MCQs using the showAnswerBtn pattern.
 *
 * The site uses <button class="showAnswerBtn" data-id="0" data-answer="c">
 * for each MCQ. We extract the answer from the data-answer attribute, and
 * parse the preceding HTML chunk for the question + 4 options.
 *
 * Rate-limited (1 request per 2 seconds). Idempotent (skips cached files).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const OUTPUT_DIR = join(process.cwd(), 'scripts', 's24-data')
const DELAY_MS = 2000

interface ScrapedMCQ {
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string // 'A' | 'B' | 'C' | 'D'
  subject: string
  sourceUrl: string
  language: 'hi' | 'en'
}

interface SubjectConfig {
  slug: string
  name: string
  topicSlug: string
  language: 'hi' | 'en'
  maxPages: number
}

const SUBJECTS: SubjectConfig[] = [
  { slug: 'physics-gk', name: 'Physics GK', topicSlug: 'science-technology', language: 'hi', maxPages: 50 },
  { slug: 'physics-mcq-in-hindi', name: 'Physics MCQ', topicSlug: 'science-technology', language: 'hi', maxPages: 50 },
  { slug: 'chemistry-gk', name: 'Chemistry GK', topicSlug: 'science-technology', language: 'hi', maxPages: 15 },
  { slug: 'biology-gk', name: 'Biology GK', topicSlug: 'science-technology', language: 'hi', maxPages: 50 },
  { slug: 'india-gk', name: 'India GK', topicSlug: 'india-gk', language: 'hi', maxPages: 50 },
  { slug: 'gk-questions', name: 'GK Questions', topicSlug: 'general-knowledge', language: 'hi', maxPages: 50 },
  { slug: 'gk-quiz', name: 'GK Quiz', topicSlug: 'general-knowledge', language: 'hi', maxPages: 50 },
]

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'hi,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return null
    return await response.text()
  } catch { return null }
}

function parseMCQs(html: string, subject: string, sourceUrl: string, language: 'hi' | 'en'): ScrapedMCQ[] {
  const mcqs: ScrapedMCQ[] = []

  // Find all showAnswerBtn elements with their data-id and data-answer
  const answerButtons = [...html.matchAll(/<button[^>]*class="[^"]*showAnswerBtn[^"]*"[^>]*data-id="(\d+)"[^>]*data-answer="([a-d])"[^>]*>/g)]

  for (const btn of answerButtons) {
    const id = btn[1]
    const answer = btn[2].toUpperCase()
    const btnIndex = btn.index!

    // Look back ~3000 chars for the question + options block
    const chunk = html.substring(Math.max(0, btnIndex - 3000), btnIndex)

    // Strip HTML tags, convert to lines
    const text = chunk
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 1)

    // Find the last question (a numbered line) and the 4 options after it
    let question = ''
    const options: string[] = []
    let foundQuestion = false

    for (let i = text.length - 1; i >= 0; i--) {
      const line = text[i]
      const optMatch = line.match(/^\(?([A-Da-d])\)?[\.\)]\s*(.+)/)
      if (optMatch) {
        const idx = optMatch[1].toUpperCase().charCodeAt(0) - 65
        if (idx >= 0 && idx < 4) {
          options[idx] = optMatch[2].trim()
        }
      } else if (!foundQuestion && options.length >= 2 && line.length > 10) {
        // This is the question line (the first non-option line above the options)
        question = line.replace(/^\d+[\.\)]\s*/, '').trim()
        foundQuestion = true
        break
      }
    }

    // Validate: must have a question + at least 2 options
    if (question && question.length > 8 && options.filter((o) => o && o.length > 0).length >= 2) {
      // Skip intro text
      if (question.includes('तियोगी परीक्षाओं') || question.includes('प्रतियोगी परीक्षाओं')) continue
      mcqs.push({
        question,
        optionA: options[0] || '',
        optionB: options[1] || '',
        optionC: options[2] || '',
        optionD: options[3] || '',
        correctAnswer: answer,
        subject,
        sourceUrl,
        language,
      })
    }
  }

  return mcqs
}

async function scrapeSubject(subject: SubjectConfig): Promise<ScrapedMCQ[]> {
  const outputFile = join(OUTPUT_DIR, `${subject.slug}.json`)
  const allMCQs: ScrapedMCQ[] = []
  let emptyCount = 0

  for (let page = 1; page <= subject.maxPages; page++) {
    const url = page === 1 ? `https://gk-hindi.in/${subject.slug}` : `https://gk-hindi.in/${subject.slug}?page=${page}`
    process.stdout.write(`  ${subject.slug} p${page}…`)
    const html = await fetchPage(url)
    if (!html) { console.log(' FAIL'); break }
    const mcqs = parseMCQs(html, subject.name, url, subject.language)
    if (mcqs.length === 0) {
      emptyCount++
      if (emptyCount >= 2) { console.log(` 0 (2 empty, stop)`); break }
      console.log(` 0`)
    } else {
      emptyCount = 0
      allMCQs.push(...mcqs)
      console.log(` ${mcqs.length} (total: ${allMCQs.length})`)
    }
    await sleep(DELAY_MS)
  }

  writeFileSync(outputFile, JSON.stringify(allMCQs, null, 2))
  console.log(`  → saved ${allMCQs.length} to ${subject.slug}.json`)
  return allMCQs
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  console.log('SITE-S24 v3: scraping gk-hindi.in (showAnswerBtn pattern)…\n')

  let total = 0
  for (const subject of SUBJECTS) {
    console.log(`\n=== ${subject.name} ===`)
    const mcqs = await scrapeSubject(subject)
    total += mcqs.length
  }

  console.log(`\n=== TOTAL: ${total} MCQs scraped ===`)

  // Summary
  for (const subject of SUBJECTS) {
    const file = join(OUTPUT_DIR, `${subject.slug}.json`)
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, 'utf-8')) as ScrapedMCQ[]
      const withAns = data.filter((m) => m.correctAnswer).length
      console.log(`  ${subject.name.padEnd(25)} ${data.length} MCQs (${withAns} w/ answers)`)
    }
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
