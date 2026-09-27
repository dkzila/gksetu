'use client'

/**
 * GlobIQ — §8 vocabulary chips shared by the P4-S3 exam/syllabus views
 * (the same labels/styles the console's exam page uses — one vocabulary,
 * every surface). Depth ladder, priority, question likelihood, relevance
 * and the §8 effective period rendered consistently.
 */

export type Depth = 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
export type Priority = 'CORE' | 'SUPPORTING' | 'LOW'
export type Likelihood = 'HIGH' | 'MEDIUM' | 'LOW'
export type Relevance = 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'

export const DEPTH_STYLE: Record<Depth, string> = {
  ONE_LINE: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  FACT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CONCEPT: 'border-teal-200 bg-teal-50 text-teal-700',
  DETAILED: 'border-amber-200 bg-amber-50 text-amber-800',
  ANALYTICAL: 'border-rose-200 bg-rose-50 text-rose-700',
}

export const DEPTH_LABEL: Record<Depth, string> = {
  ONE_LINE: 'One line',
  FACT: 'Fact',
  CONCEPT: 'Concept',
  DETAILED: 'Detailed',
  ANALYTICAL: 'Analytical',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  CORE: 'Core',
  SUPPORTING: 'Supporting',
  LOW: 'Low priority',
}

export const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  HIGH: 'Often asked',
  MEDIUM: 'Sometimes asked',
  LOW: 'Rarely asked',
}

export const RELEVANCE_LABEL: Record<Relevance, string> = {
  DIRECT: 'Direct',
  PARTIAL: 'Partial',
  CONTEXTUAL: 'Contextual',
}

/** ISO date (day-granular §8) → YYYY-MM-DD. */
export const fmtDay = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')

/** §36 window as a reader-friendly range ("Jun 1, 2025 → open"). */
export function fmtWindow(from: string, to: string | null): string {
  const start = new Date(from).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  const end = to
    ? new Date(to).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'open'
  return `${start} → ${end}`
}
