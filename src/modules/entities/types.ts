/**
 * GlobIQ — Entities module: DTOs (P6-S3)
 * Master Plan §6 (Entity row: "Person/place/org/concept etc. — id, type,
 * canonical name, aliases, country"), §12 step 3 (attach entities to
 * CurrentEvents), §13 (the canonical-reference philosophy: stable ids,
 * aliases, country applicability), §14 (GLOBAL/COUNTRY scope — the Topic
 * precedent), §17 (entity names/aliases are first-class search terms via
 * event documents), §36 (soft-delete only — RETIRED entities stop new
 * links, existing links stay as honest history), §37 (client-agnostic
 * DTOs, server-computed affordances), §38 (scoped console surface).
 */

/** §6 Entity type vocabulary. */
export type EntityTypePublic = 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'

export const ENTITY_TYPES: EntityTypePublic[] = ['PERSON', 'PLACE', 'ORGANISATION', 'CONCEPT']

/** Human-readable one-liners for UI + docs. */
export const ENTITY_TYPE_LABELS: Record<EntityTypePublic, string> = {
  PERSON: 'Person',
  PLACE: 'Place',
  ORGANISATION: 'Organisation',
  CONCEPT: 'Concept',
}

/** §36 lifecycle: ACTIVE is live; RETIRED is soft-deleted (read-only history). */
export type EntityStatusPublic = 'ACTIVE' | 'RETIRED'

export const ENTITY_STATUSES: EntityStatusPublic[] = ['ACTIVE', 'RETIRED']

/** §14 scope — same vocabulary as Topic/KnowledgeUnit/CurrentEvent. */
export type EntityScopePublic = 'GLOBAL' | 'COUNTRY'

export const ENTITY_SCOPES: EntityScopePublic[] = ['GLOBAL', 'COUNTRY']

/** One alias row (§6 "aliases" — the TopicAlias §13 precedent). */
export interface EntityAliasRef {
  id: string
  value: string
  /** ISO language code when the alias is language-specific; null = neutral. */
  languageCode: string | null
}

/** List row (admin). */
export interface AdminEntity {
  id: string
  slug: string
  canonicalName: string
  description: string | null
  type: EntityTypePublic
  status: EntityStatusPublic
  scope: EntityScopePublic
  countryIso: string | null
  notes: string | null
  aliasCount: number
  eventCount: number
  createdAt: string
  updatedAt: string
}

/** Detail (admin): aliases + the events referencing this entity (§37). */
export interface AdminEntityDetail extends AdminEntity {
  aliases: EntityAliasRef[]
  /** §12 step 3 — events that link this entity (label + count surface). */
  events: Array<{
    eventId: string
    eventSlug: string
    eventTitle: string
    lifecycleState: string
    note: string | null
    linkedAt: string
  }>
  /** §36/§37 — RETIRED entities are read-only; reactivation restores edits. */
  editable: boolean
}

export interface EntityPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminEntityListResult {
  entities: AdminEntity[]
  pagination: EntityPagination
  /** Counts across the visible scope — the registry overview. */
  summary: { total: number; ACTIVE: number; RETIRED: number }
}
