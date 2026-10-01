/**
 * GKSetu — Entities module: input validation (P6-S3)
 * Master Plan §6 (Entity row), §13 (canonical reference discipline), §14
 * (GLOBAL/COUNTRY scope — explicit country iff COUNTRY), §37 (explicit
 * field errors), §39 (the mobile client sends the same shapes).
 *
 * Slugs are immutable and kebab-case (§16/§36 — the Topic precedent);
 * type/scope are create-time decisions (structural reclassification is a
 * new entity, §36).
 */
import { z } from 'zod'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const entitySlugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(64, 'Slug must be at most 64 characters')
  .regex(SLUG_PATTERN, 'Slug must be lowercase kebab-case (letters, digits, single hyphens)')

export const ENTITY_TYPE_INPUTS = ['PERSON', 'PLACE', 'ORGANISATION', 'CONCEPT'] as const
export const ENTITY_SCOPE_INPUTS = ['GLOBAL', 'COUNTRY'] as const
export const ENTITY_STATUS_INPUTS = ['ACTIVE', 'RETIRED'] as const

/** One alias input — value plus optional ISO language code (§6/§13). */
export const entityAliasInputSchema = z.object({
  value: z.string().trim().min(1, 'Alias value is required').max(120),
  language: z.string().trim().min(2).max(8).toLowerCase().optional(),
})

export const createEntitySchema = z
  .object({
    canonicalName: z.string().trim().min(2, 'Canonical name must be at least 2 characters').max(160),
    slug: entitySlugSchema.optional(), // omitted ⇒ derived from the name
    description: z.string().trim().max(2000).optional(),
    type: z.enum(ENTITY_TYPE_INPUTS, { message: 'type must be PERSON, PLACE, ORGANISATION or CONCEPT' }),
    scope: z.enum(ENTITY_SCOPE_INPUTS).default('GLOBAL'),
    /** ISO code of the owning country — required when scope = COUNTRY (§14). */
    country: z.string().trim().min(2).max(8).optional(),
    notes: z.string().trim().max(2000).optional(),
    aliases: z.array(entityAliasInputSchema).max(20, 'At most 20 aliases per entity').optional(),
  })
  .superRefine((data, ctx) => {
    // GLOBAL entities must not carry a country (role-independent invariant);
    // COUNTRY+missing-country is resolved in the service (a country admin's
    // home market may be implied, the CurrentEvent precedent).
    if (data.scope === 'GLOBAL' && data.country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['country'],
        message: 'Global entities must not specify a country',
      })
    }
    // Duplicate alias values would fight the [entityId, value] unique.
    const values = (data.aliases ?? []).map((alias) => alias.value.toLowerCase())
    if (new Set(values).size !== values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aliases'],
        message: 'Alias values must be unique (case-insensitive)',
      })
    }
  })

export type CreateEntityInput = z.infer<typeof createEntitySchema>

export const updateEntitySchema = z
  .object({
    canonicalName: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    /** §36 status flips: RETIRE (soft-delete) / reactivate. */
    status: z.enum(ENTITY_STATUS_INPUTS).optional(),
    /** Replaces the alias set wholesale (empty array clears). */
    aliases: z.array(entityAliasInputSchema).max(20).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })

export type UpdateEntityInput = z.infer<typeof updateEntitySchema>

/** GET /api/entities/admin query — filters + pagination (§37 deterministic). */
export const adminEntityListQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  type: z.enum(ENTITY_TYPE_INPUTS).optional(),
  status: z.enum(ENTITY_STATUS_INPUTS).optional(),
  scope: z.enum(ENTITY_SCOPE_INPUTS).optional(),
  country: z.string().trim().min(2).max(8).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export type AdminEntityListQuery = z.infer<typeof adminEntityListQuerySchema>
