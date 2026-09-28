/**
 * GlobIQ — Follow & Save module: input validation (P5-S1)
 * Master Plan §9 (explicit signals), §10 (followable object vocabulary),
 * §37 (explicit field errors), §39 (the mobile client sends the same shapes).
 *
 * objectRef is the public identity of the followed object — canonical slug
 * or internal id, mirroring the platform-wide ref convention (§37). The
 * service resolves it and enforces the §14 country rules; validation only
 * guarantees shape.
 */
import { z } from 'zod'

/** Followable object types today (§10 — ENTITY joined in P6-S3; current-affairs
 *  themes are taxonomy nodes and ride TOPIC, the §13 Current Affairs domain). */
export const FOLLOW_OBJECT_TYPES = ['EXAM', 'TOPIC', 'ENTITY'] as const
export type FollowObjectTypeInput = (typeof FOLLOW_OBJECT_TYPES)[number]

/** Public ref — slug (kebab-case) or canonical id (cuid). */
const objectRefField = z
  .string()
  .trim()
  .min(2, 'Pick what you want to follow')
  .max(120, 'Object reference is too long')

/** POST /api/follows body. */
export const followCreateSchema = z.object({
  objectType: z.enum(FOLLOW_OBJECT_TYPES, { message: 'objectType must be EXAM, TOPIC or ENTITY' }),
  objectRef: objectRefField,
})
export type FollowCreateInput = z.infer<typeof followCreateSchema>

/** GET /api/follows query — optional type filter + §35 label context. */
export const followListQuerySchema = z.object({
  type: z.enum(FOLLOW_OBJECT_TYPES).optional(),
  country: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
})
export type FollowListQuery = z.infer<typeof followListQuerySchema>

/** GET /api/follows/state query — the single-object button state. */
export const followStateQuerySchema = z.object({
  objectType: z.enum(FOLLOW_OBJECT_TYPES, { message: 'objectType must be EXAM, TOPIC or ENTITY' }),
  objectRef: objectRefField,
})
export type FollowStateQuery = z.infer<typeof followStateQuerySchema>

/** DELETE /api/follows/[id] param — the follow row id returned by list/POST. */
export const followIdSchema = z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'Invalid follow id')
