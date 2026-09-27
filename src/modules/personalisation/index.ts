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
 * commercial consequence.
 *
 * P5-S4: the DASHBOARD/FEED half — the §9 signal union (goal exams ∪
 * followed exams → the §11 combined queue via the exam-mapping engine,
 * computed never stored) with explainable reasons on every queue unit, the
 * §34 homepage teaser's data source, and the §10 retrieval-only saves block.
 * P5-S5: the EXPLANATIONS & CONTROLS half — the §9 signal inventory (every
 * explicit signal with its effect sentence, §35 labels, §16 paths, §36
 * honest statuses and per-signal removal refs) and the §31 explicit reset
 * (all follows + the goal; onboarding back to PENDING; saves quarantined).
 */
export {
  GoalError,
  toGoalErrorResponse,
  setMyGoal,
  getMyGoal,
  removeMyGoal,
  completeOnboarding,
  skipOnboarding,
  loadUserContext,
  getGoalRow,
} from './service'
export {
  goalSetSchema,
  goalGetQuerySchema,
  dashboardGetQuerySchema,
  personalisationGetQuerySchema,
  onboardingActionSchema,
  GOAL_LEVELS,
  MAX_GOAL_EXAMS,
  MAX_GOAL_TOPICS,
} from './validation'
export type {
  GoalSetInput,
  GoalGetQuery,
  DashboardGetQuery,
  PersonalisationGetQuery,
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

// ---------- P5-S4: the dashboard/feed (§9/§10/§11/§22/§34) ----------

export { getMyDashboard, DASHBOARD_SAVES_LIMIT } from './dashboard-service'
export type {
  DashboardQueueReason,
  DashboardTier,
  DashboardQueueUnit,
  DashboardQueueMode,
  DashboardQueue,
  DashboardSignals,
  DashboardPlan,
  DashboardSaves,
  DashboardResponse,
} from './dashboard-types'

// ---------- P5-S5: explanations & controls (§9/§31/§10/§35/§36/§46.3) ----------

export { getMyPersonalisation, resetMyPersonalisation } from './inventory-service'
export type {
  InventorySignalKind,
  InventorySignalEffect,
  InventorySignal,
  InventoryGoal,
  InventorySignals,
  HowItWorks,
  InventorySaves,
  InventoryOnboarding,
  InventoryReset,
  PersonalisationInventory,
  PersonalisationResetResult,
} from './inventory-types'
