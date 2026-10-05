'use client'

/**
 * GKSetu — Personalisation client types (P5-S3)
 * Mirrors the /api/profile, /api/goal and /api/onboarding contracts (§37).
 */

import type { ApiJurisdiction } from '@/components/home/jurisdiction'

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
  /** SITE-S12: the learner's home state code (ISO 3166-2 suffix, e.g. "MH").
   * Null when the home market has no seeded STATE jurisdictions or the user
   * skipped the optional step-1 field. */
  stateCode: string | null
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
  /** SITE-S12: the exam's jurisdiction projection (null when not backfilled). */
  jurisdiction: ApiJurisdiction | null
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

// ---------- S11-B: syllabus-derived subjects (mirrors /api/exams/subjects) ----------

export interface ApiDerivedSubject {
  slug: string
  label: string
  /** Which of the requested exams' syllabi carry this subject (request order). */
  examSlugs: string[]
}

export interface ApiExamSubjects {
  subjects: ApiDerivedSubject[]
  /** The exams that resolved with a current version (provenance chips). */
  exams: Array<{ slug: string; name: string; code: string }>
  /** Refs that contributed nothing (unknown/inactive/no version in effect). */
  skipped: string[]
  note: string | null
}

// ---------- Dashboard (mirrors src/modules/personalisation/dashboard-types.ts, P5-S4) ----------

export interface ApiDashboardReason {
  kind: 'GOAL_EXAM' | 'GOAL_SUBJECT' | 'FOLLOWED_EXAM' | 'FOLLOWED_SUBJECT' | 'REVISION_DUE'
  text: string
  examSlug?: string
  topicSlug?: string
}

export interface ApiQueueCovering {
  exam: { slug: string; name: string; code: string }
  node: {
    name: string
    depth: number
    topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  }
  requiredDepth: string
  priority: string
  relevance: string
  questionLikelihood: string
  expectedScope: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
}

/** One unit in the personalised queue — the §11 engine row + §9 explanations. */
export interface ApiDashboardQueueUnit {
  unit: {
    unit: {
      slug: string
      canonicalName: string
      canonicalSummary: string | null
      type: string
      difficulty: string
    }
    canonicalPath: string
    requiredDepth: string
    priority: string
    questionLikelihood: string
    exams: Array<{ slug: string; name: string; code: string }>
    examCount: number
    isShared: boolean
    coverings: ApiQueueCovering[]
    latestEffectiveFrom: string | null
  }
  tier: 'REVISION_DUE' | 'GOAL_SUBJECT' | 'FOLLOWED_SUBJECT' | 'EXAM_SCOPE'
  reasons: ApiDashboardReason[]
  /** P7-S4 §22 — present when a submitted attempt touched this unit. */
  mastery: { score: number; lastReviewedAt: string; nextReviewAt: string } | null
}

// ---------- P7-S4: mastery / revision queue (mirrors mastery-types.ts) ----------

/** One tracked unit in the §22 revision queue (the assessment module's row verbatim). */
export interface ApiMasteryUnitItem {
  unit: {
    slug: string
    canonicalName: string
    status: string
    topicSlug: string
    topicName: string
    topicLabel: string
    canonicalPath: string
  }
  masteryScore: number
  attemptedCount: number
  correctCount: number
  streak: number
  lastReviewedAt: string
  nextReviewAt: string
  dueInDays: number
  isDue: boolean
  isWeak: boolean
  reason: string
}

/** The dashboard's §22 mastery block (trimmed from the full overview). */
export interface ApiDashboardMastery {
  stats: {
    trackedUnitCount: number
    dueCount: number
    dueSoonCount: number
    weakCount: number
    averageScore: number | null
    submittedAttemptCount: number
  }
  due: ApiMasteryUnitItem[]
  upcoming: ApiMasteryUnitItem[]
  weak: ApiMasteryUnitItem[]
  rules: string
  note: string | null
}

/** GET /api/mastery?unit= — the §22 knowledge-page mastery strip. */
export interface ApiMasteryUnitState {
  unit: {
    slug: string
    canonicalName: string
    topicSlug: string
    topicName: string
    topicLabel: string
    canonicalPath: string
  }
  state: {
    masteryScore: number
    attemptedCount: number
    correctCount: number
    streak: number
    lastReviewedAt: string
    nextReviewAt: string
    dueInDays: number
    isDue: boolean
    isWeak: boolean
    reason: string
  } | null
  note: string | null
}

export interface ApiDashboardExamResolution {
  exam: { id: string; slug: string; name: string; code: string; level: string }
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  note: string | null
  unitCount: number
  mappingCount: number
}

export interface ApiDashboardFollowedExam {
  kind: 'EXAM'
  slug: string
  name: string
  code: string
  organiser: string
  level: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string
  canonicalPath: string
}

export interface ApiDashboardFollowedTopic {
  kind: 'TOPIC'
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: string
  scope: 'GLOBAL' | 'COUNTRY'
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string | null
  canonicalPath: string
}

export interface ApiDashboardSaveUnitObject {
  kind: 'KNOWLEDGE_UNIT'
  slug: string
  /** The unit's canonical name — the display title for unit saves. */
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  status: string
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topicSlug: string
  topicCanonicalName: string
  canonicalPath: string
  languageCode: string
}

export interface ApiDashboardSaveItemObject {
  kind: 'CONTENT_ITEM'
  id: string
  /** The live published revision's title — the display title for item saves. */
  title: string
  format: string
  languageCode: string
  status: string
  topicSlug: string
  topicCanonicalName: string
  canonicalPath: string
  countryIso: string | null
  unit: { slug: string; canonicalName: string; type: string; status: string }
}

export type ApiDashboardSaveObject = ApiDashboardSaveUnitObject | ApiDashboardSaveItemObject

/** The display title of a saved object (unit canonicalName / item title). */
export function saveObjectTitle(object: ApiDashboardSaveObject): string {
  return object.kind === 'KNOWLEDGE_UNIT' ? object.canonicalName : object.title
}

export interface ApiDashboardSave {
  id: string
  objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM'
  savedAt: string
  object: ApiDashboardSaveObject
}

export interface ApiDashboard {
  market: {
    country: { isoCode: string; name: string; slug: string }
    language: { code: string; name: string; nativeName: string | null }
    direction: 'LTR' | 'RTL'
    isHomeMarket: boolean
  }
  user: {
    name: string | null
    onboardingStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
    homeCountryIso: string | null
    preferredLanguageCode: string | null
  }
  plan: {
    level: ApiGoal['level']
    targetYear: number | null
    dailyMinutes: number | null
    studyLanguage: { code: string; name: string } | null
  } | null
  goal: ApiGoal | null
  signals: {
    goalExamCount: number
    goalSubjectCount: number
    followedExamCount: number
    followedTopicCount: number
    followedExams: ApiDashboardFollowedExam[]
    followedTopics: ApiDashboardFollowedTopic[]
  }
  queue: {
    mode: 'GOAL_AND_FOLLOW' | 'GOAL' | 'FOLLOW' | 'NONE'
    countryIso: string
    /** P7-S5 §11: the single-exam scope when filtered (null = combined). */
    scopeExam: { slug: string; name: string } | null
    /** P7-S5 §11: the caller's choosable scopes (the chips input). */
    scopes: Array<{ slug: string; name: string; fromGoal: boolean; fromFollow: boolean }>
    exams: ApiDashboardExamResolution[]
    units: ApiDashboardQueueUnit[]
    stats: {
      examCount: number
      unitCount: number
      mappingCount: number
      sharedUnitCount: number
      duplicatesAvoided: number
    }
    note: string | null
  }
  saves: { total: number; items: ApiDashboardSave[] }
  /** P7-S4: the §22 revision queue (due/upcoming/weak + the stated rules). */
  mastery: ApiDashboardMastery
  computedAt: string
}

// ---------- Personalisation inventory (mirrors inventory-types.ts, P5-S5) ----------

export interface ApiInventoryEffect {
  kind: 'QUEUE_SCOPE' | 'QUEUE_RANKING' | 'REVISION_QUEUE' | 'PLAN' | 'LABELS'
  text: string
}

export interface ApiInventorySignal {
  id: string
  kind: 'FOLLOWED_EXAM' | 'FOLLOWED_TOPIC' | 'FOLLOWED_ENTITY' | 'GOAL_EXAM' | 'GOAL_SUBJECT' | 'GOAL_PREFERENCE'
  label: string
  detail: string | null
  slug: string | null
  canonicalPath: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED' | 'DRAFT' | null
  declaredAt: string | null
  effects: ApiInventoryEffect[]
  removal: { method: 'DELETE'; path: string } | null
}

export interface ApiInventoryGoal {
  id: string
  declaredAt: string
  updatedAt: string
  exams: ApiInventorySignal[]
  subjects: ApiInventorySignal[]
  preferences: ApiInventorySignal[]
}

export interface ApiPersonalisation {
  market: {
    country: { isoCode: string; name: string; slug: string }
    language: { code: string; name: string; nativeName: string | null }
    direction: 'LTR' | 'RTL'
    isHomeMarket: boolean
  }
  user: {
    name: string | null
    onboardingStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
    homeCountryIso: string | null
    preferredLanguageCode: string | null
  }
  howItWorks: {
    scope: string
    ranking: string
    homeMarket: string
    labels: string
    saves: string
  }
  signals: {
    follows: ApiInventorySignal[]
    goal: ApiInventoryGoal | null
    counts: {
      follows: number
      goalExams: number
      goalSubjects: number
      goalPreferences: number
      total: number
    }
  }
  /** P7-S4/P8-S1: the derived §9 implicit signals (mastery) + the recorded
   * activity family (share events — §21/§32 analytics, never a ranking input). */
  implicit: {
    mastery: {
      trackedUnitCount: number
      dueCount: number
      weakCount: number
      submittedAttemptCount: number
      effects: ApiInventoryEffect[]
      note: string
    }
    sharing: {
      shareActionCount: number
      effects: Array<{ kind: 'ANALYTICS'; text: string }>
      note: string
    }
  }
  saves: { total: number; collections: number; note: string }
  onboarding: { status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'; note: string }
  reset: { available: boolean; signalCount: number; removes: string[]; keeps: string[] }
  computedAt: string
}

export interface ApiResetResult {
  removed: {
    follows: number
    goal: boolean
    goalExams: number
    goalSubjects: number
    onboardingReset: boolean
    /** P7-S4: derived §22 mastery rows cleared (§9/§31). */
    masteryStates: number
  }
  kept: { saves: number; collections: number }
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
