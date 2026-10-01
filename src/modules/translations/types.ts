/**
 * GKSetu — Translations module: public types (P9-S1)
 * Master Plan §6 (Translation row), §18 (Translator/Localiser), §19 step 5
 * (localisation review), §26 (AI-assisted drafts with provenance + review
 * gates), §35 (translations reference canonical content, never duplicate
 * business identity), §36 (drift + immutable revisions), §37 (client-agnostic
 * DTOs), §38 (workspace scoping).
 */

/** The representation types a translation link can join (§23 reading formats). */
export type TranslationSourceTypePublic = 'CONTENT_ITEM' | 'QNA'

export const TRANSLATION_SOURCE_TYPES: readonly TranslationSourceTypePublic[] = [
  'CONTENT_ITEM',
  'QNA',
]

/**
 * The link's own lifecycle (§36 — recorded data, never a guess):
 * - DRAFT — the target representation is not published yet (work in progress)
 * - PUBLISHED — the target published, synced to the recorded source revision
 * - OUTDATED — the source published a newer revision after that sync (§36
 *   drift). The target is STILL published and public — an editorial freshness
 *   flag, never a visibility flag (§35 keeps exposing published translations)
 * - RETIRED — the link itself was retired; both content rows stand untouched
 */
export type TranslationStatusPublic = 'DRAFT' | 'PUBLISHED' | 'OUTDATED' | 'RETIRED'

export const TRANSLATION_STATUSES: readonly TranslationStatusPublic[] = [
  'DRAFT',
  'PUBLISHED',
  'OUTDATED',
  'RETIRED',
]

/** One end of a translation link, resolved to its representation. */
export interface TranslationEndpointDto {
  type: TranslationSourceTypePublic
  id: string
  /** §16-style label: `{unit-or-event-slug}/{language}/{format}`. */
  label: string
  languageCode: string
  /** The live revision's title (or question text) — display only. */
  title: string | null
  /** The representation's own §19 workflow status. */
  status: string
  /** The anchor's §14 country scope (null = GLOBAL anchor → platform workspace). */
  countryId: string | null
}

/** The §6 Translation row as a client-agnostic DTO (§37). */
export interface TranslationDto {
  id: string
  status: TranslationStatusPublic
  /** §26 AI-provenance — the target's working copy was machine-drafted. */
  aiAssisted: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  source: TranslationEndpointDto
  target: TranslationEndpointDto
  /** The target language (§6 "language" field). */
  language: { code: string; name: string; nativeName: string | null }
  /** The source revision the target is synced to (its last publish point). */
  sourceRevisionNumber: number
  /** The source's CURRENT live revision number (drift = live > synced). */
  sourceLiveRevisionNumber: number | null
  /** Derived drift (§36): the source moved past the sync point. */
  stale: boolean
}

/** List stats — the working surface's §32-shaped summary block. */
export interface TranslationStats {
  total: number
  byStatus: Record<TranslationStatusPublic, number>
  aiAssisted: number
  outdated: number
  /** Published cross-language representation pairs on the same anchor — the
   * translations that exist IN FACT (§35), whether or not a link tracks them. */
  publishedCrossLanguagePairs: number
  /** Active links whose target is published — the tracked subset. */
  trackedPublished: number
  note: string
}

/** Filters for the editorial list. */
export interface TranslationListFilters {
  status?: TranslationStatusPublic
  languageCode?: string
}

/** `POST /api/translations` body. */
export interface TranslationCreateInput {
  sourceType: TranslationSourceTypePublic
  sourceId: string
  languageCode: string
  notes?: string
}

/** `POST /api/translations/{id}/retire` body. */
export interface TranslationRetireInput {
  note?: string
}
