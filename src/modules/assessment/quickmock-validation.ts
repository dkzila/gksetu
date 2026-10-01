/**
 * GKSetu — Assessment module: combined-exam quick-mock validation (P7-S5)
 * Master Plan §37 (explicit, typed validation errors — the same zod
 * discipline as every module), §39 (the contract a mobile client codes
 * against). The start body carries the §11 scope choice (COMBINED vs one
 * exam ref) + the sizing bounds mirrored from quickmock-types.
 */
import { z } from 'zod'

import {
  QUICK_MOCK_MAX_QUESTIONS,
  QUICK_MOCK_MIN_QUESTIONS,
} from './quickmock-types'

/** Exam refs are kebab-case slugs or canonical ids (cuid) — the §11 engine's input shape. */
const EXAM_REF_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$|^c[a-z0-9]{20,}$/

/** GET /api/mock-tests/quick — §35 market steering only (defaults to the account's home market). */
export const quickMockSetupQuerySchema = z
  .object({
    country: z.string().trim().min(2).max(8).optional(),
    language: z.string().trim().min(2).max(8).optional(),
  })
  .strict()

export type QuickMockSetupQuery = z.infer<typeof quickMockSetupQuerySchema>

/** POST /api/mock-tests/quick — the §22/§11 scope + the sizing choice. */
export const quickMockStartSchema = z
  .object({
    /** §22 combined-exam mode: COMBINED = the §11 union across the caller's
     * eligible exams; EXAM = §11 single-exam mode (one exam in the input set). */
    mode: z.enum(['COMBINED', 'EXAM']),
    /** Required iff mode = 'EXAM' — the §11 engine validates it in-scope. */
    exam: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(EXAM_REF_PATTERN, 'Exam must be a slug or a canonical id')
      .optional(),
    /** The requested composition size (bounded — a quick mock stays quick). */
    questionCount: z
      .number()
      .int()
      .min(QUICK_MOCK_MIN_QUESTIONS)
      .max(QUICK_MOCK_MAX_QUESTIONS)
      .optional(),
    /** §35 label market steering (defaults to the account's home market). */
    country: z.string().trim().min(2).max(8).optional(),
    language: z.string().trim().min(2).max(8).optional(),
  })
  .strict()
  .refine((body) => body.mode !== 'EXAM' || typeof body.exam === 'string', {
    message: 'Single-exam mode needs an exam reference',
    path: ['exam'],
  })
  .refine((body) => body.mode !== 'COMBINED' || body.exam === undefined, {
    message: 'Combined mode takes no exam reference — it spans the whole followed set',
    path: ['exam'],
  })

export type QuickMockStartInput = z.infer<typeof quickMockStartSchema>
