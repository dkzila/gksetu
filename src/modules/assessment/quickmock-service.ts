/**
 * GKSetu — Assessment module: the §22 combined-exam quick mock (P7-S5)
 *
 * "A combined mock test can be scoped to 'everything relevant across my
 * followed exams'" (§22) — implemented as a GENERATED attempt: the §11 union
 * engine (getCombinedExamView — the same call the dashboard's learning queue
 * uses; single-exam mode is one exam in the input set, "without any
 * additional data modeling") resolves the scope's canonical units, the
 * published question pool is deduplicated strictly by canonical unit identity
 * (§11 step 6 — never the same knowledge twice), and a TestAttempt is created
 * that anchors on a SCOPE SNAPSHOT (generatedScopeJson) instead of an
 * editorial MockTest row (§11: the combined view is computed, never a
 * separately stored syllabus/content database — but the §6 attempt itself is
 * honest stored user state, exactly like an editorial attempt).
 *
 * The runner, deadline enforcement, server-side scoring, the immutable
 * answers[] record and the §22 mastery fold are THE SAME engine (P7-S3/S4):
 * a submitted quick mock updates every unit it touched, exactly once, inside
 * the claim transaction. Nothing here re-implements them.
 *
 * §28 boundaries: this service never resolves personalisation — the caller
 * (route layer) resolves the §9 goal ∪ follow scope and hands it over with
 * the §35 label market, the mastery-market pattern (import direction stays
 * personalisation → assessment, never the reverse).
 */
import { db } from '@/lib/db'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import { findActiveLanguageByCode } from '@/modules/country-locale'
import { getCombinedExamView } from '@/modules/exam-mapping'

import { toAttemptState } from './mocktest-service'
import type { PublicAttemptState } from './mocktest-types'
import {
  QUICK_MOCK_DEFAULT_QUESTIONS,
  QUICK_MOCK_DURATION_RULE,
  QUICK_MOCK_HISTORY_LIMIT,
  QUICK_MOCK_MAX_QUESTIONS,
  QUICK_MOCK_MIN_QUESTIONS,
  QUICK_MOCK_MINUTES_PER_QUESTION,
  QUICK_MOCK_MIN_DURATION_MINUTES,
  QUICK_MOCK_PASS_PERCENT,
  QUICK_MOCK_SCOPE_RULE,
  QuickMockError,
  type QuickMockGeneratedScope,
  type QuickMockHistoryItem,
  type QuickMockMarket,
  type QuickMockScopeCard,
  type QuickMockScopeExam,
  type QuickMockScopeExamRef,
  type QuickMockSetup,
  type QuickMockStartResponse,
} from './quickmock-types'
import type { QuickMockStartInput } from './quickmock-validation'

// ---------- Scope eligibility (§11 step 1: "valid for the user's country") ----------

/**
 * The caller's scope filtered to exams the §11 engine will actually union:
 * ACTIVE + in the request's home market. Everything else stays out with its
 * honest reason (the dashboard's read-time eligibility rule, §36).
 */
function eligibleScopeExams(
  scopeExams: QuickMockScopeExam[],
  market: QuickMockMarket
): QuickMockScopeExam[] {
  const seen = new Set<string>()
  return scopeExams.filter((exam) => {
    if (seen.has(exam.slug)) return false
    if (exam.status !== 'ACTIVE') return false
    if (exam.countryIso.toUpperCase() !== market.countryIso.toUpperCase()) return false
    seen.add(exam.slug)
    return true
  })
}

const toExamRef = (exam: QuickMockScopeExam): QuickMockScopeExamRef => ({
  slug: exam.slug,
  name: exam.name,
  code: exam.code,
})

// ---------- The §11-step-6 question pool (canonical dedup) ----------

/** §8/§22 ordering — BASIC before INTERMEDIATE before ADVANCED (deterministic pick). */
const DIFFICULTY_RANK: Record<string, number> = { BASIC: 0, INTERMEDIATE: 1, ADVANCED: 2 }

/**
 * The published, language-matched pool over the scope's units, deduplicated
 * STRICTLY by canonical unit identity (§11 step 6): one deterministic question
 * per unit — difficulty ascending (§22's BASIC → ADVANCED practice order),
 * then most recently updated, then id (§37 determinism, never title
 * similarity). Keyed by unit SLUG — the combined view's own public identity.
 */
async function loadUnitQuestionPool(
  unitSlugs: string[],
  languageCode: string
): Promise<Map<string, string>> {
  if (unitSlugs.length === 0) return new Map()
  const language = await findActiveLanguageByCode(languageCode.toLowerCase())
  if (!language) {
    throw new QuickMockError(
      'QUICK_MOCK_UNAVAILABLE',
      `The "${languageCode}" language is not active on this platform yet — quick mocks cannot be composed in it (§35).`
    )
  }
  const rows = await db.question.findMany({
    where: {
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: language.id,
      knowledgeUnit: { slug: { in: unitSlugs } },
    },
    select: {
      id: true,
      difficulty: true,
      updatedAt: true,
      knowledgeUnit: { select: { slug: true } },
    },
  })
  const best = new Map<string, { id: string; difficulty: number; updatedAt: Date }>()
  for (const row of rows) {
    const slug = row.knowledgeUnit.slug
    const rank = DIFFICULTY_RANK[row.difficulty] ?? 0
    const current = best.get(slug)
    if (
      !current ||
      rank < current.difficulty ||
      (rank === current.difficulty && row.updatedAt > current.updatedAt)
    ) {
      best.set(slug, { id: row.id, difficulty: rank, updatedAt: row.updatedAt })
    }
  }
  const pool = new Map<string, string>()
  for (const [slug, pick] of best) pool.set(slug, pick.id)
  return pool
}

// ---------- Generated-attempt lifecycle helpers ----------

/** §6 lapse sweep for generated attempts (the P7-S3 pattern, mockTestId null). */
async function abandonExpiredQuickAttempts(userId: string): Promise<void> {
  const expired = await db.testAttempt.findMany({
    where: {
      userId,
      mockTestId: null,
      status: 'IN_PROGRESS',
      deadlineAt: { lt: new Date(Date.now() - 60_000) },
    },
    select: { id: true },
  })
  for (const row of expired) {
    const claimed = await db.testAttempt.updateMany({
      where: { id: row.id, status: 'IN_PROGRESS' },
      data: { status: 'ABANDONED' },
    })
    if (claimed.count === 0) continue
    await recordAudit({
      actor: null,
      action: AUDIT_ACTIONS.attemptAbandon,
      objectType: AUDIT_OBJECT_TYPES.testAttempt,
      objectId: row.id,
      objectLabel: `quick-mock/Attempt`,
      before: { status: 'IN_PROGRESS' },
      after: { status: 'ABANDONED' },
      metadata: { reason: 'deadline-passed', generated: true },
    }).catch(() => undefined)
  }
}

/** The §22 sizing rule — stated in QUICK_MOCK_DURATION_RULE, applied here. */
export function quickMockDurationMinutes(questionCount: number): number {
  return Math.max(
    QUICK_MOCK_MIN_DURATION_MINUTES,
    Math.ceil(questionCount * QUICK_MOCK_MINUTES_PER_QUESTION)
  )
}

/** One generated attempt row → the history DTO (§37 deterministic projection). */
function toHistoryItem(row: {
  id: string
  status: QuickMockHistoryItem['status']
  startedAt: Date
  submittedAt: Date | null
  durationMinutes: number
  correctCount: number | null
  totalCount: number | null
  scorePercent: number | null
  passed: boolean | null
  generatedScopeJson: string | null
}): QuickMockHistoryItem | null {
  if (!row.generatedScopeJson) return null
  try {
    const scope = JSON.parse(row.generatedScopeJson) as QuickMockGeneratedScope
    return {
      id: row.id,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      durationMinutes: row.durationMinutes,
      questionCount: row.totalCount ?? scope.questionCount,
      correctCount: row.correctCount,
      scorePercent: row.scorePercent,
      passed: row.passed,
      mode: scope.mode,
      exams: scope.exams,
    }
  } catch {
    return null // §36 defensive: a corrupt snapshot degrades out of the list
  }
}

// ---------- The setup surface (GET /api/mock-tests/quick) ----------

/**
 * Everything the quick-mock view needs to render honest choices: the scope
 * cards (§22 combined + §11 single-exam per eligible exam) with their pool
 * sizes, the live in-progress attempt (resume — same engine), the recent
 * history, and the stated sizing rules (§9 transparency).
 */
export async function getQuickMockSetup(
  userId: string,
  input: { scopeExams: QuickMockScopeExam[]; market: QuickMockMarket }
): Promise<QuickMockSetup> {
  const eligible = eligibleScopeExams(input.scopeExams, input.market)

  // One engine call for the whole eligible set: per-unit coverings carry the
  // exam sets, so per-exam pools derive by filtering — N+1 never happens.
  let combinedUnits: Awaited<ReturnType<typeof getCombinedExamView>>['units'] = []
  if (eligible.length > 0) {
    const view = await getCombinedExamView({
      exams: eligible.map((exam) => exam.slug),
      country: input.market.countryIso,
      language: input.market.languageCode,
    })
    combinedUnits = view.units
  }
  const pool = await loadUnitQuestionPool(
    combinedUnits.map((unit) => unit.unit.slug),
    input.market.languageCode
  )

  /** Units of a given exam set that actually carry a pool question (§11 step 6). */
  const questionsForExams = (examSlugs: Set<string>): number =>
    combinedUnits.filter(
      (unit) => pool.has(unit.unit.slug) && unit.exams.some((exam) => examSlugs.has(exam.slug))
    ).length

  const scopes: QuickMockScopeCard[] = []
  if (eligible.length > 0) {
    const available = combinedUnits.filter((unit) => pool.has(unit.unit.slug)).length
    scopes.push({
      mode: 'COMBINED',
      exam: null,
      exams: eligible.map(toExamRef),
      availableQuestions: available,
      reason:
        eligible.some((exam) => exam.fromGoal) && eligible.some((exam) => exam.fromFollow)
          ? 'Everything relevant across your goal and followed exams (§22) — each topic once, at its deepest requirement (§11).'
          : eligible.some((exam) => exam.fromGoal)
            ? 'Everything relevant across your goal exam(s) (§22) — each topic once, at its deepest requirement (§11).'
            : 'Everything relevant across your followed exams (§22) — each topic once, at its deepest requirement (§11).',
    })
    for (const exam of eligible) {
      scopes.push({
        mode: 'EXAM',
        exam: toExamRef(exam),
        exams: [toExamRef(exam)],
        availableQuestions: questionsForExams(new Set([exam.slug])),
        reason: exam.fromGoal
          ? `Only what ${exam.name} maps to (§11 single-exam mode) — your goal exam.`
          : `Only what ${exam.name} maps to (§11 single-exam mode) — you follow it.`,
      })
    }
  }

  // The live attempt (after the honest lapse sweep) + the recent history.
  await abandonExpiredQuickAttempts(userId)
  const [inProgressRow, historyRows] = await Promise.all([
    db.testAttempt.findFirst({
      where: { userId, mockTestId: null, status: 'IN_PROGRESS' },
      orderBy: { startedAt: 'desc' },
      include: { mockTest: true },
    }),
    db.testAttempt.findMany({
      where: { userId, mockTestId: null, status: { in: ['SUBMITTED', 'ABANDONED'] } },
      orderBy: { startedAt: 'desc' },
      take: QUICK_MOCK_HISTORY_LIMIT,
    }),
  ])
  const inProgress = inProgressRow ? await toAttemptState(inProgressRow) : null
  const history = historyRows
    .map((row) => toHistoryItem(row))
    .filter((item): item is QuickMockHistoryItem => item != null)

  const note =
    eligible.length === 0
      ? 'Follow an exam or declare a goal first — a quick mock is scoped to your exams (§22).'
      : scopes.every((card) => card.availableQuestions === 0)
        ? 'No published questions match your scope in this language yet — the editorial pool is still growing (§36).'
        : null

  return {
    market: { countryIso: input.market.countryIso, languageCode: input.market.languageCode },
    sizing: {
      minQuestions: QUICK_MOCK_MIN_QUESTIONS,
      maxQuestions: QUICK_MOCK_MAX_QUESTIONS,
      defaultQuestions: QUICK_MOCK_DEFAULT_QUESTIONS,
      durationRule: QUICK_MOCK_DURATION_RULE,
      scopeRule: QUICK_MOCK_SCOPE_RULE,
    },
    scopes,
    inProgress,
    history,
    note,
  }
}

// ---------- The start surface (POST /api/mock-tests/quick) ----------

/**
 * Generates (or resumes) the caller's §22 quick mock. COMBINED unions every
 * eligible scope exam; EXAM runs §11 single-exam mode on one ref. The
 * composition walks the combined queue's own §11 order (priority →
 * likelihood → freshness), one question per canonical unit, and freezes into
 * a §6 attempt with the scope snapshot — deadline and pass mark derived from
 * the stated rules, scored and folded into mastery by the SAME submit path.
 */
export async function startQuickMock(
  user: { userId: string; email: string },
  input: QuickMockStartInput & { scopeExams: QuickMockScopeExam[]; market: QuickMockMarket },
  meta: AuditRequestMeta = {}
): Promise<QuickMockStartResponse> {
  const eligible = eligibleScopeExams(input.scopeExams, input.market)
  if (eligible.length === 0) {
    throw new QuickMockError(
      'QUICK_MOCK_NO_SCOPE',
      'No active exam in your home market is in your goal or follows yet — a quick mock is scoped to your exams (§22).'
    )
  }

  const scopeExams: QuickMockScopeExam[] =
    input.mode === 'EXAM'
      ? (() => {
          const match = eligible.find(
            (exam) =>
              exam.slug === input.exam?.toLowerCase() || exam.code.toUpperCase() === input.exam?.toUpperCase()
          )
          if (!match) {
            throw new QuickMockError(
              'QUICK_MOCK_EXAM_NOT_IN_SCOPE',
              `"${input.exam}" is not one of your active home-market exams — pick a scope from your quick-mock options (§11).`
            )
          }
          return [match]
        })()
      : eligible

  // §11 steps 2–9: the union over the chosen scope (same engine, one call).
  const view = await getCombinedExamView({
    exams: scopeExams.map((exam) => exam.slug),
    country: input.market.countryIso,
    language: input.market.languageCode,
  })

  // §11 step 6: one question per canonical unit, in the queue's own order.
  const pool = await loadUnitQuestionPool(
    view.units.map((unit) => unit.unit.slug),
    input.market.languageCode
  )
  const requested = input.questionCount ?? QUICK_MOCK_DEFAULT_QUESTIONS
  const chosen = view.units
    .filter((unit) => pool.has(unit.unit.slug))
    .slice(0, requested)
    .map((unit) => pool.get(unit.unit.slug)!)

  if (chosen.length === 0) {
    throw new QuickMockError(
      'QUICK_MOCK_NO_QUESTIONS',
      'No published questions match this scope in this language yet — the editorial pool is still growing (§36). Try another scope, or use the mock tests on the exam pages.'
    )
  }

  // §22 resume-or-create (the P7-S3 rule, quick scope): finish the live one first.
  await abandonExpiredQuickAttempts(user.userId)
  const existing = await db.testAttempt.findFirst({
    where: { userId: user.userId, mockTestId: null, status: 'IN_PROGRESS' },
    orderBy: { startedAt: 'desc' },
    include: { mockTest: true },
  })
  if (existing) {
    const state = await toAttemptState(existing)
    return {
      attempt: state,
      note: 'You already have a quick mock in progress — this is it (§22: finish the live one first).',
    }
  }

  // The §36-spirit scope snapshot — the deal this attempt was generated under.
  const scopeSnapshot: QuickMockGeneratedScope = {
    mode: input.mode,
    exams: scopeExams.map(toExamRef),
    unitCount: view.units.length,
    questionCount: chosen.length,
    generatedAt: new Date().toISOString(),
  }
  const durationMinutes = quickMockDurationMinutes(chosen.length)
  const startedAt = new Date()
  const deadlineAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000)

  const created = await db.testAttempt.create({
    data: {
      userId: user.userId,
      mockTestId: null,
      status: 'IN_PROGRESS',
      startedAt,
      deadlineAt,
      servedQuestionsJson: JSON.stringify(chosen),
      durationMinutes,
      passPercent: QUICK_MOCK_PASS_PERCENT,
      generatedScopeJson: JSON.stringify(scopeSnapshot),
      answersJson: '[]',
    },
    include: { mockTest: true },
  })

  await recordAudit({
    actor: { userId: user.userId, email: user.email, role: 'READER' },
    action: AUDIT_ACTIONS.attemptStart,
    objectType: AUDIT_OBJECT_TYPES.testAttempt,
    objectId: created.id,
    objectLabel: `quick-mock/Attempt`,
    after: {
      mode: scopeSnapshot.mode,
      exams: scopeSnapshot.exams.map((exam) => exam.slug),
      questionCount: chosen.length,
      durationMinutes,
      deadlineAt: deadlineAt.toISOString(),
    },
    metadata: {
      generated: true,
      mode: scopeSnapshot.mode,
      exams: scopeSnapshot.exams.map((exam) => exam.slug),
      questionCount: chosen.length,
      requestedCount: requested,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const attempt: PublicAttemptState = await toAttemptState(created, chosen)
  return {
    attempt,
    note:
      chosen.length < requested
        ? `Only ${chosen.length} published question${chosen.length === 1 ? '' : 's'} matched this scope — a shorter mock was generated (§36 honest sizing).`
        : null,
  }
}
