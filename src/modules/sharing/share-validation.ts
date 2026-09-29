/**
 * GlobIQ — Sharing: input validation (P8-S1)
 * Master Plan §37 (explicit validation errors, stable contracts). Two inputs
 * exist: the metadata query (a §16 path — the share URL IS the path) and the
 * event body (a share action or a landing visit). Both accept the SAME path
 * shape the hash router produces, so a mobile client (§39) shares with the
 * exact string the web app renders.
 */
import { z } from 'zod'

/** A §16 path as the app renders it after the hash — origin-agnostic (§37). */
const sharePathSchema = z
  .string()
  .trim()
  .min(1, 'A share path is required')
  .max(512, 'That path is too long')
  .refine((value) => !/^https?:\/\//i.test(value), {
    message: 'Send the path after the hash (e.g. /gk/{topic}/{unit}/), never an absolute URL',
  })

/** GET /api/share/metadata?path=… */
export const shareMetadataQuerySchema = z.object({
  path: sharePathSchema,
})

/** POST /api/share/events — a share action (channel required) or a landing visit. */
export const shareEventSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('SHARE_CREATE'),
    path: sharePathSchema,
    channel: z.enum(['WEB_SHARE', 'COPY_LINK'], {
      message: 'Share actions record how the link left the device (§21)',
    }),
  }),
  z.object({
    action: z.literal('SHARE_LANDING'),
    path: sharePathSchema,
    channel: z.undefined().optional(),
  }),
])

export type ShareMetadataQuery = z.infer<typeof shareMetadataQuerySchema>
export type ShareEventInput = z.infer<typeof shareEventSchema>

/** PATCH /api/collections/{id} — the §21 share opt-in/revoke (follow-save module). */
export const collectionVisibilitySchema = z.object({
  visibility: z.enum(['PRIVATE', 'LINK'], {
    message: 'Collections are either private or shareable via link (§21)',
  }),
})
export type CollectionVisibilityInput = z.infer<typeof collectionVisibilitySchema>
