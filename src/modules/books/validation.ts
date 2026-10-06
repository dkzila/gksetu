/**
 * GKSetu — Books module: validation (SITE-S15)
 * Zod schemas for the admin inputs (create/update/transition/editions/exam-links).
 */
import { z } from 'zod'

export const BOOK_TYPES = ['BOOK', 'MAGAZINE', 'NOTE_COMPILATION', 'CURRENT_AFFAIRS_DIGEST'] as const
export const BOOK_FORMATS = ['PDF', 'PRINT'] as const
export const BOOK_TRANSITION_ACTIONS = ['publish', 'retire', 'reactivate'] as const
export const BOOK_EXAM_RELEVANCE = ['primary', 'supplementary'] as const

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const bookSlugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(96, 'Slug must be at most 96 characters')
  .regex(SLUG_PATTERN, 'Slug must be lowercase kebab-case (letters, digits, single hyphens)')

/** POST /api/books/admin — create. */
export const bookCreateSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  slug: bookSlugSchema,
  type: z.enum(BOOK_TYPES).default('BOOK'),
  subtitle: z.string().trim().max(200).optional(),
  description: z.string().trim().min(20, 'Description must be at least 20 characters').max(20_000),
  coverImageUrl: z.string().trim().url().nullable().optional(),
  category: z.string().trim().min(2).max(60).optional(),
  author: z.string().trim().min(2).max(120).optional(),
  country: z.string().trim().min(2).max(2).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
})
export type BookCreateInput = z.infer<typeof bookCreateSchema>

/** PATCH /api/books/admin/{id} — edit. */
export const bookUpdateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  subtitle: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().min(20).max(20_000).optional(),
  coverImageUrl: z.string().trim().url().nullable().optional(),
  category: z.string().trim().min(2).max(60).nullable().optional(),
  author: z.string().trim().min(2).max(120).nullable().optional(),
  country: z.string().trim().min(2).max(2).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})
export type BookUpdateInput = z.infer<typeof bookUpdateSchema>

/** POST /api/books/admin/{id}/transition. */
export const bookTransitionSchema = z.object({
  action: z.enum(BOOK_TRANSITION_ACTIONS),
  reason: z.string().trim().max(1000).optional(),
})
export type BookTransitionInput = z.infer<typeof bookTransitionSchema>

/** POST /api/books/admin/{id}/editions. */
export const bookEditionCreateSchema = z.object({
  format: z.enum(BOOK_FORMATS),
  language: z.string().trim().min(2).max(8),
  price: z.number().int().min(0).max(1_000_000_00), // 0 to ₹10 lakh (in paise)
  fileUrl: z.string().trim().url().nullable().optional(),
  pageCount: z.number().int().min(1).max(5000).nullable().optional(),
  isbn: z.string().trim().min(10).max(20).nullable().optional(),
  isActive: z.boolean().default(true),
})
export type BookEditionCreateInput = z.infer<typeof bookEditionCreateSchema>

/** PATCH /api/books/admin/{id}/editions/{editionId}. */
export const bookEditionUpdateSchema = z.object({
  price: z.number().int().min(0).max(1_000_000_00).optional(),
  fileUrl: z.string().trim().url().nullable().optional(),
  pageCount: z.number().int().min(1).max(5000).nullable().optional(),
  isbn: z.string().trim().min(10).max(20).nullable().optional(),
  isActive: z.boolean().optional(),
})
export type BookEditionUpdateInput = z.infer<typeof bookEditionUpdateSchema>

/** POST /api/books/admin/{id}/exam-links. */
export const bookExamLinkSchema = z.object({
  examRef: z.string().trim().min(2).max(120),
  relevance: z.enum(BOOK_EXAM_RELEVANCE).default('supplementary'),
})
export type BookExamLinkInput = z.infer<typeof bookExamLinkSchema>

/** GET /api/books/admin — admin listing with filters. */
export const adminBookListQuerySchema = z.object({
  type: z.enum(BOOK_TYPES).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'RETIRED']).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  country: z.string().trim().min(2).max(2).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AdminBookListQuery = z.infer<typeof adminBookListQuerySchema>

/** GET /api/store — public directory. */
export const publicStoreQuerySchema = z.object({
  type: z.enum(BOOK_TYPES).optional(),
  category: z.string().trim().min(2).max(60).optional(),
  exam: z.string().trim().min(2).max(120).optional(), // exam slug — the autosuggest
  language: z.string().trim().min(2).max(8).optional(),
  country: z.string().trim().min(2).max(8).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
})
export type PublicStoreQuery = z.infer<typeof publicStoreQuerySchema>
