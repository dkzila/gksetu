/**
 * GKSetu — Knowledge module: canonical reading-page DTOs (P2-S5; the
 * exam-coverage layer filled in P3-S5)
 * Master Plan §22 (knowledge page: quick fact + deeper explanation + related
 * concepts + sources + exam coverage), §7 (one canonical record, many
 * representations — the page assembles, it never duplicates), §16 (canonical
 * URL generated from country + language + object identity, never from user
 * input), §23 (format-aware rendering — each format parses to its own shape;
 * never one unstructured blob), §24 (provenance surfaces with the page),
 * §35 (only actual published translations are exposed), §37 (client-agnostic
 * JSON — no HTML fragments; mobile-ready per §39).
 */

import type { ContentFormatPublic } from './content-types'
import type { SourceVerificationPublic } from './source-types'
import type { UnitExamRequirement } from '@/modules/exam-mapping'
import type { PublicPracticeLayer, PublicQnaLayer } from '@/modules/assessment'
import type { PageSeo, PageStructuredData } from '@/modules/seo'

/**
 * §22 layer order — the reading flow: the quick fact first, then the deeper
 * formats from most explanatory to most operational. FACT_CARD never appears
 * here: it IS the quick-fact layer.
 */
export const PAGE_FORMAT_ORDER: readonly ContentFormatPublic[] = [
  'EXPLAINER',
  'PROFILE',
  'COMPARISON',
  'TIMELINE',
  'REVISION_NOTE',
  'CURRENT_EVENT_UPDATE',
]

/** §22 quick-fact layer — the FACT_CARD representation when published,
 * otherwise the canonical summary (the record is always renderable). */
export interface QuickFactLayer {
  source: 'FACT_CARD' | 'CANONICAL_SUMMARY'
  title: string | null
  body: string
}

/** Format-aware parsed payloads (§23). Raw `body` always ships alongside —
 * clients may render it verbatim or use the structured view. */
export interface TimelineEntry {
  date: string
  event: string
}

export interface ComparisonRow {
  axis: string
  left: string
  right: string
}

export interface ProfileField {
  key: string
  value: string
}

export interface RepresentationParsed {
  /** TIMELINE — one event per "date — event" line (§23 convention). */
  timeline?: TimelineEntry[]
  /** COMPARISON — "axis | left | right" rows. */
  comparison?: ComparisonRow[]
  /** PROFILE — "key: value" fields. */
  profile?: ProfileField[]
}

/** One published representation rendered inside the page (§22 layer 2). */
export interface PageRepresentation {
  id: string
  format: ContentFormatPublic
  title: string
  body: string
  parsed: RepresentationParsed | null
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  /** §24/§26 — immutable AI-provenance snapshot of the live revision. */
  aiAssisted: boolean
  sourceCount: number
}

/** §24 sources layer — unique evidence aggregated across the displayed
 * representations, each with verification state and where it is cited. */
export interface PageSource {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: SourceVerificationPublic
  publishedAt: string | null
  retrievedAt: string
  verifiedAt: string | null
  claim: string | null
  /** Which displayed representations cite this evidence. */
  citedBy: { itemId: string; title: string; format: ContentFormatPublic }[]
}

/** §22 related-concepts layer — sibling VERIFIED units under the same topic. */
export interface RelatedUnit {
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  /** Language codes (country-configured) with ≥1 published representation —
   * the §35 "read it in…" signal for each related card. */
  availableLanguages: string[]
  /** §16 canonical path in the page's resolved language. */
  canonicalPath: string
}

/**
 * §22 QnA layer (P7-S1) — the practice step between learn (representations)
 * and revise (revision notes/mock tests): explanatory question-and-answer
 * entries anchored to this unit in the rendered language, ALWAYS live
 * revision snapshots (§36). Owned by the assessment module; the knowledge
 * page only assembles it (§7 — one canonical record, many representations).
 */
export type PageQnaLayer = PublicQnaLayer

/**
 * §22 scored practice layer (P7-S2) — the Question/Quiz layer after the
 * Q&A learning layer: published MCQs anchored to this unit in the rendered
 * language, ALWAYS live revision snapshots (§36) and NEVER carrying the
 * correctAnswer/explanation — those ship per-question through the practice
 * answer-check API after the learner answers (the §22 scored discipline).
 * Owned by the assessment module; the knowledge page only assembles it
 * (§7 — one canonical record, many representations).
 */
export type PagePracticeLayer = PublicPracticeLayer

/**
 * §22 exam-coverage layer — filled since P3-S5 from the §8 requirement layer
 * (the unit-side mirror of the exam coverage read): which exams need this
 * unit today, at what depth, under which syllabus topic. `available: false`
 * is the honest empty state — no live mapping points at this unit yet —
 * never a fabricated placeholder (the layer must never invent data before
 * ExamMapping says so, and it never has to again).
 */
export type ExamCoverageLayer =
  | { available: false; note: string }
  | {
      available: true
      /** One row per (exam × syllabus node) — a unit may anchor at several
       * nodes of one exam; every requirement stays visible. */
      requirements: UnitExamRequirement[]
      /** Distinct exams requiring this unit today. */
      examCount: number
    }

/** GET /api/knowledge/page/{ref} payload — the assembled §22 knowledge page. */
export interface KnowledgePage {
  /** The canonical record (§7) — language-neutral layers render from it. */
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    canonicalBody: string
    type: string
    difficulty: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    validity: { validFrom: string | null; validUntil: string | null }
    createdAt: string
    updatedAt: string
  }
  /** Breadcrumb context (§22) — the topic path from the public taxonomy. */
  topic: {
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    path: { slug: string; label: string }[]
  }
  quickFact: QuickFactLayer
  representations: PageRepresentation[]
  /** §22 QnA layer (P7-S1) — published Q&A entries for this unit in this
   * language; the honest empty note when none exist yet. */
  qna: PageQnaLayer
  /** §22 scored practice layer (P7-S2) — after the Q&A learning layer;
   * honest empty note when none exist yet. */
  practice: PagePracticeLayer
  sources: PageSource[]
  related: RelatedUnit[]
  examCoverage: ExamCoverageLayer
  /** §35 — the language this page rendered in (country-configured). */
  language: { code: string; name: string; nativeName: string | null }
  /** §35 — actual published translations of this unit in the country (the
   * hreflang-honest set; never planned/unpublished languages). */
  translations: {
    code: string
    name: string
    nativeName: string | null
    /** §16 canonical path of this page rendered in that language. */
    canonicalPath: string
    /** P9-S1 §36 drift honesty: this published translation's source moved
     * past the sync point — the original has been updated since this
     * translation. Still published, still public (§35); never a visibility
     * flag — an editorial freshness signal surfaced to the reader. */
    stale: boolean
    /** The tracked source's language when this translation carries an active
     * link (null = untracked representation). */
    sourceLanguageCode: string | null
  }[]
  /** §16 — canonical URL of THIS page (country + language + object identity). */
  canonicalPath: string
  /** §16 SEO block (P4-S4) — canonical, hreflang cluster (the published
   * translation set — the same §35 honesty as `translations`), robots, lastmod. */
  seo: PageSeo
  /** §16 structured-data graph (P4-S5) — Organization, WebSite,
   * BreadcrumbList + Article/LearningResource (educational schema, §16). */
  structuredData: PageStructuredData
  /** §19 — representations scheduled to go live (readable soon). */
  scheduledCount: number
}
