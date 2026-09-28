/**
 * GlobIQ — Current Affairs module: input validation (P6-S1)
 * Master Plan §12 (event-centric workflow), §14 (explicit scope), §16 (slug
 * hygiene — the router must never concatenate arbitrary user input), §24
 * (source provenance fields on aggregation), §30 (URL sanity), §37 (explicit
 * validation errors).
 */
import { z } from 'zod'

import { normalizeSourceUrl } from '@/modules/knowledge'
import { SOURCE_TYPES } from '@/modules/knowledge'

import {
  CURRENT_EVENT_LIFECYCLES,
  EVENT_SCOPES,
  type CurrentEventLifecyclePublic,
} from './types'

const CURRENT_EVENT_LIFECYCLE_ENUMS = CURRENT_EVENT_LIFECYCLES as [
  CurrentEventLifecyclePublic,
  ...CurrentEventLifecyclePublic[],
]

/** §16 URL-stable slug: kebab-case, latin letters/digits only. */
export const EVENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Accepts YYYY-MM-DD or full ISO-8601; refined to a Date in the service. */
const dateLike = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'Enter a valid date (YYYY-MM-DD or ISO)',
  })

/** One §12 step 2 source aggregated onto the event at create time — either a
 * new evidence registration (URL is the identity: deduped against the shared
 * Source registry) with event-level attribution. */
const initialSourceSchema = z.object({
  title: z.string().trim().min(3, 'Source title must be at least 3 characters').max(300),
  publisher: z.string().trim().min(2, 'Publisher must be at least 2 characters').max(200),
  url: z
    .string()
    .trim()
    .min(8, 'A source URL is required')
    .max(2000)
    .refine((value) => normalizeSourceUrl(value) !== null, {
      message: 'Enter a valid http(s) URL',
    }),
  type: z.enum(SOURCE_TYPES),
  /** §24 when the underlying material was published. */
  publishedAt: dateLike.optional(),
  /** Event-level attribution: what this source adds. */
  note: z.string().trim().max(500).optional(),
  /** Mark as the lead evidence (at most one initial source may be primary). */
  isPrimary: z.boolean().optional(),
})

export const createCurrentEventSchema = z
  .object({
    title: z.string().trim().min(5, 'Title must be at least 5 characters').max(300),
    /** Optional — generated from the title when omitted (§16 hygiene enforced
     *  server-side regardless: the pattern above, uniqueness, immutability). */
    slug: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(EVENT_SLUG_PATTERN, 'Slug must be kebab-case (a-z, 0-9, hyphens)')
      .optional(),
    eventDate: dateLike,
    eventEndDate: dateLike.optional(),
    location: z.string().trim().max(200).optional(),
    summary: z
      .string()
      .trim()
      .min(10, 'Summary must be at least 10 characters')
      .max(2000),
    significance: z.string().trim().max(2000).optional(),
    /** §13 primary canonical topic slug. */
    topic: z.string().trim().min(1, 'Pick the primary topic'),
    /** §14 explicit scope — GLOBAL (world-relevant, ADMIN-managed) or COUNTRY. */
    scope: z.enum(EVENT_SCOPES).default('GLOBAL'),
    /** ISO code — required for ADMIN-created COUNTRY events; a COUNTRY_ADMIN's
     *  own home country may be implied (the knowledge precedent, resolved by
     *  the service). GLOBAL events must never carry one. */
    country: z
      .string()
      .trim()
      .length(2, 'Country must be an ISO 3166-1 alpha-2 code')
      .transform((value) => value.toUpperCase())
      .optional(),
    notes: z.string().trim().max(2000).optional(),
    /** §12 step 2: aggregate initial evidence in the same create call — the
     *  breaking-news flow (create the event from its first source). */
    initialSources: z.array(initialSourceSchema).max(10).optional(),
  })
  .refine((data) => data.scope !== 'GLOBAL' || !data.country, {
    message: 'Global events cannot carry a country ISO code',
    path: ['country'],
  })
  .refine(
    (data) =>
      !data.eventEndDate || new Date(data.eventEndDate).getTime() >= new Date(data.eventDate).getTime(),
    { message: 'The span end cannot be before the event date', path: ['eventEndDate'] }
  )
  .refine(
    (data) =>
      !data.initialSources ||
      data.initialSources.filter((source) => source.isPrimary).length <= 1,
    {
      message: 'At most one initial source can be marked primary',
      path: ['initialSources'],
    }
  )

export type CreateCurrentEventInput = z.infer<typeof createCurrentEventSchema>

/** Metadata edits (§36: audited, slug immutable). Scope/country are part of
 *  the event's §14 identity and never patchable — a mis-scoped event is
 *  corrected by archiving and recreating, keeping the trail honest. */
export const updateCurrentEventSchema = z
  .object({
    title: z.string().trim().min(5).max(300).optional(),
    eventDate: dateLike.optional(),
    eventEndDate: dateLike.nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    summary: z.string().trim().min(10).max(2000).optional(),
    significance: z.string().trim().max(2000).nullable().optional(),
    /** Primary topic re-anchoring (§12 step 3 is normally additive, but the
     *  primary topic may need correcting — audited like every edit). */
    topic: z.string().trim().min(1).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  })

export type UpdateCurrentEventInput = z.infer<typeof updateCurrentEventSchema>

/** §12 step 6 lifecycle transition — target-state form (the state machine
 *  validates the edge server-side; no arbitrary action vocabulary needed). */
export const currentEventTransitionSchema = z.object({
  to: z.enum(CURRENT_EVENT_LIFECYCLE_ENUMS),
  /** Why the transition happened — recommended, always stored in the audit
   *  metadata when present (§36 corrections are never silent). */
  reason: z.string().trim().max(1000).optional(),
})

export type CurrentEventTransitionInput = z.infer<typeof currentEventTransitionSchema>

/** §12 step 2 aggregation: cite an EXISTING source id, or register new
 *  evidence by URL (deduped — an already-registered URL reuses its record). */
export const attachEventSourceSchema = z
  .object({
    /** Existing shared-registry Source id. */
    source: z.string().trim().min(1).optional(),
    /** New evidence registration (ignored when `source` is given). */
    title: z.string().trim().min(3).max(300).optional(),
    publisher: z.string().trim().min(2).max(200).optional(),
    url: z
      .string()
      .trim()
      .min(8)
      .max(2000)
      .refine((value) => normalizeSourceUrl(value) !== null, {
        message: 'Enter a valid http(s) URL',
      })
      .optional(),
    type: z.enum(SOURCE_TYPES).optional(),
    publishedAt: dateLike.optional(),
    /** Event-level attribution: what this source adds. */
    note: z.string().trim().max(500).optional(),
    /** Mark as the lead evidence — swaps the existing primary (service-side). */
    isPrimary: z.boolean().optional(),
  })
  .refine(
    (data) =>
      !!data.source ||
      (!!data.title && !!data.publisher && !!data.url && !!data.type),
    {
      message:
        'Either cite an existing source id, or provide the full new evidence (title, publisher, URL, type)',
      path: ['source'],
    }
  )

export type AttachEventSourceInput = z.infer<typeof attachEventSourceSchema>

export const updateEventSourceLinkSchema = z.object({
  note: z.string().trim().max(500).nullable().optional(),
  isPrimary: z.boolean().optional(),
})

export type UpdateEventSourceLinkInput = z.infer<typeof updateEventSourceLinkSchema>

/** §12 step 3: link a canonical KnowledgeUnit by slug (VERIFIED only). */
export const attachEventKnowledgeUnitSchema = z.object({
  unit: z.string().trim().min(1, 'Pick a knowledge unit to link'),
  note: z.string().trim().max(500).optional(),
})

export type AttachEventKnowledgeUnitInput = z.infer<typeof attachEventKnowledgeUnitSchema>

/** P6-S3 §12 step 3: link an Entity by slug (ACTIVE only — the §36 rule). */
export const attachEventEntitySchema = z.object({
  entity: z.string().trim().min(1, 'Pick an entity to link'),
  note: z.string().trim().max(500).optional(),
})

export type AttachEventEntityInput = z.infer<typeof attachEventEntitySchema>

/** P6-S3 §12 step 3: cross-file the event under an additional topic. */
export const attachEventTopicSchema = z.object({
  topic: z.string().trim().min(1, 'Pick a topic to file under'),
  note: z.string().trim().max(500).optional(),
})

export type AttachEventTopicInput = z.infer<typeof attachEventTopicSchema>

export const adminCurrentEventListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  lifecycle: z.enum(CURRENT_EVENT_LIFECYCLE_ENUMS).optional(),
  scope: z.enum(EVENT_SCOPES).optional(),
  /** ISO code filter (COUNTRY events of one market). */
  country: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .optional(),
  /** Topic slug filter. */
  topic: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminCurrentEventListQuery = z.infer<typeof adminCurrentEventListQuerySchema>

/** P6-S4 §12 step 5: the exam-aware feed query. `exam` selects the PUBLIC
 * single-exam mode (no auth); without it the feed is the caller's §9
 * COMBINED view — goal exams ∪ followed exams — and the route enforces a
 * Bearer token. `lifecycle` LIVE = emerging/developing/stable (§12 step 6);
 * ALL adds ARCHIVED for the historical view (P6-S5 formalizes archive
 * windows). */
export const feedQuerySchema = z.object({
  country: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
  /** Single-exam mode — public ref (slug or canonical id) of the exam whose
   * syllabus the feed is matched against (§37 ref convention). */
  exam: z.string().trim().min(1, 'Pick an exam').max(120).optional(),
  lifecycle: z.enum(['LIVE', 'ALL']).default('LIVE'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(25).default(10),
})

export type FeedQuery = z.infer<typeof feedQuerySchema>

/** P6-S5 §12 step 6/§19: the freshness sweep body. Dry-run is the SAFE
 *  DEFAULT — applying the rules is always an explicit choice (§36). */
export const freshnessSweepSchema = z.object({
  dryRun: z.boolean().default(true),
})

export type FreshnessSweepInput = z.infer<typeof freshnessSweepSchema>
