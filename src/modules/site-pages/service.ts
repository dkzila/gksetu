/**
 * GKSetu — Site Pages: domain service (CONSOLE-S1)
 * docs/console-master-plan.md §4.2 — the managed static pages (About,
 * Contact, Privacy Policy, terms, anything the team creates). WordPress-
 * simple: one row per page, `body` is the working copy, publishing
 * snapshots it into publishedBody/publishedTitle (the ContentItem→revision
 * pattern collapsed for small single-section documents).
 *
 * URL grammar: the reserved top-level set (about, contact, privacy-policy,
 * terms, disclaimer) renders at /{slug}; every other slug at /p/{slug}.
 * The footer's links come from the published list (showInFooter, sortOrder).
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit, type AuditRequestMeta } from '@/modules/audit'

import type { CreatePageInput, UpdatePageInput, TransitionPageInput } from './validation'

// ---------- The reserved top-level URL space ----------
//
// These slugs render at /{slug} (they precede country parsing — the app
// router treats them as market-independent, like /signin). Anything else a
// team creates lives under /p/{slug}.
export const RESERVED_PAGE_SLUGS = ['about', 'contact', 'privacy-policy', 'terms', 'disclaimer'] as const

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isReservedPageSlug(slug: string): boolean {
  return (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug)
}

// ---------- Types ----------

export interface PublicPageSummary {
  slug: string
  title: string
  sortOrder: number
}

export interface PublicSitePage {
  slug: string
  title: string
  body: string
  seoTitle: string | null
  seoDescription: string | null
  publishedAt: string
  updatedAt: string
}

export interface AdminSitePage {
  id: string
  slug: string
  title: string
  body: string
  status: 'DRAFT' | 'PUBLISHED'
  publishedTitle: string | null
  publishedBody: string | null
  publishedAt: string | null
  showInFooter: boolean
  sortOrder: number
  seoTitle: string | null
  seoDescription: string | null
  updatedAt: string
  updatedBy: { email: string | null } | null
}

export type PageErrorCode =
  | 'SLUG_REJECTED'
  | 'SLUG_TAKEN'
  | 'SLUG_IMMUTABLE'
  | 'NOT_FOUND'
  | 'ALREADY_PUBLISHED'
  | 'NOT_PUBLISHED'
  | 'EMPTY_BODY'

const ERROR_STATUS: Record<PageErrorCode, number> = {
  SLUG_REJECTED: 400,
  SLUG_TAKEN: 409,
  SLUG_IMMUTABLE: 400,
  NOT_FOUND: 404,
  ALREADY_PUBLISHED: 409,
  NOT_PUBLISHED: 409,
  EMPTY_BODY: 400,
}

export class SitePagesError extends Error {
  readonly code: PageErrorCode
  readonly status: number

  constructor(code: PageErrorCode, message: string) {
    super(message)
    this.name = 'SitePagesError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

// ---------- Public reads ----------

/** The footer/nav list: every PUBLISHED page with showInFooter, sorted. */
export async function listPublishedPages(): Promise<PublicPageSummary[]> {
  const rows = await db.sitePage.findMany({
    where: { status: 'PUBLISHED', showInFooter: true },
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    select: { slug: true, title: true, sortOrder: true },
  })
  return rows.map((row) => ({ slug: row.slug, title: row.title, sortOrder: row.sortOrder }))
}

/** The public page render source — the published snapshot, never the working copy. */
export async function getPublishedPage(slug: string): Promise<PublicSitePage> {
  const row = await db.sitePage.findUnique({ where: { slug } })
  if (!row || row.status !== 'PUBLISHED' || row.publishedBody === null) {
    throw new SitePagesError('NOT_FOUND', `Page "${slug}" not found`)
  }
  return {
    slug: row.slug,
    title: row.publishedTitle ?? row.title,
    body: row.publishedBody,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------- Admin reads (pages:manage) ----------

export async function listAllPages(): Promise<AdminSitePage[]> {
  const rows = await db.sitePage.findMany({
    orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      slug: true,
      title: true,
      body: true,
      status: true,
      publishedTitle: true,
      publishedBody: true,
      publishedAt: true,
      showInFooter: true,
      sortOrder: true,
      seoTitle: true,
      seoDescription: true,
      updatedAt: true,
      createdBy: { select: { email: true } },
    },
  })
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    status: row.status,
    publishedTitle: row.publishedTitle,
    publishedBody: row.publishedBody,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    showInFooter: row.showInFooter,
    sortOrder: row.sortOrder,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.createdBy ? { email: row.createdBy.email } : null,
  }))
}

export async function getPageById(id: string): Promise<AdminSitePage> {
  const rows = await listAllPages()
  const row = rows.find((entry) => entry.id === id)
  if (!row) throw new SitePagesError('NOT_FOUND', 'Page not found')
  return row
}

// ---------- Writes (pages:manage — ADMIN only in v1) ----------

function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug) || slug.length > 80) {
    throw new SitePagesError('SLUG_REJECTED', `Slug "${slug}" must be kebab-case (a-z, 0-9, hyphens), ≤80 chars`)
  }
}

function auditRef(actor: Actor) {
  return { userId: actor.userId, email: actor.email, role: actor.role }
}

export async function createPage(
  actor: Actor,
  input: CreatePageInput,
  meta: AuditRequestMeta
): Promise<AdminSitePage> {
  assertCan(actor, 'pages:manage')
  assertValidSlug(input.slug)

  const existing = await db.sitePage.findUnique({ where: { slug: input.slug } })
  if (existing) throw new SitePagesError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)

  const row = await db.sitePage.create({
    data: {
      slug: input.slug,
      title: input.title,
      body: input.body,
      showInFooter: input.showInFooter ?? true,
      sortOrder: input.sortOrder ?? 0,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      createdById: actor.userId,
    },
  })

  await recordAudit({
    actor: auditRef(actor),
    action: AUDIT_ACTIONS.sitePageCreate,
    objectType: AUDIT_OBJECT_TYPES.sitePage,
    objectId: row.id,
    objectLabel: row.slug,
    before: null,
    after: { slug: row.slug, title: row.title },
    ...meta,
  })

  return getPageById(row.id)
}

export async function updatePage(
  actor: Actor,
  id: string,
  input: UpdatePageInput,
  meta: AuditRequestMeta
): Promise<AdminSitePage> {
  assertCan(actor, 'pages:manage')

  const existing = await db.sitePage.findUnique({ where: { id } })
  if (!existing) throw new SitePagesError('NOT_FOUND', 'Page not found')

  // The slug is the page's URL identity — immutable after creation (§36's
  // URL-stability rule, the taxonomy-slug precedent).
  if (input.slug !== undefined && input.slug !== existing.slug) {
    throw new SitePagesError('SLUG_IMMUTABLE', 'A page slug is immutable — create a new page (and retire this one) to change its URL')
  }

  await db.sitePage.update({
    where: { id },
    data: {
      title: input.title ?? existing.title,
      body: input.body ?? existing.body,
      showInFooter: input.showInFooter ?? existing.showInFooter,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      seoTitle: input.seoTitle !== undefined ? (input.seoTitle ?? null) : existing.seoTitle,
      seoDescription:
        input.seoDescription !== undefined ? (input.seoDescription ?? null) : existing.seoDescription,
    },
  })

  const updated = await getPageById(id)
  await recordAudit({
    actor: auditRef(actor),
    action: AUDIT_ACTIONS.sitePageUpdate,
    objectType: AUDIT_OBJECT_TYPES.sitePage,
    objectId: id,
    objectLabel: updated.slug,
    before: { title: existing.title, showInFooter: existing.showInFooter, bodyLength: existing.body.length },
    after: { title: updated.title, showInFooter: updated.showInFooter, bodyLength: updated.body.length },
    ...meta,
  })

  return updated
}

export async function deletePage(actor: Actor, id: string, meta: AuditRequestMeta): Promise<void> {
  assertCan(actor, 'pages:manage')

  const existing = await db.sitePage.findUnique({ where: { id } })
  if (!existing) throw new SitePagesError('NOT_FOUND', 'Page not found')

  await db.sitePage.delete({ where: { id } })
  await recordAudit({
    actor: auditRef(actor),
    action: AUDIT_ACTIONS.sitePageDelete,
    objectType: AUDIT_OBJECT_TYPES.sitePage,
    objectId: id,
    objectLabel: existing.slug,
    before: { slug: existing.slug, title: existing.title, status: existing.status },
    after: null,
    ...meta,
  })
}

/**
 * The lifecycle: publish snapshots the working copy (title+body) into the
 * published fields and stamps publishedAt; unpublish withdraws the page
 * from the public surface (the snapshot is kept for the next publish).
 */
export async function transitionPage(
  actor: Actor,
  id: string,
  input: TransitionPageInput,
  meta: AuditRequestMeta
): Promise<AdminSitePage> {
  assertCan(actor, 'pages:manage')

  const existing = await db.sitePage.findUnique({ where: { id } })
  if (!existing) throw new SitePagesError('NOT_FOUND', 'Page not found')

  if (input.action === 'publish') {
    if (existing.status === 'PUBLISHED') {
      throw new SitePagesError('ALREADY_PUBLISHED', 'Page is already published — edit and re-publish to refresh the snapshot')
    }
    if (existing.body.trim() === '') {
      throw new SitePagesError('EMPTY_BODY', 'Cannot publish a page with an empty body')
    }
    await db.sitePage.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedTitle: existing.title,
        publishedBody: existing.body,
        publishedAt: new Date(),
      },
    })
  } else {
    if (existing.status !== 'PUBLISHED') {
      throw new SitePagesError('NOT_PUBLISHED', 'Page is not published')
    }
    await db.sitePage.update({ where: { id }, data: { status: 'DRAFT' } })
  }

  const updated = await getPageById(id)
  await recordAudit({
    actor: auditRef(actor),
    action: AUDIT_ACTIONS.sitePageTransition,
    objectType: AUDIT_OBJECT_TYPES.sitePage,
    objectId: id,
    objectLabel: updated.slug,
    before: { status: existing.status },
    after: { status: updated.status },
    metadata: { action: input.action },
    ...meta,
  })

  return updated
}
