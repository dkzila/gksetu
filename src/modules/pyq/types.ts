/**
 * GKSetu — PYQ module: public DTOs (SITE-S7)
 * docs/learning-platform-plan.md SITE-S7 — PYQ is a PROVENANCE layer, not a
 * new content type: these payloads are aggregates over the existing
 * Question/QnA practice machinery (§22 scored discipline — the
 * correctAnswer NEVER ships; §19 public reads serve the live revision
 * snapshot; §35 reader-language honesty with the labelled English
 * fallback; §16 SEO blocks as §16 paths; §37 client-agnostic contracts,
 * deterministic ordering, server-side pagination; §38 public surface).
 */
import type { PageSeo } from '@/modules/seo'
import type { PracticeQuestionCard, PracticeQnaCard } from '@/modules/assessment'

// ---------- The provenance badge (the "Asked in …" chip) ----------

/**
 * One exam-sitting appearance of a Question/QnA — the public badge shape.
 * `paper` is "" when the sitting did not name one (unspecified — the §
 * honesty rule: never fabricate "Prelims" where the row records none).
 */
export interface PyqProvenanceBadge {
  examSlug: string
  examName: string
  year: number
  paper: string
}

// ---------- GET /api/pyq — the /pyq/ directory index ----------

/** One exam's year group in the index (count = questions + Q&As of the year). */
export interface PyqIndexYear {
  year: number
  count: number
}

/** One exam card of the /pyq/ directory. */
export interface PyqIndexExam {
  examSlug: string
  examName: string
  organiser: string
  /** Distinct published MCQs with provenance in this exam (reader language). */
  questionCount: number
  /** Distinct published Q&As with provenance in this exam (reader language). */
  qnaCount: number
  /** Year groups, newest year first. */
  years: PyqIndexYear[]
}

/** GET /api/pyq payload body — ok({ pyq: this }). */
export interface PyqIndex {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  /** Only exams with ≥1 published question or Q&A, total count desc, then name. */
  exams: PyqIndexExam[]
  seo: PageSeo
  seoTitle: string
  seoDescription: string
  /** §35 honesty marker (same rule as the practice listings). */
  fallback?: boolean
}

// ---------- GET /api/pyq?exam= — the per-exam year groups ----------

/** One year row of the per-exam page. */
export interface PyqExamYear {
  year: number
  count: number
}

/**
 * GET /api/pyq?exam={slug} payload body. `exam` is null for an unknown exam
 * slug — the honest empty state (the practice-listing unknown-subject
 * behaviour): an ok envelope with no years and a canonical that falls back
 * to the /pyq/ root.
 */
export interface PyqExamYears {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: { slug: string; name: string; organiser: string } | null
  /** Year groups, newest year first. */
  years: PyqExamYear[]
  /** Distinct questions + Q&As across the years. */
  total: number
  seo: PageSeo
  seoTitle: string
  seoDescription: string
  /** §35 honesty marker (same rule as the practice listings). */
  fallback?: boolean
}

// ---------- GET /api/pyq?exam=&year= — the year practice page ----------

/** One practice MCQ card of the year page — the exact PracticeQuestionCard
 * shape (options = LABELS only, the correctAnswer NEVER ships; §22) plus
 * every provenance appearance of the item (not just this exam-year). */
export interface PyqYearQuestion extends PracticeQuestionCard {
  provenance: PyqProvenanceBadge[]
}

/** One Q&A card of the year page — the exact PracticeQnaCard shape plus the
 * item's every provenance appearance. */
export interface PyqYearQna extends PracticeQnaCard {
  provenance: PyqProvenanceBadge[]
}

/**
 * GET /api/pyq?exam={slug}&year={year} payload body. `pagination` pages the
 * QUESTIONS (newest-published first, §37 discipline); `qna` rides along
 * unpaginated (bounded, newest-published first) — mains-style Q&As are a
 * per-year handful in practice. `exam` null = unknown exam.
 */
export interface PyqYear {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: { slug: string; name: string; organiser: string } | null
  year: number
  questions: PyqYearQuestion[]
  qna: PyqYearQna[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  seo: PageSeo
  seoTitle: string
  seoDescription: string
  /** §35 honesty marker (swaps BOTH lists to English when the reader language
   * carries none of this exam-year's items and English does). */
  fallback?: boolean
}

// ---------- Admin (console) DTOs — /api/pyq/admin ----------

/** Which provenance table a row belongs to (the console's MCQ/QnA filter). */
export type PyqProvenanceKind = 'QUESTION' | 'QNA'

/** One row of the console's provenance table. */
export interface PyqAdminProvenanceRow {
  id: string
  kind: PyqProvenanceKind
  targetId: string
  /** The target's question text, truncated for the table (~140 chars). */
  questionText: string
  /** The target's lifecycle status (ContentStatus). */
  targetStatus: string
  examSlug: string
  examName: string
  year: number
  paper: string
  questionNumber: string | null
  notes: string | null
  updatedAt: string
}

export interface PyqAdminProvenancePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** GET /api/pyq/admin payload body. */
export interface PyqAdminProvenanceListResult {
  items: PyqAdminProvenanceRow[]
  pagination: PyqAdminProvenancePagination
  /** Coverage stats across the in-scope registry (the questions-console precedent). */
  summary: { total: number; questions: number; qnas: number }
}
