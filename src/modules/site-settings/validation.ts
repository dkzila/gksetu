/**
 * GKSetu — Site Settings: request validation (CONSOLE-S1).
 * Zod schemas mirroring the module's service inputs (the country-locale
 * validation precedent).
 */
import { z } from 'zod'

/** Page-slugs reserve the top-level URL space; settings never do. */
export const settingKeySchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/, 'Keys are dotted, lowercase-starting, ≥2 segments (e.g. integration.ga.measurementId)')

export const settingValueSchema = z.string().max(200_000)

export const settingsEntrySchema = z.object({
  key: settingKeySchema,
  value: settingValueSchema,
  /** Empty string clears the value (the injector skips empties). */
  countryIso: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullish(),
  isActive: z.boolean().optional(),
})

export const settingsUpsertSchema = z.object({
  entries: z.array(settingsEntrySchema).min(1).max(50),
})

export const settingsRemoveSchema = z.object({
  key: settingKeySchema,
  countryIso: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullish(),
})

export type SettingsUpsertInput = z.infer<typeof settingsUpsertSchema>
export type SettingsRemoveInput = z.infer<typeof settingsRemoveSchema>
