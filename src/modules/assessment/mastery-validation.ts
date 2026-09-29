/**
 * GlobIQ — Assessment module: mastery query validation (P7-S4)
 * Master Plan §37 (explicit, typed validation errors — the same zod
 * discipline as every module), §39 (the query contract a mobile client
 * codes against). `unit` scopes the response to the §22 knowledge-page
 * mastery strip; `country`/`language` steer §35 labels + §16 paths only.
 */
import { z } from 'zod'

/** Unit refs are kebab-case slugs or canonical ids (cuid). */
const UNIT_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$|^c[a-z0-9]{20,}$/

export const masteryQuerySchema = z
  .object({
    /** §22 knowledge-page strip: one unit's mastery state. */
    unit: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(UNIT_REF_PATTERN, 'Unit must be a slug or a canonical id')
      .optional(),
    /** §35 label market steering (defaults to the account's home market). */
    country: z.string().trim().min(2).max(8).optional(),
    language: z.string().trim().min(2).max(8).optional(),
  })
  .strict()

export type MasteryQuery = z.infer<typeof masteryQuerySchema>
