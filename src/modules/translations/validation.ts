/**
 * GlobIQ — Translations module: input validation (P9-S1, §37)
 * zod schemas shared by the API routes; the service re-validates its
 * invariants (defense in depth).
 */
import { z } from 'zod'

import {
  TRANSLATION_SOURCE_TYPES,
  TRANSLATION_STATUSES,
} from './types'

export const translationListSchema = z.object({
  status: z.enum(TRANSLATION_STATUSES).optional(),
  languageCode: z.string().trim().min(2).max(10).optional(),
})

export const translationCreateSchema = z.object({
  sourceType: z.enum(TRANSLATION_SOURCE_TYPES),
  sourceId: z.string().trim().min(1, 'Pick a published source representation'),
  languageCode: z.string().trim().min(2, 'Pick the target language'),
  notes: z.string().trim().max(1000).optional(),
})

export const translationRetireSchema = z.object({
  note: z.string().trim().max(1000).optional(),
})

export type TranslationListParsed = z.infer<typeof translationListSchema>
export type TranslationCreateParsed = z.infer<typeof translationCreateSchema>
export type TranslationRetireParsed = z.infer<typeof translationRetireSchema>
