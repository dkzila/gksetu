/**
 * GKSetu — Current Affairs module: the public event-page DTOs (P6-S2)
 * Master Plan §12 (the event is the canonical record; its representations
 * render it), §16 (the /current-affairs/{slug}/ canonical page), §22 (the
 * reading experience: what happened, why it matters, the sources, the
 * canonical knowledge it touches), §24 (aggregated evidence + per-item
 * citations, verification states intact), §35 (only the country's configured
 * languages; only ACTUAL published translations offered), §36 (revisions with
 * change summaries — corrections are never silent), §37 (client-agnostic
 * DTOs, deterministic ordering).
 */

import type { CurrentEventLifecyclePublic, EventScopePublic, FreshnessInfo } from './types'
import type { EventExamRelevance } from './feed-types'
import type { PageSeo, JsonLdNode } from '@/modules/seo'

/** One published representation on the event page — ALWAYS the live revision. */
export interface EventPageRepresentation {
  id: string
  format: string
  title: string
  body: string
  revision: {
    number: number
    publishedAt: string
    /** §36 provenance — why this revision exists (null on first publish). */
    changeSummary: string | null
  }
  /** §24/§26 — the live revision's AI-provenance snapshot. */
  aiAssisted: boolean
  /** §24 — evidence links on this representation (details in the page's
   * sources layer, cross-referenced by id). */
  sourceCount: number
}

/** §24 transparency: one evidence record on the event page — the §12 step 2
 * aggregated event evidence, plus any citations from displayed
 * representations (both surfaces point at the SAME shared Source registry). */
export interface EventPageSource {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: string
  publishedAt: string | null
  retrievedAt: string
  verifiedAt: string | null
  /** §12 step 2 — the editorial note on the aggregated event evidence. */
  eventNote: string | null
  isPrimary: boolean
  /** Which displayed representations cite this evidence (§24 attribution). */
  citedBy: Array<{ representationId: string; title: string; format: string }>
  /** §24 claim-level attribution when cited by a representation. */
  claim: string | null
}

/** §12 step 3 / §7: one linked canonical KnowledgeUnit — the one-truth links. */
export interface EventPageUnit {
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  /** §16 knowledge-page path (…/gk/{topic}/{unit}/) in the reader's language. */
  canonicalPath: string
  topicSlug: string
}

/** P6-S3 §12 step 3: one linked Entity — who/what the event is about. The
 * §6 vocabulary (person/place/organisation/concept) renders as a chip; a
 * RETIRED entity still renders (its links are honest history, §36). */
export interface EventPageEntity {
  slug: string
  canonicalName: string
  description: string | null
  type: 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
  status: 'ACTIVE' | 'RETIRED'
  /** §14 — null = a GLOBAL (world-reference) entity. */
  countryIso: string | null
  /** The editorial note on the link ("the landing agency"). */
  note: string | null
}

/** P6-S3 §12 step 3: an additional-topic cross-filing beyond the primary. */
export interface EventPageTopicRef {
  slug: string
  canonicalName: string
  /** §13 label in the reader's language when one exists. */
  label: string
  /** §16 topic-landing path in the reader's language. */
  canonicalPath: string
}

/** GET /api/current-affairs/page/{ref} payload. */
export interface CurrentEventPage {
  event: {
    slug: string
    title: string
    eventDate: string
    eventEndDate: string | null
    location: string | null
    summary: string
    significance: string | null
    lifecycleState: CurrentEventLifecyclePublic
    /** P6-S5 §17 — the server-computed freshness verdict (age from §6 event_date). */
    freshness: FreshnessInfo
    scope: EventScopePublic
    topic: { slug: string; canonicalName: string; label: string }
    /** §13 breadcrumb trail (Home → …topic) with §16 paths. */
    topicPath: Array<{ slug: string; label: string }>
  }
  /** Published representations in the RESOLVED language (live revisions). */
  representations: EventPageRepresentation[]
  /** §35: 'reader_language' = representations render; 'canonical_fallback' =
   * the event record renders alone (honest note, never a fake translation). */
  presentedFrom: 'reader_language' | 'canonical_fallback'
  /** §35 translation surface — country languages with published content. */
  translations: Array<{
    code: string
    name: string
    nativeName: string | null
    canonicalPath: string
  }>
  sources: EventPageSource[]
  knowledgeUnits: EventPageUnit[]
  /** P6-S3 §12 step 3 — who/what this event is about (entity chips). */
  entities: EventPageEntity[]
  /** P6-S3 §12 step 3 — additional-topic cross-filings beyond the primary. */
  additionalTopics: EventPageTopicRef[]
  language: { code: string; name: string; nativeName: string | null }
  /** §16 canonical path of THIS page (in the resolved language). */
  canonicalPath: string
  seo: PageSeo
  structuredData: { graph: JsonLdNode[] }
  /** §19: scheduled representations pending release for this event. */
  scheduledCount: number
  /** P6-S4 §12 step 5 — which exam syllabi this event feeds: the reader
   * market's ACTIVE public exams whose in-effect version anchors the
   * event's topics (§13 node links) or maps its VERIFIED-linked units (§8
   * mappings). Capped + deterministic (§37). */
  examRelevance: EventExamRelevance
}
