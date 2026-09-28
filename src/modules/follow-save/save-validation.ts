/**
 * GlobIQ — Follow & Save module: SAVE-half input validation (P5-S2)
 * Master Plan §10 (savable object vocabulary — content objects, NOT exams/
 * topics: those are follows), §37 (explicit field errors), §39 (the mobile
 * client sends the same shapes).
 *
 * objectRef conventions (§37): KNOWLEDGE_UNIT accepts slug-or-id (the public
 * unit identity grammar); CONTENT_ITEM accepts the representation id — the
 * same id the public knowledge page exposes on every representation. EXAM/
 * TOPIC are rejected at validation with a pointer to /api/follows — the §10
 * boundary is structural, not advisory.
 */
import { z } from 'zod'

/** Savable object types today (§10 — kept in lockstep with the Prisma enum). */
export const SAVE_OBJECT_TYPES = ['KNOWLEDGE_UNIT', 'CONTENT_ITEM', 'CURRENT_EVENT', 'QNA'] as const
export type SaveObjectTypeInput = (typeof SAVE_OBJECT_TYPES)[number]

/** Follow vocabulary is rejected with an explicit §10 redirect, not a generic enum error. */
export const FOLLOW_ONLY_TYPES = ['EXAM', 'TOPIC', 'ENTITY'] as const

const objectRefField = z
  .string()
  .trim()
  .min(2, 'Pick what you want to save')
  .max(120, 'Object reference is too long')

/** The §10 boundary message shared by create + state schemas. */
const followRedirectMessage =
  'Exams, topics and entities are followed, not saved (§10). Use POST /api/follows.'

const saveObjectType = z
  .string()
  .transform((value) => value.trim().toUpperCase())
  .superRefine((value, ctx) => {
    if ((FOLLOW_ONLY_TYPES as readonly string[]).includes(value)) {
      ctx.addIssue({ code: 'custom', message: followRedirectMessage })
      return
    }
    if (!(SAVE_OBJECT_TYPES as readonly string[]).includes(value)) {
      ctx.addIssue({
        code: 'custom',
        message:
          'objectType must be KNOWLEDGE_UNIT, CONTENT_ITEM, CURRENT_EVENT or QNA (Question/MockTest join with P7-S2/S3)',
      })
    }
  }) as unknown as z.ZodType<SaveObjectTypeInput>

/** POST /api/saves body. `collectionId` is optional — default "Saved" when absent. */
export const saveCreateSchema = z.object({
  objectType: saveObjectType,
  objectRef: objectRefField,
  collectionId: z
    .string()
    .trim()
    .regex(/^c[a-z0-9]{20,}$/, 'Invalid collection id')
    .optional(),
})
export type SaveCreateInput = z.infer<typeof saveCreateSchema>

/** GET /api/saves query — optional type/collection filters + §35 label context. */
export const saveListQuerySchema = z.object({
  type: z.enum(SAVE_OBJECT_TYPES).optional(),
  collection: z
    .string()
    .trim()
    .regex(/^c[a-z0-9]{20,}$/, 'Invalid collection id')
    .optional(),
  country: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
})
export type SaveListQuery = z.infer<typeof saveListQuerySchema>

/** GET /api/saves/state query — the single-object button state. */
export const saveStateQuerySchema = z.object({
  objectType: saveObjectType,
  objectRef: objectRefField,
})
export type SaveStateQuery = z.infer<typeof saveStateQuerySchema>

/** DELETE /api/saves/[id] param — the saved-item row id returned by list/POST. */
export const saveIdSchema = z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'Invalid save id')

/** PATCH /api/saves/[id] body — move the item to another collection. */
export const saveMoveSchema = z.object({
  collectionId: z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'Invalid collection id'),
})
export type SaveMoveInput = z.infer<typeof saveMoveSchema>

/** POST /api/collections body. */
export const collectionNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the collection a name')
  .max(60, 'Collection names stay under 60 characters')
export const collectionCreateSchema = z.object({ name: collectionNameSchema })
export type CollectionCreateInput = z.infer<typeof collectionCreateSchema>

/** PATCH /api/collections/[id] body. */
export const collectionUpdateSchema = z.object({ name: collectionNameSchema })
export type CollectionUpdateInput = z.infer<typeof collectionUpdateSchema>

/** Collection id param. */
export const collectionIdSchema = z
  .string()
  .trim()
  .regex(/^c[a-z0-9]{20,}$/, 'Invalid collection id')
