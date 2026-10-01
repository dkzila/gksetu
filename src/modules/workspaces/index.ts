/**
 * GKSetu — Workspaces module (Master Plan §28, §43 P9-S3)
 *
 * Public interface — the CLIENT-SAFE face: reads (list/detail) + §32 metrics
 * + validation + types. The §20 provisioning (createStaff/updateStaff) is
 * deliberately OFF this barrel in ./provisioning.ts, imported only by the
 * provisioning routes — it pulls node:crypto scrypt at module scope, which
 * must never reach a client bundle (the P9-S1 ai-service precedent; the leak
 * was caught live by the browser verification round through the analytics
 * barrel chain).
 */
export {
  WorkspaceError,
  toWorkspaceErrorResponse,
  listWorkspaces,
  getWorkspace,
  workspaceInsightMetrics,
} from './service'
export type { WorkspaceErrorCode } from './service'
export { createStaffSchema, updateStaffSchema } from './validation'
export type { CreateStaffInput, UpdateStaffInput } from './validation'
export type {
  StaffRole,
  WorkspaceCountryRef,
  WorkspaceStaffMember,
  WorkspaceLanguageCoverage,
  WorkspaceBoardSummary,
  WorkspaceStats,
  WorkspaceSummary,
  WorkspaceDetail,
  StaffInviteResult,
  StaffUpdateResult,
  WorkspaceInsightMetrics,
} from './types'
