/**
 * GKSetu — Workspaces: request validation (P9-S3)
 *
 * Master Plan §37 (explicit validation errors, client-agnostic).
 * The §35 market×language rule and the §20 scope guards are enforced in the
 * service against the live registries — one truth, same as registration.
 */
import { z } from 'zod'

// Inlined (NOT imported from the identity-access barrel — that barrel's
// service pulls password.ts/scrypt and must never enter a client-reachable
// chain; the per-module small-helper duplication precedent). Keep in sync
// with identity-access/validation.ts.
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address')

/** Workspace staff roles the provisioning surface may grant (§18/§38).
 *  ADMIN is platform-level and lives outside every workspace surface. */
export const STAFF_ROLE_CHOICES = ['WRITER', 'COUNTRY_ADMIN'] as const

export const staffRoleSchema = z.enum(STAFF_ROLE_CHOICES, {
  message: 'Workspace staff roles are WRITER or COUNTRY_ADMIN — ADMIN is platform-level (§38)',
})

const languageScopeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Language code must be at least 2 characters')
  .max(8, 'Language code must be at most 8 characters')

/** POST /api/workspaces/[iso]/staff — invite semantics: no admin-chosen
 *  password; the server generates the one-time credential. */
export const createStaffSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, 'Name cannot be empty').max(80, 'Name is too long').optional(),
  role: staffRoleSchema,
  /** Explicit §20 language scope for the market; null/omitted = all the
   *  market's configured languages. Validated §35 in the service. */
  languageScopeCode: languageScopeSchema.nullable().optional(),
})

/**
 * PATCH /api/workspaces/[iso]/staff/[userId] — every field optional
 * (present = update; explicit null clears the language scope to
 * all-languages). resetCredential mints a fresh one-time password.
 */
export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty').max(80, 'Name is too long').nullable().optional(),
    role: staffRoleSchema.optional(),
    languageScopeCode: languageScopeSchema.nullable().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    resetCredential: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.role !== undefined ||
      value.languageScopeCode !== undefined ||
      value.status !== undefined ||
      value.resetCredential !== undefined,
    { message: 'Provide at least one field to update' }
  )

export type CreateStaffInput = z.infer<typeof createStaffSchema>
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>
