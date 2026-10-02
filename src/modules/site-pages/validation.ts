/**
 * GKSetu — Site Pages: request validation (CONSOLE-S1).
 */
import { z } from 'zod'

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slugs are kebab-case (a-z, 0-9, hyphens)')

const seoTitleSchema = z.string().max(120).nullish()
const seoDescriptionSchema = z.string().max(320).nullish()

export const createPageSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  body: z.string().max(500_000),
  showInFooter: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  seoTitle: seoTitleSchema,
  seoDescription: seoDescriptionSchema,
})

export const updatePageSchema = z
  .object({
    slug: slugSchema.optional(), // accepted but must equal the stored slug (immutable)
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(500_000).optional(),
    showInFooter: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    seoTitle: seoTitleSchema,
    seoDescription: seoDescriptionSchema,
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' })

export const transitionPageSchema = z.object({
  action: z.enum(['publish', 'unpublish']),
})

export type CreatePageInput = z.infer<typeof createPageSchema>
export type UpdatePageInput = z.infer<typeof updatePageSchema>
export type TransitionPageInput = z.infer<typeof transitionPageSchema>
