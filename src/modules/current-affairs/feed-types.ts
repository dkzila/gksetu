/**
 * GlobIQ — Current Affairs module: the exam-aware feed DTOs (P6-S4)
 * Master Plan §12 step 5 (current-affairs knowledge flows "into a followed
 * exam's combined queue the moment it's mapped" — these DTOs are that
 * flow's feed surface), §9 (explainable: every item carries a reason
 * rendered verbatim), §10 (follows + the declared goal drive the combined
 * mode; saves never appear), §11 (single-exam mode is the same matching
 * with one exam), §14 (GLOBAL or reader-country events only), §16 (the
 * /current-affairs/{slug}/ canonical path shipped as data), §35 (only the
 * reader country's configured languages; PUBLISHED representations are the
 * public gate), §36 (honest lifecycle — ARCHIVED stays out of LIVE), §37
 * (client-agnostic JSON, deterministic ordering), §39 (the same payload a
 * mobile app renders).
 */
import type { CurrentEventLifecyclePublic, EventScopePublic } from './types'

/** One feed item — ready to render (§37): the event's canonical record, its
 * §16 path, the exams it feeds with their syllabus anchors, the §9 reason,
 * and the §35 published-language surface. */
export interface ExamFeedItem {
  slug: string
  title: string
  /** ISO-8601 dates (§6 event_date / optional span end). */
  eventDate: string
  eventEndDate: string | null
  location: string | null
  summary: string
  significance: string | null
  lifecycleState: CurrentEventLifecyclePublic
  scope: EventScopePublic
  /** §14 market of a COUNTRY event (null = GLOBAL). */
  countryIso: string | null
  /** The event's §13 primary topic with its §35 label (reader language →
   * canonical name fallback). */
  topic: { slug: string; canonicalName: string; label: string }
  /** The contributing exams this event feeds (deduped, slug-sorted). */
  matchedExams: Array<{ slug: string; name: string; code: string }>
  /** Where each exam's syllabus anchors the match — a §13 syllabus-node
   * topic link or a §8 canonical-unit mapping. Deduped by
   * examSlug+nodeName+matchVia, deterministically sorted. */
  syllabusAnchors: Array<{
    examSlug: string
    examName: string
    nodeName: string
    matchVia: 'TOPIC' | 'KNOWLEDGE_UNIT'
  }>
  /** §9 explanation — a complete sentence, renderable verbatim on any
   * client (e.g. "Mapped to SSC CGL — Current affairs"). */
  reason: string
  /** §35: sorted ISO codes of the PUBLISHED representations in the reader
   * country's language set (the honest language surface). */
  languages: string[]
  /** How many published representations matched that language set. */
  representationCount: number
  /** §16 canonical event-page path in the resolved language. */
  canonicalPath: string
}

/** GET /api/current-affairs/feed payload. EXAM mode = one public exam's
 * view (no auth); COMBINED mode = the caller's §9 exam scope (goal ∪
 * follows, home market only, Bearer-authenticated). */
export interface ExamAwareFeed {
  mode: 'EXAM' | 'COMBINED'
  /** EXAM mode: the single resolved exam. Null in COMBINED mode. */
  exam: { slug: string; name: string; code: string } | null
  /** COMBINED mode: the contributing exams (goal ∪ follows, §9). Empty in
   * EXAM mode (the single exam lives in `exam`). */
  exams: Array<{ slug: string; name: string; code: string }>
  /** §14 market the feed ran in. */
  readerCountryIso: string
  items: ExamFeedItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  /** Honest empty-state note (§36) — set when there is nothing to show. */
  note: string | null
}

/** P6-S4 §12 step 5 (reverse direction): which exam syllabi ONE event
 * feeds — the public event page's exam-relevance layer. Capped at the §37
 * sane payload size (6 exams, deterministic name → slug order). */
export interface EventExamRelevance {
  exams: Array<{
    slug: string
    name: string
    code: string
    /** The syllabus anchors connecting this exam to the event (deduped,
     * node-name sorted). */
    anchors: Array<{
      nodeName: string
      matchVia: 'TOPIC' | 'KNOWLEDGE_UNIT'
      /** The mapped canonical unit's slug (KNOWLEDGE_UNIT matches only). */
      unitSlug: string | null
    }>
  }>
}
