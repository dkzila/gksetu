/**
 * GlobIQ — Personalisation module (Master Plan §28, §43 P5-S3…S5)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P5-S3: the GOAL half — the §6 UserGoal/Profile row (exams, subjects,
 * level, study language, preferences) + the User onboarding state machine +
 * the profile self-service aggregation endpoints. Goals are §9 explicit
 * signals: they drive personalisation only, never anything with legal or
 * commercial consequence. P5-S4 (dashboard/feed) and P5-S5 (explanations +
 * reset) extend this module.
 */
export {
  GoalError,
  toGoalErrorResponse,
  setMyGoal,
  getMyGoal,
  removeMyGoal,
  completeOnboarding,
  skipOnboarding,
} from './service'
export {
  goalSetSchema,
  goalGetQuerySchema,
  onboardingActionSchema,
  GOAL_LEVELS,
  MAX_GOAL_EXAMS,
  MAX_GOAL_TOPICS,
} from './validation'
export type {
  GoalSetInput,
  GoalGetQuery,
  OnboardingActionInput,
  GoalLevelInput,
} from './validation'
export type {
  GoalLevelPublic,
  GoalExamSummary,
  GoalTopicSummary,
  PublicGoal,
  GoalMutationResult,
  GoalRemovalResult,
} from './types'
