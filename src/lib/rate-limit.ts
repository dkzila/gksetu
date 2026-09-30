/**
 * GlobIQ — In-memory rate limiting (Master Plan §30: rate limiting).
 *
 * Deliberately simple sliding-window counters keyed by route + client IP.
 * Sufficient for the single-instance dev/preview stage; §29 (Infrastructure
 * Evolution) replaces this with a shared store when we scale out — the
 * `checkRateLimit` signature stays stable for that swap.
 */

interface RateLimitOptions {
  /** Max allowed requests within the window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

interface RateLimitResult {
  allowed: boolean
  /** Remaining requests in the current window (never negative). */
  remaining: number
  /** Seconds until the oldest request leaves the window (0 = retry now). */
  retryAfterSec: number
}

const buckets = new Map<string, number[]>()
const MAX_BUCKETS = 10_000

function sweepIfNeeded(now: number, windowMs: number): void {
  if (buckets.size <= MAX_BUCKETS) return
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((t) => now - t < windowMs)
    if (fresh.length === 0) buckets.delete(key)
    else buckets.set(key, fresh)
  }
}

/** Extracts the caller IP from standard proxy headers (Vercel/Caddy). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

export function checkRateLimit(key: string, { limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  sweepIfNeeded(now, windowMs)

  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)

  if (hits.length >= limit) {
    const retryAfterMs = windowMs - (now - hits[0]!)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }

  hits.push(now)
  buckets.set(key, hits)
  return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0 }
}

/** Auth endpoint limits (§30): generous for humans, hostile to brute force. */
export const RATE_LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 }, // 5/hour per IP
  login: { limit: 10, windowMs: 15 * 60 * 1000 }, // 10/15min per IP
  taxonomyRead: { limit: 60, windowMs: 60 * 1000 }, // public tree/detail/search per IP
  taxonomyWrite: { limit: 30, windowMs: 60 * 1000 }, // admin taxonomy mutations per IP
  auditRead: { limit: 60, windowMs: 60 * 1000 }, // admin audit trail reads per IP
  knowledgeRead: { limit: 60, windowMs: 60 * 1000 }, // public knowledge list/detail per IP
  knowledgeWrite: { limit: 30, windowMs: 60 * 1000 }, // admin knowledge mutations per IP
  contentRead: { limit: 60, windowMs: 60 * 1000 }, // public content list/detail per IP
  contentWrite: { limit: 30, windowMs: 60 * 1000 }, // admin content mutations per IP
  sourceRead: { limit: 60, windowMs: 60 * 1000 }, // admin source registry reads per IP
  sourceWrite: { limit: 30, windowMs: 60 * 1000 }, // source registry + link mutations per IP
  editorialRead: { limit: 60, windowMs: 60 * 1000 }, // editorial workspace reads per IP
  editorialWrite: { limit: 30, windowMs: 60 * 1000 }, // editorial task mutations per IP
  examsRead: { limit: 60, windowMs: 60 * 1000 }, // public exam directory/detail per IP
  examsWrite: { limit: 30, windowMs: 60 * 1000 }, // admin exam/version mutations per IP
  searchRead: { limit: 60, windowMs: 60 * 1000 }, // public search queries per IP (P4-S1)
  searchWrite: { limit: 10, windowMs: 60 * 1000 }, // admin index rebuilds/stats per IP (P4-S1)
  discoveryRead: { limit: 60, windowMs: 60 * 1000 }, // public homepage/topic-landing compositions per IP (P4-S2)
  followsRead: { limit: 60, windowMs: 60 * 1000 }, // authenticated follow list/state reads per IP (P5-S1)
  followsWrite: { limit: 30, windowMs: 60 * 1000 }, // follow/unfollow mutations per IP (P5-S1)
  savesRead: { limit: 60, windowMs: 60 * 1000 }, // authenticated save list/state reads per IP (P5-S2)
  savesWrite: { limit: 30, windowMs: 60 * 1000 }, // save/unsave/move + collection mutations per IP (P5-S2)
  profileRead: { limit: 60, windowMs: 60 * 1000 }, // authenticated profile/goal reads per IP (P5-S3)
  profileWrite: { limit: 30, windowMs: 60 * 1000 }, // profile/goal/onboarding mutations per IP (P5-S3)
  dashboardRead: { limit: 60, windowMs: 60 * 1000 }, // authenticated dashboard/feed reads per IP (P5-S4)
  personalisationRead: { limit: 60, windowMs: 60 * 1000 }, // authenticated inventory/explanation reads per IP (P5-S5)
  personalisationWrite: { limit: 30, windowMs: 60 * 1000 }, // the §31 reset action per IP (P5-S5)
  currentAffairsRead: { limit: 60, windowMs: 60 * 1000 }, // admin event list/detail reads per IP (P6-S1)
  currentAffairsWrite: { limit: 30, windowMs: 60 * 1000 }, // event + aggregation mutations per IP (P6-S1)
  feedRead: { limit: 60, windowMs: 60 * 1000 }, // exam-aware current-affairs feed reads per IP (P6-S4)
  entityRead: { limit: 60, windowMs: 60 * 1000 }, // admin entity registry reads per IP (P6-S3)
  entityWrite: { limit: 30, windowMs: 60 * 1000 }, // entity registry + event link mutations per IP (P6-S3)
  qnaRead: { limit: 60, windowMs: 60 * 1000 }, // admin QnA registry reads per IP (P7-S1)
  qnaWrite: { limit: 30, windowMs: 60 * 1000 }, // QnA mutations per IP (P7-S1)
  questionRead: { limit: 60, windowMs: 60 * 1000 }, // admin Question registry reads per IP (P7-S2)
  questionWrite: { limit: 30, windowMs: 60 * 1000 }, // Question mutations per IP (P7-S2)
  questionPractice: { limit: 120, windowMs: 60 * 1000 }, // public practice answer checks per IP (P7-S2 §22 — scored server-side, no persistence)
  mocktestRead: { limit: 60, windowMs: 60 * 1000 }, // admin MockTest registry reads per IP (P7-S3)
  mocktestWrite: { limit: 30, windowMs: 60 * 1000 }, // MockTest mutations per IP (P7-S3)
  mocktestAttempt: { limit: 30, windowMs: 60 * 1000 }, // public attempt start/submit mutations per IP (P7-S3 §22 — timed, scored server-side, persisted for mastery)
  masteryRead: { limit: 60, windowMs: 60 * 1000 }, // private mastery/revision-queue reads per IP (P7-S4 §22 — owner-scoped, auth-gated)
  quickMockRead: { limit: 60, windowMs: 60 * 1000 }, // private quick-mock setup reads per IP (P7-S5 §22 — owner-scoped, auth-gated)
  quickMockWrite: { limit: 10, windowMs: 60 * 1000 }, // quick-mock generation per IP (P7-S5 §22 — a mutation: creates a §6 attempt)
  shareRead: { limit: 60, windowMs: 60 * 1000 }, // public share-card/shared-collection reads per IP (P8-S1 §21)
  shareWrite: { limit: 30, windowMs: 60 * 1000 }, // share-event records per IP (P8-S1 §21/§32 — anonymous allowed, object-guarded)
  notificationsRead: { limit: 60, windowMs: 60 * 1000 }, // private notification feed/preferences/stats reads per IP (P8-S2 §27 — owner-scoped, auth-gated)
  notificationsWrite: { limit: 30, windowMs: 60 * 1000 }, // mark-read + preference mutations + the admin dispatch sweep per IP (P8-S2 §27)
  feedbackWrite: { limit: 10, windowMs: 60 * 1000 }, // PUBLIC feedback submissions per IP (P8-S3 §25 — anonymous-friendly, object-guarded, duplicate-folded; reports are heavier than shares so the cap is tighter)
  feedbackRead: { limit: 60, windowMs: 60 * 1000 }, // editorial queue reads + own-report reads per IP (P8-S3 §25/§31)
  feedbackManage: { limit: 30, windowMs: 60 * 1000 }, // editorial transitions per IP (P8-S3 §44 — auth-gated queue actions, the notificationsWrite precedent; separate from the tighter public-submission cap)
  analyticsRead: { limit: 60, windowMs: 60 * 1000 }, // product-analytics reads per IP (P8-S4 §32 — ADMIN-gated aggregate reads, the auditRead precedent)
  seoIngest: { limit: 10, windowMs: 60 * 1000 }, // SEO observation batches per IP (P8-S5 §16/§32 — ADMIN-gated platform ingestion, the reindexWrite precedent)
  landingWrite: { limit: 30, windowMs: 60 * 1000 }, // arrival-census beacons per IP (P8-S5 §32 — anonymous best-effort rows, the shareEventWrite precedent)
  translationsRead: { limit: 60, windowMs: 60 * 1000 }, // translation-workspace list reads per IP (P9-S1 §18/§38 — staff-gated)
  translationsWrite: { limit: 30, windowMs: 60 * 1000 }, // translation link mutations per IP (P9-S1 — create/retire; the AI draft rides its own tighter cap below)
  translationAiDraft: { limit: 10, windowMs: 60 * 1000 }, // §26 machine-draft generations per IP (P9-S1 — a model call per request, the quickMockWrite precedent)
} as const
