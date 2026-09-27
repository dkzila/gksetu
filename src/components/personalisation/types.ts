'use client'

/**
 * GlobIQ — Personalisation client types (P5-S3)
 * Mirrors the /api/profile, /api/goal and /api/onboarding contracts (§37).
 */

// ---------- API envelope ----------

export interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: unknown }
  meta?: { timestamp: string }
}

// ---------- Goal (mirrors src/modules/personalisation/types.ts) ----------

export interface ApiGoalExam {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string
  canonicalPath: string
}

export interface ApiGoalTopic {
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  scope: 'GLOBAL' | 'COUNTRY'
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string | null
  canonicalPath: string
}

export interface ApiGoal {
  id: string
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED' | null
  studyLanguage: { code: string; name: string } | null
  targetYear: number | null
  dailyMinutes: number | null
  declaredAt: string
  updatedAt: string
  exams: ApiGoalExam[]
  topics: ApiGoalTopic[]
  counts: { exams: number; topics: number }
}

export interface ApiProfile {
  user: {
    id: string
    email: string
    name: string | null
    homeCountry: { isoCode: string; name: string } | null
    preferredLanguage: { code: string; name: string } | null
    onboardingStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
    onboardingCompletedAt: string | null
  }
  goal: ApiGoal | null
}

// ---------- Picker data (public endpoints the wizard consumes) ----------

export interface ApiExamOption {
  slug: string
  name: string
  code: string
  organiser: string
  level: string
  description: string | null
  countryIso: string
  currentVersion: { label: string } | null
}

export interface ApiTopicNode {
  id: string
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  childCount: number
  children: ApiTopicNode[]
}

// ---------- Shared helpers ----------

export const LEVEL_LABELS: Record<string, string> = {
  BEGINNER: 'Beginner — starting fresh',
  INTERMEDIATE: 'Intermediate — some preparation done',
  ADVANCED: 'Advanced — deep into preparation',
}

export const ONBOARDING_COPY: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Setup pending', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  IN_PROGRESS: { label: 'Setup in progress', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  COMPLETED: { label: 'Setup completed', className: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  SKIPPED: { label: 'Setup skipped', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}
