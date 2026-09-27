/**
 * GlobIQ — Personalisation: the dashboard/feed service (P5-S4)
 * Master Plan §9 (layered, explainable, reversible personalisation), §10
 * (follows drive the feed; saves are retrieval — never a signal), §11 (the
 * combined-exam queue: union by canonical unit id, MAX required depth, the
 * covering-exam set — reusing the P3-S4 engine verbatim, computed at request
 * time, never stored §46.3), §22 (the dashboard: what matters now — the
 * combined-exam queue; due revisions and weak-topic feedback arrive with the
 * P7 assessment system and stay honest quiet states until then), §34 (the
 * authenticated homepage's personalised layer), §14 (the queue ALWAYS runs
 * in the user's home market — §11 step 1 "valid for the user's country"),
 * §16 (canonical paths), §35 (label chains), §36 (honest statuses — retired
 * exams stay listed in the signals, excluded from the queue with an honest
 * note), §37 (typed errors mapped by route handlers), §39 (mobile-ready).
 *
 * Signal layering (§9) in one paragraph: the queue's SCOPE is the union of
 * goal exams and followed exams (declared + passive signals); goal subjects
 * and followed topics never add units — they RE-RANK and EXPLAIN (a unit
 * whose syllabus topic is a declared goal subject outranks one merely
 * followed, which outranks plain exam scope). Every unit carries its reasons
 * ("Because your goal includes …", §9). Saves appear ONLY as a clearly
 * labelled retrieval block and never touch ranking (§10).
 */
import { db } from '@/lib/db'
import { LocaleError, resolveLocaleContext } from '@/modules/country-locale'
import { getCombinedExamView } from '@/modules/exam-mapping'
import type { CombinedExamResolution, CombinedQueueUnit } from '@/modules/exam-mapping'
import { listMyFollows, listRecentSaves } from '@/modules/follow-save'
import type { FollowedExamSummary, FollowedTopicSummary, PublicSave } from '@/modules/follow-save'
import { ExamError } from '@/modules/exams-syllabus'
import { getPublicTree } from '@/modules/taxonomy'
import type { PublicTopicNode } from '@/modules/taxonomy'

import { getMyGoal, loadUserContext } from './service'
import type { UserContext } from './service'
import type { GoalTopicSummary, PublicGoal } from './types'
import type {
  DashboardPlan,
  DashboardQueue,
  DashboardQueueMode,
  DashboardQueueReason,
  DashboardQueueUnit,
  DashboardResponse,
  DashboardSignals,
  DashboardTier,
} from './dashboard-types'
import type { DashboardGetQuery } from './validation'

/** The dashboard's saves block size (§10 retrieval shortcut — small by design). */
export const DASHBOARD_SAVES_LIMIT = 3

// ---------- §9 label market (mirrors resolveGoalMarket's lenient chain) ----------

interface LabelMarket {
  isoCode: string
  slug: string
  name: string
  languageCode: string
  languageName: string
  languageNativeName: string | null
  direction: 'LTR' | 'RTL'
}

/**
 * Resolves the dashboard's label market (§35): explicit query → the goal's
 * declared study language → the account's preferred language → the market
 * default. The chain is lenient for DERIVED languages (a study/preferred
 * language not configured in the market falls back to the default) and
 * strict for EXPLICIT query languages (a 400, the goal GET precedent).
 */
async function resolveLabelMarket(
  user: UserContext,
  studyLanguageCode: string | null,
  query: DashboardGetQuery
): Promise<LabelMarket> {
  const countryInput = query.country?.trim() || user.homeCountryIso || undefined
  const languageInput =
    query.language?.trim() || studyLanguageCode || user.preferredLanguageCode || undefined

  const attempt = async (language?: string) => resolveLocaleContext({ country: countryInput, language })

  let resolution
  try {
    resolution = await attempt(languageInput)
  } catch (error) {
    if (error instanceof LocaleError && !query.language && languageInput) {
      resolution = await attempt(undefined)
    } else {
      throw error
    }
  }

  return {
    isoCode: resolution.country.isoCode,
    slug: resolution.country.slug,
    name: resolution.country.name,
    languageCode: resolution.language.code,
    languageName: resolution.language.name,
    languageNativeName: resolution.language.nativeName,
    direction: resolution.language.direction,
  }
}

// ---------- §9/§11 exam scope ----------

interface ExamScopeEntry {
  slug: string
  name: string
  status: FollowedExamSummary['status']
  countryIso: string
  fromGoal: boolean
  fromFollow: boolean
}

/**
 * §11 step 1 for a real user: the exam set is the union of goal exams and
 * followed exams, deduplicated by canonical slug. Eligibility re-applies at
 * READ time (§36 honesty — the declaration-time guards were the P5-S1/S3
 * rules): only ACTIVE exams of the user's home country feed the queue;
 * everything else stays visible in the signals with its honest status.
 */
function buildExamScope(goal: PublicGoal | null, followedExams: FollowedExamSummary[]): {
  entries: ExamScopeEntry[]
  goalExamCount: number
  followedExamCount: number
} {
  const bySlug = new Map<string, ExamScopeEntry>()
  for (const exam of goal?.exams ?? []) {
    bySlug.set(exam.slug, {
      slug: exam.slug,
      name: exam.name,
      status: exam.status,
      countryIso: exam.countryIso,
      fromGoal: true,
      fromFollow: false,
    })
  }
  for (const exam of followedExams) {
    const existing = bySlug.get(exam.slug)
    if (existing) {
      existing.fromFollow = true
      existing.status = exam.status // the freshest honest read wins
      existing.countryIso = exam.countryIso
    } else {
      bySlug.set(exam.slug, {
        slug: exam.slug,
        name: exam.name,
        status: exam.status,
        countryIso: exam.countryIso,
        fromGoal: false,
        fromFollow: true,
      })
    }
  }
  return {
    entries: [...bySlug.values()],
    goalExamCount: goal?.exams.length ?? 0,
    followedExamCount: followedExams.length,
  }
}

// ---------- §9 reasons + tier overlay ----------

const TIER_RANK: Record<DashboardTier, number> = {
  GOAL_SUBJECT: 0,
  FOLLOWED_SUBJECT: 1,
  EXAM_SCOPE: 2,
}

interface SignalIndex {
  goalExamNames: Map<string, string>
  followedExamNames: Map<string, string>
  /** Matched node slug (selection or descendant) → the SELECTED subject. */
  goalSubjects: Map<string, { slug: string; label: string }>
  followedSubjects: Map<string, { slug: string; label: string }>
}

/**
 * Expands one selected subject into its descendant-inclusive match set
 * (§13): onboarding selects nodes at ANY level — a DOMAIN selection like
 * "polity-governance" must match units anchored at its BRANCH/TOPIC
 * descendants ("fundamental-rights"). Ancestor direction is deliberately
 * NOT expanded: selecting one child never drags its siblings in — the
 * conservative, explainable direction (§9).
 */
function expandSubject(
  slug: string,
  label: string,
  nodesBySlug: Map<string, PublicTopicNode>,
  into: Map<string, { slug: string; label: string }>
): void {
  into.set(slug, { slug, label }) // the selection itself always matches
  const stack = [nodesBySlug.get(slug)]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    for (const child of node.children) {
      // A nested selection of a descendant keeps ITS label (closest choice wins).
      if (!into.has(child.slug)) into.set(child.slug, { slug, label })
      stack.push(child)
    }
  }
}

/**
 * Builds the subject match sets from the live taxonomy tree of the label
 * market. Selections missing from the tree (a topic retired from the public
 * tree, §36) degrade to exact-slug matching — honest, never an error.
 */
async function buildSignalIndex(
  market: LabelMarket,
  goal: PublicGoal | null,
  followedExams: FollowedExamSummary[],
  followedTopics: FollowedTopicSummary[]
): Promise<SignalIndex> {
  const goalExamNames = new Map<string, string>()
  for (const exam of goal?.exams ?? []) goalExamNames.set(exam.slug, exam.name)
  const followedExamNames = new Map<string, string>()
  for (const exam of followedExams) followedExamNames.set(exam.slug, exam.name)

  const goalSubjects = new Map<string, { slug: string; label: string }>()
  const followedSubjects = new Map<string, { slug: string; label: string }>()
  const selected: Array<{
    topic: GoalTopicSummary | FollowedTopicSummary
    into: Map<string, { slug: string; label: string }>
  }> = []
  for (const topic of goal?.topics ?? []) selected.push({ topic, into: goalSubjects })
  for (const topic of followedTopics) selected.push({ topic, into: followedSubjects })

  if (selected.length > 0) {
    let nodesBySlug = new Map<string, PublicTopicNode>()
    try {
      const tree = await getPublicTree({ country: market.isoCode, language: market.languageCode })
      const walk = (node: PublicTopicNode) => {
        nodesBySlug.set(node.slug, node)
        node.children.forEach(walk)
      }
      tree.forEach(walk)
    } catch {
      nodesBySlug = new Map() // degrade to exact-slug matching (§36 honest)
    }
    for (const { topic, into } of selected) {
      expandSubject(topic.slug, topic.label, nodesBySlug, into)
    }
  }

  return { goalExamNames, followedExamNames, goalSubjects, followedSubjects }
}

/**
 * Explains one §11 queue unit from the caller's §9 signals (§9: "Recommendation
 * output must be explainable"). Reasons are complete sentences, ready to
 * render verbatim on any client (§39). Covering exams explain scope; the
 * unit's syllabus-node topics explain subject affinity.
 */
function explainUnit(unit: CombinedQueueUnit, signals: SignalIndex): { tier: DashboardTier; reasons: DashboardQueueReason[] } {
  const reasons: DashboardQueueReason[] = []
  const seen = new Set<string>()
  const push = (reason: DashboardQueueReason, key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    reasons.push(reason)
  }

  for (const exam of unit.exams) {
    if (signals.goalExamNames.has(exam.slug)) {
      push(
        { kind: 'GOAL_EXAM', text: `Because your goal includes ${exam.name}`, examSlug: exam.slug },
        `goal-exam:${exam.slug}`
      )
    } else if (signals.followedExamNames.has(exam.slug)) {
      push(
        { kind: 'FOLLOWED_EXAM', text: `Because you follow ${exam.name}`, examSlug: exam.slug },
        `followed-exam:${exam.slug}`
      )
    }
  }

  for (const covering of unit.coverings) {
    const topic = covering.node.topic
    if (!topic) continue
    const goalSubject = signals.goalSubjects.get(topic.slug)
    if (goalSubject) {
      push(
        {
          kind: 'GOAL_SUBJECT',
          text: `Because ${goalSubject.label} is one of your goal subjects`,
          topicSlug: goalSubject.slug,
        },
        `goal-subject:${goalSubject.slug}`
      )
      continue
    }
    const followedSubject = signals.followedSubjects.get(topic.slug)
    if (followedSubject) {
      push(
        {
          kind: 'FOLLOWED_SUBJECT',
          text: `Because you follow the subject ${followedSubject.label}`,
          topicSlug: followedSubject.slug,
        },
        `followed-subject:${followedSubject.slug}`
      )
    }
  }

  const tier: DashboardTier = reasons.some((reason) => reason.kind === 'GOAL_SUBJECT')
    ? 'GOAL_SUBJECT'
    : reasons.some((reason) => reason.kind === 'FOLLOWED_SUBJECT')
      ? 'FOLLOWED_SUBJECT'
      : 'EXAM_SCOPE'
  return { tier, reasons }
}

// ---------- The dashboard (GET /api/dashboard) ----------

export async function getMyDashboard(
  userId: string,
  query: DashboardGetQuery = {}
): Promise<DashboardResponse> {
  const user = await loadUserContext(userId)

  const [userRow, goal] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, onboardingStatus: true },
    }),
    getMyGoal(userId, query),
  ])

  // §35 label market (the goal chain: query → study language → preferred → default).
  const market = await resolveLabelMarket(user, goal?.studyLanguage?.code ?? null, query)

  // §9 signals: follows resolve in the SAME label market (§16/§35 coherence).
  const follows = await listMyFollows(userId, {
    country: market.isoCode,
    language: market.languageCode,
  })
  const followedExams = follows.items.flatMap((item) =>
    item.object.kind === 'EXAM' ? [item.object] : []
  )
  const followedTopics = follows.items.flatMap((item) =>
    item.object.kind === 'TOPIC' ? [item.object] : []
  )

  // §11 step 1: the exam scope (goal ∪ follows, honest read-time eligibility).
  const scope = buildExamScope(goal, followedExams)
  const hasGoalExams = scope.goalExamCount > 0
  const hasFollowedExams = scope.followedExamCount > 0
  const mode: DashboardQueueMode = hasGoalExams && hasFollowedExams
    ? 'GOAL_AND_FOLLOW'
    : hasGoalExams
      ? 'GOAL'
      : hasFollowedExams
        ? 'FOLLOW'
        : 'NONE'

  const eligible = user.homeCountryIso
    ? scope.entries.filter(
        (entry) => entry.status === 'ACTIVE' && entry.countryIso === user.homeCountryIso
      )
    : []

  let queue: DashboardQueue
  if (eligible.length === 0) {
    queue = {
      mode,
      countryIso: user.homeCountryIso ?? market.isoCode,
      exams: [],
      units: [],
      stats: { examCount: 0, unitCount: 0, mappingCount: 0, sharedUnitCount: 0, duplicatesAvoided: 0 },
      note:
        mode === 'NONE'
          ? null
          : 'None of your declared or followed exams is active in your home market right now — the queue returns the moment one is (§36).',
    }
  } else {
    // §11 steps 2–9 in the user's HOME market (§14 — "valid for the user's
    // country"); labels in the resolved §35 language. The engine is the
    // single union implementation — the dashboard never re-derives it (§28).
    try {
      const combined = await getCombinedExamView({
        exams: eligible.map((entry) => entry.slug),
        country: user.homeCountryIso!,
        language: market.languageCode,
      })

      const signals = await buildSignalIndex(market, goal, followedExams, followedTopics)
      const explained = combined.units.map((unit) => {
        const { tier, reasons } = explainUnit(unit, signals)
        return { unit, tier, reasons } satisfies DashboardQueueUnit
      })
      // §9 layering: goal subjects → followed subjects → engine base order
      // (priority → likelihood → freshness, §11 step 7). Stable within tiers.
      explained.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])

      queue = {
        mode,
        countryIso: user.homeCountryIso!,
        exams: combined.exams as CombinedExamResolution[],
        units: explained,
        stats: combined.stats,
        note: null,
      }
    } catch (error) {
      // Honest §36 degradation — e.g. a home market not yet live (a
      // COMING_SOON country has no public compositions). The dashboard
      // itself stays useful: signals, plan and saves all render.
      if (error instanceof ExamError) {
        queue = {
          mode,
          countryIso: user.homeCountryIso!,
          exams: [],
          units: [],
          stats: { examCount: 0, unitCount: 0, mappingCount: 0, sharedUnitCount: 0, duplicatesAvoided: 0 },
          note: `The combined-exam queue is unavailable for your home market right now: ${error.message}`,
        }
      } else {
        throw error
      }
    }
  }

  // §10 retrieval block — the ONLY place saves appear, never a ranking input.
  const saves: { total: number; items: PublicSave[] } = await listRecentSaves(userId, DASHBOARD_SAVES_LIMIT, {
    country: market.isoCode,
    language: market.languageCode,
  })

  const plan: DashboardPlan | null = goal
    ? {
        level: goal.level,
        targetYear: goal.targetYear,
        dailyMinutes: goal.dailyMinutes,
        studyLanguage: goal.studyLanguage,
      }
    : null

  const signals: DashboardSignals = {
    goalExamCount: scope.goalExamCount,
    goalSubjectCount: goal?.counts.topics ?? 0,
    followedExamCount: scope.followedExamCount,
    followedTopicCount: followedTopics.length,
    followedExams: followedExams,
    followedTopics: followedTopics,
  }

  return {
    market: {
      country: { isoCode: market.isoCode, name: market.name, slug: market.slug },
      language: {
        code: market.languageCode,
        name: market.languageName,
        nativeName: market.languageNativeName,
      },
      direction: market.direction,
      isHomeMarket: market.isoCode === user.homeCountryIso,
    },
    user: {
      name: userRow?.name ?? null,
      onboardingStatus: userRow?.onboardingStatus ?? 'PENDING',
      homeCountryIso: user.homeCountryIso,
      preferredLanguageCode: user.preferredLanguageCode,
    },
    plan,
    goal,
    signals,
    queue,
    saves,
    computedAt: new Date().toISOString(),
  }
}
