/**
 * GKSetu — Knowledge: Source & provenance domain service (P2-S3)
 * Master Plan §6 (Source row), §24 (Source and Trust Model — every factual
 * content object carries provenance: publisher, URL, publication date,
 * retrieved/verified date, source category, editor verification state,
 * claim/content-level attribution), §26 (AI-assisted fields carry provenance
 * and flow through the human review gate — the existing DRAFT → IN_REVIEW →
 * PUBLISHED path IS that gate; the aiAssisted flag carries the metadata),
 * §14/§15/§20 (country scope enforced server-side on the LINK — a Country A
 * admin can only attach evidence to content they may manage; the Source
 * record itself is platform-level shared evidence), §36 (no hard deletes —
 * unreliable sources are marked, links preserved as provenance history),
 * §37 (service-boundary authorization, deterministic ordering), §38
 * (scoped admin), §43 (P2-S3 scope).
 *
 * Design: one canonical Source row per normalized URL (the §11 dedup
 * philosophy applied to evidence — two items citing the same URL share the
 * record). Links are live provenance metadata on the ContentItem: public
 * reads expose current links with each source's verification state, and
 * every attach/detach/edit is audited.
 *
 * Caching note (§29): indexed DB queries now; no cache for the registry.
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import type {
  AdminContentSourceLink,
  AdminContentSourceListResult,
  AdminSource,
  AdminSourceDetail,
  AdminSourceListResult,
  AdminSourceUsage,
  PublicSourceRef,
  SourceVerificationAction,
  SourceVerificationPublic,
  SourceTypePublic,
} from './source-types'
import { SOURCE_VERIFICATION_TRANSITIONS } from './source-types'
import { anchorLabel, anchorOfItem, anchorTarget, type ItemAnchor } from './content-anchors'
import type {
  AdminSourceListQuery,
  CreateSourceInput,
  LinkSourceInput,
  SourceVerificationInput,
  UpdateSourceInput,
  UpdateSourceLinkInput,
} from './source-validation'
import { normalizeSourceUrl } from './source-validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type SourceErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_EXISTS'
  | 'INVALID_URL'
  | 'INVALID_VERIFICATION_TRANSITION'
  | 'SOURCE_UNRELIABLE'
  | 'ITEM_NOT_FOUND'
  | 'LINK_NOT_FOUND'
  | 'SOURCE_ALREADY_LINKED'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_CONTENT_ADMIN_ONLY'
  | 'LANGUAGE_SCOPE' // P6-S2: the §20 WRITER language-scope narrowing now rides
  // source-link management too (the pre-existing gap — content-service parity)

const ERROR_STATUS: Record<SourceErrorCode, number> = {
  SOURCE_NOT_FOUND: 404,
  SOURCE_EXISTS: 409,
  INVALID_URL: 400,
  INVALID_VERIFICATION_TRANSITION: 409,
  SOURCE_UNRELIABLE: 409,
  ITEM_NOT_FOUND: 404,
  LINK_NOT_FOUND: 404,
  SOURCE_ALREADY_LINKED: 409,
  COUNTRY_MISMATCH: 403,
  GLOBAL_CONTENT_ADMIN_ONLY: 403,
  LANGUAGE_SCOPE: 403,
}

export class SourceError extends Error {
  readonly code: SourceErrorCode
  readonly status: number

  constructor(code: SourceErrorCode, message: string) {
    super(message)
    this.name = 'SourceError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown SourceError to envelope data (§37); null for others. */
export function toSourceErrorResponse(
  error: unknown
): { message: string; code: SourceErrorCode; status: number } | null {
  if (error instanceof SourceError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

type SourceRow = Prisma.SourceGetPayload<null>

type LinkRow = Prisma.ContentSourceLinkGetPayload<{ include: { source: true } }>

type LinkedItemRow = Prisma.ContentItemGetPayload<{
  include: { knowledgeUnit: true; currentEvent: true; language: true }
}>

async function loadSource(id: string): Promise<SourceRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.source.findUnique({ where: { id } })
}

/** Item + owning anchor + language — the link-operation permission context. */
async function loadLinkedItem(id: string): Promise<LinkedItemRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.contentItem.findUnique({
    where: { id },
    include: { knowledgeUnit: true, currentEvent: true, language: true },
  })
}

/** A link's permission target: the OWNING anchor's country scope (§14) — the
 * same rule as every other content-object operation (unit or event, P6-S2). */
function targetOfAnchor(anchor: ItemAnchor): { countryId: string | null } {
  return anchorTarget(anchor)
}

function canReadUsage(actor: Actor, anchor: ItemAnchor): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    // P6-S2: writers see their scope's citation usage too (they author event
    // representations now — the board's context is part of working it, §20).
    return anchor.scope === 'GLOBAL' || anchor.countryId === actor.countryId
  }
  return false
}

/** Object-level link permission + denial audit (§20 signal — KU/content pattern). */
function assertCanManageLinks(
  actor: Actor,
  item: LinkedItemRow,
  anchor: ItemAnchor,
  operation: string,
  meta?: AuditRequestMeta
): void {
  if (can(actor, 'content:manage', { ...targetOfAnchor(anchor), languageId: item.languageId })) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceLinkDenied,
    objectType: AUDIT_OBJECT_TYPES.contentSourceLink,
    objectId: item.id,
    objectLabel: anchorLabel(anchor, item.language.code, item.format),
    before: { itemStatus: item.status, anchorKind: anchor.kind, anchorScope: anchor.scope },
    metadata: {
      attemptedOperation: operation,
      reason:
        actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER'
          ? anchor.scope === 'GLOBAL'
            ? 'GLOBAL_CONTENT_ADMIN_ONLY'
            : actor.role === 'WRITER' &&
                actor.languageScopeId &&
                item.languageId !== actor.languageScopeId
              ? 'LANGUAGE_SCOPE'
              : 'COUNTRY_MISMATCH'
          : 'ROLE',
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined)
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (anchor.scope === 'GLOBAL') {
      throw new SourceError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country-scoped staff cannot attach sources to representations of global records'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      item.languageId !== actor.languageScopeId
    ) {
      throw new SourceError(
        'LANGUAGE_SCOPE',
        'This representation is outside your language scope (§20 explicit staff scopes)'
      )
    }
    throw new SourceError(
      'COUNTRY_MISMATCH',
      'You can only manage sources on your own country\u2019s content'
    )
  }
  throw new SourceError('COUNTRY_MISMATCH', 'You do not have permission to manage this content\u2019s sources')
}

function toAdminSource(
  source: SourceRow,
  visibleUsageCount: number
): AdminSource {
  const verification = source.verification as SourceVerificationPublic
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    type: source.type as SourceTypePublic,
    verification,
    publishedAt: source.publishedAt?.toISOString() ?? null,
    retrievedAt: source.retrievedAt.toISOString(),
    verifiedAt: source.verifiedAt?.toISOString() ?? null,
    notes: source.notes,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
    usageCount: visibleUsageCount,
    // Affordances from server truth (§20) — the verification state machine.
    allowedTransitions: Object.keys(
      SOURCE_VERIFICATION_TRANSITIONS[verification]
    ) as SourceVerificationAction[],
  }
}

/** Snapshot for audit before/after (§30 — provenance records redact notes length only). */
function snapshotOf(source: SourceRow) {
  return {
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    type: source.type,
    verification: source.verification,
    publishedAt: source.publishedAt?.toISOString() ?? null,
    retrievedAt: source.retrievedAt.toISOString(),
    verifiedAt: source.verifiedAt?.toISOString() ?? null,
    notesLength: source.notes?.length ?? 0,
  }
}

function toPublicRef(link: LinkRow): PublicSourceRef {
  const source = link.source
  return {
    id: source.id,
    title: source.title,
    publisher: source.publisher,
    url: source.url,
    type: source.type as SourceTypePublic,
    verification: source.verification as SourceVerificationPublic,
    publishedAt: source.publishedAt?.toISOString() ?? null,
    retrievedAt: source.retrievedAt.toISOString(),
    verifiedAt: source.verifiedAt?.toISOString() ?? null,
    claim: link.claim,
  }
}

// ---------- Registry reads (admin) ----------

/** Registry list with filters + the §24 trust summary. Sources are
 * platform-level evidence; usage counts are filtered to what the actor may
 * read (COUNTRY_ADMIN: global + own-country items — §20 parity). */
export async function getAdminSources(
  actor: Actor,
  query: AdminSourceListQuery
): Promise<AdminSourceListResult> {
  assertCan(actor, 'source:manage')

  const where: Prisma.SourceWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.verification ? { verification: query.verification } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { publisher: { contains: query.q, mode: 'insensitive' } },
            { url: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [rows, total, grouped] = await Promise.all([
    db.source.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        links: { include: { contentItem: { include: { knowledgeUnit: true, currentEvent: true } } } },
      },
    }),
    db.source.count({ where }),
    db.source.groupBy({ by: ['verification'], _count: { _all: true } }),
  ])

  const summary: Record<SourceVerificationPublic, number> = {
    UNVERIFIED: 0,
    VERIFIED: 0,
    UNRELIABLE: 0,
  }
  for (const group of grouped) {
    summary[group.verification as SourceVerificationPublic] = group._count._all
  }

  const sources = rows.map((row) => {
    const visible = row.links.filter((link) => {
      const anchor = anchorOfItem(link.contentItem)
      return anchor ? canReadUsage(actor, anchor) : false
    })
    return toAdminSource(row, visible.length)
  })

  return {
    sources,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary,
  }
}

/** Registry detail: evidence record + where it is cited (scope-filtered, §20). */
export async function getAdminSource(actor: Actor, id: string): Promise<AdminSourceDetail> {
  assertCan(actor, 'source:manage')
  const source = await loadSource(id)
  if (!source) throw new SourceError('SOURCE_NOT_FOUND', 'Source not found')

  const links = await db.contentSourceLink.findMany({
    where: { sourceId: source.id },
    include: {
      contentItem: { include: { knowledgeUnit: true, currentEvent: true, language: true } },
    },
    orderBy: [{ contentItem: { updatedAt: 'desc' } }, { id: 'desc' }],
  })

  const usage: AdminSourceUsage[] = []
  for (const link of links) {
    const anchor = anchorOfItem(link.contentItem)
    if (!anchor || !canReadUsage(actor, anchor)) continue
    usage.push({
      itemId: link.contentItem.id,
      itemTitle: link.contentItem.title,
      format: link.contentItem.format,
      languageCode: link.contentItem.language.code,
      itemStatus: link.contentItem.status,
      unitSlug: anchor.slug,
      unitName: anchor.name,
      claim: link.claim,
    })
  }

  return { ...toAdminSource(source, usage.length), usage }
}

// ---------- Registry writes (admin) ----------

export async function createSource(
  actor: Actor,
  input: CreateSourceInput,
  meta: AuditRequestMeta = {}
): Promise<AdminSource> {
  assertCan(actor, 'source:manage')

  const url = normalizeSourceUrl(input.url)
  if (!url) throw new SourceError('INVALID_URL', 'Enter a valid http(s) URL')

  // §11-style dedup applied to evidence: one canonical record per URL.
  const existing = await db.source.findUnique({ where: { url } })
  if (existing) {
    throw new SourceError(
      'SOURCE_EXISTS',
      `A source record for this URL already exists (id: ${existing.id}, "${existing.title}") — cite the existing record instead of duplicating evidence`
    )
  }

  const created = await db.source.create({
    data: {
      title: input.title,
      publisher: input.publisher,
      url,
      type: input.type,
      verification: 'UNVERIFIED', // every new evidence record starts unverified (§24)
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
      retrievedAt: input.retrievedAt ? new Date(input.retrievedAt) : new Date(),
      notes: input.notes ?? null,
      createdById: actor.userId,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceCreate,
    objectType: AUDIT_OBJECT_TYPES.source,
    objectId: created.id,
    objectLabel: created.publisher,
    after: snapshotOf(created),
    metadata: { url: created.url, type: created.type },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminSource(created, 0)
}

export async function updateSource(
  actor: Actor,
  id: string,
  input: UpdateSourceInput,
  meta: AuditRequestMeta = {}
): Promise<AdminSource> {
  assertCan(actor, 'source:manage')
  const source = await loadSource(id)
  if (!source) throw new SourceError('SOURCE_NOT_FOUND', 'Source not found')

  // URL corrections re-normalize and re-check the identity constraint.
  let url: string | undefined
  if (input.url !== undefined && input.url !== source.url) {
    url = normalizeSourceUrl(input.url) ?? undefined
    if (!url) throw new SourceError('INVALID_URL', 'Enter a valid http(s) URL')
    const clash = await db.source.findUnique({ where: { url } })
    if (clash && clash.id !== source.id) {
      throw new SourceError(
        'SOURCE_EXISTS',
        `Another source record already uses this URL (id: ${clash.id}) — evidence is deduplicated by URL (§11 rule applied to sources)`
      )
    }
  }

  const before = snapshotOf(source)
  const updated = await db.source.update({
    where: { id: source.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.publisher !== undefined ? { publisher: input.publisher } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.publishedAt !== undefined
        ? { publishedAt: input.publishedAt === null ? null : new Date(input.publishedAt) }
        : {}),
      ...(input.retrievedAt !== undefined ? { retrievedAt: new Date(input.retrievedAt) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceUpdate,
    objectType: AUDIT_OBJECT_TYPES.source,
    objectId: source.id,
    objectLabel: updated.publisher,
    before,
    after: snapshotOf(updated),
    metadata: { changedFields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const linkCount = await db.contentSourceLink.count({ where: { sourceId: source.id } })
  return toAdminSource(updated, linkCount)
}

/** §24 editor verification workflow (see SOURCE_VERIFICATION_TRANSITIONS). */
export async function transitionSourceVerification(
  actor: Actor,
  id: string,
  input: SourceVerificationInput,
  meta: AuditRequestMeta = {}
): Promise<AdminSource> {
  assertCan(actor, 'source:manage')
  const source = await loadSource(id)
  if (!source) throw new SourceError('SOURCE_NOT_FOUND', 'Source not found')

  const current = source.verification as SourceVerificationPublic
  const target = SOURCE_VERIFICATION_TRANSITIONS[current][input.action]
  if (!target) {
    throw new SourceError(
      'INVALID_VERIFICATION_TRANSITION',
      `"${input.action}" is not a valid verification transition from ${current}`
    )
  }

  const before = snapshotOf(source)
  const updated = await db.source.update({
    where: { id: source.id },
    data: {
      verification: target,
      verifiedAt: input.action === 'verify' ? new Date() : null,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceVerify,
    objectType: AUDIT_OBJECT_TYPES.source,
    objectId: source.id,
    objectLabel: updated.publisher,
    before: { verification: before.verification, verifiedAt: before.verifiedAt },
    after: { verification: target, verifiedAt: updated.verifiedAt?.toISOString() ?? null },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const linkCount = await db.contentSourceLink.count({ where: { sourceId: source.id } })
  return toAdminSource(updated, linkCount)
}

// ---------- Content-item provenance links (content:manage on the item) ----------

/** Admin view: the evidence attached to one content item (§24). Read access
 * follows the module's read/manage split: COUNTRY_ADMIN may VIEW global items'
 * citations (read-only — content parity, §38) but cannot modify them. */
export async function listContentSources(
  actor: Actor,
  itemId: string
): Promise<AdminContentSourceListResult> {
  const item = await loadLinkedItem(itemId)
  if (!item) throw new SourceError('ITEM_NOT_FOUND', 'Content item not found')
  const anchor = anchorOfItem(item)
  if (!anchor) throw new SourceError('ITEM_NOT_FOUND', 'Content item has no canonical anchor')
  if (!canReadUsage(actor, anchor)) {
    throw new SourceError(
      'COUNTRY_MISMATCH',
      'You can only view sources of global content and your own country content'
    )
  }

  const links = await db.contentSourceLink.findMany({
    where: { contentItemId: item.id },
    include: { source: true },
    orderBy: [{ source: { publisher: 'asc' } }, { id: 'asc' }], // deterministic (§37)
  })

  const mapped: AdminContentSourceLink[] = links.map((link) => ({
    id: link.id,
    claim: link.claim,
    linkedAt: link.createdAt.toISOString(),
    source: {
      id: link.source.id,
      title: link.source.title,
      publisher: link.source.publisher,
      url: link.source.url,
      type: link.source.type as SourceTypePublic,
      verification: link.source.verification as SourceVerificationPublic,
      publishedAt: link.source.publishedAt?.toISOString() ?? null,
      retrievedAt: link.source.retrievedAt.toISOString(),
      verifiedAt: link.source.verifiedAt?.toISOString() ?? null,
    },
  }))

  return {
    itemId: item.id,
    anchor: { kind: anchor.kind, slug: anchor.slug, name: anchor.name },
    format: item.format,
    language: { code: item.language.code, name: item.language.name },
    links: mapped,
  }
}

/** Attach evidence to a content item — content-level, or claim-level when a
 * claim is provided (§24). New links to UNRELIABLE evidence are refused. */
export async function linkSourceToItem(
  actor: Actor,
  itemId: string,
  input: LinkSourceInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentSourceLink> {
  const item = await loadLinkedItem(itemId)
  if (!item) throw new SourceError('ITEM_NOT_FOUND', 'Content item not found')
  const anchor = anchorOfItem(item)
  if (!anchor) throw new SourceError('ITEM_NOT_FOUND', 'Content item has no canonical anchor')
  assertCanManageLinks(actor, item, anchor, 'link', meta)

  const source = await loadSource(input.source)
  if (!source) throw new SourceError('SOURCE_NOT_FOUND', `Unknown source "${input.source}"`)
  if (source.verification === 'UNRELIABLE') {
    throw new SourceError(
      'SOURCE_UNRELIABLE',
      'This source is marked UNRELIABLE — unreliable evidence cannot be attached to new content (§24 trust model). Existing citations remain as preserved provenance history.'
    )
  }

  const existing = await db.contentSourceLink.findUnique({
    where: { contentItemId_sourceId: { contentItemId: item.id, sourceId: source.id } },
    select: { id: true },
  })
  if (existing) {
    throw new SourceError(
      'SOURCE_ALREADY_LINKED',
      'This source is already cited by the item — one link per item × source (edit the claim instead)'
    )
  }

  const link = await db.contentSourceLink.create({
    data: {
      contentItemId: item.id,
      sourceId: source.id,
      claim: input.claim?.trim() ?? null,
    },
    include: { source: true },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceLinkCreate,
    objectType: AUDIT_OBJECT_TYPES.contentSourceLink,
    objectId: link.id,
    objectLabel: `${anchorLabel(anchor, item.language.code, item.format)} ← ${source.publisher}`,
    after: {
      itemId: item.id,
      anchorKind: anchor.kind,
      sourceId: source.id,
      sourceUrl: source.url,
      claim: link.claim,
      attribution: link.claim ? 'claim-level' : 'content-level',
    },
    metadata: { sourceVerification: source.verification },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return {
    id: link.id,
    claim: link.claim,
    linkedAt: link.createdAt.toISOString(),
    source: {
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      type: source.type as SourceTypePublic,
      verification: source.verification as SourceVerificationPublic,
      publishedAt: source.publishedAt?.toISOString() ?? null,
      retrievedAt: source.retrievedAt.toISOString(),
      verifiedAt: source.verifiedAt?.toISOString() ?? null,
    },
  }
}

/** Edit a link's claim-level attribution (§24). */
export async function updateContentSourceClaim(
  actor: Actor,
  itemId: string,
  linkId: string,
  input: UpdateSourceLinkInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentSourceLink> {
  const item = await loadLinkedItem(itemId)
  if (!item) throw new SourceError('ITEM_NOT_FOUND', 'Content item not found')
  const anchor = anchorOfItem(item)
  if (!anchor) throw new SourceError('ITEM_NOT_FOUND', 'Content item has no canonical anchor')
  assertCanManageLinks(actor, item, anchor, 'update-claim', meta)

  const link = await db.contentSourceLink.findUnique({
    where: { id: linkId },
    include: { source: true },
  })
  if (!link || link.contentItemId !== item.id) {
    throw new SourceError('LINK_NOT_FOUND', 'This citation link does not exist on the item')
  }

  const updated = await db.contentSourceLink.update({
    where: { id: link.id },
    data: { ...(input.claim !== undefined ? { claim: input.claim?.trim() ?? null } : {}) },
    include: { source: true },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceLinkUpdate,
    objectType: AUDIT_OBJECT_TYPES.contentSourceLink,
    objectId: link.id,
    objectLabel: `${anchorLabel(anchor, item.language.code, item.format)} ← ${link.source.publisher}`,
    before: { claim: link.claim },
    after: { claim: updated.claim },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const source = updated.source
  return {
    id: updated.id,
    claim: updated.claim,
    linkedAt: updated.createdAt.toISOString(),
    source: {
      id: source.id,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      type: source.type as SourceTypePublic,
      verification: source.verification as SourceVerificationPublic,
      publishedAt: source.publishedAt?.toISOString() ?? null,
      retrievedAt: source.retrievedAt.toISOString(),
      verifiedAt: source.verifiedAt?.toISOString() ?? null,
    },
  }
}

/** Detach evidence from an item. The Source record is never deleted (§36). */
export async function unlinkSourceFromItem(
  actor: Actor,
  itemId: string,
  linkId: string,
  meta: AuditRequestMeta = {}
): Promise<{ ok: true; removedLinkId: string }> {
  const item = await loadLinkedItem(itemId)
  if (!item) throw new SourceError('ITEM_NOT_FOUND', 'Content item not found')
  const anchor = anchorOfItem(item)
  if (!anchor) throw new SourceError('ITEM_NOT_FOUND', 'Content item has no canonical anchor')
  assertCanManageLinks(actor, item, anchor, 'unlink', meta)

  const link = await db.contentSourceLink.findUnique({
    where: { id: linkId },
    include: { source: true },
  })
  if (!link || link.contentItemId !== item.id) {
    throw new SourceError('LINK_NOT_FOUND', 'This citation link does not exist on the item')
  }

  await db.contentSourceLink.delete({ where: { id: link.id } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.sourceLinkRemove,
    objectType: AUDIT_OBJECT_TYPES.contentSourceLink,
    objectId: link.id,
    objectLabel: `${anchorLabel(anchor, item.language.code, item.format)} ← ${link.source.publisher}`,
    before: {
      itemId: item.id,
      anchorKind: anchor.kind,
      sourceId: link.sourceId,
      sourceUrl: link.source.url,
      claim: link.claim,
    },
    metadata: { note: 'Link removed — the Source record itself is preserved (§36)' },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { ok: true, removedLinkId: link.id }
}

// ---------- Public reads (used by the content service) ----------

/**
 * The §24 public provenance surface: current links of a content item, each
 * with its source's verification state. Called only for items that already
 * passed the public visibility chain (PUBLISHED + live revision + VERIFIED
 * unit + country/topic visibility) — provenance is never more visible than
 * the content it backs.
 */
export async function getPublicSourcesForItem(contentItemId: string): Promise<PublicSourceRef[]> {
  const links = await db.contentSourceLink.findMany({
    where: { contentItemId },
    include: { source: true },
    orderBy: [{ source: { publisher: 'asc' } }, { id: 'asc' }], // deterministic (§37)
  })
  return links.map(toPublicRef)
}
