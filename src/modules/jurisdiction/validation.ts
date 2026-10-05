/**
 * GKSetu — Jurisdiction module: validation (SITE-S12)
 *
 * Zod schemas for the public + admin inputs (the picker query, the Console
 * cascade, the exam-form's jurisdictionId). Caps are §30 sanity caps: hostile
 * to bots, generous for real learners.
 */
import { z } from 'zod'

export const JURISDICTION_LEVELS = ['INTERNATIONAL', 'CENTRAL', 'STATE', 'DISTRICT'] as const
export type JurisdictionLevelInput = (typeof JURISDICTION_LEVELS)[number]

/** GET /api/jurisdictions?country=&level= — the public picker. */
export const publicJurisdictionsQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  /** Optional filter to limit to one level (default = STATE rows of the country). */
  level: z.enum(JURISDICTION_LEVELS).optional(),
})
export type PublicJurisdictionsQuery = z.infer<typeof publicJurisdictionsQuerySchema>

/** GET /api/jurisdictions/admin — Console admin listing. */
export const adminJurisdictionListQuerySchema = z.object({
  country: z.string().trim().min(2).max(2).optional(),
  level: z.enum(JURISDICTION_LEVELS).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
export type AdminJurisdictionListQuery = z.infer<typeof adminJurisdictionListQuerySchema>

/** The Console create/edit jurisdiction payload (only ADMIN can create). */
export const jurisdictionCreateSchema = z.object({
  level: z.enum(JURISDICTION_LEVELS),
  /** Required for STATE/DISTRICT (ISO 3166-2 suffix), null for CENTRAL/INTERNATIONAL. */
  code: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, 'Code must be uppercase letters/digits with hyphens, e.g. "MH"')
    .nullable()
    .optional(),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(160),
  /** Required for STATE/DISTRICT; null for CENTRAL (the country is implied) / INTERNATIONAL. */
  country: z.string().trim().min(2).max(2).nullable().optional(),
  /** Required for DISTRICT (its parent STATE row's id). */
  parentId: z.string().trim().min(5).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
})
export type JurisdictionCreateInput = z.infer<typeof jurisdictionCreateSchema>

/** The optional `state` query on GET /api/exams — the learner's home state code
 * (ISO 3166-2 suffix), used for jurisdiction-aware relevance ordering. */
export const EXAM_STATE_QUERY = z
  .string()
  .trim()
  .min(2)
  .max(8)
  .regex(/^[A-Z]{2,8}$/, 'state must be a 2-8 letter uppercase code, e.g. "MH"')
  .optional()
