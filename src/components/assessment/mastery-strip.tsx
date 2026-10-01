'use client'

/**
 * GKSetu — the §22 knowledge-page mastery strip (P7-S4)
 *
 * The "your mastery" layer of the §22 learn → practice → revise flow: on the
 * knowledge page, beside the QnA + practice layers, the signed-in reader
 * sees their spaced-review state for THIS unit — mastery %, accuracy,
 * streak, the next review date (or the honest due badge) — derived from
 * their submitted mock-test attempts (§22: "Mastery state per Knowledge
 * Unit/topic, derived from TestAttempt history"). Signed-out readers see
 * nothing (§31 — private state renders only for its owner); an untracked
 * unit renders the honest quiet note, never a zero-score guess.
 *
 * GET /api/mastery?unit={slug} (Bearer) — the same §39 API a mobile app
 * calls; nothing is client-guessed.
 */
import { useEffect, useState } from 'react'
import { CalendarClock, TrendingUp } from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'

import type { ApiMasteryUnitState } from '@/components/personalisation/types'

export interface MasteryStripProps {
  /** The unit's canonical slug — the strip's identity input. */
  unitSlug: string
}

/** GET /api/mastery?unit= envelope — the route's `ok({ unit })` wrapper. */
interface MasteryEnvelope {
  status: 'ok' | 'error'
  data?: { unit: ApiMasteryUnitState }
  error?: { message: string }
}

const DAY_MS = 24 * 60 * 60 * 1000

function dueLabel(dueInDays: number): string {
  if (dueInDays < 0) {
    const days = -dueInDays
    return `overdue by ${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (dueInDays === 0) return 'due today'
  return `next review in ${dueInDays} ${dueInDays === 1 ? 'day' : 'days'}`
}

function scoreClass(score: number): string {
  if (score >= 80) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (score >= 50) return 'border-amber-200 bg-amber-50 text-amber-800'
  return 'border-rose-200 bg-rose-50 text-rose-700'
}

export function MasteryStrip({ unitSlug }: MasteryStripProps) {
  const { status, token } = useAuth()
  const [state, setState] = useState<ApiMasteryUnitState | null>(null)

  useEffect(() => {
    // Signed-out renders nothing (the render guard below) — no fetch, no
    // state reset in the effect body (the lint rule's exact advice).
    if (status !== 'authenticated' || !token) return
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(
          `/api/mastery?unit=${encodeURIComponent(unitSlug)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
        )
        const payload = (await response.json()) as MasteryEnvelope
        if (!cancelled && payload.status === 'ok' && payload.data?.unit) {
          setState(payload.data.unit)
        }
      } catch {
        // Quiet — the strip stays absent on failure (honest, not alarming).
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [status, token, unitSlug])

  // §31: private state renders only for its signed-in owner — quiet otherwise.
  if (status !== 'authenticated' || !token || !state) return null

  const s = state.state
  return (
    <section
      aria-labelledby="mastery-strip-heading"
      className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id="mastery-strip-heading"
          className="flex items-center gap-2 text-sm font-semibold text-zinc-900"
        >
          <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Your mastery
        </h3>
        {s && (
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={`text-[10px] font-semibold ${scoreClass(s.masteryScore)}`}>
              {s.masteryScore}%
            </Badge>
            {s.isDue ? (
              <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700">
                <CalendarClock className="mr-1 h-3 w-3" aria-hidden="true" />
                Due for revision
              </Badge>
            ) : (
              <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] text-zinc-500">
                <CalendarClock className="mr-1 h-3 w-3" aria-hidden="true" />
                {dueLabel(s.dueInDays)}
              </Badge>
            )}
          </span>
        )}
      </div>
      {s ? (
        <div className="mt-2 space-y-1 text-xs text-zinc-500">
          <p>{s.reason}</p>
          <p>
            {s.correctCount}/{s.attemptedCount} correct across submitted attempts
            {s.streak > 0 && (
              <>
                {' '}· streak <strong className="font-semibold text-zinc-700">{s.streak}</strong>
                {s.streak === 1 ? ' perfect round' : ' perfect rounds'}
              </>
            )}
            {' '}· next review{' '}
            {new Date(s.nextReviewAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          {state.note ??
            'Not tracked yet — attempt a mock test that covers this page and your revision schedule starts.'}
        </p>
      )}
    </section>
  )
}
