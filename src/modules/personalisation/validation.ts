/**
 * GKSetu — Personalisation module: input validation (P5-S3)
 * Master Plan §6 (UserGoal fields), §9 (explicit signals), §30 (sanity caps),
 * §35 (study language), §37 (explicit field errors), §39 (the mobile client
 * sends the same shapes).
 *
 * PUT /api/goal is a FULL REPLACEMENT (§9: "change goals at any time" — one
 * coherent goal per user, never a patchwork): the body is the complete goal
 * state. `exams`/`topics` accept canonical slugs or ids (§37 ref convention)
 * and may be empty; the optional scalars clear when null/absent.
 */
import { z } from 'zod'

/** §30 sanity caps: generous for real learners, hostile to bots. */
export const MAX_GOAL_EXAMS = 10
export const MAX_GOAL_TOPICS = 25

/** §6 GoalLevel vocabulary (kept in lockstep with the Prisma enum). */
export const GOAL_LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const
export type GoalLevelInput = (typeof GOAL_LEVELS)[number]

/** Public ref — slug (kebab-case) or canonical id (cuid). */
const objectRefField = z
  .string()
  .trim()
  .min(2, 'Pick at least one valid object')
  .max(120, 'Object reference is too long')

/** PUT /api/goal body. */
export const goalSetSchema = z.object({
  exams: z
    .array(objectRefField)
    .max(MAX_GOAL_EXAMS, `A goal can declare at most ${MAX_GOAL_EXAMS} exams`)
    .default([]),
  topics: z
    .array(objectRefField)
    .max(MAX_GOAL_TOPICS, `A goal can declare at most ${MAX_GOAL_TOPICS} subjects`)
    .default([]),
  level: z.enum(GOAL_LEVELS, { message: 'level must be BEGINNER, INTERMEDIATE or ADVANCED' })
    .nullable()
    .optional(),
  /** §35: the declared study language (null/absent = follow the account's preferred language). */
  studyLanguageCode: z.string().trim().min(2).max(8).nullable().optional(),
  targetYear: z
    .number()
    .int('Target year must be a whole year')
    .min(2024, 'Target year looks too early')
    .max(2035, 'Target year looks too far out')
    .nullable()
    .optional(),
  dailyMinutes: z
    .number()
    .int('Daily minutes must be a whole number')
    .min(5, 'Aim for at least 5 minutes a day')
    .max(600, 'Keep the daily target under 10 hours')
    .nullable()
    .optional(),
  /** SITE-S12: the learner's subdivision code (ISO 3166-2 suffix, e.g. "MH").
   * Validated against the seeded STATE rows of the home country by the service
   * (a state code that doesn't exist there is rejected — never a guessed
   * assignment). Null clears the field (§9 explicit signal, changeable). */
  stateCode: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .regex(/^[A-Z]{2,8}$/, 'state must be a 2-8 letter uppercase code, e.g. "MH"')
    .nullable()
    .optional(),
})
export type GoalSetInput = z.infer<typeof goalSetSchema>

/** GET /api/goal query — optional §35 label context (country/language). */
export const goalGetQuerySchema = z.object({
  country: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
})
export type GoalGetQuery = z.infer<typeof goalGetQuerySchema>

/**
 * GET /api/dashboard query — the same optional §35 label context. The queue
 * itself is ALWAYS computed in the user's home market (§11 step 1 / §14);
 * country/language steer labels and §16 paths only (P5-S4).
 */
export const dashboardGetQuerySchema = z.object({
  country: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
  /**
   * P7-S5 §11 single-exam mode: "A user may also choose to view a single
   * exam's queue only" — one exam of the caller's goal ∪ follow scope. The
   * same union engine runs with one exam in the input set; the filter applies
   * to the queue AND the revision-queue lists (both §11-union surfaces).
   */
  exam: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$|^c[a-z0-9]{20,}$/i, 'Exam must be a slug or a canonical id')
    .optional(),
})
export type DashboardGetQuery = z.infer<typeof dashboardGetQuerySchema>

/**
 * GET /api/personalisation query — the same optional §35 label context as the
 * dashboard (P5-S5): the controls surface labels exactly what the dashboard
 * labels, through the same chain (query → goal study language → preferred →
 * market default).
 */
export const personalisationGetQuerySchema = z.object({
  country: z.string().trim().max(8).optional(),
  language: z.string().trim().max(8).optional(),
})
export type PersonalisationGetQuery = z.infer<typeof personalisationGetQuerySchema>

/** POST /api/onboarding body. */
export const onboardingActionSchema = z.object({
  action: z.enum(['complete', 'skip'], { message: 'action must be "complete" or "skip"' }),
})
export type OnboardingActionInput = z.infer<typeof onboardingActionSchema>
