/**
 * GlobIQ — Identity & Access: request validation
 * Master Plan §37 (API Principles): explicit validation errors, client-agnostic.
 */
import { z } from 'zod'

import { fieldErrors } from '@/lib/validation'

export { fieldErrors }

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address')

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number')

/** POST /api/auth/register */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Name cannot be empty').max(80, 'Name is too long').optional(),
  homeCountryIso: z.string().trim().length(2, 'Use a 2-letter ISO code').optional(),
  preferredLanguageCode: z.string().trim().min(2).max(8).optional(),
  /** Optional device/app label for the session (e.g. "Web — Chrome"). */
  label: z.string().trim().min(1).max(64).optional(),
})

/** POST /api/auth/login */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  label: z.string().trim().min(1).max(64).optional(),
})

/**
 * PATCH /api/profile (P5-S3) — self-service profile basics. Every field is
 * optional (present = update; absent = keep); explicit null clears (name,
 * country, language). The §35 country×language rule is enforced in the
 * service against the same registry registration uses — one truth.
 */
export const profileUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name cannot be empty')
      .max(80, 'Name is too long')
      .nullable()
      .optional(),
    homeCountryIso: z
      .string()
      .trim()
      .length(2, 'Use a 2-letter ISO code')
      .nullable()
      .optional(),
    preferredLanguageCode: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  })

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>
