/**
 * GlobIQ — Analytics module: the §32 product-analytics service (P8-S4)
 *
 * One aggregate read over the stores earlier sessions already write. This
 * module OWNS no data — §28's ownership rule: the producing module owns its
 * event store (search owns SearchQueryLog, sharing owns ShareEvent, …); the
 * analytics module only reads. Every read is AGGREGATE (count / groupBy /
 * distinct) — §31: no per-user row ever crosses this boundary, so the §32
 * analytics identity stays separated from public content identity and the
 * §31 reset never has to touch a §32 number.
 *
 * §32's own rule shapes the design: "Avoid optimising solely for raw
 * pageviews — a platform that increases irrelevant page consumption can look
 * successful while failing the core problem." There is deliberately NO
 * pageview counter anywhere in this module: every metric is an ACTION that
 * signals intent (a query typed, an exam followed, an attempt submitted, a
 * report filed, a link shared) — the relevance-first stance, stated on every
 * response.
 *
 * Window contract: FLOW metrics (queries, attempts submitted, shares,
 * reports, resolutions, notification reads) honour the requested window;
 * STOCK metrics (status distributions, mastery bands, the revision queue)
 * are current state and carry "all-time state" in their derivation.
 */
import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'

import {
  AnalyticsError,
  type AnalyticsFamily,
  type AnalyticsMetric,
  type AnalyticsPending,
  type AnalyticsWindow,
  type AnalyticsWindowDays,
  type ProductAnalytics,
} from './analytics-types'

// ---------- helpers ----------

const DAY_MS = 24 * 60 * 60 * 1000

const WINDOW_LABELS: Record<string, string> = {
  '7': 'last 7 days',
  '30': 'last 30 days',
  '90': 'last 90 days',
  all: 'all time',
}

function windowSince(days: AnalyticsWindowDays): Date | null {
  if (days === 'all') return null
  return new Date(Date.now() - days * DAY_MS)
}

/** The where-clause fragment for a windowed flow read. */
function flow(since: Date | null, field: 'createdAt' | 'submittedAt' | 'resolvedAt') {
  return since ? { [field]: { gte: since } } : {}
}

/** One-decimal percent; 0 (never null) with the denominator stated in derivations. */
function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

/** "a ×3 · b ×1" listing for text metrics — 'none in window' when empty. */
function tallyList(entries: Array<{ text: string; count: number }>, emptyLabel: string): string {
  if (entries.length === 0) return emptyLabel
  return entries.map((entry) => `${entry.text} ×${entry.count}`).join(' · ')
}

function dedupeCounted(rows: Array<{ queryText: string }>): Array<{ text: string; count: number }> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = row.queryText.trim().toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
  return Math.round(value) // whole minutes; a same-minute resolution is honestly 0
}

const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60000

// ---------- the §32 constants (verbatim spec text on every response) ----------

const PRINCIPLE = 'Measure whether the product solves relevance, not merely pageviews (§32).'
const PAGEVIEW_WARNING =
  'Avoid optimising solely for raw pageviews — a platform that increases irrelevant page consumption can look successful while failing the core problem this platform exists to solve (§32). There is deliberately no pageview counter in this module: every metric is an intent-bearing action.'

// ---------- the read ----------

export async function getProductAnalytics(
  actor: Actor,
  input: { days: AnalyticsWindowDays }
): Promise<ProductAnalytics> {
  // §38: product analytics measures the PRODUCT (search, learning, retention,
  // sharing are cross-market by nature) — a platform surface, like audit and
  // the notification dispatch sweep. The §38 workspace split applies to
  // editorial surfaces (the feedback queue); splitting these families per
  // country would be a partial cut some stores cannot honestly support
  // (attempts carry no country). Stated on the 403, never silently.
  if (actor.role !== 'ADMIN') {
    throw new AnalyticsError(
      'ANALYTICS_ADMIN_ONLY',
      'Product analytics is a platform surface (§32/§38) — it measures the whole product; the per-country workspace split applies to editorial surfaces like the feedback queue',
      403
    )
  }

  const since = windowSince(input.days)
  const window: AnalyticsWindow = {
    days: input.days,
    since: since ? since.toISOString() : null,
    label: WINDOW_LABELS[String(input.days)] ?? `${input.days} days`,
  }

  const families: AnalyticsFamily[] = [
    await discoveryFamily(since, window),
    await relevanceFamily(),
    await learningFamily(since, window),
    await retentionFamily(since, window),
    await contentFamily(since, window),
    await sharingFamily(since, window),
  ]

  return {
    principle: PRINCIPLE,
    pageviewWarning: PAGEVIEW_WARNING,
    generatedAt: new Date().toISOString(),
    window,
    families,
    upcoming: {
      editorial:
        'P8-S5 — time to publish, review cycle, correction cycle: the §19/§25 workflow timings from the audit trail (the §44 resolution moments this session already indexes).',
      seo:
        'P8-S5 — indexed pages, impressions, clicks, query coverage: the sitemap census plus Search Console inputs; the zero-result list in Discovery above is the honest query-coverage seed.',
      growthReferral:
        'P8-S5 — growth and referral measurement: arrival attribution (the ShareEvent landings are the in-platform half; referrer halves land with real traffic).',
    },
    sources: [
      'search → SearchQueryLog (written by the §17 public surface since P8-S4)',
      'follow-save → UserFollow + SavedItem (P5-S1/S2)',
      'assessment → TestAttempt + MasteryState (P7-S3/S4)',
      'content-quality → ContentFeedback (P8-S3)',
      'sharing → ShareEvent (P8-S1)',
      'notifications → NotificationEvent (P8-S2)',
      'sources + current-affairs → Source + CurrentEvent (P2/P6)',
    ],
  }
}

// ---------- 1. Discovery (§32: "search success, topic discovery, organic landing engagement") ----------

async function discoveryFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  const where = { ...flow(since, 'createdAt') }
  const [total, successful, zeroRows, marketRows, topRows] = await Promise.all([
    db.searchQueryLog.count({ where }),
    db.searchQueryLog.count({ where: { ...where, resultCount: { gt: 0 } } }),
    db.searchQueryLog.findMany({
      where: { ...where, resultCount: 0 },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { queryText: true },
    }),
    db.searchQueryLog.groupBy({ by: ['countryIso', 'languageCode'], where, _count: { _all: true } }),
    db.searchQueryLog.groupBy({
      by: ['queryText'],
      where,
      _count: { queryText: true },
      orderBy: { _count: { queryText: 'desc' } },
      take: 10,
    }),
  ])

  const markets = marketRows
    .map((row) => `${row.countryIso}/${row.languageCode} ×${row._count._all}`)
    .sort()
    .join(' · ')

  const metrics: AnalyticsMetric[] = [
    {
      key: 'searchQueries',
      label: 'Search queries',
      value: total,
      unit: 'count',
      derivation: `SearchQueryLog rows in the ${window.label} — one row per completed §17 public search query. By market: ${markets || 'none yet'}.`,
    },
    {
      key: 'searchSuccessRate',
      label: 'Search success rate',
      value: pct(successful, total),
      unit: 'percent',
      derivation: `${successful} of ${total} queries returned ≥ 1 result (§32 "search success"). Anonymous-only rows — a failed search says nothing about who failed (§31).`,
    },
    {
      key: 'topQueries',
      label: 'Top queries',
      value: tallyList(
        topRows.map((row) => ({ text: row.queryText.trim().toLowerCase(), count: row._count.queryText })),
        'no queries in window yet'
      ),
      unit: 'text',
      derivation: 'Most frequent queries in the window (top 10, case-folded) — the demand side of discovery.',
    },
    {
      key: 'zeroResultQueries',
      label: 'Zero-result queries (the gap list)',
      value: tallyList(dedupeCounted(zeroRows), 'no failed searches in window — honestly stated'),
      unit: 'text',
      derivation:
        'Distinct queries that returned nothing in the window (top 10) — kept on purpose: the honest content-gap list, and the P8-S5 query-coverage input.',
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'topicDiscovery',
      text: 'Topic-hub visits are deliberately not counted (§32\u2019s no-raw-pageviews rule); demand for topics is measured through the query mix above and share landings in the Sharing family.',
    },
    {
      key: 'organicLanding',
      text: 'Search-engine ("organic") landing attribution needs referrer telemetry — deliberately not collected (§31); it lands with the P8-S5 SEO measurement (Search Console + referrer halves).',
    },
  ]

  return {
    key: 'discovery',
    label: 'Discovery',
    specExamples: ['search success', 'topic discovery', 'organic landing engagement'],
    metrics,
    pending,
  }
}

// ---------- 2. Relevance (§32: "follow-to-consumption, exam coverage, recommended-item usefulness") ----------

async function relevanceFamily(): Promise<AnalyticsFamily> {
  // Distinct users per store — aggregate sets, never per-user rows out.
  const [followRows, attemptRows, saveRows, examFollowRows] = await Promise.all([
    db.userFollow.findMany({ select: { userId: true }, distinct: ['userId'] }),
    db.testAttempt.findMany({ where: { status: 'SUBMITTED' }, select: { userId: true }, distinct: ['userId'] }),
    db.savedItem.findMany({ select: { userId: true }, distinct: ['userId'] }),
    db.userFollow.findMany({ where: { objectType: 'EXAM' }, select: { objectId: true }, distinct: ['objectId'] }),
  ])

  const followers = new Set(followRows.map((row) => row.userId))
  const attempters = new Set(attemptRows.map((row) => row.userId))
  const savers = new Set(saveRows.map((row) => row.userId))
  const consumed = new Set([...attempters, ...savers])
  let followedToAttempt = 0
  let followedToSave = 0
  for (const userId of followers) {
    if (attempters.has(userId)) followedToAttempt += 1
    if (savers.has(userId)) followedToSave += 1
  }

  // Exam coverage: of the distinct exams followed by ≥1 user, the share with
  // learning activity on a unit mapped to that exam.
  const examIds = [...new Set(examFollowRows.map((row) => row.objectId))]
  const exams = await db.exam.findMany({
    where: { id: { in: examIds } },
    select: { id: true, versions: { select: { id: true } } },
  })
  const versionIds = exams.flatMap((exam) => exam.versions.map((version) => version.id))
  const [mappings, learnedRows] = await Promise.all([
    versionIds.length
      ? db.examMapping.findMany({
          where: { examVersionId: { in: versionIds } },
          select: { examVersionId: true, knowledgeUnitId: true },
        })
      : Promise.resolve([] as Array<{ examVersionId: string; knowledgeUnitId: string }>),
    db.masteryState.findMany({ select: { knowledgeUnitId: true }, distinct: ['knowledgeUnitId'] }),
  ])
  const learnedUnits = new Set(learnedRows.map((row) => row.knowledgeUnitId))
  const versionToExam = new Map<string, string>()
  for (const exam of exams) {
    for (const version of exam.versions) versionToExam.set(version.id, exam.id)
  }
  const coveredExams = new Set<string>()
  for (const mapping of mappings) {
    if (learnedUnits.has(mapping.knowledgeUnitId)) {
      const examId = versionToExam.get(mapping.examVersionId)
      if (examId) coveredExams.add(examId)
    }
  }

  const metrics: AnalyticsMetric[] = [
    {
      key: 'followToConsumption',
      label: 'Follow-to-consumption',
      value: pct([...followers].filter((userId) => consumed.has(userId)).length, followers.size),
      unit: 'percent',
      derivation: `${followers.size} users follow ≥ 1 exam/topic/entity; of those, ${followedToAttempt} have submitted ≥ 1 attempt and ${followedToSave} have ≥ 1 saved item (either counts as consumption — §32's core question: did following lead to use?).`,
    },
    {
      key: 'examCoverage',
      label: 'Followed exams under learning',
      value: pct(coveredExams.size, exams.length),
      unit: 'percent',
      derivation: `${coveredExams.size} of ${exams.length} distinct followed exams have ≥ 1 mastery row on a unit mapped to that exam (all versions — §36: historical mappings stay queryable; mastery is written exclusively by submitted attempts, §22).`,
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'recommendedItemUsefulness',
      text: 'Never a rating (§25’s no-ratings rule applies to recommendations too); usefulness is measured through consumption — the follow-to-consumption metrics above are the honest proxy. Accept/dismiss telemetry is deliberately not collected (§31 minimal).',
    },
  ]

  return {
    key: 'relevance',
    label: 'Relevance',
    specExamples: ['follow-to-consumption', 'exam coverage', 'recommended-item usefulness'],
    metrics,
    pending,
  }
}

// ---------- 3. Learning (§32: "completion, quiz/mock-test accuracy, repeated-error reduction, mastery progression") ----------

async function learningFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  const [statusRows, submittedRows, masteryRows] = await Promise.all([
    db.testAttempt.groupBy({ by: ['status'], _count: { _all: true } }),
    db.testAttempt.findMany({
      where: { status: 'SUBMITTED', ...flow(since, 'submittedAt') },
      select: { scorePercent: true, passed: true },
    }),
    db.masteryState.findMany({ select: { masteryScore: true, attemptedCount: true } }),
  ])

  const statusMap = new Map(statusRows.map((row) => [row.status, row._count._all]))
  const totalAttempts = statusRows.reduce((sum, row) => sum + row._count._all, 0)
  const submittedAll = statusMap.get('SUBMITTED') ?? 0

  const scores = submittedRows.map((row) => row.scorePercent ?? 0)
  const passed = submittedRows.filter((row) => row.passed === true).length

  const multiRound = masteryRows.filter((row) => row.attemptedCount >= 2)
  const multiRoundMastered = multiRound.filter((row) => row.masteryScore >= 80)

  const mastered = masteryRows.filter((row) => row.masteryScore >= 80).length
  const progressing = masteryRows.filter((row) => row.masteryScore >= 60 && row.masteryScore < 80).length
  const developing = masteryRows.filter((row) => row.masteryScore < 60).length

  const metrics: AnalyticsMetric[] = [
    {
      key: 'completionRate',
      label: 'Attempt completion',
      value: pct(submittedAll, totalAttempts),
      unit: 'percent',
      derivation: `${submittedAll} of ${totalAttempts} attempts ever started are SUBMITTED (all-time state; IN_PROGRESS rows may still submit, ABANDONED ones honestly will not — §22).`,
    },
    {
      key: 'accuracy',
      label: 'Average score / pass rate',
      value: `${avg(scores)}% · ${pct(passed, submittedRows.length)}%`,
      unit: 'text',
      derivation: `Average score and pass rate over the ${submittedRows.length} attempts submitted in the ${window.label} (TestAttempt.scorePercent / passed, set once at submit — §6).`,
    },
    {
      key: 'repeatedErrorReduction',
      label: 'Repeated-error reduction',
      value: pct(multiRoundMastered.length, multiRound.length),
      unit: 'percent',
      derivation: `${multiRoundMastered.length} of ${multiRound.length} units practiced ≥ 2 rounds now score ≥ 80 (MasteryState over per-user × unit) — §22's streak mechanic (any slip resets to tomorrow) is the designed reduction mechanism.`,
    },
    {
      key: 'masteryProgression',
      label: 'Mastery progression',
      value: `mastered ${mastered} · progressing ${progressing} · developing ${developing} (avg ${avg(masteryRows.map((row) => row.masteryScore))}%)`,
      unit: 'text',
      derivation:
        'MasteryState bands (≥80 / 60–79 / <60) — derived exclusively from submitted attempts (§22); §36: RETIRED units keep their rows honestly.',
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'errorTrajectories',
      text: 'Per-unit error trajectories (first-round vs latest-round accuracy) land with real multi-round history — the aggregate streak signal above is today\u2019s honest form.',
    },
  ]

  return {
    key: 'learning',
    label: 'Learning',
    specExamples: ['completion', 'quiz/mock-test accuracy', 'repeated-error reduction', 'mastery progression'],
    metrics,
    pending,
  }
}

// ---------- 4. Retention (§32: "return sessions, saved-item reuse, revision activity") ----------

async function retentionFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  const [submittedAll, masteryRows, notifRows, revDueRows] = await Promise.all([
    db.testAttempt.findMany({
      where: { status: 'SUBMITTED' },
      select: { userId: true, submittedAt: true },
    }),
    db.masteryState.findMany({ select: { nextReviewAt: true } }),
    db.notificationEvent.groupBy({
      by: ['status'],
      where: { ...flow(since, 'createdAt') },
      _count: { _all: true },
    }),
    db.notificationEvent.groupBy({
      by: ['status'],
      where: { ...flow(since, 'createdAt'), triggerType: 'REVISION_DUE' },
      _count: { _all: true },
    }),
  ])

  // Multi-day learning activity — the honest "they came back" signal.
  const activityDays = new Map<string, Set<string>>()
  for (const row of submittedAll) {
    // status SUBMITTED guarantees submittedAt is set; the guard keeps TS honest.
    if (!row.submittedAt) continue
    const days = activityDays.get(row.userId) ?? new Set<string>()
    days.add(row.submittedAt.toISOString().slice(0, 10))
    activityDays.set(row.userId, days)
  }
  const activeUsers = activityDays.size
  const returning = [...activityDays.values()].filter((days) => days.size >= 2).length

  const statusCount = (rows: Array<{ status: string; _count: { _all: number } }>, status: string) =>
    rows.find((row) => row.status === status)?._count._all ?? 0
  const readRate = (rows: Array<{ status: string; _count: { _all: number } }>) => {
    const read = statusCount(rows, 'READ')
    const sent = statusCount(rows, 'SENT')
    return { read, sent, rate: pct(read, read + sent) }
  }
  const overall = readRate(notifRows)
  const revision = readRate(revDueRows)

  const now = Date.now()
  const due = masteryRows.filter((row) => row.nextReviewAt.getTime() <= now).length

  const metrics: AnalyticsMetric[] = [
    {
      key: 'returnEngagement',
      label: 'Return engagement',
      value: pct(returning, activeUsers),
      unit: 'percent',
      derivation: `${returning} of ${activeUsers} users with a submitted attempt have learning activity on ≥ 2 distinct days — the nearest honest "return" signal (see the pending note: true session instrumentation is deliberately not built).`,
    },
    {
      key: 'revisionQueue',
      label: 'Revision queue',
      value: `${due} due of ${masteryRows.length} tracked units`,
      unit: 'text',
      derivation:
        'MasteryState rows with nextReviewAt ≤ now (the §22 spaced-review schedule) — the queue the dashboard and the §11 step 7 re-ranking serve. Current state, not windowed.',
    },
    {
      key: 'notificationReadRate',
      label: 'Notification read rate',
      value: overall.rate,
      unit: 'percent',
      derivation: `${overall.read} READ of ${overall.read + overall.sent} dispatched rows (READ + SENT; QUEUED/FAILED excluded — not yet / never delivered) created in the ${window.label}. Revision digests specifically: ${revision.rate}% (${revision.read} of ${revision.read + revision.sent}).`,
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'returnSessions',
      text: 'True return sessions need a session concept — deliberately not instrumented (§31 data minimisation); if ever needed it must stay aggregate-only like every §32 read. The multi-day activity signal above is the honest stand-in.',
    },
    {
      key: 'savedItemReuse',
      text: 'No save-access telemetry, by design (§31 — a save is a retrieval action, not a tracked visit); reuse surfaces only if a future session adds it without profiling. Not scheduled.',
    },
  ]

  return {
    key: 'retention',
    label: 'Retention',
    specExamples: ['return sessions', 'saved-item reuse', 'revision activity'],
    metrics,
    pending,
  }
}

// ---------- 5. Content (§32: "source freshness, correction rate, content usefulness, feedback-report volume/resolution time") ----------

async function contentFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  const [statusRows, typeRows, resolvedRows, sourceRows, eventRows, windowCreated] = await Promise.all([
    db.contentFeedback.groupBy({ by: ['status'], _count: { _all: true } }),
    db.contentFeedback.groupBy({ by: ['feedbackType'], _count: { _all: true } }),
    db.contentFeedback.findMany({
      where: { resolvedAt: { not: null, ...(since ? { gte: since } : {}) } },
      select: { createdAt: true, resolvedAt: true },
    }),
    db.source.groupBy({ by: ['verification'], _count: { _all: true } }),
    db.currentEvent.groupBy({ by: ['lifecycleState'], _count: { _all: true } }),
    db.contentFeedback.count({ where: flow(since, 'createdAt') }),
  ])

  const statusMap = new Map(statusRows.map((row) => [row.status, row._count._all]))
  const totalReports = statusRows.reduce((sum, row) => sum + row._count._all, 0)
  const resolvedAll = statusMap.get('RESOLVED') ?? 0

  const typeList = typeRows
    .map((row) => ({
      text: row.feedbackType.toLowerCase().replace(/_/g, ' '),
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count)

  const sourceList = sourceRows
    .map((row) => ({ text: row.verification.toLowerCase(), count: row._count._all }))
    .sort((a, b) => b.count - a.count)

  const eventList = eventRows
    .map((row) => ({ text: row.lifecycleState.toLowerCase(), count: row._count._all }))
    .sort((a, b) => b.count - a.count)

  const resolutionTimes = resolvedRows
    .filter((row) => row.resolvedAt)
    .map((row) => minutesBetween(row.createdAt, row.resolvedAt as Date))
  const medianMinutes = median(resolutionTimes)

  const metrics: AnalyticsMetric[] = [
    {
      key: 'feedbackVolume',
      label: 'Feedback-report volume',
      value: totalReports,
      unit: 'count',
      derivation: `ContentFeedback reports, all-time state (${windowCreated} filed in the ${window.label}) — by reason: ${tallyList(typeList, 'none yet')}. The P8-S3 queue stats are the §38-scoped view of the same store; this is the platform read.`,
    },
    {
      key: 'correctionRate',
      label: 'Correction rate',
      value: pct(resolvedAll, totalReports),
      unit: 'percent',
      derivation: `${resolvedAll} of ${totalReports} reports RESOLVED (dismissed honestly excluded from the numerator — a dismissal is a judged report, not a correction; §25).`,
    },
    {
      key: 'timeToCorrect',
      label: 'Median time-to-correct',
      value: medianMinutes ?? 'no resolutions in window',
      unit: 'minutes',
      derivation: `Median minutes from report createdAt to resolvedAt over the ${resolvedRows.length} resolutions landed in the ${window.label} (§44's auditable resolution moments — the same per-report pattern the P8-S3 queue stats seed).`,
    },
    {
      key: 'sourceFreshness',
      label: 'Source verification / event freshness',
      value: `${tallyList(sourceList, 'no sources')} — events: ${tallyList(eventList, 'no events')}`,
      unit: 'text',
      derivation:
        'Sources by §24 verification state and events by §12 lifecycle (emerging → developing → stable → archived) — the trust inputs behind every published claim. Current state; retrieval-recency windows join with the P8-S5 editorial analytics.',
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'contentUsefulness',
      text: 'Never public ratings (§25) — the quality loop\u2019s volume/resolution (this family) is the honest usefulness proxy; a star rating would be a moderation signal, never a §32 one.',
    },
  ]

  return {
    key: 'content',
    label: 'Content',
    specExamples: ['source freshness', 'correction rate', 'content usefulness', 'feedback-report volume/resolution time'],
    metrics,
    pending,
  }
}

// ---------- 6. Sharing (§32: "share actions, landing visits") ----------

async function sharingFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  const actionWhere = { ...flow(since, 'createdAt'), action: 'SHARE_CREATE' as const }
  const landingWhere = { ...flow(since, 'createdAt'), action: 'SHARE_LANDING' as const }
  const [actionRows, landingRows, channelRows] = await Promise.all([
    db.shareEvent.groupBy({ by: ['objectType'], where: actionWhere, _count: { _all: true } }),
    db.shareEvent.groupBy({ by: ['objectType'], where: landingWhere, _count: { _all: true } }),
    db.shareEvent.groupBy({ by: ['channel'], where: actionWhere, _count: { _all: true } }),
  ])

  const typeLabel = (type: string) => type.toLowerCase().replace(/_/g, ' ')
  const actions = actionRows.reduce((sum, row) => sum + row._count._all, 0)
  const landings = landingRows.reduce((sum, row) => sum + row._count._all, 0)

  const actionList = actionRows
    .map((row) => ({ text: typeLabel(row.objectType), count: row._count._all }))
    .sort((a, b) => b.count - a.count)
  const landingList = landingRows
    .map((row) => ({ text: typeLabel(row.objectType), count: row._count._all }))
    .sort((a, b) => b.count - a.count)
  const channels = channelRows
    .map((row) => `${(row.channel ?? 'unknown').toLowerCase().replace(/_/g, ' ')} ×${row._count._all}`)
    .sort()
    .join(' · ')

  const metrics: AnalyticsMetric[] = [
    {
      key: 'shareActions',
      label: 'Share actions',
      value: actions,
      unit: 'count',
      derivation: `SHARE_CREATE rows in the ${window.label} — by object: ${tallyList(actionList, 'none yet')}; by channel: ${channels || 'none yet'}. §21: the platform records its OWN actions, never what networks did with them.`,
    },
    {
      key: 'landingVisits',
      label: 'Landing visits',
      value: landings,
      unit: 'count',
      derivation: `SHARE_LANDING rows in the ${window.label} — by object: ${tallyList(landingList, 'none yet')}. Landings are anonymous by design (§31).`,
    },
    {
      key: 'shareToLanding',
      label: 'Share → landing',
      value: pct(landings, actions),
      unit: 'percent',
      derivation: `${landings} landings against ${actions} share actions in the window — the honest in-platform conversion (a share that is never opened is honestly counted as such).`,
    },
  ]

  return {
    key: 'sharing',
    label: 'Sharing',
    specExamples: ['share actions', 'landing visits'],
    metrics,
    pending: [],
  }
}
