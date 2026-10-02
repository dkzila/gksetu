/**
 * GKSetu — Tutorials module: public DTOs (SITE-S8)
 * docs/learning-platform-plan.md SITE-S8 — a tutorial is COMPUTED, never
 * stored (§46.3 spirit): the exam's frozen syllabus tree is the table of
 * contents, the in-effect-mapped VERIFIED market-visible units are the
 * lessons, and the practice/PYQ/QnA/mock layers ride the existing spine
 * (§22 scored discipline — the correctAnswer NEVER ships on any tutorial
 * payload, option labels only; §19 public reads serve the live revision
 * snapshot; §14 market scoping; §35 reader-language content with the honest,
 * labelled English fallback; §16 SEO blocks as /tutorials/… paths; §37
 * client-agnostic contracts, deterministic ordering; §38 public surface).
 *
 * The ONLY persisted tutorial state is per-user chapter progress
 * (TutorialProgress) — shipped by the progress service, never cached.
 */
import type { PageSeo } from '@/modules/seo'
import type { PracticeQuestionCard, PracticeQnaCard } from '@/modules/assessment'

// ---------- The chapter summary (shared: TOC rows + the chapter rail tree) ----------

/**
 * One chapter row of a tutorial — a SyllabusNode of the exam's current
 * version in DFS reading order (roots by priority, children nested after
 * their parent by priority). `slug` is the chapter's URL identity
 * (/tutorials/{exam}/{chapter}/; the node id fallback is applied by the
 * service when a legacy node carries no slug).
 *
 * `mockTestCount` is the EXAM-level EXAM-scoped PUBLISHED count — mock tests
 * are version/exam-scoped, never node-scoped, so every chapter row carries
 * the same number (the exam's tests are reachable from any chapter; the
 * totals count them ONCE).
 */
export interface TutorialChapterSummary {
  id: string
  slug: string
  title: string
  depth: number
  /** Ancestor titles, root first — the chapter's syllabus position. */
  parentTitles: string[]
  /** DISTINCT in-effect-mapped VERIFIED market-visible units on THIS node. */
  lessonCount: number
  /** PUBLISHED questions on this node's mapped units (payload language). */
  practiceCount: number
  /** The provenance-bearing subset of those questions. */
  pyqCount: number
  /** PUBLISHED Q&As on this node's mapped units (payload language). */
  qnaCount: number
  /** The exam-level EXAM-scoped PUBLISHED mock-test count (see above). */
  mockTestCount: number
}

// ---------- GET /api/tutorials — the index ----------

/**
 * One exam card of the /tutorials/ directory (every ACTIVE exam whose
 * current version carries ≥1 node, examName asc).
 */
export interface TutorialsIndexExam {
  examSlug: string
  examName: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  /** ALL nodes of the current version (the syllabus walk's TOC size). */
  chapterCount: number
  /** DISTINCT in-effect-mapped VERIFIED market-visible units across the version. */
  lessonCount: number
  /** PUBLISHED questions on those units (payload language). */
  practiceCount: number
  /** The provenance-bearing subset. */
  pyqCount: number
  /** PUBLISHED EXAM-scoped mock tests of that version (payload language). */
  mockTestCount: number
}

/** GET /api/tutorials payload body — ok({ tutorials: this }). */
export interface TutorialsIndex {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exams: TutorialsIndexExam[]
  seo: PageSeo
  seoTitle: string
  seoDescription: string
  /** §35 honesty marker (same rule as the practice listings — see service). */
  fallback?: boolean
}

// ---------- GET /api/tutorials/[examRef] — the TOC ----------

/** The exam a tutorial belongs to (null = unknown/inactive exam, or no
 * current version — the honest empty state, canonical /tutorials/). */
export interface TutorialExamRef {
  slug: string
  name: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
}

export interface TutorialExamTotals {
  chapters: number
  lessons: number
  practice: number
  pyq: number
  qna: number
  mockTests: number
}

/** GET /api/tutorials/[examRef] payload body — ok({ tutorial: this }). */
export interface TutorialExam {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: TutorialExamRef | null
  /** The current version's label (null with exam:null). */
  versionLabel: string | null
  /** All chapters in DFS reading order. */
  chapters: TutorialChapterSummary[]
  totals: TutorialExamTotals
  seo: PageSeo
  seoTitle: string
  seoDescription: string
  /** §35 honesty marker. */
  fallback?: boolean
}

// ---------- GET /api/tutorials/[examRef]/[chapterRef] — the chapter ----------

/** One lesson card — a mapped canonical unit (§7). `path` is the §16
 * knowledge-page path /{topic}/{unit}/ shipped as data; `topicLabel` is the
 * §35 label (reader language → country default → canonical name). */
export interface TutorialLesson {
  unitSlug: string
  title: string
  summary: string | null
  type: string
  difficulty: string
  path: string
  topicSlug: string
  topicLabel: string
}

/** One EXAM-scoped mock-test card of the exam's current version. */
export interface TutorialMockTestCard {
  slug: string
  title: string
  durationMinutes: number
  questionCount: number
}

export interface TutorialChapterSibling {
  slug: string
  title: string
}

/** The visited chapter — nodeChain walks root → parent → self. */
export interface TutorialChapterInfo {
  id: string
  slug: string
  title: string
  nodeChain: TutorialChapterSibling[]
}

/**
 * GET /api/tutorials/[examRef]/[chapterRef] payload body — ok({ chapter: this }).
 * `chapter` null = unknown chapter (canonical falls back to the TOC page);
 * `exam` null = unknown/inactive exam or no current version (canonical falls
 * back to /tutorials/). `practice.questions`/`pyq.questions` are the exact
 * PracticeQuestionCard shape (options = LABELS only — the correctAnswer NEVER
 * ships; §22), `qna` the exact PracticeQnaCard shape; `pyq` is the
 * provenance-bearing subset of `practice` (each card carries its full
 * provenance array). `tree` is the same chapter-summary shape as the TOC
 * (the navigation rail). `mockTests` are the exam's current-version
 * EXAM-scoped PUBLISHED tests (payload language).
 */
export interface TutorialChapter {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: TutorialExamRef | null
  versionLabel: string | null
  chapter: TutorialChapterInfo | null
  /** Mapped units of THIS node — ordered mapping-priority (CORE first) then unit name. */
  lessons: TutorialLesson[]
  /** PUBLISHED questions on this node's mapped units (labels only, §22). */
  practice: { total: number; questions: PracticeQuestionCard[] }
  /** The provenance-bearing subset of practice (each with its provenance). */
  pyq: { total: number; questions: PracticeQuestionCard[] }
  /** PUBLISHED Q&As on this node's mapped units (PracticeQnaCard shape). */
  qna: PracticeQnaCard[]
  mockTests: TutorialMockTestCard[]
  /** Prev/next in the exam's DFS reading order. */
  siblings: { prev: TutorialChapterSibling | null; next: TutorialChapterSibling | null }
  /** The full TOC (navigation rail) — TutorialChapterSummary rows, DFS order. */
  tree: TutorialChapterSummary[]
  seo: PageSeo
  seoTitle: string
  seoDescription: string
  /** §35 honesty marker (swaps the chapter's language-scoped blocks together). */
  fallback?: boolean
}

// ---------- /api/tutorials/progress — the persisted walk ----------

/**
 * The signed-in user's syllabus-walk progress for one exam (§9 explicit
 * signal): `totalNodes` counts ALL nodes of the current version — progress
 * is about the syllabus walk, not only content-rich chapters.
 * `completedNodeIds` is in DFS reading order (the TOC's order — "continue
 * where you left" resolves the first uncompleted chapter). Unknown exam or
 * no current version → the honest empty shape (0/0), never an error.
 */
export interface TutorialExamProgress {
  examSlug: string
  completedNodeIds: string[]
  totalNodes: number
  percent: number
}
