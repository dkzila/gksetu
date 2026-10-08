/**
 * SITE-S25: Comprehensive gk-hindi.in scraper.
 *
 * Improvements over S24:
 *  - Uses the `question-wrapper` div pattern (the site's own structural
 *    delimiter) instead of fragile text-pattern matching.
 *  - Auto-detects the max page count per subject from pagination links.
 *  - Parallel fetching with concurrency control (5 concurrent requests).
 *  - Handles ALL 115+ subject slugs discovered on the homepage sidebar.
 *  - Per-subject JSON cache; --force flag to re-scrape.
 *  - Also captures the source page URL per MCQ for provenance.
 *
 * Output: scripts/s25-data/{slug}.json — array of ScrapedMCQ.
 *
 * Run:  bun scripts/s25-scrape-gk-hindi.ts              # scrape all
 *       bun scripts/s25-scrape-gk-hindi.ts --slug india-gk  # one subject
 *       bun scripts/s25-scrape-gk-hindi.ts --force      # re-scrape cached
 *       bun scripts/s25-scrape-gk-hindi.ts --max-pages 20  # cap pages
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

const OUTPUT_DIR = join(process.cwd(), 'scripts', 's25-data')
const DELAY_MS = 600            // 0.6s between sequential requests within a subject
const CONCURRENCY = 3          // parallel subjects (reduced from 5 to be gentler)
const DEFAULT_MAX_PAGES = 80    // safety cap per subject
const PER_SUBJECT_TIMEOUT_MS = 5 * 60 * 1000

interface ScrapedMCQ {
  id: string             // stable hash for dedup
  question: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  correctAnswer: string  // 'A' | 'B' | 'C' | 'D'
  subject: string       // human-readable
  subjectSlug: string   // gk-hindi.in slug
  topicSlug: string      // GKSetu taxonomy topic slug
  sourceUrl: string
  language: 'hi' | 'en'
}

interface SubjectConfig {
  slug: string
  name: string
  topicSlug: string
  language: 'hi' | 'en'
}

// All subjects discovered on gk-hindi.in sidebar (115+ slugs).
// Each maps to a GKSetu taxonomy topic for later KnowledgeUnit anchoring.
const SUBJECTS: SubjectConfig[] = [
  // --- Science subjects ---
  { slug: 'physics-gk', name: 'Physics GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'physics-mcq-in-hindi', name: 'Physics MCQ', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'physics-gk-in-english', name: 'Physics GK (English)', topicSlug: 'science-technology', language: 'en' },
  { slug: 'chemistry-gk', name: 'Chemistry GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'chemistry-gk-question', name: 'Chemistry GK Questions', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'biology-gk', name: 'Biology GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'science-gk', name: 'Science GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'human-body-gk-in-hindi', name: 'Human Body GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'technology-gk-in-hindi', name: 'Technology GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'electronics-gk-in-hindi', name: 'Electronics GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'computer-gk', name: 'Computer GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'computer-in-hindi', name: 'Computer in Hindi', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'isro-gk-in-hindi', name: 'ISRO GK', topicSlug: 'science-technology', language: 'hi' },
  { slug: 'chandrayan3-gk-in-hindi', name: 'Chandrayaan-3 GK', topicSlug: 'science-technology', language: 'hi' },

  // --- India GK ---
  { slug: 'india-gk', name: 'India GK', topicSlug: 'india-gk', language: 'hi' },
  { slug: 'indian-polity-gk-in-hindi', name: 'Indian Polity GK', topicSlug: 'polity-governance', language: 'hi' },
  { slug: 'indian-polity-mcq', name: 'Indian Polity MCQ', topicSlug: 'polity-governance', language: 'hi' },
  { slug: 'indian-political-gk-in-hindi', name: 'Indian Political GK', topicSlug: 'polity-governance', language: 'hi' },
  { slug: 'political-gk', name: 'Political GK', topicSlug: 'polity-governance', language: 'hi' },
  { slug: 'sanvidhan-gk', name: 'Constitution GK', topicSlug: 'polity-governance', language: 'hi' },
  { slug: 'history-gk', name: 'History GK', topicSlug: 'history', language: 'hi' },
  { slug: 'modern-history-quiz', name: 'Modern History Quiz', topicSlug: 'history', language: 'hi' },
  { slug: 'geography-gk', name: 'Geography GK', topicSlug: 'geography', language: 'hi' },
  { slug: 'economics-gk', name: 'Economics GK', topicSlug: 'economy', language: 'hi' },
  { slug: 'accounting-concept', name: 'Accounting Concepts', topicSlug: 'economy', language: 'hi' },
  { slug: 'indian-culture-quiz', name: 'Indian Culture Quiz', topicSlug: 'history', language: 'hi' },
  { slug: 'sports-gk', name: 'Sports GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'ipl-gk-questions-in-hindi', name: 'IPL GK Questions', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'bollywood-gk', name: 'Bollywood GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'famous-person-gk-in-hindi', name: 'Famous Persons GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'ramayan-gk', name: 'Ramayan GK', topicSlug: 'history', language: 'hi' },
  { slug: 'special-day-gk-in-hindi', name: 'Important Days GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'states-capitals-gk', name: 'States & Capitals GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'static-gk-in-hindi', name: 'Static GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'static-gk-in-hindi', name: 'Static GK (alt)', topicSlug: 'static-gk', language: 'hi' },

  // --- State GK (mapped to state-specific topics) ---
  { slug: 'bihar-gk-in-hindi', name: 'Bihar GK', topicSlug: 'state-gk-bihar', language: 'hi' },
  { slug: 'haryana-gk-in-hindi', name: 'Haryana GK', topicSlug: 'state-gk-haryana', language: 'hi' },
  { slug: 'himachal-pradesh-gk-in-hindi', name: 'Himachal Pradesh GK', topicSlug: 'state-gk-himachal-pradesh', language: 'hi' },
  { slug: 'jharkhand-gk-in-hindi', name: 'Jharkhand GK', topicSlug: 'state-gk-jharkhand', language: 'hi' },
  { slug: 'karnataka-gk-in-hindi', name: 'Karnataka GK', topicSlug: 'state-gk-karnataka', language: 'hi' },
  { slug: 'maharashtra-gk-in-hindi', name: 'Maharashtra GK', topicSlug: 'state-gk-maharashtra', language: 'hi' },
  { slug: 'mp-gk-in-hindi', name: 'Madhya Pradesh GK', topicSlug: 'state-gk-madhya-pradesh', language: 'hi' },
  { slug: 'rajasthan-gk-in-hindi', name: 'Rajasthan GK', topicSlug: 'state-gk-rajasthan', language: 'hi' },
  { slug: 'up-gk-in-hindi', name: 'Uttar Pradesh GK', topicSlug: 'state-gk-uttar-pradesh', language: 'hi' },
  { slug: 'delhi-gk-in-hindi', name: 'Delhi GK', topicSlug: 'state-gk-delhi', language: 'hi' },
  { slug: 'chhattisgarh-gk-in-hindi', name: 'Chhattisgarh GK', topicSlug: 'state-gk-chhattisgarh', language: 'hi' },

  // --- World GK ---
  { slug: 'world-gk', name: 'World GK', topicSlug: 'world-gk', language: 'hi' },

  // --- General GK / mixed ---
  { slug: 'gk-questions', name: 'GK Questions', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-quiz', name: 'GK Quiz', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-in-english', name: 'GK in English', topicSlug: 'general-knowledge', language: 'en' },
  { slug: 'gk-in-hindi-2024', name: 'GK in Hindi 2024', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-in-hindi-2025', name: 'GK in Hindi 2025', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'general-knowledge-hindi', name: 'General Knowledge Hindi', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'general-knowledge-in-hindi', name: 'General Knowledge in Hindi', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'general-knowledge-questions', name: 'General Knowledge Questions', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'general-knowledge-question-answer-in-hindi', name: 'GK Q&A in Hindi', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'general-awareness', name: 'General Awareness', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'general-awareness-in-hindi', name: 'General Awareness Hindi', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'samany-gyan', name: 'Samanya Gyan', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'samany-gyan-in-hindi', name: 'Samanya Gyan Hindi', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-1000', name: 'GK 1000', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'important-100-gk-in-hindi', name: 'Important 100 GK', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'top-gk-questions-in-hindi', name: 'Top GK Questions', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'best-gk-question-in-hindi', name: 'Best GK Questions', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'one-line-gk', name: 'One Line GK', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-interesting-question-in-hindi', name: 'Interesting GK Questions', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-ka-janak-pita', name: 'GK ke Janak Pita', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-for-kids-in-hindi', name: 'GK for Kids', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-notes', name: 'GK Notes', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-test-in-hindi', name: 'GK Test', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk-question-photo', name: 'GK Photo Questions', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'brain-quiz', name: 'Brain Quiz', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'whatsapp-gk', name: 'WhatsApp GK', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'mcq-question-in-hindi', name: 'MCQ Questions Hindi', topicSlug: 'general-knowledge', language: 'hi' },

  // --- Exam-specific GK ---
  { slug: 'ssc-gk-in-hindi', name: 'SSC GK', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-gk-mcq-in-hindi', name: 'SSC GK MCQ', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper', name: 'SSC Model Paper 1', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper2', name: 'SSC Model Paper 2', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper3', name: 'SSC Model Paper 3', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper4', name: 'SSC Model Paper 4', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper5', name: 'SSC Model Paper 5', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper6', name: 'SSC Model Paper 6', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper7', name: 'SSC Model Paper 7', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper8', name: 'SSC Model Paper 8', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper9', name: 'SSC Model Paper 9', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'ssc-model-practice-paper10', name: 'SSC Model Paper 10', topicSlug: 'ssc-gk', language: 'hi' },
  { slug: 'upsc-gk-in-hindi', name: 'UPSC GK', topicSlug: 'upsc-gk', language: 'hi' },
  { slug: 'ias-gk-question', name: 'IAS GK Questions', topicSlug: 'upsc-gk', language: 'hi' },
  { slug: 'bpsc-gk-in-hindi', name: 'BPSC GK', topicSlug: 'bpsc-gk', language: 'hi' },
  { slug: 'ctet-gk-in-hindi', name: 'CTET GK', topicSlug: 'ctet-gk', language: 'hi' },
  { slug: 'bed-entrance-gk-in-hindi', name: 'B.Ed Entrance GK', topicSlug: 'bed-entrance-gk', language: 'hi' },
  { slug: 'teaching-aptitude-in-hindi', name: 'Teaching Aptitude', topicSlug: 'ctet-gk', language: 'hi' },
  { slug: 'bank-gk', name: 'Bank GK', topicSlug: 'banking-gk', language: 'hi' },
  { slug: 'rail-gk', name: 'Railway GK', topicSlug: 'railway-gk', language: 'hi' },
  { slug: 'indian-army-gk-in-hindi', name: 'Indian Army GK', topicSlug: 'defence-gk', language: 'hi' },
  { slug: 'indian-army-model-paper-in-hindi', name: 'Indian Army Model Paper', topicSlug: 'defence-gk', language: 'hi' },
  { slug: 'kbc-gk-in-hindi', name: 'KBC GK', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'khan-sir-gk', name: 'Khan Sir GK', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'government-jobs-gk-in-hindi', name: 'Government Jobs GK', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'lucent-gk-in-hindi', name: 'Lucent GK', topicSlug: 'general-knowledge', language: 'hi' },

  // --- Misc / special ---
  { slug: 'hindi-grammar-gk', name: 'Hindi Grammar GK', topicSlug: 'hindi-grammar', language: 'hi' },
  { slug: 'hindi-grammar-gk-questions', name: 'Hindi Grammar Questions', topicSlug: 'hindi-grammar', language: 'hi' },
  { slug: 'hindi-grammar-mcq', name: 'Hindi Grammar MCQ', topicSlug: 'hindi-grammar', language: 'hi' },
  { slug: 'math-gk', name: 'Math GK', topicSlug: 'mathematics', language: 'hi' },
  { slug: 'reasoning-in-hindi', name: 'Reasoning Hindi', topicSlug: 'reasoning', language: 'hi' },
  { slug: 'agriculture-gk', name: 'Agriculture GK', topicSlug: 'agriculture', language: 'hi' },
  { slug: 'aadhar-card-gk-in-hindi', name: 'Aadhar Card GK', topicSlug: 'static-gk', language: 'hi' },
  { slug: 'current-affairs-in-hindi', name: 'Current Affairs Hindi', topicSlug: 'current-affairs', language: 'hi' },
  { slug: 'daily-current-affairs-in-hindi', name: 'Daily Current Affairs', topicSlug: 'current-affairs', language: 'hi' },
  { slug: 'online-gk-test-in-hindi', name: 'Online GK Test', topicSlug: 'general-knowledge', language: 'hi' },
  { slug: 'gk', name: 'GK', topicSlug: 'general-knowledge', language: 'hi' },
]

// Deduplicate by slug (some entries had same slug)
const UNIQUE_SUBJECTS = (() => {
  const seen = new Set<string>()
  const out: SubjectConfig[] = []
  for (const s of SUBJECTS) {
    if (seen.has(s.slug)) continue
    seen.add(s.slug)
    out.push(s)
  }
  return out
})()

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function fetchPage(url: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'hi,en;q=0.9',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (response.status === 429 || response.status >= 500) {
        await sleep(3000 * (attempt + 1))
        continue
      }
      if (!response.ok) return null
      return await response.text()
    } catch {
      await sleep(2000 * (attempt + 1))
    }
  }
  return null
}

/** Detect max page from pagination HTML like href="/india-gk?page=80". */
function detectMaxPage(html: string, slug: string): number {
  const re = new RegExp(`href="/${slug}\\?page=(\\d+)"`, 'g')
  let maxPage = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const n = parseInt(m[1]!, 10)
    if (n > maxPage) maxPage = n
  }
  return maxPage
}

/** Decode HTML entities + trim. */
function decodeText(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strip tags from inner HTML, preserving text. */
function stripTags(html: string): string {
  return decodeText(html.replace(/<[^>]+>/g, ' '))
}

/**
 * Parse MCQs by walking each `<button class="showAnswerBtn" data-id="N" data-answer="X">`.
 * For each button, walk back ~3000 chars to find the matching options
 * (class="option-qN" where N == data-id) and the question text (the last
 * `<b>...</b>` preceding those options).
 *
 * This is the actual structure gk-hindi.in uses: only the FIRST MCQ is wrapped
 * in `question-wrapper`; subsequent MCQs share one outer container.
 */
function parseMCQs(html: string, subject: SubjectConfig, sourceUrl: string): ScrapedMCQ[] {
  const mcqs: ScrapedMCQ[] = []
  const seen = new Set<string>()

  // Strip scripts/styles so they don't pollute the chunk text
  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

  const btnRe = /<button[^>]*class="[^"]*showAnswerBtn[^"]*"[^>]*data-id="(\d+)"[^>]*data-answer="([a-d])"[^>]*>/gi
  let bm: RegExpExecArray | null
  while ((bm = btnRe.exec(cleanHtml)) !== null) {
    const idNum = bm[1]!
    const correctAnswer = bm[2]!.toUpperCase()
    const btnIdx = bm.index!

    // Walk back up to 4000 chars to find this MCQ's block
    const chunkStart = Math.max(0, btnIdx - 4000)
    const chunk = cleanHtml.substring(chunkStart, btnIdx)

    // Find options matching class="option-q{idNum}" — these are THIS MCQ's options
    // Note: the site formats attribute as `data-option = "a"` (spaces around =)
    const optionRe = new RegExp(`<li[^>]*class="[^"]*option-q${idNum}[^"]*"[^>]*data-option\\s*=\\s*"([a-d])"[^>]*>([\\s\\S]*?)</li>`, 'gi')
    const options: Record<string, string> = {}
    let om: RegExpExecArray | null
    while ((om = optionRe.exec(chunk)) !== null) {
      const key = om[1]!.toUpperCase()
      let text = stripTags(om[2]!)
      text = text.replace(/^\(?[A-Da-d]\)?[\.\)]\s*/, '').trim()
      if (text) options[key] = text
    }
    if (!options.A || !options.B || !options.C || !options.D) continue

    // The question text: the LAST `<b>...</b>` that appears BEFORE the first option-qN in the chunk
    const firstOptIdx = chunk.indexOf(`option-q${idNum}`)
    if (firstOptIdx === -1) continue
    const beforeOpts = chunk.substring(0, firstOptIdx)
    const bMatches = [...beforeOpts.matchAll(/<b>([\s\S]*?)<\/b>/gi)]
    if (bMatches.length === 0) continue
    let questionText = stripTags(bMatches[bMatches.length - 1]![1]!)
    questionText = questionText.replace(/^\d+\s*[\.\)]\s*/, '').replace(/^(?:Q|प्र|Question|प्रश्न)\s*[\.\):\-]?\s*/i, '').trim()
    if (!questionText || questionText.length < 5) continue

    const id = `${subject.slug}::${questionText}`.slice(0, 200)
    if (seen.has(id)) continue
    seen.add(id)

    mcqs.push({
      id,
      question: questionText,
      optionA: options.A,
      optionB: options.B,
      optionC: options.C,
      optionD: options.D,
      correctAnswer,
      subject: subject.name,
      subjectSlug: subject.slug,
      topicSlug: subject.topicSlug,
      sourceUrl,
      language: subject.language,
    })
  }
  return mcqs
}

async function scrapeSubject(subject: SubjectConfig, maxPagesCap: number): Promise<ScrapedMCQ[]> {
  const outputFile = join(OUTPUT_DIR, `${subject.slug}.json`)
  if (existsSync(outputFile) && !process.env.S25_FORCE) {
    try {
      const cached = JSON.parse(readFileSync(outputFile, 'utf-8')) as ScrapedMCQ[]
      if (Array.isArray(cached)) {
        console.log(`  [cached] ${subject.slug}: ${cached.length} MCQs`)
        return cached
      }
    } catch { /* fall through */ }
  }

  const allMCQs: ScrapedMCQ[] = []
  const seen = new Set<string>()

  // First page
  const firstUrl = `https://gk-hindi.in/${subject.slug}`
  const firstHtml = await fetchPage(firstUrl)
  if (!firstHtml) {
    console.log(`  [fail] ${subject.slug}: page 1 fetch failed`)
    writeFileSync(outputFile, '[]')
    return []
  }
  const maxPage = Math.min(maxPagesCap, detectMaxPage(firstHtml, subject.slug))
  console.log(`  [start] ${subject.slug}: detected ${maxPage} pages`)

  const page1Mcqs = parseMCQs(firstHtml, subject, firstUrl)
  for (const m of page1Mcqs) {
    if (!seen.has(m.id)) { seen.add(m.id); allMCQs.push(m) }
  }
  console.log(`  ${subject.slug} page 1: ${page1Mcqs.length} MCQs (total: ${allMCQs.length})`)

  // Pages 2..maxPage in parallel batches
  const pageUrls: string[] = []
  for (let p = 2; p <= maxPage; p++) pageUrls.push(`https://gk-hindi.in/${subject.slug}?page=${p}`)

  const BATCH = 3  // pages per parallel batch within one subject (reduced from 5)
  for (let i = 0; i < pageUrls.length; i += BATCH) {
    const batch = pageUrls.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async (url) => {
        const html = await fetchPage(url)
        if (!html) return { url, mcqs: [] as ScrapedMCQ[] }
        const mcqs = parseMCQs(html, subject, url)
        return { url, mcqs }
      })
    )
    for (const r of results) {
      for (const m of r.mcqs) {
        if (!seen.has(m.id)) { seen.add(m.id); allMCQs.push(m) }
      }
    }
    const pageNum = i + BATCH
    console.log(`  ${subject.slug} up to page ${Math.min(pageNum, maxPage)}: total ${allMCQs.length} MCQs`)
    await sleep(DELAY_MS)
  }

  writeFileSync(outputFile, JSON.stringify(allMCQs, null, 2))
  console.log(`  [done] ${subject.slug}: ${allMCQs.length} MCQs → ${outputFile}`)
  return allMCQs
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const argv = process.argv.slice(2)
  const onlySlug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const force = argv.includes('--force') || !!process.env.S25_FORCE
  const maxPagesArg = argv.includes('--max-pages') ? parseInt(argv[argv.indexOf('--max-pages') + 1]!, 10) : DEFAULT_MAX_PAGES
  if (force) process.env.S25_FORCE = '1'

  let targets = UNIQUE_SUBJECTS
  if (onlySlug) targets = UNIQUE_SUBJECTS.filter((s) => s.slug === onlySlug)
  console.log(`SITE-S25 scraper: ${targets.length} subjects, maxPages=${maxPagesArg}, force=${force}`)

  // Process subjects in parallel batches (CONCURRENCY subjects at a time)
  const subjectCounts: Record<string, number> = {}
  let total = 0
  const BATCH = CONCURRENCY
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH)
    console.log(`\n=== Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(targets.length / BATCH)}: ${batch.map((s) => s.slug).join(', ')} ===`)
    const results = await Promise.allSettled(
      batch.map(async (s) => {
        try {
          const mcqs = await scrapeSubject(s, maxPagesArg)
          return { slug: s.slug, mcqs }
        } catch (e) {
          console.log(`  [error] ${s.slug}: ${(e as Error).message.slice(0, 200)}`)
          return { slug: s.slug, mcqs: [] as ScrapedMCQ[] }
        }
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        subjectCounts[r.value.slug] = r.value.mcqs.length
        total += r.value.mcqs.length
      }
    }
    console.log(`  Batch total: ${results.reduce((a, r) => a + (r.status === 'fulfilled' ? r.value.mcqs.length : 0), 0)} MCQs (running total: ${total})`)
  }

  console.log('\n=== PARITY REPORT ===')
  const sorted = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])
  for (const [slug, count] of sorted) {
    console.log(`  ${slug.padEnd(45)} ${count} MCQs`)
  }
  console.log(`\nTotal: ${total} MCQs scraped across ${targets.length} subjects`)
  console.log(`Output: ${OUTPUT_DIR}/`)
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
