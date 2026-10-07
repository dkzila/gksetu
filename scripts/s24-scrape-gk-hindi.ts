/**
 * SITE-S24: Scrape gk-hindi.in — extract MCQs from subject pages.
 *
 * Crawls the site's subject/category pages, parses the HTML to extract
 * MCQs (question text, 4 options, correct answer, subject), and writes
 * JSON files per subject to scripts/s24-data/.
 *
 * Rate-limited (1 request per 2 seconds — respectful crawling).
 * Idempotent — skips pages already scraped (checks if the output file exists).
 *
 * Run: `bun scripts/s24-scrape-gk-hindi.ts`
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

const OUTPUT_DIR = join(process.cwd(), 'scripts', 's24-data')
const DELAY_MS = 2000 // 2 seconds between requests — respectful crawling

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
  slug: string           // the URL path segment on gk-hindi.in
  name: string           // human-readable subject name
  topicSlug: string      // GKSetu's taxonomy topic slug (for mapping)
  language: 'hi' | 'en'  // the source language of the page
  maxPages: number       // safety cap on pages to scrape
}

// The subjects to scrape (from search analysis of gk-hindi.in)
const SUBJECTS: SubjectConfig[] = [
  { slug: 'physics-gk', name: 'Physics GK', topicSlug: 'science-technology', language: 'hi', maxPages: 120 },
  { slug: 'physics-mcq-in-hindi', name: 'Physics MCQ', topicSlug: 'science-technology', language: 'hi', maxPages: 180 },
  { slug: 'physics-gk-in-english', name: 'Physics Quiz (English)', topicSlug: 'science-technology', language: 'en', maxPages: 50 },
  { slug: 'chemistry-gk', name: 'Chemistry GK', topicSlug: 'science-technology', language: 'hi', maxPages: 15 },
  { slug: 'biology-gk', name: 'Biology GK', topicSlug: 'science-technology', language: 'hi', maxPages: 50 },
  { slug: 'india-gk', name: 'India GK', topicSlug: 'india-gk', language: 'hi', maxPages: 50 },
  { slug: 'gk-questions', name: 'GK Questions', topicSlug: 'general-knowledge', language: 'hi', maxPages: 50 },
  { slug: 'gk-quiz', name: 'GK Quiz', topicSlug: 'general-knowledge', language: 'hi', maxPages: 50 },
]

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GKSetuContentBot/1.0; +https://gksetu.in)',
        'Accept': 'text/html',
        'Accept-Language': 'hi,en',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      console.log(`  ! HTTP ${response.status} for ${url}`)
      return null
    }
    return await response.text()
  } catch (error) {
    console.log(`  ! Fetch error for ${url}: ${(error as Error).message}`)
    return null
  }
}

/**
 * Parses the HTML to extract MCQs. The gk-hindi.in format is:
 * Each MCQ is a block with a question, followed by 4 options (A/B/C/D),
 * and a "उत्तर" (answer) or "Answer" line showing the correct option.
 */
function parseMCQs(html: string, subject: string, sourceUrl: string, language: 'hi' | 'en'): ScrapedMCQ[] {
  const mcqs: ScrapedMCQ[] = []

  // Strategy: look for question blocks. gk-hindi.in uses various HTML
  // patterns — we try multiple selectors.
  //
  // Pattern 1: <div class="question"> or <p class="question">
  // Pattern 2: Numbered questions "Q. " or "प्र. "
  // Pattern 3: <li> elements with options
  //
  // The most robust approach: extract text blocks that contain a question
  // followed by 4 options (A/B/C/D or (a)/(b)/(c)/(d)) and an answer marker.

  // Remove script/style tags
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')

  // Extract text content (strip HTML tags but keep structure)
  const text = cleanHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\r\n/g, '\n')

  // Split into lines and find MCQ blocks
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  let currentQuestion = ''
  let options: string[] = []
  let inQuestion = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect question start: "Q. " or "प्र. " or "Q:" or a numbered question
    const questionMatch = line.match(/^(?:Q\.?\s*|प्र\.?\s*|Question\s*[:\-]?\s*|प्रश्न\s*[:\-]?\s*)/i)

    // Detect option lines: "A) ..." or "(A) ..." or "A. ..." or "(a) ..."
    const optionMatch = line.match(/^(?:\(?([A-Da-d])\)?[\.\)]\s*)(.+)/)

    // Detect answer: "उत्तर" or "Answer" or "Ans" followed by the letter
    const answerMatch = line.match(/^(?:उत्तर\s*[:\-]?\s*|Answer\s*[:\-]?\s*|Ans\s*[:\-]?\s*)([A-Da-d])/i)

    if (questionMatch && !inQuestion) {
      // Start of a new question
      if (currentQuestion && options.length === 4) {
        // Save the previous MCQ (without an answer — we'll try to find it)
        mcqs.push({
          question: currentQuestion,
          optionA: options[0] || '',
          optionB: options[1] || '',
          optionC: options[2] || '',
          optionD: options[3] || '',
          correctAnswer: '',
          subject,
          sourceUrl,
          language,
        })
      }
      currentQuestion = line.replace(questionMatch[0], '').trim()
      options = []
      inQuestion = true
    } else if (optionMatch && inQuestion) {
      // An option line
      const optionLetter = optionMatch[1].toUpperCase()
      const optionText = optionMatch[2].trim()
      const optionIndex = optionLetter.charCodeAt(0) - 65 // A=0, B=1, C=2, D=3
      if (optionIndex >= 0 && optionIndex < 4) {
        options[optionIndex] = optionText
      }
    } else if (answerMatch && inQuestion && options.length === 4) {
      // Found the answer — save the MCQ with the correct answer
      const answerLetter = answerMatch[1].toUpperCase()
      mcqs.push({
        question: currentQuestion,
        optionA: options[0] || '',
        optionB: options[1] || '',
        optionC: options[2] || '',
        optionD: options[3] || '',
        correctAnswer: answerLetter,
        subject,
        sourceUrl,
        language,
      })
      currentQuestion = ''
      options = []
      inQuestion = false
    } else if (inQuestion && !optionMatch && !answerMatch) {
      // Continuation of the question text (multi-line questions)
      if (options.length === 0) {
        currentQuestion += ' ' + line
      }
    }
  }

  // Save the last MCQ if it has 4 options
  if (currentQuestion && options.length === 4) {
    mcqs.push({
      question: currentQuestion,
      optionA: options[0] || '',
      optionB: options[1] || '',
      optionC: options[2] || '',
      optionD: options[3] || '',
      correctAnswer: '',
      subject,
      sourceUrl,
      language,
    })
  }

  return mcqs
}

async function scrapeSubject(subject: SubjectConfig): Promise<ScrapedMCQ[]> {
  const outputFile = join(OUTPUT_DIR, `${subject.slug}.json`)
  if (existsSync(outputFile)) {
    console.log(`  ${subject.slug}: already scraped — loading from cache.`)
    return JSON.parse(readFileSync(outputFile, 'utf-8')) as ScrapedMCQ[]
  }

  const allMCQs: ScrapedMCQ[] = []
  let emptyPageCount = 0

  for (let page = 1; page <= subject.maxPages; page++) {
    const url = page === 1
      ? `https://gk-hindi.in/${subject.slug}`
      : `https://gk-hindi.in/${subject.slug}?page=${page}`

    console.log(`  ${subject.slug} page ${page}: fetching ${url}`)
    const html = await fetchPage(url)
    if (!html) {
      console.log(`  ${subject.slug} page ${page}: fetch failed — stopping.`)
      break
    }

    const mcqs = parseMCQs(html, subject.name, url, subject.language)
    if (mcqs.length === 0) {
      emptyPageCount++
      if (emptyPageCount >= 2) {
        console.log(`  ${subject.slug} page ${page}: no MCQs found — 2 empty pages, stopping.`)
        break
      }
    } else {
      emptyPageCount = 0
      allMCQs.push(...mcqs)
      console.log(`  ${subject.slug} page ${page}: found ${mcqs.length} MCQs (total: ${allMCQs.length})`)
    }

    // Rate limit
    await sleep(DELAY_MS)
  }

  // Save to file
  writeFileSync(outputFile, JSON.stringify(allMCQs, null, 2))
  console.log(`  ${subject.slug}: saved ${allMCQs.length} MCQs to ${outputFile}`)

  return allMCQs
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  console.log('SITE-S24: scraping gk-hindi.in…\n')

  let totalMCQs = 0
  const subjectCounts: Record<string, number> = {}

  for (const subject of SUBJECTS) {
    console.log(`\n=== ${subject.name} (${subject.slug}) ===`)
    const mcqs = await scrapeSubject(subject)
    totalMCQs += mcqs.length
    subjectCounts[subject.name] = mcqs.length
  }

  console.log('\n=== PARITY REPORT ===')
  for (const [name, count] of Object.entries(subjectCounts)) {
    console.log(`  ${name.padEnd(30)} ${count} MCQs`)
  }
  console.log(`\nTotal: ${totalMCQs} MCQs scraped`)
  console.log(`Output: ${OUTPUT_DIR}/`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
