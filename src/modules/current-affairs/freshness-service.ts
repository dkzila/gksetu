/**
 * GlobIQ — Current Affairs: the freshness/archive rule service (P6-S5)
 * Master Plan §12 step 6 (the lifecycle machine gains its AUTOMATED
 * direction: age windows drive emerging → developing → stable → archived —
 * the exact "P6-S5's automated freshness rules will drive the → ARCHIVED
 * direction" the state machine promised), §17 (freshness as a first-class
 * current-affairs signal — the same rule table labels every feed item and
 * event page server-side, §37), §19 step 10 (archive/withdraw as an
 * explicit, audited editorial operation), §14 (COUNTRY_ADMIN sweeps stay in
 * their own market — GLOBAL events are admin-only, skipped honestly rather
 * than attempted-and-denied), §36 (archiving is end-of-life for UPDATES,
 * never for the record: the page stays public, the reopen stays manual,
 * every automated move is audited like a hand-made one), §37 (deterministic
 * ordering, explainable rules, ready-to-render DTOs), §38 (console surface).
 *
 * The sweep is deliberately MANUAL and PREVIEW-FIRST: dry-run is the
 * default, the overview shows exactly what the rules prescribe before
 * anything moves, and the actor who runs it owns the audit trail (the
 * per-event entries carry metadata.automated so history distinguishes the
 * rule's hand from the editor's).
 */
import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  latestAuditByAction,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'

import {
  CURRENT_EVENT_LIFECYCLES,
  CURRENT_EVENT_TRANSITIONS,
  FRESHNESS_RULES,
  FRESHNESS_TIERS,
  computeFreshness,
  freshnessAgeDays,
  prescribeAutoTransition,
  type CurrentEventLifecyclePublic,
  type FreshnessOverview,
  type FreshnessPendingTransition,
  type FreshnessSweepResult,
  type FreshnessTier,
} from './types'
import type { FreshnessSweepInput } from './validation'

// ---------- Internal helpers ----------

/** The sweep's working row — everything the rules and the audit need. */
interface SweepRow {
  id: string
  slug: string
  title: string
  lifecycleState: string
  eventDate: Date
  scope: string
  countryId: string | null
}

/** §14 target for the shared permission layer (the service.ts shape). */
function targetOfEvent(event: Pick<SweepRow, 'scope' | 'countryId'>): { countryId: string | null } {
  return { countryId: event.scope === 'COUNTRY' ? event.countryId : null }
}

/** Deterministic ordering (§37): slug asc. */
function bySlug(a: FreshnessPendingTransition, b: FreshnessPendingTransition): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0
}

/** The rule verdict for one row — or null when the event is already where
 *  the rules want it (the transition machine's same-state guard, §36). */
function prescriptionFor(row: SweepRow, now: Date): FreshnessPendingTransition | null {
  const from = row.lifecycleState as CurrentEventLifecyclePublic
  const ageDays = freshnessAgeDays(row.eventDate, now)
  const prescription = prescribeAutoTransition(from, ageDays)
  if (!prescription) return null
  // Defensive (§36): the machine's own edge check — never move outside it.
  if (!CURRENT_EVENT_TRANSITIONS[from].includes(prescription.to)) return null
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    from,
    to: prescription.to,
    ageDays,
    rule: prescription.rule,
  }
}

// ---------- The overview (GET /api/current-affairs/admin/freshness) ----------

export async function getFreshnessOverview(actor: Actor): Promise<FreshnessOverview> {
  assertCan(actor, 'current-affairs:manage')

  const now = new Date()
  const rows = await db.currentEvent.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      lifecycleState: true,
      eventDate: true,
      scope: true,
      countryId: true,
    },
    orderBy: [{ slug: 'asc' }], // deterministic (§37)
  })

  // §14: the overview covers exactly what THIS actor could sweep — ADMIN sees
  // the whole registry; a COUNTRY_ADMIN's own-market events only.
  const inScope = rows.filter((row) => can(actor, 'current-affairs:manage', targetOfEvent(row)))

  const lifecycleCounts = Object.fromEntries(
    CURRENT_EVENT_LIFECYCLES.map((state) => [state, 0])
  ) as Record<CurrentEventLifecyclePublic, number>
  const tierCounts = Object.fromEntries(
    FRESHNESS_TIERS.map((tier) => [tier, 0])
  ) as Record<FreshnessTier, number>

  const pending: FreshnessPendingTransition[] = []
  for (const row of inScope) {
    lifecycleCounts[row.lifecycleState as CurrentEventLifecyclePublic] += 1
    tierCounts[computeFreshness(row.eventDate, now).tier] += 1
    const prescription = prescriptionFor(row, now)
    if (prescription) pending.push(prescription)
  }
  pending.sort(bySlug)

  // The last APPLIED sweep — audit-derived (§19: the trail is the truth).
  let lastSweep: FreshnessOverview['lastSweep'] = null
  const lastEntry = await latestAuditByAction([AUDIT_ACTIONS.freshnessSweep])
  if (lastEntry) {
    const metadata = (lastEntry.metadata ?? {}) as { applied?: unknown; skipped?: unknown }
    const appliedCount = typeof metadata.applied === 'number' ? metadata.applied : 0
    const skippedCount = typeof metadata.skipped === 'number' ? metadata.skipped : 0
    lastSweep = {
      at: lastEntry.createdAt,
      byEmail: lastEntry.actor.email,
      appliedCount,
      skippedCount,
    }
  }

  return {
    rules: FRESHNESS_RULES,
    lifecycleCounts,
    tierCounts,
    total: inScope.length,
    pending,
    lastSweep,
  }
}

// ---------- The sweep (POST /api/current-affairs/admin/freshness) ----------

export async function runFreshnessSweep(
  actor: Actor,
  input: FreshnessSweepInput,
  meta: AuditRequestMeta = {}
): Promise<FreshnessSweepResult> {
  assertCan(actor, 'current-affairs:manage')

  const now = new Date()
  const rows = await db.currentEvent.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      lifecycleState: true,
      eventDate: true,
      scope: true,
      countryId: true,
    },
    orderBy: [{ slug: 'asc' }], // deterministic (§37)
  })

  // §14: out-of-scope events are SKIPPED, not attempted — a COUNTRY_ADMIN's
  // sweep never touches (or denial-audits) global or foreign-market records.
  let outOfScopeCount = 0
  let unchangedCount = 0
  const applied: FreshnessPendingTransition[] = []

  for (const row of rows) {
    if (!can(actor, 'current-affairs:manage', targetOfEvent(row))) {
      outOfScopeCount += 1
      continue
    }
    const prescription = prescriptionFor(row, now)
    if (!prescription) {
      unchangedCount += 1
      continue
    }

    if (input.dryRun) {
      applied.push(prescription)
      continue
    }

    // Apply: the same audited move transitionCurrentEvent makes, with the
    // rule's fingerprints in the metadata (§36 — never a silent edit, even
    // an automated one).
    await db.currentEvent.update({
      where: { id: row.id },
      data: { lifecycleState: prescription.to },
    })
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.currentEventAutoTransition,
      objectType: AUDIT_OBJECT_TYPES.currentEvent,
      objectId: row.id,
      objectLabel: row.slug,
      before: { lifecycleState: prescription.from },
      after: { lifecycleState: prescription.to },
      metadata: {
        automated: 'freshness-rules',
        rule: prescription.rule,
        ageDays: prescription.ageDays,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    applied.push(prescription)
  }

  applied.sort(bySlug)

  // One summary entry per applied sweep — the overview's lastSweep source.
  if (!input.dryRun) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.freshnessSweep,
      objectType: AUDIT_OBJECT_TYPES.currentEvent,
      objectId: null,
      objectLabel: 'freshness-sweep',
      before: null,
      after: { applied: applied.length, skipped: unchangedCount + outOfScopeCount },
      metadata: {
        dryRun: false,
        applied: applied.length,
        skipped: unchangedCount + outOfScopeCount,
        rules: FRESHNESS_RULES,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
  }

  return { dryRun: input.dryRun, applied, unchangedCount, outOfScopeCount }
}
