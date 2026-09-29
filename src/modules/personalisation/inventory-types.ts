/**
 * GlobIQ — Personalisation: explanations & controls DTOs (P5-S5)
 * Master Plan §9 (personalisation must be layered, EXPLAINABLE and reversible
 * — this inventory IS the explanation surface: every signal with its effect
 * sentence and its control), §10 (saves are retrieval, NEVER a signal — the
 * inventory always lists them separately with the standing note), §31 (the
 * account-control surface over personal data, incl. the explicit "reset
 * personalisation" control with an honest removes/keeps contract), §35 (label
 * chains on every signal label), §16 (canonical paths for navigation), §36
 * (honest statuses — an inactive exam stays listed with an honest effect
 * sentence), §37 (client-agnostic ready-to-render shapes), §39 (the same
 * endpoint a mobile app calls), §46.3 (computed at request time, never
 * stored).
 */

/** One §9 explicit signal kind — the vocabulary of the inventory. */
export type InventorySignalKind =
  | 'FOLLOWED_EXAM'
  | 'FOLLOWED_TOPIC'
  | 'FOLLOWED_ENTITY'
  | 'GOAL_EXAM'
  | 'GOAL_SUBJECT'
  | 'GOAL_PREFERENCE'

/**
 * What one signal does. `kind` is machine-readable (a mobile client can group
 * effects); `text` is a complete ready-to-render sentence (§9: recommendation
 * output must be explainable — so must its input inventory).
 */
export interface InventorySignalEffect {
  kind: 'QUEUE_SCOPE' | 'QUEUE_RANKING' | 'REVISION_QUEUE' | 'PLAN' | 'LABELS'
  text: string
}

/** One row of the §9 signal inventory. */
export interface InventorySignal {
  /** Stable id — the follow row id, or a preference key for goal rows. */
  id: string
  kind: InventorySignalKind
  /** Display label (§35 chain for subjects; exam name; preference name). */
  label: string
  /** Sub-label: organiser · code for exams, canonical name for subjects, current value for preferences. */
  detail: string | null
  slug: string | null
  /** §16 canonical path of the object (null for preferences). */
  canonicalPath: string | null
  /** §36 honest status of the underlying object (null for preferences). */
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED' | 'DRAFT' | null
  declaredAt: string | null
  effects: InventorySignalEffect[]
  /**
   * The per-signal removal control (§31 reversible): the exact request that
   * removes ONLY this signal. Null for goal rows — the goal is one coherent
   * declaration replaced wholesale (§9), so its controls live on the group.
   */
  removal: { method: 'DELETE'; path: string } | null
}

/** The caller's declared goal as inventory rows + its group-level §31 controls. */
export interface InventoryGoal {
  id: string
  declaredAt: string
  updatedAt: string
  exams: InventorySignal[]
  subjects: InventorySignal[]
  preferences: InventorySignal[]
}

/** The full §9 signal inventory (follows + goal), with coherent counts. */
export interface InventorySignals {
  follows: InventorySignal[]
  goal: InventoryGoal | null
  counts: {
    follows: number
    goalExams: number
    goalSubjects: number
    goalPreferences: number
    /** Every row the reset would remove (follows + all goal rows). */
    total: number
  }
}

/** The standing §9 layering explanation — how the layers combine, with live values. */
export interface HowItWorks {
  /** Scope: the goal ∪ follows exam union feeding the §11 queue. */
  scope: string
  /** Ranking: the tier layering on top of the engine's base order. */
  ranking: string
  /** The home-market rule (§14) — where the queue always runs. */
  homeMarket: string
  /** The §35 label chain resolution order. */
  labels: string
  /** The §10 saves quarantine — never a ranking input. */
  saves: string
}

/** The §10 saves block — deliberately separate from the signal inventory. */
export interface InventorySaves {
  total: number
  collections: number
  /** Rendered verbatim: saves are retrieval, never a recommendation signal. */
  note: string
}

/**
 * The §9 IMPLICIT signals this platform derives (P7-S4: mock-test
 * performance — the §22 mastery layer). Listed separately from the explicit
 * inventory: the user never declared these, so the surface states WHAT is
 * derived, FROM WHAT, and what it affects — the §9/§31 honesty contract.
 */
export interface InventoryImplicit {
  mastery: {
    trackedUnitCount: number
    dueCount: number
    weakCount: number
    /** The immutable §6 records mastery derives from. */
    submittedAttemptCount: number
    /** §9 effect sentences — rendered verbatim. */
    effects: InventorySignalEffect[]
    /** The §31 note: attempts are immutable history; the derived state clears with the reset. */
    note: string
  }
}

/** The §6 onboarding state as part of the personalisation lifecycle. */
export interface InventoryOnboarding {
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
  note: string
}

/**
 * The §31 reset contract — exactly what the control removes and keeps, so any
 * client can render an honest confirmation without hardcoding (§39).
 */
export interface InventoryReset {
  /** Always true — the control exists even for an empty account (idempotent no-op). */
  available: boolean
  /** How many signal rows would disappear right now. */
  signalCount: number
  removes: string[]
  keeps: string[]
}

/** GET /api/personalisation response body. */
export interface PersonalisationInventory {
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
  howItWorks: HowItWorks
  signals: InventorySignals
  /** P7-S4: the derived §9 implicit signals (mock-test performance → mastery). */
  implicit: InventoryImplicit
  saves: InventorySaves
  onboarding: InventoryOnboarding
  reset: InventoryReset
  computedAt: string
}

/** DELETE /api/personalisation response — the reset receipt. */
export interface PersonalisationResetResult {
  removed: {
    follows: number
    goal: boolean
    goalExams: number
    goalSubjects: number
    /** True when the setup status actually changed (it was not already PENDING). */
    onboardingReset: boolean
    /** P7-S4: derived mastery rows cleared (§9 implicit signal, §31). */
    masteryStates: number
  }
  /** What the reset deliberately preserved (§10/§31) — with live counts. */
  kept: {
    saves: number
    collections: number
  }
}
