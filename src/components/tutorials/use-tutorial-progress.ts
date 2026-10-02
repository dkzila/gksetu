'use client'

/**
 * GKSetu — tutorial progress hook (SITE-S8-B).
 *
 * The ONE client-side wrapper over the authenticated tutorial-progress API
 * (the only persisted tutorials state — SITE-S8-A):
 *   GET  /api/tutorials/progress?exam={slug} (Bearer) → the per-exam walk
 *   POST /api/tutorials/progress {nodeId, completed}   → the refreshed walk
 *
 * Shared by the TOC view (progress bar + per-row learned ticks) and the
 * chapter reader (hero toggle + rail ticks). Optimistic by design: a toggle
 * flips the local set immediately, the POST confirms, and any failure reverts
 * to the server's last word (§37 server truth) with a quiet error the caller
 * may surface. Anonymous readers simply never enable the hook (the route
 * 401s by design) — no progress UI renders signed-out.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Envelope } from '@/components/home/types'

/** GET /api/tutorials/progress → data.progress (the SITE-S8-A contract). */
export interface TutorialExamProgress {
  examSlug: string
  /** DFS reading order, CURRENT version's nodes only. */
  completedNodeIds: string[]
  /** ALL nodes of the current version — the walk, not just content chapters. */
  totalNodes: number
  percent: number
}

/** One optimistic toggle in flight — {nodeId → direction}. */
type ToggleState = Record<string, 'marking' | 'unmarking'>

export interface UseTutorialProgressResult {
  progress: TutorialExamProgress | null
  /** True while the initial GET is in flight (only when enabled). */
  loading: boolean
  /** Which node ids have a toggle in flight (per-row spinners/disabled). */
  toggling: ToggleState
  /** The last toggle failure (quiet — callers surface it or not). */
  error: string | null
  /** True when the node is marked learned in the CURRENT local state. */
  isLearned: (nodeId: string) => boolean
  /** Optimistic mark/unmark; adopts the server's refreshed walk on success. */
  toggleLearned: (nodeId: string, completed: boolean) => Promise<void>
}

export function useTutorialProgress(
  examSlug: string | null,
  token: string | null,
  enabled: boolean
): UseTutorialProgressResult {
  const [progress, setProgress] = useState<TutorialExamProgress | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [toggling, setToggling] = useState<ToggleState>({})
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  // ---------- The initial read (per exam; race-guarded) ----------
  useEffect(() => {
    const current = ++seq.current
    if (!enabled || !token || !examSlug) {
      setProgress(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const response = await fetch(`/api/tutorials/progress?exam=${encodeURIComponent(examSlug)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const body = (await response.json()) as Envelope<{ progress: TutorialExamProgress }>
        if (current !== seq.current) return
        if (body.status === 'ok' && body.data) {
          setProgress(body.data.progress)
        } else {
          // Fail-silent to "no bar" (§ the honest degrade) — the tutorials
          // content itself is fully usable without progress.
          setProgress(null)
        }
      } catch {
        if (current === seq.current) setProgress(null)
      } finally {
        if (current === seq.current) setLoading(false)
      }
    })()
  }, [enabled, token, examSlug])

  const isLearned = useCallback(
    (nodeId: string) => progress?.completedNodeIds.includes(nodeId) === true,
    [progress]
  )

  const toggleLearned = useCallback(
    async (nodeId: string, completed: boolean) => {
      if (!token) return
      // Optimistic flip + snapshot for the revert (§37 server truth wins).
      const snapshot = progress
      setToggling((current) => ({ ...current, [nodeId]: completed ? 'marking' : 'unmarking' }))
      setProgress((current) => {
        if (!current) return current
        const has = current.completedNodeIds.includes(nodeId)
        const completedNodeIds = completed
          ? has
            ? current.completedNodeIds
            : [...current.completedNodeIds, nodeId]
          : current.completedNodeIds.filter((id) => id !== nodeId)
        const percent =
          current.totalNodes > 0
            ? Math.round((completedNodeIds.length / current.totalNodes) * 100)
            : 0
        return { ...current, completedNodeIds, percent }
      })
      try {
        const response = await fetch('/api/tutorials/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          cache: 'no-store',
          body: JSON.stringify({ nodeId, completed }),
        })
        const body = (await response.json()) as Envelope<{ progress: TutorialExamProgress }>
        if (body.status === 'ok' && body.data) {
          setProgress(body.data.progress)
          setError(null)
        } else {
          setProgress(snapshot)
          setError(body.error?.message ?? 'Could not save your progress — please retry.')
        }
      } catch {
        setProgress(snapshot)
        setError('Network error — could not save your progress.')
      } finally {
        setToggling((current) => {
          const next = { ...current }
          delete next[nodeId]
          return next
        })
      }
    },
    [progress, token]
  )

  return { progress, loading, toggling, error, isLearned, toggleLearned }
}
