/**
 * GKSetu — Assessment module: combined-exam quick-mock DTOs (P7-S5)
 * Master Plan §22 ("Combined-exam mode with deduplication (Section 11),
 * applied identically to the learning queue and the mock-test scope — e.g. a
 * combined mock test can be scoped to 'everything relevant across my followed
 * exams'"), §11 (the union engine, canonical dedup, single-exam mode = one
 * exam in the input set, "Covers: Exam A + Exam B"), §6/§36 (the attempt
 * snapshot-carries the deal at start — a generated attempt anchors on its
 * scope snapshot instead of an editorial MockTest), §9 (the mastery fold rides
 * the submit path unchanged — quick attempts feed the same implicit signal),
 * §16/§35 (paths/labels in the resolved market), §37 (client-agnostic,
 * deterministic, typed errors), §39 (the same APIs a mobile app calls).
 */
import type { AttemptStatusPublic, PublicAttemptState } from './mocktest-types'

// ---------- Sizing rules (stated, not implied — §9 transparency) ----------

/** Smallest generatable quick mock (§37 honest bounds). */
export const QUICK_MOCK_MIN_QUESTIONS = 5
/** Largest generatable quick mock (bounded — a quick mock stays quick). */
export const QUICK_MOCK_MAX_QUESTIONS = 25
/** Default composition size. */
export const QUICK_MOCK_DEFAULT_QUESTIONS = 10
/** Minutes of exam time per served question (1.5 → a 10-question mock runs 15 minutes). */
export const QUICK_MOCK_MINUTES_PER_QUESTION = 1.5
/** Floor on the generated duration — never shorter than 5 minutes. */
export const QUICK_MOCK_MIN_DURATION_MINUTES = 5
/** §6 pass criteria snapshot for a generated attempt (the P7-S3 sample convention). */
export const QUICK_MOCK_PASS_PERCENT = 40
/** Generated attempts surfaced in the quick-mock history list. */
export const QUICK_MOCK_HISTORY_LIMIT = 5

/** The §22 duration rule as one sentence — rendered verbatim (§9). */
export const QUICK_MOCK_DURATION_RULE =
  'A quick mock runs at 1.5 minutes per question (minimum 5 minutes) and the pass mark is 40% — the same server-enforced deadline and scoring as an editorial mock test (§22).'

/** The §22/§11 scope rule as one sentence — rendered verbatim (§9). */
export const QUICK_MOCK_SCOPE_RULE =
  'Questions are drawn from the published pool, one per canonical Knowledge Unit, in the combined queue’s own order (§11 — priority, then question likelihood, then freshness; never the same knowledge twice).'

// ---------- The generated-scope snapshot (§6/§36 spirit, frozen at start) ----------

export type QuickMockMode = 'COMBINED' | 'EXAM'

/** One covering exam inside a generated scope — the "Covers:" chip input (§11 step 9). */
export interface QuickMockScopeExamRef {
  slug: string
  name: string
  code: string
}

/** The stored shape of TestAttempt.generatedScopeJson (null on editorial attempts). */
export interface QuickMockGeneratedScope {
  mode: QuickMockMode
  exams: QuickMockScopeExamRef[]
  /** Units in the scope's §11 union (the honest denominator). */
  unitCount: number
  /** Questions actually served (≤ requested when the pool runs short). */
  questionCount: number
  generatedAt: string
}

/** Parsed + validated from the row — a corrupt snapshot degrades honestly (§36). */
export function parseQuickMockScope(json: string): QuickMockGeneratedScope | null {
  try {
    const raw = JSON.parse(json) as Partial<QuickMockGeneratedScope>
    if (
      (raw.mode !== 'COMBINED' && raw.mode !== 'EXAM') ||
      !Array.isArray(raw.exams) ||
      typeof raw.questionCount !== 'number' ||
      typeof raw.generatedAt !== 'string'
    ) {
      return null
    }
    return {
      mode: raw.mode,
      exams: raw.exams.filter(
        (exam): exam is QuickMockScopeExamRef =>
          typeof exam?.slug === 'string' &&
          typeof exam?.name === 'string' &&
          typeof exam?.code === 'string'
      ),
      unitCount: typeof raw.unitCount === 'number' ? raw.unitCount : raw.exams.length,
      questionCount: raw.questionCount,
      generatedAt: raw.generatedAt,
    }
  } catch {
    return null
  }
}

// ---------- Caller-resolved scope (the personalisation module's input) ----------

/**
 * One exam of the caller's goal ∪ follow scope — the quick-mock service never
 * resolves personalisation itself (§28 module boundaries: the route layer
 * resolves the §9 signals and hands the set over, the mastery-market pattern).
 */
export interface QuickMockScopeExam {
  slug: string
  name: string
  code: string
  status: string
  countryIso: string
  fromGoal: boolean
  fromFollow: boolean
}

/** The label market a quick mock builds in (§14 home market + §35 language). */
export interface QuickMockMarket {
  countryIso: string
  languageCode: string
}

// ---------- Setup surface (GET /api/mock-tests/quick) ----------

/** One choosable scope with its honest pool size. */
export interface QuickMockScopeCard {
  mode: QuickMockMode
  /** Set iff mode = 'EXAM' (§11 single-exam mode). */
  exam: QuickMockScopeExamRef | null
  /** The §11 covering set rendered on the card (chips input). */
  exams: QuickMockScopeExamRef[]
  /** Published, language-matched, unit-deduplicated questions available (§11 step 6). */
  availableQuestions: number
  /** §9 explanation — why this scope exists for this user. */
  reason: string
}

/** One past generated attempt in the history list. */
export interface QuickMockHistoryItem {
  id: string
  status: AttemptStatusPublic
  startedAt: string
  submittedAt: string | null
  durationMinutes: number
  questionCount: number
  correctCount: number | null
  scorePercent: number | null
  passed: boolean | null
  mode: QuickMockMode
  exams: QuickMockScopeExamRef[]
}

/** GET /api/mock-tests/quick response body (§37 envelope, §39 mobile-ready). */
export interface QuickMockSetup {
  market: {
    countryIso: string
    languageCode: string
  }
  /** The sizing bounds — mirrored so clients render honest pickers. */
  sizing: {
    minQuestions: number
    maxQuestions: number
    defaultQuestions: number
    durationRule: string
    scopeRule: string
  }
  /** §11 step 1 scope cards: COMBINED first, then each eligible exam. */
  scopes: QuickMockScopeCard[]
  /** The one live generated attempt, if any (§22 resume — same engine). */
  inProgress: PublicAttemptState | null
  /** Last generated attempts, newest first (§37 deterministic). */
  history: QuickMockHistoryItem[]
  /** Honest note when no scope/pool exists yet (§36 — rendered verbatim). */
  note: string | null
}

// ---------- Start surface (POST /api/mock-tests/quick) ----------

/** POST /api/mock-tests/quick response body — the runner opens on this. */
export interface QuickMockStartResponse {
  attempt: PublicAttemptState
  /** Honest note: resumed an in-progress sprint, or a short pool (§36). */
  note: string | null
}

// ---------- Typed errors (§37) ----------

export type QuickMockErrorCode =
  | 'QUICK_MOCK_NO_SCOPE'
  | 'QUICK_MOCK_EXAM_NOT_IN_SCOPE'
  | 'QUICK_MOCK_NO_QUESTIONS'
  | 'QUICK_MOCK_IN_PROGRESS'
  | 'QUICK_MOCK_UNAVAILABLE'

const ERROR_STATUS: Record<QuickMockErrorCode, number> = {
  QUICK_MOCK_NO_SCOPE: 409,
  QUICK_MOCK_EXAM_NOT_IN_SCOPE: 404,
  QUICK_MOCK_NO_QUESTIONS: 409,
  QUICK_MOCK_IN_PROGRESS: 409,
  QUICK_MOCK_UNAVAILABLE: 503,
}

export class QuickMockError extends Error {
  readonly code: QuickMockErrorCode
  readonly status: number

  constructor(code: QuickMockErrorCode, message: string) {
    super(message)
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toQuickMockErrorResponse(
  error: unknown
): { code: string; message: string; status: number } | null {
  if (error instanceof QuickMockError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}
