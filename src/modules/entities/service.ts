/**
 * GKSetu — Entities domain service (P6-S3)
 * Master Plan §6 (Entity row: id, type, canonical name, aliases, country),
 * §12 step 3 (attach entities to CurrentEvents — the attach/detach lives in
 * the current-affairs service on the event; this module owns the registry),
 * §13 (canonical reference discipline: stable ids, aliases, soft delete),
 * §14 (GLOBAL entities are ADMIN-managed like all global objects; COUNTRY
 * entities belong to exactly one market — enforced at the service boundary,
 * never by UI hiding), §16 (immutable, kebab-case, URL-stable slugs), §36
 * (RETIRED is read-only end-of-life; reactivation is explicit; every
 * mutation audited), §37 (typed errors mapped to HTTP by route handlers,
 * deterministic ordering), §38 (scoped console surface).
 */
import { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import { findActiveCountryByIso } from '@/modules/country-locale'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'

import type {
  AdminEntity,
  AdminEntityDetail,
  AdminEntityListResult,
  EntityAliasRef,
  EntityScopePublic,
  EntityStatusPublic,
  EntityTypePublic,
} from './types'
import type { AdminEntityListQuery, CreateEntityInput, UpdateEntityInput } from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers, §37) ----------

export type EntityErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_SLUG_TAKEN'
  | 'INVALID_SLUG'
  | 'COUNTRY_NOT_FOUND'
  | 'COUNTRY_REQUIRED'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_ENTITIES_ADMIN_ONLY'
  | 'ENTITY_RETIRED'
  | 'ENTITY_DENIED'

const ERROR_STATUS: Record<EntityErrorCode, number> = {
  ENTITY_NOT_FOUND: 404,
  ENTITY_SLUG_TAKEN: 409,
  INVALID_SLUG: 400,
  COUNTRY_NOT_FOUND: 400,
  COUNTRY_REQUIRED: 400,
  COUNTRY_MISMATCH: 403,
  GLOBAL_ENTITIES_ADMIN_ONLY: 403,
  ENTITY_RETIRED: 409,
  ENTITY_DENIED: 403,
}

export class EntityError extends Error {
  readonly code: EntityErrorCode
  readonly status: number

  constructor(code: EntityErrorCode, message: string) {
    super(message)
    this.name = 'EntityError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown EntityError to envelope data (§37); null for others. */
export function toEntityErrorResponse(
  error: unknown
): { message: string; code: EntityErrorCode; status: number } | null {
  if (error instanceof EntityError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The §12 step 3 event references are carried on the detail surface. */
const ENTITY_INCLUDE = {
  aliases: { include: { language: { select: { code: true } } } },
  country: { select: { isoCode: true } },
  events: {
    include: {
      currentEvent: { select: { id: true, slug: true, title: true, lifecycleState: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }],
  },
} satisfies Prisma.EntityInclude

type EntityRow = Prisma.EntityGetPayload<{ include: typeof ENTITY_INCLUDE }>

function toAdminEntity(row: EntityRow): AdminEntity {
  return {
    id: row.id,
    slug: row.slug,
    canonicalName: row.canonicalName,
    description: row.description,
    type: row.type as EntityTypePublic,
    status: row.status as EntityStatusPublic,
    scope: row.scope as EntityScopePublic,
    countryIso: row.country?.isoCode ?? null,
    notes: row.notes,
    aliasCount: row.aliases.length,
    eventCount: row.events.length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toAdminEntityDetail(row: EntityRow): AdminEntityDetail {
  return {
    ...toAdminEntity(row),
    aliases: row.aliases
      .map(
        (alias): EntityAliasRef => ({
          id: alias.id,
          value: alias.value,
          languageCode: alias.language?.code ?? null,
        })
      )
      .sort((a, b) => a.value.localeCompare(b.value)), // deterministic (§37)
    events: row.events
      .map((link) => ({
        eventId: link.currentEvent.id,
        eventSlug: link.currentEvent.slug,
        eventTitle: link.currentEvent.title,
        lifecycleState: link.currentEvent.lifecycleState,
        note: link.note,
        linkedAt: link.createdAt.toISOString(),
      }))
      .sort((a, b) => a.eventSlug.localeCompare(b.eventSlug)),
    editable: row.status === 'ACTIVE',
  }
}

async function loadEntity(idOrRef: string): Promise<EntityRow | null> {
  return db.entity.findFirst({
    where: CUID_PATTERN.test(idOrRef) ? { id: idOrRef } : { slug: idOrRef.toLowerCase() },
    include: ENTITY_INCLUDE,
  })
}

/** §37 ref resolution for other modules (follow service, event linking). */
export async function findEntityByRef(ref: string): Promise<{ id: string; slug: string } | null> {
  const row = await db.entity.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    select: { id: true, slug: true },
  })
  return row ?? null
}

/** Deterministic unique slug for auto-generated identities (§16). */
async function resolveUniqueSlug(canonicalName: string): Promise<string> {
  const base =
    canonicalName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'entity'
  let candidate = base
  for (let suffix = 2; suffix <= 30; suffix += 1) {
    const taken = await db.entity.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!taken) return candidate
    candidate = `${base}-${suffix}`
  }
  throw new EntityError('INVALID_SLUG', 'Could not derive a unique slug — provide one explicitly')
}

/** Writes the alias set (create) or replaces it wholesale (update). */
async function writeAliases(
  entityId: string,
  aliases: NonNullable<CreateEntityInput['aliases']>
): Promise<void> {
  for (const alias of aliases) {
    let languageId: string | null = null
    if (alias.language) {
      const language = await db.language.findFirst({
        where: { code: alias.language, status: 'ACTIVE' },
        select: { id: true },
      })
      if (!language) {
        throw new EntityError('COUNTRY_NOT_FOUND', `Unknown language "${alias.language}" for an alias`)
      }
      languageId = language.id
    }
    try {
      await db.entityAlias.create({ data: { entityId, value: alias.value, languageId } })
    } catch (error) {
      // Duplicate [entityId, value] → the honest 409 instead of a raw P2002.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new EntityError(
          'ENTITY_SLUG_TAKEN',
          `Alias "${alias.value}" already exists on this entity`
        )
      }
      throw error
    }
  }
}

// ---------- Reads (admin, §38) ----------

/** Admin list: ADMIN sees everything; COUNTRY_ADMIN sees GLOBAL (read-only
 *  surface) + own-market entities. Filters: q (name/slug/alias), type,
 *  status, scope, country; deterministic canonicalName ordering (§37). */
export async function getAdminEntities(
  actor: Actor,
  query: AdminEntityListQuery
): Promise<AdminEntityListResult> {
  if (!can(actor, 'entities:manage')) {
    throw new EntityError('ENTITY_DENIED', 'Viewing the entity registry requires the entities permission')
  }

  const ownCountryId = actor.role === 'COUNTRY_ADMIN' ? actor.countryId : null
  const visibility: Prisma.EntityWhereInput | undefined = ownCountryId
    ? { OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: ownCountryId }] }
    : undefined

  let countryFilter: Prisma.EntityWhereInput = {}
  if (query.country) {
    const country = await db.country.findUnique({ where: { isoCode: query.country } })
    countryFilter = { countryId: country?.id ?? 'none' }
  }

  const where: Prisma.EntityWhereInput = {
    AND: [
      ...(visibility ? [visibility] : []),
      {
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.scope ? { scope: query.scope } : {}),
        ...(query.country || query.scope === 'COUNTRY' ? countryFilter : {}),
        ...(query.q
          ? {
              OR: [
                { canonicalName: { contains: query.q, mode: 'insensitive' } },
                { slug: { contains: query.q, mode: 'insensitive' } },
                { description: { contains: query.q, mode: 'insensitive' } },
                { aliases: { some: { value: { contains: query.q, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
    ],
  }

  const [rows, total, grouped] = await Promise.all([
    db.entity.findMany({
      where,
      orderBy: [{ canonicalName: 'asc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: ENTITY_INCLUDE,
    }),
    db.entity.count({ where }),
    db.entity.groupBy({ by: ['status'], _count: { _all: true }, where: visibility }),
  ])

  const summary = { total: 0, ACTIVE: 0, RETIRED: 0 }
  for (const group of grouped) {
    summary[group.status as EntityStatusPublic] = group._count._all
    summary.total += group._count._all
  }

  return {
    entities: rows.map(toAdminEntity),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary,
  }
}

/** Admin detail — the registry surface: aliases + the linking events (§37). */
export async function getAdminEntity(actor: Actor, idOrRef: string): Promise<AdminEntityDetail> {
  if (!can(actor, 'entities:manage')) {
    throw new EntityError('ENTITY_DENIED', 'Viewing the entity registry requires the entities permission')
  }
  const row = await loadEntity(idOrRef)
  if (!row) throw new EntityError('ENTITY_NOT_FOUND', 'Entity not found')
  // §14 read visibility: country staff never see other markets' entities.
  if (actor.role === 'COUNTRY_ADMIN' && row.scope === 'COUNTRY' && row.countryId !== actor.countryId) {
    throw new EntityError('ENTITY_NOT_FOUND', 'Entity not found')
  }
  return toAdminEntityDetail(row)
}

// ---------- Writes (admin) ----------

/** Create a canonical entity reference record (§6). */
export async function createEntity(
  actor: Actor,
  input: CreateEntityInput,
  meta: AuditRequestMeta = {}
): Promise<AdminEntityDetail> {
  assertCan(actor, 'entities:manage')

  // §14 scope resolution (the CurrentEvent precedent: a country admin's own
  // home market may be implied; global objects stay ADMIN-only).
  let countryId: string | null = null
  let countryIso: string | null = null
  if (input.scope === 'COUNTRY') {
    if (input.country) {
      const country = await findActiveCountryByIso(input.country)
      if (!country) {
        throw new EntityError('COUNTRY_NOT_FOUND', `Unknown or inactive country "${input.country}"`)
      }
      if (actor.role === 'COUNTRY_ADMIN' && country.id !== actor.countryId) {
        throw new EntityError('COUNTRY_MISMATCH', 'You can only create entities for your own country')
      }
      countryId = country.id
      countryIso = country.isoCode
    } else if (actor.role === 'COUNTRY_ADMIN' && actor.countryId) {
      countryId = actor.countryId
      const own = await db.country.findUnique({ where: { id: actor.countryId } })
      countryIso = own?.isoCode ?? null
    } else {
      throw new EntityError('COUNTRY_REQUIRED', 'Country is required for country-scoped entities')
    }
  } else if (actor.role === 'COUNTRY_ADMIN') {
    throw new EntityError(
      'GLOBAL_ENTITIES_ADMIN_ONLY',
      'Country admins can only create country-scoped entities'
    )
  }

  // §16: an EXPLICIT slug is identity — a clash is a 409, never a silent
  // suffix; only auto-derived slugs (from the canonical name) suffix.
  let slug: string
  if (input.slug) {
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new EntityError('INVALID_SLUG', 'Slug must be kebab-case (a-z, 0-9, hyphens)')
    }
    const taken = await db.entity.findUnique({ where: { slug: input.slug }, select: { id: true } })
    if (taken) {
      throw new EntityError(
        'ENTITY_SLUG_TAKEN',
        `Slug "${input.slug}" is already in use — slugs are immutable identity (§16)`
      )
    }
    slug = input.slug
  } else {
    slug = await resolveUniqueSlug(input.canonicalName)
  }

  const created = await db.entity.create({
    data: {
      slug,
      canonicalName: input.canonicalName,
      description: input.description ?? null,
      type: input.type,
      status: 'ACTIVE',
      scope: input.scope,
      countryId,
      notes: input.notes ?? null,
    },
  })
  if (input.aliases?.length) {
    await writeAliases(created.id, input.aliases)
  }

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.entityCreate,
    objectType: AUDIT_OBJECT_TYPES.entity,
    objectId: created.id,
    objectLabel: created.slug,
    after: {
      slug: created.slug,
      canonicalName: created.canonicalName,
      type: created.type,
      scope: created.scope,
      countryIso,
      aliases: input.aliases?.map((alias) => alias.value) ?? [],
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const row = await loadEntity(created.id)
  return toAdminEntityDetail(row!)
}

/** Metadata edits + alias replacement + §36 status flips (slug/type/scope
 *  immutable — structural reclassification is a new entity). */
export async function updateEntity(
  actor: Actor,
  idOrRef: string,
  input: UpdateEntityInput,
  meta: AuditRequestMeta = {}
): Promise<AdminEntityDetail> {
  assertCan(actor, 'entities:manage')
  const row = await loadEntity(idOrRef)
  if (!row) throw new EntityError('ENTITY_NOT_FOUND', 'Entity not found')

  // §14 object-level narrowing: GLOBAL entities (countryId null) are
  // ADMIN-only to mutate; COUNTRY entities belong to their market's admin.
  if (!can(actor, 'entities:manage', { countryId: row.countryId })) {
    throw new EntityError(
      'COUNTRY_MISMATCH',
      'You can only edit entities of your own country (global entities are platform-managed)'
    )
  }

  // §36: RETIRED is read-only end-of-life — reactivation is the one allowed
  // mutation on a retired row (the explicit editorial reopen).
  const reactivating = row.status === 'RETIRED' && input.status === 'ACTIVE'
  if (row.status === 'RETIRED' && !reactivating) {
    throw new EntityError(
      'ENTITY_RETIRED',
      'This entity is retired (end-of-life) and read-only — reactivate it first (§36)'
    )
  }

  const before = {
    canonicalName: row.canonicalName,
    description: row.description,
    notes: row.notes,
    status: row.status,
    aliases: row.aliases.map((alias) => alias.value),
  }

  await db.entity.update({
    where: { id: row.id },
    data: {
      ...(input.canonicalName !== undefined ? { canonicalName: input.canonicalName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  })
  if (input.aliases !== undefined) {
    await db.entityAlias.deleteMany({ where: { entityId: row.id } })
    if (input.aliases.length > 0) {
      await writeAliases(row.id, input.aliases)
    }
  }

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.entityUpdate,
    objectType: AUDIT_OBJECT_TYPES.entity,
    objectId: row.id,
    objectLabel: row.slug,
    before,
    after: {
      canonicalName: input.canonicalName ?? row.canonicalName,
      description: input.description === undefined ? row.description : input.description,
      notes: input.notes === undefined ? row.notes : input.notes,
      status: input.status ?? row.status,
      aliases: input.aliases !== undefined ? input.aliases.map((alias) => alias.value) : undefined,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const updated = await loadEntity(row.id)
  return toAdminEntityDetail(updated!)
}
