/**
 * GlobIQ — Translations module: domain service (P9-S1)
 * Master Plan §6 (the Translation row), §18 (Translator/Localiser — manage
 * translations, scope-limited by country + target language), §19 step 5
 * (the localisation review gate rides the workflow), §26 (AI-assisted
 * translation drafts: provenance + human review gates, never silent), §35
 * (translations reference canonical content — the target is a full
 * first-class representation of the SAME anchor, never duplicated business
 * identity; only country-configured target languages, never a global
 * language list), §36 (drift: a source's newer revision out-dates its
 * synced translations; corrections ride the normal revision cycle), §37
 * (client-agnostic DTOs + explicit errors), §38 (workspace scoping — the
 * anchor's §14 country scope decides the workspace, GLOBAL anchors are the
 * platform/ADMIN workspace), §30 (every mutation audited).
 *
 * Module direction (§28): this module imports only the shared leaves
 * (db/permissions/audit) — the knowledge/assessment/editorial modules call
 * INTO it (publish hooks, the §19 step-5 gate, the render-service staleness
 * join), never the other way around. The target representations are created
 * directly over the Prisma models (the working copy is seeded from the
 * source's live revision — already format-valid by construction).
 */
import { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
} from '@/modules/audit'

import type {
  TranslationCreateInput,
  TranslationDto,
  TranslationEndpointDto,
  TranslationListFilters,
  TranslationSourceTypePublic,
  TranslationStats,
  TranslationStatusPublic,
} from './types'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type TranslationErrorCode =
  | 'TRANSLATION_NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_NOT_PUBLISHED'
  | 'TARGET_LANGUAGE_NOT_FOUND'
  | 'TARGET_LANGUAGE_NOT_CONFIGURED'
  | 'TRANSLATION_EXISTS'
  | 'TARGET_REPRESENTATION_EXISTS'
  | 'TRANSLATION_NOT_DRAFT'
  | 'TARGET_NOT_DRAFT'
  | 'TRANSLATION_ALREADY_RETIRED'
  | 'TRANSLATION_AI_UNAVAILABLE'

const ERROR_STATUS: Record<TranslationErrorCode, number> = {
  TRANSLATION_NOT_FOUND: 404,
  SOURCE_NOT_FOUND: 404,
  SOURCE_NOT_PUBLISHED: 400,
  TARGET_LANGUAGE_NOT_FOUND: 404,
  TARGET_LANGUAGE_NOT_CONFIGURED: 400,
  TRANSLATION_EXISTS: 409,
  TARGET_REPRESENTATION_EXISTS: 409,
  TRANSLATION_NOT_DRAFT: 409,
  TARGET_NOT_DRAFT: 409,
  TRANSLATION_ALREADY_RETIRED: 409,
  TRANSLATION_AI_UNAVAILABLE: 503,
}

export class TranslationError extends Error {
  readonly code: TranslationErrorCode
  readonly status: number

  constructor(code: TranslationErrorCode, message: string) {
    super(message)
    this.name = 'TranslationError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown TranslationError to envelope data (§37); null otherwise. */
export function toTranslationErrorResponse(
  error: unknown
): { message: string; code: TranslationErrorCode; status: number } | null {
  if (error instanceof TranslationError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

/** Request context captured in the audit trail (§30). */
export interface TranslationRequestMeta {
  ip?: string | null
  userAgent?: string | null
}

// ---------- Representation resolution (both link ends) ----------

/** The resolved shape of one link end — shared with the server-only
 * ./ai-service (§26 model call, kept out of every client-reachable graph). */
export interface ResolvedRepresentation {
  id: string
  type: TranslationSourceTypePublic
  languageCode: string
  languageId: string
  /** §16-style label: `{anchor-slug}/{language}/{format-or-QnA}`. */
  label: string
  /** The working-copy title (or question text) — display only. */
  title: string
  status: string
  /** The anchor's §14 country scope (null = GLOBAL → platform workspace). */
  countryId: string | null
  /** The anchor ids for target creation. */
  knowledgeUnitId: string | null
  currentEventId: string | null
  format: string | null
  /** The live revision (the published truth a translation works from). */
  liveRevisionNumber: number | null
  liveTitle: string | null
  liveBody: string | null
  anchorSlug: string
}

type ContentRow = Prisma.ContentItemGetPayload<{
  include: {
    language: true
    knowledgeUnit: { select: { slug: true; scope: true; countryId: true } }
    currentEvent: { select: { slug: true; countryId: true } }
    publishedRevision: { select: { revisionNumber: true; title: true; body: true } }
  }
}>

type QnaRow = Prisma.QnAGetPayload<{
  include: {
    language: true
    knowledgeUnit: { select: { slug: true; scope: true; countryId: true } }
    publishedRevision: { select: { revisionNumber: true; questionText: true; answerBody: true } }
  }
}>

function resolveContentItem(row: ContentRow): ResolvedRepresentation {
  const unit = row.knowledgeUnit
  const event = row.currentEvent
  const anchorSlug = unit?.slug ?? event?.slug ?? 'unknown'
  return {
    id: row.id,
    type: 'CONTENT_ITEM',
    languageCode: row.language.code,
    languageId: row.languageId,
    label: `${anchorSlug}/${row.language.code}/${row.format}`,
    title: row.title,
    status: row.status,
    countryId: unit ? (unit.scope === 'COUNTRY' ? unit.countryId : null) : event?.countryId ?? null,
    knowledgeUnitId: row.knowledgeUnitId,
    currentEventId: row.currentEventId,
    format: row.format,
    liveRevisionNumber: row.publishedRevision?.revisionNumber ?? null,
    liveTitle: row.publishedRevision?.title ?? null,
    liveBody: row.publishedRevision?.body ?? null,
    anchorSlug,
  }
}

function resolveQna(row: QnaRow): ResolvedRepresentation {
  const unit = row.knowledgeUnit
  return {
    id: row.id,
    type: 'QNA',
    languageCode: row.language.code,
    languageId: row.languageId,
    label: `${unit?.slug ?? 'unknown'}/${row.language.code}/QnA`,
    title: row.questionText,
    status: row.status,
    countryId: unit ? (unit.scope === 'COUNTRY' ? unit.countryId : null) : null,
    knowledgeUnitId: row.knowledgeUnitId,
    currentEventId: null,
    format: null,
    liveRevisionNumber: row.publishedRevision?.revisionNumber ?? null,
    liveTitle: row.publishedRevision?.questionText ?? null,
    liveBody: row.publishedRevision?.answerBody ?? null,
    anchorSlug: unit?.slug ?? 'unknown',
  }
}

const CONTENT_INCLUDE = {
  language: true,
  knowledgeUnit: { select: { slug: true, scope: true, countryId: true } },
  currentEvent: { select: { slug: true, countryId: true } },
  publishedRevision: { select: { revisionNumber: true, title: true, body: true } },
} satisfies Prisma.ContentItemInclude

const QNA_INCLUDE = {
  language: true,
  knowledgeUnit: { select: { slug: true, scope: true, countryId: true } },
  publishedRevision: { select: { revisionNumber: true, questionText: true, answerBody: true } },
} satisfies Prisma.QnAInclude

async function resolveRepresentationsImpl(
  type: TranslationSourceTypePublic,
  ids: string[]
): Promise<Map<string, ResolvedRepresentation>> {
  const map = new Map<string, ResolvedRepresentation>()
  if (ids.length === 0) return map
  if (type === 'CONTENT_ITEM') {
    const rows = await db.contentItem.findMany({ where: { id: { in: ids } }, include: CONTENT_INCLUDE })
    for (const row of rows) map.set(row.id, resolveContentItem(row))
  } else {
    const rows = await db.qnA.findMany({ where: { id: { in: ids } }, include: QNA_INCLUDE })
    for (const row of rows) map.set(row.id, resolveQna(row))
  }
  return map
}

function endpointOf(row: ResolvedRepresentation): TranslationEndpointDto {
  return {
    type: row.type,
    id: row.id,
    label: row.label,
    languageCode: row.languageCode,
    title: row.title,
    status: row.status,
    countryId: row.countryId,
  }
}

type TranslationRow = Prisma.TranslationGetPayload<{
  include: {
    language: true
    createdBy: { select: { id: true; email: true; name: true } }
  }
}>

function dtoOf(
  link: TranslationRow,
  source: ResolvedRepresentation | undefined,
  target: ResolvedRepresentation | undefined
): TranslationDto {
  const stale =
    !!source &&
    source.liveRevisionNumber != null &&
    source.liveRevisionNumber > link.sourceRevisionNumber
  return {
    id: link.id,
    status: link.status as TranslationStatusPublic,
    aiAssisted: link.aiAssisted,
    notes: link.notes,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    source: source
      ? endpointOf(source)
      : {
          type: link.sourceContentType as TranslationSourceTypePublic,
          id: link.sourceContentId,
          label: `${link.sourceContentType === 'QNA' ? 'qna' : 'content'}/${link.sourceContentId}`,
          languageCode: '?',
          title: null,
          status: 'UNKNOWN',
          countryId: null,
        },
    target: target
      ? endpointOf(target)
      : {
          type: link.targetContentType as TranslationSourceTypePublic,
          id: link.targetContentId,
          label: `${link.targetContentType === 'QNA' ? 'qna' : 'content'}/${link.targetContentId}`,
          languageCode: link.language.code,
          title: null,
          status: 'UNKNOWN',
          countryId: null,
        },
    language: {
      code: link.language.code,
      name: link.language.name,
      nativeName: link.language.nativeName,
    },
    sourceRevisionNumber: link.sourceRevisionNumber,
    sourceLiveRevisionNumber: source?.liveRevisionNumber ?? null,
    stale,
  }
}

// ---------- The list (the §18 Translator/Localiser working surface) ----------

export async function listTranslations(
  actor: Actor,
  filters: TranslationListFilters = {}
): Promise<{ translations: TranslationDto[]; stats: TranslationStats }> {
  const links = await db.translation.findMany({
    where: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.languageCode ? { language: { code: filters.languageCode } } : {}),
    },
    include: { language: true, createdBy: { select: { id: true, email: true, name: true } } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
  })

  const sourceIds = { CONTENT_ITEM: [] as string[], QNA: [] as string[] }
  const targetIds = { CONTENT_ITEM: [] as string[], QNA: [] as string[] }
  for (const link of links) {
    sourceIds[link.sourceContentType as TranslationSourceTypePublic].push(link.sourceContentId)
    targetIds[link.targetContentType as TranslationSourceTypePublic].push(link.targetContentId)
  }
  const sources = new Map<string, ResolvedRepresentation>()
  const targets = new Map<string, ResolvedRepresentation>()
  for (const type of ['CONTENT_ITEM', 'QNA'] as const) {
    for (const [id, row] of await resolveRepresentations(type, sourceIds[type])) {
      sources.set(`${type}:${id}`, row)
    }
    for (const [id, row] of await resolveRepresentations(type, targetIds[type])) {
      targets.set(`${type}:${id}`, row)
    }
  }

  let dtos = links.map((link) =>
    dtoOf(
      link,
      sources.get(`${link.sourceContentType}:${link.sourceContentId}`),
      targets.get(`${link.targetContentType}:${link.targetContentId}`)
    )
  )

  // §38 workspace scoping: the anchor's country decides the workspace — a
  // COUNTRY_ADMIN/WRITER sees their country's links; GLOBAL anchors (null)
  // are the platform workspace, ADMIN-only (the §13/§20 parity rule).
  if (actor.role !== 'ADMIN') {
    dtos = dtos.filter((dto) => dto.target.countryId != null && dto.target.countryId === actor.countryId)
  }

  // The §32-shaped stats block over the SCOPED view.
  const byStatus: Record<TranslationStatusPublic, number> = {
    DRAFT: 0,
    PUBLISHED: 0,
    OUTDATED: 0,
    RETIRED: 0,
  }
  let aiAssisted = 0
  let outdated = 0
  let trackedPublished = 0
  for (const dto of dtos) {
    byStatus[dto.status] += 1
    if (dto.aiAssisted) aiAssisted += 1
    if (dto.stale) outdated += 1
    if (dto.status === 'PUBLISHED') trackedPublished += 1
  }

  // Cross-language equivalents IN FACT (§35): published ContentItems sharing
  // an anchor + format across ≥2 languages — whether or not a link tracks
  // them. The tracked-vs-fact pair is the framework-adoption honesty.
  const groups = await db.contentItem.groupBy({
    by: ['knowledgeUnitId', 'currentEventId', 'format', 'languageId'],
    where: { status: 'PUBLISHED', publishedRevisionId: { not: null } },
    _count: { _all: true },
  })
  const anchorLanguages = new Map<string, Set<string>>()
  for (const group of groups) {
    const key = `${group.knowledgeUnitId ?? 'e'}:${group.currentEventId ?? 'u'}:${group.format}`
    const set = anchorLanguages.get(key) ?? new Set<string>()
    set.add(group.languageId)
    anchorLanguages.set(key, set)
  }
  let publishedCrossLanguagePairs = 0
  for (const languages of anchorLanguages.values()) {
    if (languages.size >= 2) {
      publishedCrossLanguagePairs += (languages.size * (languages.size - 1)) / 2
    }
  }

  const stats: TranslationStats = {
    total: dtos.length,
    byStatus,
    aiAssisted,
    outdated,
    publishedCrossLanguagePairs,
    trackedPublished,
    note: 'Translations reference canonical content (§35): the target is a full representation of the same KnowledgeUnit/event — never duplicated business identity. OUTDATED is an editorial freshness flag (the source moved past the sync point, §36), never a visibility flag. AI-assisted drafts (§26) carry provenance and must clear the §19 review gates before they can go live — never silently published.',
  }

  return { translations: dtos, stats }
}

// ---------- Create: open a translation project (§18/§35) ----------

export async function createTranslation(
  actor: Actor,
  input: TranslationCreateInput,
  meta: TranslationRequestMeta = {}
): Promise<TranslationDto> {
  // Resolve + guard the SOURCE first: a translation always works FROM a
  // published revision (§24/§36 — the source of truth, never a draft).
  const sourceMap = await resolveRepresentations(input.sourceType, [input.sourceId])
  const source = sourceMap.get(input.sourceId)
  if (!source) {
    throw new TranslationError('SOURCE_NOT_FOUND', 'The source representation was not found')
  }
  if (source.status !== 'PUBLISHED' || source.liveRevisionNumber == null) {
    throw new TranslationError(
      'SOURCE_NOT_PUBLISHED',
      'Translations start from a PUBLISHED source revision (§36) — publish the source first'
    )
  }

  // Resolve the TARGET language (§35: only the anchor country's configured
  // languages — never a global language list).
  const language = await db.language.findUnique({ where: { code: input.languageCode } })
  if (!language || language.status !== 'ACTIVE') {
    throw new TranslationError('TARGET_LANGUAGE_NOT_FOUND', `Language "${input.languageCode}" is not an active platform language`)
  }
  if (language.id === source.languageId) {
    throw new TranslationError(
      'TARGET_LANGUAGE_NOT_CONFIGURED',
      'The target language must differ from the source language — a same-language link is not a translation'
    )
  }
  // The anchor's market: the unit's country when COUNTRY-scoped, else the
  // platform's default market (GLOBAL anchors render under every market's
  // configured languages; the default market is the v1 workspace — P9-S5
  // extends this to per-market workspaces).
  const anchorCountryId =
    source.countryId ??
    (await db.country.findFirst({ where: { isDefault: true }, select: { id: true } }))?.id ??
    null
  if (!anchorCountryId) {
    throw new TranslationError('TARGET_LANGUAGE_NOT_CONFIGURED', 'No default market is configured for global content')
  }
  const configured = await db.countryLanguage.findUnique({
    where: { countryId_languageId: { countryId: anchorCountryId, languageId: language.id } },
    select: { id: true },
  })
  if (!configured) {
    throw new TranslationError(
      'TARGET_LANGUAGE_NOT_CONFIGURED',
      `§35: the anchor's market does not expose "${language.code}" — a translation may never create a language URL the country does not support`
    )
  }

  // §20/§38: the mutation scope is the TARGET (the representation being
  // created) — country + language narrowing for COUNTRY_ADMIN/WRITER.
  assertCan(actor, 'translations:manage', { countryId: source.countryId, languageId: language.id })

  // One ACTIVE link per (source, language) — the §7/§11 no-duplication rule
  // (a second Hindi translation of the same English item is duplication).
  const existingLink = await db.translation.findFirst({
    where: {
      sourceContentType: input.sourceType,
      sourceContentId: source.id,
      languageId: language.id,
      status: { not: 'RETIRED' },
    },
    select: { id: true },
  })
  if (existingLink) {
    throw new TranslationError(
      'TRANSLATION_EXISTS',
      'An active translation into this language already exists for this source (one per source and language, §7)'
    )
  }

  // One ACTIVE link per target — a target's declared source is singular.
  if (input.sourceType === 'CONTENT_ITEM') {
    const existingRepresentation = await db.contentItem.findFirst({
      where: {
        ...(source.knowledgeUnitId ? { knowledgeUnitId: source.knowledgeUnitId } : {}),
        ...(source.currentEventId ? { currentEventId: source.currentEventId } : {}),
        languageId: language.id,
        ...(source.format ? { format: source.format as Prisma.EnumContentFormatFilter['equals'] } : {}),
      },
      select: { id: true },
    })
    if (existingRepresentation) {
      throw new TranslationError(
        'TARGET_REPRESENTATION_EXISTS',
        'A representation already exists in this language for the same anchor and format (§7 — one representation per anchor/language/format); retire or translate it through the normal correction cycle instead'
      )
    }
  }

  // Defensive: a ContentItem source always carries its format (§23); fail
  // closed rather than create a malformed target.
  if (input.sourceType === 'CONTENT_ITEM' && !source.format) {
    throw new TranslationError('SOURCE_NOT_FOUND', 'The source representation is malformed (no format)')
  }

  // Create the target representation (DRAFT) + the link in ONE transaction.
  // The working copy is SEEDED with the source's live revision text — the
  // translator translates in place (the CAT-tool convention); the §19 gates
  // (editorial + localisation review) catch untranslated residue before it
  // can ever go live. A QnA target may still collide with the (unit,
  // language, questionText) unique — mapped to the same honest 409.
  let created: { link: TranslationRow; targetId: string }
  try {
    created = await db.$transaction(async (tx) => {
    let targetId: string
    if (input.sourceType === 'CONTENT_ITEM') {
      const item = await tx.contentItem.create({
        data: {
          knowledgeUnitId: source.knowledgeUnitId,
          currentEventId: source.currentEventId,
          languageId: language.id,
          format: source.format as ContentFormatValue,
          status: 'DRAFT',
          title: source.liveTitle ?? source.title,
          body: source.liveBody ?? '',
          aiAssisted: false,
          createdById: actor.userId,
        },
      })
      targetId = item.id
    } else {
      const qna = await tx.qnA.create({
        data: {
          knowledgeUnitId: source.knowledgeUnitId!,
          languageId: language.id,
          status: 'DRAFT',
          questionText: source.liveTitle ?? source.title,
          answerBody: source.liveBody ?? '',
          aiAssisted: false,
          createdById: actor.userId,
        },
      })
      targetId = qna.id
    }
    const link = await tx.translation.create({
      data: {
        sourceContentType: input.sourceType,
        sourceContentId: source.id,
        targetContentType: input.sourceType,
        targetContentId: targetId,
        languageId: language.id,
        sourceRevisionNumber: source.liveRevisionNumber ?? 1,
        status: 'DRAFT',
        aiAssisted: false,
        notes: input.notes?.trim() || null,
        createdById: actor.userId,
      },
      include: { language: true, createdBy: { select: { id: true, email: true, name: true } } },
    })
    return { link, targetId }
  })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new TranslationError(
        'TARGET_REPRESENTATION_EXISTS',
        'A representation already exists in this language for the same anchor (§7 — one representation per anchor/language); retire or translate it through the normal correction cycle instead'
      )
    }
    throw error
  }

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.translationCreate,
    objectType: AUDIT_OBJECT_TYPES.translation,
    objectId: created.link.id,
    objectLabel: `${source.label} → ${language.code}`,
    after: {
      status: 'DRAFT',
      sourceType: input.sourceType,
      sourceId: source.id,
      targetId: created.targetId,
      languageCode: language.code,
      sourceRevisionNumber: created.link.sourceRevisionNumber,
    },
    metadata: { seededFromSourceRevision: created.link.sourceRevisionNumber },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  }).catch(() => undefined)

  const refreshed = await loadTranslationDto(created.link.id)
  return refreshed!
}

// ---------- The §26 AI draft lives in ./ai-service (server-only) ----------
// The model call is isolated from this file deliberately: client components
// reach this module's graph through the analytics barrel (the §32 metrics),
// and the z-ai SDK is backend-only — ai-service is imported EXCLUSIVELY by
// its API route, never re-exported through the barrel.

// ---------- Retire the link (§36 soft delete — content stands) ----------

export async function retireTranslation(
  actor: Actor,
  translationId: string,
  input: { note?: string } = {},
  meta: TranslationRequestMeta = {}
): Promise<TranslationDto> {
  const link = await db.translation.findUnique({
    where: { id: translationId },
    include: { language: true },
  })
  if (!link) throw new TranslationError('TRANSLATION_NOT_FOUND', 'Translation link not found')
  if (link.status === 'RETIRED') {
    throw new TranslationError('TRANSLATION_ALREADY_RETIRED', 'This translation link is already retired')
  }

  const targetMap = await resolveRepresentations(
    link.targetContentType as TranslationSourceTypePublic,
    [link.targetContentId]
  )
  const target = targetMap.get(link.targetContentId)
  assertCan(actor, 'translations:manage', {
    countryId: target?.countryId ?? null,
    languageId: link.languageId,
  })

  await db.translation.update({
    where: { id: link.id },
    data: { status: 'RETIRED', notes: input.note?.trim() || link.notes },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.translationRetire,
    objectType: AUDIT_OBJECT_TYPES.translation,
    objectId: link.id,
    objectLabel: `${link.sourceContentType}:${link.sourceContentId} → ${link.language.code}`,
    before: { status: link.status },
    after: { status: 'RETIRED', note: input.note?.trim() ?? null },
    metadata: { contentRowsUntouched: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  }).catch(() => undefined)

  const refreshed = await loadTranslationDto(link.id)
  return refreshed!
}

// ---------- Publish-path hooks (§36 drift + sync — called in the
// publishing module's transaction) ----------

/**
 * Called inside the ContentItem/QnA publish transactions. Two §36 duties,
 * both system-recorded:
 * 1. DRIFT — the representation that just published is a SOURCE with synced
 *    translations ⇒ those links flip to OUTDATED (the source moved past
 *    their sync point). Their targets stay published and public (§35).
 * 2. SYNC — the representation that just published is a TARGET with an
 *    active link ⇒ the link flips to PUBLISHED and re-syncs to the source's
 *    CURRENT live revision (a translation published after the source's
 *    revision N+1 naturally carries it; the localisation review is the
 *    human check that it actually does).
 */
export async function onRepresentationPublished(
  tx: Prisma.TransactionClient,
  event: { type: TranslationSourceTypePublic; id: string; revisionNumber: number }
): Promise<void> {
  // --- 1. Drift: synced translations of THIS representation go OUTDATED ---
  const synced = await tx.translation.findMany({
    where: {
      sourceContentType: event.type,
      sourceContentId: event.id,
      status: 'PUBLISHED',
    },
    select: { id: true, sourceRevisionNumber: true },
  })
  for (const link of synced) {
    if (link.sourceRevisionNumber >= event.revisionNumber) continue // already synced past this
    await tx.translation.update({
      where: { id: link.id },
      data: { status: 'OUTDATED' },
    })
    void recordAudit({
      actor: null,
      action: AUDIT_ACTIONS.translationDrift,
      objectType: AUDIT_OBJECT_TYPES.translation,
      objectId: link.id,
      objectLabel: `source ${event.type}:${event.id}`,
      before: { status: 'PUBLISHED', sourceRevisionNumber: link.sourceRevisionNumber },
      after: { status: 'OUTDATED', sourceLiveRevisionNumber: event.revisionNumber },
      metadata: {
        automated: 'publish',
        note: 'The source published a newer revision — the synced translation is OUTDATED (§36). The target stays published and public (§35).',
      },
    }).catch(() => undefined)
  }

  // --- 2. Sync: THIS representation is a translation target that published ---
  const link = await tx.translation.findFirst({
    where: {
      targetContentType: event.type,
      targetContentId: event.id,
      status: { in: ['DRAFT', 'OUTDATED', 'PUBLISHED'] },
    },
    select: { id: true, sourceContentType: true, sourceContentId: true, sourceRevisionNumber: true, aiAssisted: true },
  })
  if (!link) return

  // The source's CURRENT live revision is the honest sync point.
  let sourceLive: number | null = null
  if (link.sourceContentType === 'CONTENT_ITEM') {
    const row = await tx.contentItem.findUnique({
      where: { id: link.sourceContentId },
      select: { publishedRevision: { select: { revisionNumber: true } } },
    })
    sourceLive = row?.publishedRevision?.revisionNumber ?? null
  } else {
    const row = await tx.qnA.findUnique({
      where: { id: link.sourceContentId },
      select: { publishedRevision: { select: { revisionNumber: true } } },
    })
    sourceLive = row?.publishedRevision?.revisionNumber ?? null
  }

  await tx.translation.update({
    where: { id: link.id },
    data: {
      status: 'PUBLISHED',
      sourceRevisionNumber: sourceLive ?? link.sourceRevisionNumber,
    },
  })
  void recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.translationSync,
    objectType: AUDIT_OBJECT_TYPES.translation,
    objectId: link.id,
    objectLabel: `target ${event.type}:${event.id}`,
    before: { sourceRevisionNumber: link.sourceRevisionNumber },
    after: {
      status: 'PUBLISHED',
      sourceRevisionNumber: sourceLive ?? link.sourceRevisionNumber,
    },
    metadata: {
      automated: 'publish',
      aiAssisted: link.aiAssisted,
      note: 'The translation target published — the link syncs to the source\'s current live revision (§36).',
    },
  }).catch(() => undefined)
}

/**
 * The §19 step-5 gate lookup: does this representation carry an ACTIVE
 * translation link as TARGET? (Called from the editorial module's submit
 * wiring — a submitted translation opens a LOCALISATION_REVIEW task in
 * addition to the standard EDITORIAL_REVIEW.)
 */
export async function findActiveTargetLink(
  tx: Prisma.TransactionClient,
  type: TranslationSourceTypePublic,
  targetContentId: string
): Promise<{ id: string; languageCode: string } | null> {
  const link = await tx.translation.findFirst({
    where: {
      targetContentType: type,
      targetContentId,
      status: { not: 'RETIRED' },
    },
    select: { id: true, language: { select: { code: true } } },
  })
  return link ? { id: link.id, languageCode: link.language.code } : null
}

// ---------- The §35 public staleness join (render-service) ----------

/**
 * For the knowledge page's translation surface: which of these published
 * ContentItems are tracked translations whose source moved past the sync
 * point (§36 drift — the honest "the original has been updated since this
 * translation" signal)?
 */
export async function getStaleTranslationsForItems(
  itemIds: string[]
): Promise<Map<string, { stale: boolean; sourceLanguageCode: string }>> {
  const result = new Map<string, { stale: boolean; sourceLanguageCode: string }>()
  if (itemIds.length === 0) return result
  const links = await db.translation.findMany({
    where: {
      targetContentType: 'CONTENT_ITEM',
      targetContentId: { in: itemIds },
      status: { not: 'RETIRED' },
    },
    select: {
      targetContentId: true,
      sourceRevisionNumber: true,
      sourceContentType: true,
      sourceContentId: true,
    },
  })
  if (links.length === 0) return result

  // Resolve the sources' live revisions + language codes (polymorphic refs —
  // no Prisma relation to ride, the EditorialTask pattern).
  const sourceContentIds = links
    .filter((link) => link.sourceContentType === 'CONTENT_ITEM')
    .map((link) => link.sourceContentId)
  const sourceQnaIds = links
    .filter((link) => link.sourceContentType === 'QNA')
    .map((link) => link.sourceContentId)
  const liveBySource = new Map<string, { live: number | null; languageCode: string }>()
  if (sourceContentIds.length > 0) {
    const rows = await db.contentItem.findMany({
      where: { id: { in: sourceContentIds } },
      select: {
        id: true,
        language: { select: { code: true } },
        publishedRevision: { select: { revisionNumber: true } },
      },
    })
    for (const row of rows) {
      liveBySource.set(`CONTENT_ITEM:${row.id}`, {
        live: row.publishedRevision?.revisionNumber ?? null,
        languageCode: row.language.code,
      })
    }
  }
  if (sourceQnaIds.length > 0) {
    const rows = await db.qnA.findMany({
      where: { id: { in: sourceQnaIds } },
      select: {
        id: true,
        language: { select: { code: true } },
        publishedRevision: { select: { revisionNumber: true } },
      },
    })
    for (const row of rows) {
      liveBySource.set(`QNA:${row.id}`, {
        live: row.publishedRevision?.revisionNumber ?? null,
        languageCode: row.language.code,
      })
    }
  }

  for (const link of links) {
    const source = liveBySource.get(`${link.sourceContentType}:${link.sourceContentId}`)
    if (!source) continue
    result.set(link.targetContentId, {
      stale: source.live != null && source.live > link.sourceRevisionNumber,
      sourceLanguageCode: source.languageCode,
    })
  }
  return result
}

// ---------- §32 insights (the editorial family's translation metrics) ----------

export interface TranslationInsightMetrics {
  activeLinks: number
  byStatus: Record<TranslationStatusPublic, number>
  aiAssistedActive: number
  stalePublished: number
  /** Published cross-language representation pairs (same anchor+format, ≥2
   * languages) — the translations that exist IN FACT (§35). */
  publishedCrossLanguagePairs: number
  derivation: string
}

/** Windowless, aggregate-only counts (§31/§32) for the editorial family. */
export async function translationInsightMetrics(): Promise<TranslationInsightMetrics> {
  const rows = await db.translation.findMany({
    select: {
      status: true,
      aiAssisted: true,
      sourceRevisionNumber: true,
      sourceContentType: true,
      sourceContentId: true,
    },
    where: { status: { not: 'RETIRED' } },
  })
  // The sources' live revisions (polymorphic refs — resolved in batch).
  const contentIds = rows.filter((r) => r.sourceContentType === 'CONTENT_ITEM').map((r) => r.sourceContentId)
  const qnaIds = rows.filter((r) => r.sourceContentType === 'QNA').map((r) => r.sourceContentId)
  const liveBySource = new Map<string, number>()
  if (contentIds.length > 0) {
    const sources = await db.contentItem.findMany({
      where: { id: { in: contentIds } },
      select: { id: true, publishedRevision: { select: { revisionNumber: true } } },
    })
    for (const row of sources) {
      if (row.publishedRevision) liveBySource.set(`CONTENT_ITEM:${row.id}`, row.publishedRevision.revisionNumber)
    }
  }
  if (qnaIds.length > 0) {
    const sources = await db.qnA.findMany({
      where: { id: { in: qnaIds } },
      select: { id: true, publishedRevision: { select: { revisionNumber: true } } },
    })
    for (const row of sources) {
      if (row.publishedRevision) liveBySource.set(`QNA:${row.id}`, row.publishedRevision.revisionNumber)
    }
  }

  const byStatus: Record<TranslationStatusPublic, number> = { DRAFT: 0, PUBLISHED: 0, OUTDATED: 0, RETIRED: 0 }
  let aiAssistedActive = 0
  let stalePublished = 0
  for (const row of rows) {
    byStatus[row.status as TranslationStatusPublic] += 1
    if (row.aiAssisted) aiAssistedActive += 1
    const live = liveBySource.get(`${row.sourceContentType}:${row.sourceContentId}`)
    if (live != null && live > row.sourceRevisionNumber) stalePublished += 1
  }

  // Cross-language equivalents IN FACT (§35): published ContentItems sharing
  // an anchor + format across ≥2 languages — the tracked-vs-fact pair is the
  // framework-adoption honesty (untracked pairs still exist and serve).
  const groups = await db.contentItem.groupBy({
    by: ['knowledgeUnitId', 'currentEventId', 'format', 'languageId'],
    where: { status: 'PUBLISHED', publishedRevisionId: { not: null } },
    _count: { _all: true },
  })
  const anchorLanguages = new Map<string, Set<string>>()
  for (const group of groups) {
    const key = `${group.knowledgeUnitId ?? 'e'}:${group.currentEventId ?? 'u'}:${group.format}`
    const set = anchorLanguages.get(key) ?? new Set<string>()
    set.add(group.languageId)
    anchorLanguages.set(key, set)
  }
  let publishedCrossLanguagePairs = 0
  for (const languages of anchorLanguages.values()) {
    if (languages.size >= 2) {
      publishedCrossLanguagePairs += (languages.size * (languages.size - 1)) / 2
    }
  }

  return {
    activeLinks: rows.length,
    byStatus,
    aiAssistedActive,
    stalePublished,
    publishedCrossLanguagePairs,
    derivation: `${rows.length} active translation links (Translation rows, status ≠ RETIRED); drift derived from each link's synced source revision vs the source's live revision — never a guess (§36).`,
  }
}

// ---------- Loaders ----------

type ContentFormatValue = Prisma.ContentItemCreateInput['format']

async function loadTranslationDtoImpl(id: string): Promise<TranslationDto | null> {
  const link = await db.translation.findUnique({
    where: { id },
    include: { language: true, createdBy: { select: { id: true, email: true, name: true } } },
  })
  if (!link) return null
  const sourceMap = await resolveRepresentations(
    link.sourceContentType as TranslationSourceTypePublic,
    [link.sourceContentId]
  )
  const targetMap = await resolveRepresentations(
    link.targetContentType as TranslationSourceTypePublic,
    [link.targetContentId]
  )
  return dtoOf(
    link,
    sourceMap.get(link.sourceContentId),
    targetMap.get(link.targetContentId)
  )
}

// ---------- The server-only §26 surface (re-exported for ./ai-service) ----------

/** Resolves link ends to their representations (shared with ./ai-service). */
export async function resolveRepresentations(
  type: TranslationSourceTypePublic,
  ids: string[]
): Promise<Map<string, ResolvedRepresentation>> {
  return resolveRepresentationsImpl(type, ids)
}

/** Loads one link as its §37 DTO (shared with ./ai-service). */
export async function loadTranslationDto(id: string): Promise<TranslationDto | null> {
  return loadTranslationDtoImpl(id)
}
