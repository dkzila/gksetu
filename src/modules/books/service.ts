/**
 * GKSetu — Books: domain service (SITE-S15)
 *
 * The marketplace registry's domain service. Three responsibilities:
 *
 * 1. Public reads: the store directory (GET /api/store) + the book detail
 *    (GET /api/store/{slug}) + the exam-linked autosuggest (GET /api/store?exam={slug}).
 * 2. Admin CRUD: create/update/transition books + editions + exam links (the
 *    §19/§36 editorial workflow — DRAFT → PUBLISHED → RETIRED → PUBLISHED).
 * 3. The projection: toPublicBookSummary / toPublicBookDetail (server-only —
 *    never leaks internal ids beyond what the client needs).
 *
 * §14: a book belongs to ONE country (magazines can be country-specific). The
 * store directory is country-scoped (the resolved market's books). The book
 * detail page can be read across markets (the canonical URL is /store/{slug}/).
 *
 * §35: the language fallback chain — the user's preferred language → the
 * market default → the book's first available edition.
 */
import type { Prisma, Book, BookEdition, BookStatus, BookType } from '@prisma/client'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  findActiveCountryByIso,
  getPublicCountry,
  resolveLocaleContext,
  LocaleError,
} from '@/modules/country-locale'
import { findExam } from '@/modules/exams-syllabus'
import { findActiveLanguageByCode } from '@/modules/country-locale'

import {
  BOOK_TRANSITIONS,
  BOOK_TYPE_LABELS,
} from './types'
import type {
  AdminBook,
  AdminBookDetail,
  AdminBookListResult,
  BookTransitionAction,
  PublicBookDetail,
  PublicBookEdition,
  PublicBookSummary,
  PublicExamBooksResult,
  PublicStoreDirectory,
} from './types'
import type {
  AdminBookListQuery,
  BookCreateInput,
  BookEditionCreateInput,
  BookEditionUpdateInput,
  BookExamLinkInput,
  BookTransitionInput,
  BookUpdateInput,
  PublicStoreQuery,
} from './validation'

// ---------- Typed domain errors ----------

export type BookErrorCode =
  | 'BOOK_NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'COUNTRY_NOT_FOUND'
  | 'LANGUAGE_NOT_FOUND'
  | 'EDITION_NOT_FOUND'
  | 'EXAM_NOT_FOUND'
  | 'DUPLICATE_EXAM_LINK'
  | 'DUPLICATE_EDITION'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'COUNTRY_MISMATCH'

const ERROR_STATUS: Record<BookErrorCode, number> = {
  BOOK_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  COUNTRY_NOT_FOUND: 404,
  LANGUAGE_NOT_FOUND: 404,
  EDITION_NOT_FOUND: 404,
  EXAM_NOT_FOUND: 404,
  DUPLICATE_EXAM_LINK: 409,
  DUPLICATE_EDITION: 409,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  COUNTRY_MISMATCH: 403,
}

export class BookError extends Error {
  readonly code: BookErrorCode
  readonly status: number

  constructor(code: BookErrorCode, message: string) {
    super(message)
    this.name = 'BookError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toBookErrorResponse(
  error: unknown
): { message: string; code: BookErrorCode; status: number } | null {
  if (error instanceof BookError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

function priceLabel(price: number): string {
  if (price === 0) return 'Free'
  return `₹${(price / 100).toLocaleString('en-IN')}`
}

async function loadLanguageByCode(code: string) {
  const language = await findActiveLanguageByCode(code.toLowerCase())
  if (!language) throw new BookError('LANGUAGE_NOT_FOUND', `Language "${code}" not found`)
  return language
}

// ---------- Public reads ----------

/** GET /api/store — the public store directory (filters + facets + pagination). */
export async function getStoreDirectory(query: PublicStoreQuery): Promise<PublicStoreDirectory> {
  const cacheKey = `store:directory:${query.country ?? 'default'}:${query.language ?? 'default'}:${query.type ?? ''}:${query.category ?? ''}:${query.exam ?? ''}:${query.q ?? ''}:${query.page}:${query.pageSize}`
  return cachedPayload(cacheKey, () => loadStoreDirectory(query))
}

async function loadStoreDirectory(query: PublicStoreQuery): Promise<PublicStoreDirectory> {
  // Resolve the market context (§14/§35).
  let resolution
  try {
    resolution = await resolveLocaleContext({ country: query.country, language: query.language })
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new BookError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }
  const [countryRow, country] = await Promise.all([
    findActiveCountryByIso(resolution.country.isoCode),
    getPublicCountry(resolution.country.isoCode),
  ])
  if (!countryRow || !country) {
    throw new BookError('COUNTRY_NOT_FOUND', `Country "${resolution.country.isoCode}" not found`)
  }

  // Build the where clause.
  const where: Prisma.BookWhereInput = {
    status: 'PUBLISHED',
    // §14: country-scoped (the book's countryId matches the resolved market,
    // OR the book has no country = global). The latter for NOTE_COMPILATION
    // books that span markets (rare in v1).
    OR: [{ countryId: countryRow.id }, { countryId: null }],
  }
  if (query.type) where.type = query.type
  if (query.category) where.category = query.category
  if (query.q) {
    where.OR = [
      ...(where.OR ?? []),
      { title: { contains: query.q, mode: 'insensitive' } },
      { subtitle: { contains: query.q, mode: 'insensitive' } },
      { author: { contains: query.q, mode: 'insensitive' } },
    ]
  }

  // Exam filter — the autosuggest: if ?exam={slug} is given, return only the
  // books linked to that exam.
  let examBooksResult: PublicExamBooksResult | null = null
  if (query.exam) {
    examBooksResult = await getExamBooks(query.exam, query)
    // The exam-books result already carries the primary/supplementary split.
    // We'll return it as the directory's books (paginated as a flat list).
    const allBooks = [...examBooksResult.primary, ...examBooksResult.supplementary]
    const start = (query.page - 1) * query.pageSize
    const paged = allBooks.slice(start, start + query.pageSize)
    return {
      books: paged,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: allBooks.length,
        totalPages: Math.max(1, Math.ceil(allBooks.length / query.pageSize)),
      },
      facets: { categories: [], types: [], languages: [] },
      country: { isoCode: countryRow.isoCode, name: country.name },
      language: {
        code: resolution.language.code,
        name: resolution.language.name,
        nativeName: resolution.language.nativeName,
      },
    }
  }

  const [rows, total] = await Promise.all([
    db.book.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        editions: {
          where: { isActive: true },
          include: { language: { select: { code: true, name: true, nativeName: true } } },
        },
        examLinks: { select: { exam: { select: { slug: true } } } },
      },
    }),
    db.book.count({ where }),
  ])

  // Build the facets (the categories + types + languages from the full set).
  const [categories, types, languages] = await Promise.all([
    db.book.findMany({
      where: { ...where, category: { not: null } },
      distinct: ['category'],
      select: { category: true },
    }),
    db.book.findMany({ where, distinct: ['type'], select: { type: true } }),
    db.bookEdition.findMany({
      where: { book: where, isActive: true },
      distinct: ['languageId'],
      select: { language: { select: { code: true, name: true, nativeName: true } } },
    }),
  ])

  return {
    books: rows.map((row) => toPublicBookSummary(row, country)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    facets: {
      categories: categories.map((c) => c.category ?? '').filter(Boolean),
      types: types.map((t) => t.type),
      languages: languages.map((l) => l.language),
    },
    country: { isoCode: countryRow.isoCode, name: country.name },
    language: {
      code: resolution.language.code,
      name: resolution.language.name,
      nativeName: resolution.language.nativeName,
    },
  }
}

/** The exam-linked books (the autosuggest's source — primary vs supplementary). */
export async function getExamBooks(
  examRef: string,
  query?: PublicStoreQuery
): Promise<PublicExamBooksResult> {
  const cacheKey = `store:exam-books:${examRef}:${query?.language ?? ''}`
  return cachedPayload(cacheKey, () => loadExamBooks(examRef, query))
}

async function loadExamBooks(
  examRef: string,
  query?: PublicStoreQuery
): Promise<PublicExamBooksResult> {
  const exam = await findExam(examRef)
  if (!exam) throw new BookError('EXAM_NOT_FOUND', `Exam "${examRef}" not found`)

  const links = await db.bookExamLink.findMany({
    where: { examId: exam.id },
    orderBy: [{ relevance: 'asc' }, { sortOrder: 'asc' }], // primary first, then supplementary
    select: {
      relevance: true,
      book: {
        include: {
          editions: {
            where: { isActive: true },
            include: { language: { select: { code: true, name: true, nativeName: true } } },
          },
        },
      },
    },
  })

  const country = await getPublicCountry(exam.countryId ? (await db.country.findUnique({ where: { id: exam.countryId }, select: { isoCode: true } }))?.isoCode ?? 'IN' : 'IN')
  if (!country) throw new BookError('COUNTRY_NOT_FOUND', 'Exam\'s country not found')

  const primary: PublicBookSummary[] = []
  const supplementary: PublicBookSummary[] = []
  for (const link of links) {
    const summary = toPublicBookSummary(link.book, country)
    if (link.relevance === 'primary') primary.push(summary)
    else supplementary.push(summary)
  }
  return {
    exam: { slug: exam.slug, name: exam.name, code: exam.code },
    primary,
    supplementary,
  }
}

/** GET /api/store/{slug} — the book detail page payload. */
export async function getBookDetail(slug: string, input: { language?: string }): Promise<PublicBookDetail> {
  const cacheKey = `store:detail:${slug}:${input.language ?? ''}`
  return cachedPayload(cacheKey, () => loadBookDetail(slug, input))
}

async function loadBookDetail(slug: string, input: { language?: string }): Promise<PublicBookDetail> {
  const book = await db.book.findUnique({
    where: { slug: slug.toLowerCase() },
    include: {
      editions: {
        where: { isActive: true },
        include: { language: { select: { code: true, name: true, nativeName: true } } },
        orderBy: [{ format: 'asc' }, { price: 'asc' }],
      },
      examLinks: {
        select: {
          relevance: true,
          sortOrder: true,
          exam: { select: { slug: true, name: true } },
        },
        orderBy: [{ relevance: 'asc' }, { sortOrder: 'asc' }],
      },
      country: { select: { isoCode: true } },
    },
  })
  if (!book || book.status !== 'PUBLISHED') {
    throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  }

  const country = await getPublicCountry(book.country?.isoCode ?? 'IN')
  if (!country) throw new BookError('COUNTRY_NOT_FOUND', 'Book\'s country not found')

  const base = toPublicBookSummary(book, country)

  // Related books — same category + same type, excluding this one.
  const related = await db.book.findMany({
    where: {
      status: 'PUBLISHED',
      id: { not: book.id },
      OR: [
        { category: book.category, type: book.type },
        { type: book.type, category: book.category },
      ],
      category: book.category,
      type: book.type,
    },
    take: 4,
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
    include: {
      editions: {
        where: { isActive: true },
        include: { language: { select: { code: true, name: true, nativeName: true } } },
      },
      examLinks: { select: { exam: { select: { slug: true } } } },
    },
  })

  return {
    ...base,
    fullDescription: book.description,
    allEditions: book.editions.map(toPublicBookEdition),
    linkedExams: book.examLinks.map((link) => ({
      slug: link.exam.slug,
      name: link.exam.name,
      relevance: link.relevance,
    })),
    relatedBooks: related.map((row) => toPublicBookSummary(row, country)),
  }
}

// ---------- Projection ----------

type BookWithEditions = Book & {
  editions: Array<BookEdition & {
    language: { code: string; name: string; nativeName: string | null }
  }>
  examLinks?: Array<{ exam: { slug: string } }>
}

function toPublicBookEdition(
  edition: BookEdition & { language: { code: string; name: string; nativeName: string | null } }
): PublicBookEdition {
  return {
    id: edition.id,
    format: edition.format,
    language: edition.language,
    price: edition.price,
    priceLabel: priceLabel(edition.price),
    fileUrl: edition.fileUrl,
    pageCount: edition.pageCount,
    isbn: edition.isbn,
    isActive: edition.isActive,
  }
}

function toPublicBookSummary(
  book: BookWithEditions,
  country: { slug: string; isDefault: boolean; defaultLanguage: { code: string } }
): PublicBookSummary {
  const editions = book.editions.map(toPublicBookEdition)
  const startingPrice = editions.length > 0 ? Math.min(...editions.map((e) => e.price)) : 0
  return {
    id: book.id,
    slug: book.slug,
    type: book.type,
    title: book.title,
    subtitle: book.subtitle,
    description: book.description,
    coverImageUrl: book.coverImageUrl,
    category: book.category,
    author: book.author,
    publishedAt: book.publishedAt?.toISOString() ?? null,
    canonicalPath: `/store/${book.slug}/`,
    editions,
    startingPrice,
    startingPriceLabel: priceLabel(startingPrice),
    examSlugs: book.examLinks?.map((link) => link.exam.slug) ?? [],
  }
}

// ---------- Admin reads ----------

export async function getAdminBooks(
  actor: Actor,
  query: AdminBookListQuery
): Promise<AdminBookListResult> {
  assertCan(actor, 'book:manage')

  const where: Prisma.BookWhereInput = {}
  if (query.type) where.type = query.type
  if (query.status) where.status = query.status
  if (query.category) where.category = query.category
  if (query.country) {
    const countryRow = await db.country.findUnique({
      where: { isoCode: query.country.toUpperCase() },
      select: { id: true },
    })
    if (!countryRow) throw new BookError('COUNTRY_NOT_FOUND', `Country "${query.country}" not found`)
    where.countryId = countryRow.id
  }
  // COUNTRY_ADMIN scope.
  if (actor.role === 'COUNTRY_ADMIN') {
    if (!actor.countryId) throw new BookError('COUNTRY_MISMATCH', 'No country scope on your account')
    where.OR = [{ countryId: actor.countryId }, { countryId: null }]
  }
  if (query.q) {
    where.OR = [
      ...(where.OR ?? []),
      { title: { contains: query.q, mode: 'insensitive' } },
      { author: { contains: query.q, mode: 'insensitive' } },
      { category: { contains: query.q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    db.book.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        country: { select: { isoCode: true, name: true } },
        _count: { select: { editions: true, examLinks: true } },
      },
    }),
    db.book.count({ where }),
  ])

  return {
    books: rows.map(toAdminBook),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getAdminBook(actor: Actor, id: string): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const book = await db.book.findUnique({
    where: { id },
    include: {
      country: { select: { isoCode: true, name: true } },
      editions: {
        orderBy: [{ format: 'asc' }, { price: 'asc' }],
        include: { language: { select: { code: true, name: true } } },
      },
      examLinks: {
        orderBy: [{ relevance: 'asc' }, { sortOrder: 'asc' }],
        select: { id: true, relevance: true, sortOrder: true, exam: { select: { slug: true, name: true } } },
      },
      _count: { select: { editions: true, examLinks: true } },
    },
  })
  if (!book) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  // COUNTRY_ADMIN scope check.
  if (actor.role === 'COUNTRY_ADMIN' && book.countryId && book.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }
  const base = toAdminBook(book)
  return {
    ...base,
    editions: book.editions.map((e) => ({
      id: e.id,
      format: e.format,
      language: e.language,
      price: e.price,
      fileUrl: e.fileUrl,
      pageCount: e.pageCount,
      isbn: e.isbn,
      isActive: e.isActive,
    })),
    examLinks: book.examLinks.map((link) => ({
      id: link.id,
      examSlug: link.exam.slug,
      examName: link.exam.name,
      relevance: link.relevance,
      sortOrder: link.sortOrder,
    })),
  }
}

function toAdminBook(
  row: Book & {
    country: { isoCode: string; name: string } | null
    _count: { editions: number; examLinks: number }
  }
): AdminBook {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    status: row.status,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    category: row.category,
    author: row.author,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    sortOrder: row.sortOrder,
    countryIso: row.country?.isoCode ?? null,
    countryName: row.country?.name ?? null,
    editionCount: row._count.editions,
    examLinkCount: row._count.examLinks,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    allowedTransitions: Object.keys(
      BOOK_TRANSITIONS[row.status as BookStatus]
    ) as BookTransitionAction[],
  }
}

// ---------- Admin writes ----------

export async function createBook(
  actor: Actor,
  input: BookCreateInput,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')

  // §14: the owning country (null = global, allowed for ADMIN only).
  let countryId: string | null = null
  if (input.country) {
    const countryRow = await db.country.findUnique({
      where: { isoCode: input.country.toUpperCase() },
      select: { id: true },
    })
    if (!countryRow) throw new BookError('COUNTRY_NOT_FOUND', `Country "${input.country}" not found`)
    if (actor.role === 'COUNTRY_ADMIN' && countryRow.id !== actor.countryId) {
      throw new BookError('COUNTRY_MISMATCH', 'You can only create books for your own country')
    }
    countryId = countryRow.id
  } else if (actor.role === 'COUNTRY_ADMIN') {
    countryId = actor.countryId
  }

  // Stable identity (§37): unique slug.
  const slugTaken = await db.book.findUnique({ where: { slug: input.slug }, select: { id: true } })
  if (slugTaken) throw new BookError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)

  const book = await db.book.create({
    data: {
      slug: input.slug,
      type: input.type,
      status: 'DRAFT',
      title: input.title,
      subtitle: input.subtitle ?? null,
      description: input.description,
      coverImageUrl: input.coverImageUrl ?? null,
      category: input.category ?? null,
      author: input.author ?? null,
      countryId,
      publishedAt: input.publishedAt ?? null,
      createdById: actor.userId,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookCreate,
    objectType: AUDIT_OBJECT_TYPES.book,
    objectId: book.id,
    objectLabel: book.slug,
    before: null,
    after: { slug: book.slug, type: book.type, status: book.status, countryId: book.countryId },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, book.id)
}

export async function updateBook(
  actor: Actor,
  id: string,
  input: BookUpdateInput,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const existing = await db.book.findUnique({
    where: { id },
    select: { id: true, status: true, countryId: true, slug: true },
  })
  if (!existing) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && existing.countryId && existing.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }
  if (existing.status === 'RETIRED') {
    throw new BookError('STATE_LOCKED', 'Retired books are read-only (§36)')
  }

  // Resolve the country change.
  let countryId: string | null | undefined = undefined
  if (input.country !== undefined) {
    if (input.country === null) {
      countryId = null
    } else {
      const countryRow = await db.country.findUnique({
        where: { isoCode: input.country.toUpperCase() },
        select: { id: true },
      })
      if (!countryRow) throw new BookError('COUNTRY_NOT_FOUND', `Country "${input.country}" not found`)
      if (actor.role === 'COUNTRY_ADMIN' && countryRow.id !== actor.countryId) {
        throw new BookError('COUNTRY_MISMATCH', 'You can only assign books to your own country')
      }
      countryId = countryRow.id
    }
  }

  const updated = await db.book.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.coverImageUrl !== undefined ? { coverImageUrl: input.coverImageUrl } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.author !== undefined ? { author: input.author } : {}),
      ...(input.publishedAt !== undefined ? { publishedAt: input.publishedAt } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(countryId !== undefined ? { countryId } : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookUpdate,
    objectType: AUDIT_OBJECT_TYPES.book,
    objectId: id,
    objectLabel: existing.slug,
    before: { title: existing.slug },
    after: { title: updated.title, countryId: updated.countryId },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, id)
}

export async function transitionBook(
  actor: Actor,
  id: string,
  input: BookTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const existing = await db.book.findUnique({
    where: { id },
    select: { id: true, status: true, countryId: true, slug: true },
  })
  if (!existing) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && existing.countryId && existing.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }

  const target = BOOK_TRANSITIONS[existing.status as BookStatus][input.action as BookTransitionAction]
  if (!target) {
    throw new BookError('INVALID_TRANSITION', `Cannot ${input.action} a ${existing.status} book`)
  }

  const updated = await db.book.update({ where: { id }, data: { status: target } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookTransition,
    objectType: AUDIT_OBJECT_TYPES.book,
    objectId: id,
    objectLabel: existing.slug,
    before: { status: existing.status },
    after: { status: target, action: input.action, reason: input.reason ?? null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, id)
}

// ---------- Editions ----------

export async function createEdition(
  actor: Actor,
  bookId: string,
  input: BookEditionCreateInput,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, slug: true, countryId: true, status: true },
  })
  if (!book) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && book.countryId && book.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }

  const language = await loadLanguageByCode(input.language)

  // Unique constraint: one edition per format per language per book.
  const existing = await db.bookEdition.findFirst({
    where: { bookId, format: input.format, languageId: language.id },
    select: { id: true },
  })
  if (existing) {
    throw new BookError('DUPLICATE_EDITION', `A ${input.format} edition in ${language.code} already exists for this book`)
  }

  await db.bookEdition.create({
    data: {
      bookId,
      format: input.format,
      languageId: language.id,
      price: input.price,
      fileUrl: input.fileUrl ?? null,
      pageCount: input.pageCount ?? null,
      isbn: input.isbn ?? null,
      isActive: input.isActive,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookEditionCreate,
    objectType: AUDIT_OBJECT_TYPES.bookEdition,
    objectId: bookId,
    objectLabel: `${book.slug} · ${input.format} · ${language.code}`,
    before: null,
    after: { format: input.format, language: language.code, price: input.price },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, bookId)
}

export async function updateEdition(
  actor: Actor,
  bookId: string,
  editionId: string,
  input: BookEditionUpdateInput,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, slug: true, countryId: true },
  })
  if (!book) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && book.countryId && book.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }

  const edition = await db.bookEdition.findUnique({ where: { id: editionId }, select: { id: true, bookId: true } })
  if (!edition || edition.bookId !== bookId) {
    throw new BookError('EDITION_NOT_FOUND', 'Edition not found in this book')
  }

  await db.bookEdition.update({
    where: { id: editionId },
    data: {
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.fileUrl !== undefined ? { fileUrl: input.fileUrl } : {}),
      ...(input.pageCount !== undefined ? { pageCount: input.pageCount } : {}),
      ...(input.isbn !== undefined ? { isbn: input.isbn } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookEditionUpdate,
    objectType: AUDIT_OBJECT_TYPES.bookEdition,
    objectId: editionId,
    objectLabel: `${book.slug} · ${editionId.slice(-8)}`,
    before: null,
    after: { price: input.price, isActive: input.isActive },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, bookId)
}

export async function removeEdition(
  actor: Actor,
  bookId: string,
  editionId: string,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, slug: true, countryId: true },
  })
  if (!book) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && book.countryId && book.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }

  const edition = await db.bookEdition.findUnique({ where: { id: editionId }, select: { id: true, bookId: true, format: true, language: { select: { code: true } } } })
  if (!edition || edition.bookId !== bookId) {
    throw new BookError('EDITION_NOT_FOUND', 'Edition not found in this book')
  }

  await db.bookEdition.delete({ where: { id: editionId } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookEditionRemove,
    objectType: AUDIT_OBJECT_TYPES.bookEdition,
    objectId: editionId,
    objectLabel: `${book.slug} · ${edition.format} · ${edition.language?.code ?? ''}`,
    before: { format: edition.format, language: edition.language?.code },
    after: null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, bookId)
}

// ---------- Exam links ----------

export async function linkExam(
  actor: Actor,
  bookId: string,
  input: BookExamLinkInput,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, slug: true, countryId: true },
  })
  if (!book) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && book.countryId && book.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }

  const exam = await findExam(input.examRef)
  if (!exam) throw new BookError('EXAM_NOT_FOUND', `Exam "${input.examRef}" not found`)

  const existing = await db.bookExamLink.findFirst({
    where: { bookId, examId: exam.id },
    select: { id: true },
  })
  if (existing) {
    throw new BookError('DUPLICATE_EXAM_LINK', `This book is already linked to ${exam.name}`)
  }

  await db.bookExamLink.create({
    data: { bookId, examId: exam.id, relevance: input.relevance },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookExamLink,
    objectType: AUDIT_OBJECT_TYPES.bookExamLink,
    objectId: bookId,
    objectLabel: `${book.slug} · ${exam.slug} (${input.relevance})`,
    before: null,
    after: { examId: exam.id, relevance: input.relevance },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, bookId)
}

export async function unlinkExam(
  actor: Actor,
  bookId: string,
  examLinkId: string,
  meta: AuditRequestMeta = {}
): Promise<AdminBookDetail> {
  assertCan(actor, 'book:manage')
  const book = await db.book.findUnique({
    where: { id: bookId },
    select: { id: true, slug: true, countryId: true },
  })
  if (!book) throw new BookError('BOOK_NOT_FOUND', 'Book not found')
  if (actor.role === 'COUNTRY_ADMIN' && book.countryId && book.countryId !== actor.countryId) {
    throw new BookError('COUNTRY_MISMATCH', 'This book belongs to another market')
  }

  const link = await db.bookExamLink.findUnique({
    where: { id: examLinkId },
    select: { id: true, bookId: true, exam: { select: { slug: true } } },
  })
  if (!link || link.bookId !== bookId) {
    throw new BookError('EXAM_NOT_FOUND', 'Exam link not found in this book')
  }

  await db.bookExamLink.delete({ where: { id: examLinkId } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.bookExamUnlink,
    objectType: AUDIT_OBJECT_TYPES.bookExamLink,
    objectId: examLinkId,
    objectLabel: `${book.slug} · ${link.exam.slug}`,
    before: { examSlug: link.exam.slug },
    after: null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return getAdminBook(actor, bookId)
}
