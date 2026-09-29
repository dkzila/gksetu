/**
 * GlobIQ — Notifications: input validation (P8-S2)
 * Master Plan §37 (explicit validation errors, stable contracts). Three
 * inputs exist: the mark-read body (one batch or all), the preference
 * upsert (exactly one channel × category × enabled per request — one
 * coherent audited operation, the collection-PATCH precedent), and the
 * dispatch sweep (no body — the console action). Category keys validate
 * against the §27 vocabulary shared with the engine's fan-out.
 */
import { z } from 'zod'

import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategoryKey,
} from './notification-types'

const CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((category) => category.key) as [
  NotificationCategoryKey,
  ...NotificationCategoryKey[],
]

/** POST /api/notifications/read — mark one notification (its whole batch) or all as read. */
export const markReadSchema = z
  .object({
    /** The notification's batch id (the feed item's id). */
    batchId: z.string().trim().min(1).max(64).optional(),
    /** Everything unread → READ (the "Mark all read" action). */
    all: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.all) !== Boolean(value.batchId), {
    message: 'Send exactly one of { batchId } or { all: true }',
  })
export type MarkReadInput = z.infer<typeof markReadSchema>

/** PUT /api/notifications/preferences — one per-category × per-channel opt state. */
export const notificationPreferenceSchema = z.object({
  channel: z.enum(['EMAIL', 'WEB_PUSH', 'MOBILE_PUSH'], {
    message: 'Channels are email, web push or mobile push (§27)',
  }),
  category: z.enum(CATEGORY_KEYS, {
    message: 'Unknown notification category (§27)',
  }),
  enabled: z.boolean(),
})
export type NotificationPreferenceInput = z.infer<typeof notificationPreferenceSchema>
