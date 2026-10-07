/**
 * SITE-S24 fix: re-parse the scraped HTML with a better MCQ extractor.
 * The first pass missed the answer markers — this version looks for
 * "उत्तर:" or "Ans:" patterns more aggressively, and also cleans the
 * question text (strips the intro/preamble that precedes the actual question).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const OUTPUT_DIR = join(process.cwd(), 'scripts', 's24-data')
const DELAY_MS = 2000

interface ScrapedMCQ {
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string
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
  { slug: 'physics-gk', name: 'Physics GK', topicSlug: 'science-technology', language: 'hi', maxPages: 80 },
  { slug: 'physics-mcq-in-hindi', name: 'Physics MCQ', topicSlug: 'science-technology', language: 'hi', maxPages: 80 },
  { slug: 'physics-gk-in-english', name: 'Physics Quiz (English)', topicSlug: 'science-technology', language: 'en', maxPages: 30 },
  { slug: 'chemistry-gk', name: 'Chemistry GK', topicSlug: 'science-technology', language: 'hi', maxPages: 15 },
  { slug: 'biology-gk', name: 'Biology GK', topicSlug: 'science-technology', language: 'hi', maxPages: 30 },
  { slug: 'india-gk', name: 'India GK', topicSlug: 'india-gk', language: 'hi', maxPages: 30 },
  { slug: 'gk-questions', name: 'GK Questions', topicSlug: 'general-knowledge', language: 'hi', maxPages: 30 },
  { slug: 'gk-quiz', name: 'GK Quiz', topicSlug: 'general-knowledge', language: 'hi', maxPages: 30 },
]

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
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
  // Strip non-content HTML
  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

  // Extract article/main content
  const articleMatch = cleanHtml.match(/<(?:article|main|div[^>]*class="[^"]*(?:content|post|entry|question)[^"]*")[^>]*>([\s\S]*?)<\/(?:article|main|div)>/i)
  const contentHtml = articleMatch ? articleMatch[1] : cleanHtml

  // Convert to text with line breaks preserved
  const text = contentHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\r\n/g, '\n')

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 2)

  let currentQuestion = ''
  let options: string[] = []
  let inQuestion = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Detect question: starts with a number followed by "." or ")" 
    // e.g., "1. शरीर की..." or "1) What is..."
    const qMatch = line.match(/^\d+[\.\)]\s*(.+)/)
    // Detect options: "(A) ..." or "A) ..." or "A. ..." or "(a) ..."
    const oMatch = line.match(/^\(?([A-Da-d])\)?[\.\)]\s*(.+)/)
    // Detect answer: "उत्तर: A" or "Ans: A" or "Answer: A" or "सही उत्तर: A"
    const aMatch = line.match(/(?:उत्तर|Ans(?:wer)?|सही उत्तर|Correct Answer)\s*[:\-]?\s*\(?([A-Da-d])\)?/i)

    if (qMatch && !inQuestion && options.length === 0) {
      // New question starts
      if (currentQuestion && options.length === 4) {
        // Save previous without answer
        mcqs.push({ question: currentQuestion, optionA: options[0], optionB: options[1], optionC: options[2], optionD: options[3], correctAnswer: '', subject, sourceUrl, language })
      }
      currentQuestion = qMatch[1].trim()
      options = []
      inQuestion = true
    } else if (oMatch && inQuestion) {
      const idx = oMatch[1].toUpperCase().charCodeAt(0) - 65
      if (idx >= 0 && idx < 4) options[idx] = oMatch[2].trim()
    } else if (aMatch && inQuestion && options.length >= 2) {
      const answer = aMatch[1].toUpperCase()
      mcqs.push({ question: currentQuestion, optionA: options[0] || '', optionB: options[1] || '', optionC: options[2] || '', optionD: options[3] || '', correctAnswer: answer, subject, sourceUrl, language })
      currentQuestion = ''
      options = []
      inQuestion = false
    } else if (inQuestion && !oMatch && !aMatch && !qMatch && options.length === 0) {
      // Continuation of question text
      currentQuestion += ' ' + line
    }
  }
  // Last MCQ
  if (currentQuestion && options.length >= 2) {
    mcqs.push({ question: currentQuestion, optionA: options[0] || '', optionB: options[1] || '', optionC: options[2] || '', optionD: options[3] || '', correctAnswer: '', subject, sourceUrl, language })
  }

  // Filter out MCQs where the question is too short (< 10 chars) or contains intro text
  return mcqs.filter((mcq) => {
    // Skip if question is too short
    if (mcq.question.length < 10) return false
    // Skip if question contains "तियोगी परीक्षाओं" (the intro text)
    if (mcq.question.includes('तियोगी परीक्षाओं')) return false
    // Skip if question contains "प्रतियोगी परीक्षाओं" (the intro text)
    if (mcq.question.includes('प्रतियोगी परीक्षाओं')) return false
    // Skip if all options are empty
    if (!mcq.optionA && !mcq.optionB && !mcq.optionC && !mcq.optionD) return false
    return true
  })
}

async function scrapeSubject(subject: SubjectConfig): Promise<ScrapedMCQ[]> {
  const outputFile = join(OUTPUT_DIR, `${subject.slug}.json`)
  // Always re-scrape (overwrite the old data)
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
      if (emptyCount >= 2) { console.log(` 0 MCQs (2 empty, stop)`); break }
      console.log(` 0`)
    } else {
      emptyCount = 0
      allMCQs.push(...mcqs)
      const withAns = mcqs.filter((m) => m.correctAnswer).length
      console.log(` ${mcqs.length} MCQs (${withAns} w/ answers) total: ${allMCQs.length}`)
    }
    await sleep(DELAY_MS)
  }
  writeFileSync(outputFile, JSON.stringify(allMCQs, null, 2))
  console.log(`  → saved ${allMCQs.length} to ${outputFile}`)
  return allMCQs
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  console.log('SITE-S24 (fixed): scraping gk-hindi.in…\n')
  let total = 0
  for (const subject of SUBJECTS) {
    console.log(`\n=== ${subject.name} ===`)
    const mcqs = await scrapeSubject(subject)
    total += mcqs.length
  }
  console.log(`\n=== TOTAL: ${total} MCQs ===`)
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
