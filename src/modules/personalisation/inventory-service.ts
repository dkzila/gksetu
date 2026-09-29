/**
 * GlobIQ — Personalisation: explanations & controls service (P5-S5)
 * Master Plan §9 (personalisation must be layered, explainable and
 * reversible — the inventory renders every explicit signal WITH its effect
 * sentence and its control; the reset makes "reversible" one click), §31
 * (account controls over personal data, incl. the explicit "reset
 * personalisation" control — the removes/keeps contract is honest and
 * server-rendered), §10 (saves are retrieval, NEVER a signal — they appear
 * only as a separate quarantined block with their own management path), §6
 * (the onboarding state is part of the personalisation lifecycle and returns
 * to its fresh-canvas PENDING state on reset), §35 (labels through the SAME
 * chain as the dashboard), §16 (canonical paths on every signal), §36
 * (honest statuses — an inactive exam keeps its row with an honest effect
 * sentence), §37 (typed errors: GoalError from the shared loaders, LocaleError
 * for explicit bad queries), §46.3 (computed at request time, never stored).
 *
 * Ownership (§28): the reset is a BULK self-service action owned by this
 * module; it deletes follow rows and the goal aggregate through their own
 * tables (the same cascade the individual endpoints use — one module never
 * reaches into another's tables, but UserFollow/UserGoal rows ARE this
 * module's §9 signal domain since P5-S1/S3) and audits once as a bulk event.
 */
import { db } from '@/lib/db'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
  type AuditRequestMeta,
} from '@/modules/audit'
import { countMySaves, listMyFollows } from '@/modules/follow-save'
import type { FollowedEntitySummary, FollowedExamSummary, FollowedTopicSummary, PublicFollow } from '@/modules/follow-save'
import { getMyMasteryStats } from '@/modules/assessment' // P7-S4: the §9 implicit-signal layer

import { getMyGoal, loadUserContext } from './service'
import { resolveLabelMarket } from './dashboard-service'
import type { PublicGoal } from './types'
import type {
  HowItWorks,
  InventoryGoal,
  InventoryImplicit,
  InventoryOnboarding,
  InventoryReset,
  InventorySaves,
  InventorySignal,
  InventorySignals,
  PersonalisationInventory,
  PersonalisationResetResult,
} from './inventory-types'
import type { PersonalisationGetQuery } from './validation'

// ---------- §9 signal row builders (effect sentences are the §9 explanations) ----------

function pluralise(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

function followedExamSignal(follow: PublicFollow, exam: FollowedExamSummary): InventorySignal {
  return {
    id: follow.id,
    kind: 'FOLLOWED_EXAM',
    label: exam.name,
    detail: `${exam.organiser} · ${exam.code}`,
    slug: exam.slug,
    canonicalPath: exam.canonicalPath,
    status: exam.status,
    declaredAt: follow.followedAt,
    effects: [
      exam.status === 'ACTIVE'
        ? {
            kind: 'QUEUE_SCOPE',
            text: 'Joins your combined-exam queue — its whole syllabus enters your dashboard, deduplicated across exams.',
          }
        : {
            kind: 'QUEUE_SCOPE',
            text: `Currently ${exam.status.toLowerCase()} — it stays listed here but leaves your queue until it is active again.`,
          },
    ],
    removal: { method: 'DELETE', path: `/api/follows/${follow.id}` },
  }
}

function followedTopicSignal(follow: PublicFollow, topic: FollowedTopicSummary): InventorySignal {
  return {
    id: follow.id,
    kind: 'FOLLOWED_TOPIC',
    label: topic.label,
    // §35 honesty: when the label fell back (e.g. the canonical English name
    // under a Hindi request), the canonical name is shown as the detail.
    detail: topic.label !== topic.canonicalName ? topic.canonicalName : null,
    slug: topic.slug,
    canonicalPath: topic.canonicalPath,
    status: topic.status,
    declaredAt: follow.followedAt,
    effects: [
      topic.status === 'ACTIVE'
        ? {
            kind: 'QUEUE_RANKING',
            text: `Units under this subject rise up your queue and carry the reason "Because you follow the subject ${topic.label}".`,
          }
        : {
            kind: 'QUEUE_RANKING',
            text: `Currently ${topic.status.toLowerCase()} in the catalogue — units anchored directly to it still rise up your queue where mapped.`,
          },
    ],
    removal: { method: 'DELETE', path: `/api/follows/${follow.id}` },
  }
}

function followedEntitySignal(follow: PublicFollow, entity: FollowedEntitySummary): InventorySignal {
  // P6-S3 §10: a followed entity is a personalisation signal — its events'
  // coverage rides the §12/§16 surfaces; entities carry no page of their
  // own in v1, so the honest canonicalPath is null (§37).
  const typeLabel = entity.type.charAt(0) + entity.type.slice(1).toLowerCase()
  return {
    id: follow.id,
    kind: 'FOLLOWED_ENTITY',
    label: entity.canonicalName,
    detail: `${typeLabel}${entity.countryIso ? ` · ${entity.countryIso}` : ''}${entity.aliases.length ? ` · also: ${entity.aliases.slice(0, 3).join(', ')}` : ''}`,
    slug: entity.slug,
    canonicalPath: null,
    status: entity.status,
    declaredAt: follow.followedAt,
    effects: [
      entity.status === 'ACTIVE'
        ? {
            kind: 'QUEUE_RANKING',
            text: `Current affairs tagged \"${entity.canonicalName}\" join your personalised surfaces — entity follows are the §10 signal for event coverage.`,
          }
        : {
            kind: 'QUEUE_RANKING',
            text: `Retired (§36) — the follow stays listed as honest history, but new ${typeLabel.toLowerCase()} coverage no longer joins your surfaces.`,
          },
    ],
    removal: { method: 'DELETE', path: `/api/follows/${follow.id}` },
  }
}

function goalExamSignal(goal: PublicGoal, exam: PublicGoal['exams'][number]): InventorySignal {
  return {
    id: `goal:exam:${exam.slug}`,
    kind: 'GOAL_EXAM',
    label: exam.name,
    detail: `${exam.organiser} · ${exam.code}`,
    slug: exam.slug,
    canonicalPath: exam.canonicalPath,
    status: exam.status,
    declaredAt: goal.declaredAt,
    effects: [
      exam.status === 'ACTIVE'
        ? {
            kind: 'QUEUE_SCOPE',
            text: 'Joins your queue scope through your declared goal — its syllabus drives what your dashboard covers.',
          }
        : {
            // §36 — the exact P5-S4 feed behaviour, stated honestly.
            kind: 'QUEUE_SCOPE',
            text: `Currently ${exam.status.toLowerCase()} — it stays in your goal but leaves the queue until it is active again.`,
          },
    ],
    // §9: the goal is ONE coherent declaration replaced wholesale — per-exam
    // removal does not exist by design; the group controls edit/remove it.
    removal: null,
  }
}

function goalSubjectSignal(goal: PublicGoal, subject: PublicGoal['topics'][number]): InventorySignal {
  return {
    id: `goal:subject:${subject.slug}`,
    kind: 'GOAL_SUBJECT',
    label: subject.label,
    detail: subject.label !== subject.canonicalName ? subject.canonicalName : null,
    slug: subject.slug,
    canonicalPath: subject.canonicalPath,
    status: subject.status,
    declaredAt: goal.declaredAt,
    effects: [
      {
        kind: 'QUEUE_RANKING',
        // The sentence mirrors the dashboard reason verbatim (§9 coherence:
        // the inventory explains the exact reason the queue renders).
        text: `Units under this subject take the top tier of your queue with the reason "Because ${subject.label} is one of your goal subjects".`,
      },
    ],
    removal: null,
  }
}

function goalPreferenceSignals(goal: PublicGoal): InventorySignal[] {
  const rows: InventorySignal[] = []
  const base = {
    kind: 'GOAL_PREFERENCE' as const,
    slug: null,
    canonicalPath: null,
    status: null,
    declaredAt: goal.declaredAt,
    removal: null,
  }
  if (goal.level != null) {
    rows.push({
      ...base,
      id: 'goal:level',
      label: 'Preparation level',
      detail: goal.level,
      effects: [{ kind: 'PLAN', text: 'Part of your dashboard plan card — your self-declared preparation level.' }],
    })
  }
  if (goal.studyLanguage != null) {
    rows.push({
      ...base,
      id: 'goal:studyLanguage',
      label: 'Study language',
      detail: goal.studyLanguage.name,
      effects: [
        { kind: 'LABELS', text: `Your dashboard, goal and this page follow ${goal.studyLanguage.name} for labels and page links.` },
      ],
    })
  }
  if (goal.targetYear != null) {
    rows.push({
      ...base,
      id: 'goal:targetYear',
      label: 'Target year',
      detail: String(goal.targetYear),
      effects: [{ kind: 'PLAN', text: 'Part of your dashboard plan card — the exam year you are preparing for.' }],
    })
  }
  if (goal.dailyMinutes != null) {
    rows.push({
      ...base,
      id: 'goal:dailyMinutes',
      label: 'Daily pace',
      detail: `${goal.dailyMinutes} min/day`,
      effects: [{ kind: 'PLAN', text: 'Part of your dashboard plan card — your daily study pace target.' }],
    })
  }
  return rows
}

// ---------- The standing §9/§10/§14/§35 explanation ----------

function buildHowItWorks(
  goalExamCount: number,
  followedExamCount: number,
  homeCountryIso: string | null,
  saveCount: number
): HowItWorks {
  return {
    scope:
      `Your queue's scope: the union of ${goalExamCount} ${pluralise(goalExamCount, 'goal exam', 'goal exams')} ` +
      `and ${followedExamCount} ${pluralise(followedExamCount, 'followed exam', 'followed exams')} — ` +
      'computed fresh on every visit, never stored.',
    ranking:
      'Order: units under your goal subjects first, then units under followed subjects, then each exam\u2019s own ' +
      'priority (likely-question weight and freshness). Every unit carries its reasons.',
    homeMarket: homeCountryIso
      ? `The queue always runs in your home market (${homeCountryIso}) — exams from other markets never enter it.`
      : 'Your account has no home country yet — set one in your profile to unlock exam signals.',
    labels:
      'Labels follow this chain: the language you request, then your goal\u2019s study language, your account\u2019s ' +
      'preferred language, and finally the market default.',
    saves:
      `Your ${saveCount} ${pluralise(saveCount, 'saved item', 'saved items')} never influence any of this — ` +
      'saves are a personal library for retrieval, not a recommendation signal.',
  }
}

const ONBOARDING_NOTES: Record<InventoryOnboarding['status'], string> = {
  PENDING: 'The guided flow has not run yet — it will offer itself on your next visit.',
  IN_PROGRESS: 'The guided flow is half-done — pick it up from your profile anytime.',
  COMPLETED: 'Setup completed — re-run the guided flow anytime from your profile.',
  SKIPPED: 'Setup skipped — declare a goal whenever you are ready.',
}

// ---------- The inventory (GET /api/personalisation) ----------

export async function getMyPersonalisation(
  userId: string,
  query: PersonalisationGetQuery = {}
): Promise<PersonalisationInventory> {
  const user = await loadUserContext(userId)

  const [userRow, goal] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, onboardingStatus: true },
    }),
    getMyGoal(userId, query),
  ])

  // §35: the SAME label market chain as the dashboard — the controls surface
  // labels exactly what the dashboard labels.
  const market = await resolveLabelMarket(user, goal?.studyLanguage?.code ?? null, query)

  // §9 signals (follows hydrate in the same label market, §16/§35 coherence).
  const follows = await listMyFollows(userId, {
    country: market.isoCode,
    language: market.languageCode,
  })

  // §10: saves counted separately — the quarantine made visible.
  const saveCounts = await countMySaves(userId)

  // P7-S4 §9 implicit signals: the §22 mastery layer — derived, never
  // declared. The inventory states what is derived, from what, and what it
  // affects (§31 honesty); the reset clears the derived rows.
  const masteryStats = await getMyMasteryStats(userId)
  const implicit: InventoryImplicit = {
    mastery: {
      ...masteryStats,
      effects: [
        {
          kind: 'QUEUE_RANKING',
          text: 'Units due for revision rise to the top of your combined-exam queue (§11 step 7 — user state ranks the queue).',
        },
        {
          kind: 'REVISION_QUEUE',
          text: 'Your dashboard’s revision queue is scheduled from these units — spaced review at 1 → 3 → 7 → 14 → 30 → 60 days after a perfect round, tomorrow after a slip (§22).',
        },
      ],
      note:
        'Derived only from your submitted mock-test attempts (§6 — attempts are immutable history; “reset personalisation” clears this derived progress and new attempts rebuild it from that point).',
    },
  }

  const followSignals: InventorySignal[] = follows.items.map((follow) =>
    follow.object.kind === 'EXAM'
      ? followedExamSignal(follow, follow.object)
      : follow.object.kind === 'ENTITY'
        ? followedEntitySignal(follow, follow.object)
        : followedTopicSignal(follow, follow.object)
  )

  const goalPreferences = goal ? goalPreferenceSignals(goal) : []
  const inventoryGoal: InventoryGoal | null = goal
    ? {
        id: goal.id,
        declaredAt: goal.declaredAt,
        updatedAt: goal.updatedAt,
        exams: goal.exams.map((exam) => goalExamSignal(goal, exam)),
        subjects: goal.topics.map((subject) => goalSubjectSignal(goal, subject)),
        preferences: goalPreferences,
      }
    : null

  const counts = {
    follows: followSignals.length,
    goalExams: inventoryGoal?.exams.length ?? 0,
    goalSubjects: inventoryGoal?.subjects.length ?? 0,
    goalPreferences: goalPreferences.length,
    total:
      followSignals.length +
      (inventoryGoal ? inventoryGoal.exams.length + inventoryGoal.subjects.length + goalPreferences.length : 0),
  }

  const onboardingStatus = userRow?.onboardingStatus ?? 'PENDING'

  const reset: InventoryReset = {
    available: true, // the control always exists (§31) — idempotent when empty
    signalCount: counts.total,
    removes: [
      `All follows — ${pluralise(counts.follows, '1 exam or subject', `${counts.follows} exams and subjects`)} you follow`,
      goal
        ? `Your declared goal — ${counts.goalExams} ${pluralise(counts.goalExams, 'exam', 'exams')}, ${counts.goalSubjects} ${pluralise(counts.goalSubjects, 'subject', 'subjects')} and its preferences`
        : 'Your declared goal — none declared yet',
      `Your derived mastery progress — ${pluralise(masteryStats.trackedUnitCount, '1 tracked unit', `${masteryStats.trackedUnitCount} tracked units`)} and their revision schedule (new attempts rebuild it)`,
      'Your setup status returns to "pending" — the guided flow will offer itself again',
    ],
    keeps: [
      `Your ${saveCounts.total} ${pluralise(saveCounts.total, 'saved item', 'saved items')} and ${saveCounts.collections} ${pluralise(saveCounts.collections, 'collection', 'collections')} — retrieval, never personalisation signals`,
      `Your ${masteryStats.submittedAttemptCount} submitted ${pluralise(masteryStats.submittedAttemptCount, 'attempt', 'attempts')} — immutable assessment history (§6), like your saves`,
      'Your account settings — name, home country and preferred language (manage them in your profile)',
      'A security-trail record of this reset (counts only, admin-visible)',
    ],
  }

  return {
    market: {
      country: { isoCode: market.isoCode, name: market.name, slug: market.slug },
      language: {
        code: market.languageCode,
        name: market.languageName,
        nativeName: market.languageNativeName,
      },
      direction: market.direction,
      isHomeMarket: market.isoCode === user.homeCountryIso,
    },
    user: {
      name: userRow?.name ?? null,
      onboardingStatus,
      homeCountryIso: user.homeCountryIso,
      preferredLanguageCode: user.preferredLanguageCode,
    },
    howItWorks: buildHowItWorks(
      counts.goalExams,
      followSignals.filter((signal) => signal.kind === 'FOLLOWED_EXAM').length,
      user.homeCountryIso,
      saveCounts.total
    ),
    signals: { follows: followSignals, goal: inventoryGoal, counts },
    implicit,
    saves: {
      total: saveCounts.total,
      collections: saveCounts.collections,
      note: 'Saves are a personal library — they never feed your queue, your ranking or your reasons.',
    },
    onboarding: { status: onboardingStatus, note: ONBOARDING_NOTES[onboardingStatus] },
    reset,
    computedAt: new Date().toISOString(),
  }
}

// ---------- The reset (DELETE /api/personalisation — §9/§31) ----------

/**
 * The explicit "reset personalisation" control (§9/§31). Removes every §9
 * personalisation signal — all follows and the declared goal (join rows
 * cascade) — and returns the §6 onboarding state to its fresh-canvas PENDING
 * so the guided flow can offer itself again. P7-S4: the derived §22 mastery
 * rows clear too (the implicit signal — the revision queue empties), while
 * the immutable §6 attempts survive like saves do. Deliberately PRESERVES
 * saves and collections (§10 — retrieval, never signals) and account
 * settings (identity fields belong to the profile self-service).
 * Idempotent: resetting an empty account is a successful no-op.
 */
export async function resetMyPersonalisation(
  userId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<PersonalisationResetResult> {
  const user = await loadUserContext(userId)

  // Snapshot BEFORE the mutation — the audit before-state and the receipt.
  const [followsBefore, goalBefore, userRow, masteryBefore] = await Promise.all([
    db.userFollow.count({ where: { userId } }),
    db.userGoal.findUnique({
      where: { userId },
      include: { exams: { select: { examId: true } }, topics: { select: { topicId: true } } },
    }),
    db.user.findUnique({ where: { id: userId }, select: { onboardingStatus: true } }),
    db.masteryState.count({ where: { userId } }),
  ])
  const onboardingWas = userRow?.onboardingStatus ?? 'PENDING'

  // §10: saves survive — counted BEFORE so the receipt can say so honestly.
  const kept = await countMySaves(userId)

  // Cold pooled connections can stretch each round-trip past ~700ms
  // (the setMyGoal precedent); this transaction is up to 4 statements.
  await db.$transaction(
    async (tx) => {
      if (followsBefore > 0) {
        await tx.userFollow.deleteMany({ where: { userId } })
      }
      if (goalBefore) {
        // Join rows (UserGoalExam/UserGoalTopic) cascade with the goal.
        await tx.userGoal.delete({ where: { id: goalBefore.id } })
      }
      // P7-S4 §9/§31: the derived §22 mastery rows clear — the implicit
      // signal. The immutable §6 attempts survive (kept, like saves); new
      // attempts rebuild mastery from that point on.
      if (masteryBefore > 0) {
        await tx.masteryState.deleteMany({ where: { userId } })
      }
      // §6 onboarding state: back to the fresh canvas — the guided flow may
      // offer itself again (and the user can skip once more; both honest).
      if (onboardingWas !== 'PENDING') {
        await tx.user.update({
          where: { id: userId },
          data: { onboardingStatus: 'PENDING', onboardingCompletedAt: null },
        })
      }
    },
    { timeout: 20_000, maxWait: 10_000 }
  )

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.personalisationReset,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectId: userId,
    objectLabel: `${followsBefore} ${pluralise(followsBefore, 'follow', 'follows')} · goal ${
      goalBefore
        ? `${goalBefore.exams.length} ${pluralise(goalBefore.exams.length, 'exam', 'exams')}/${goalBefore.topics.length} ${pluralise(goalBefore.topics.length, 'subject', 'subjects')}`
        : 'none'
    }`,
    before: {
      followCount: followsBefore,
      goal: goalBefore
        ? {
            exams: goalBefore.exams.length,
            topics: goalBefore.topics.length,
            level: goalBefore.level,
            studyLanguageId: goalBefore.studyLanguageId,
            targetYear: goalBefore.targetYear,
            dailyMinutes: goalBefore.dailyMinutes,
          }
        : null,
      onboardingStatus: onboardingWas,
      masteryStates: masteryBefore,
    },
    after: { followCount: 0, goal: null, onboardingStatus: 'PENDING', masteryStates: 0 },
    metadata: {
      removedFollows: followsBefore,
      removedGoalExams: goalBefore?.exams.length ?? 0,
      removedGoalSubjects: goalBefore?.topics.length ?? 0,
      clearedMasteryStates: masteryBefore,
      keptSaves: kept.total,
      keptCollections: kept.collections,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return {
    removed: {
      follows: followsBefore,
      goal: goalBefore !== null,
      goalExams: goalBefore?.exams.length ?? 0,
      goalSubjects: goalBefore?.topics.length ?? 0,
      onboardingReset: onboardingWas !== 'PENDING',
      masteryStates: masteryBefore,
    },
    kept: { saves: kept.total, collections: kept.collections },
  }
}
