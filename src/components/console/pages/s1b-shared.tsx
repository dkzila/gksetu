'use client'

/**
 * GKSetu Console — CONSOLE-S1-B shared helpers (posts / sources / entities).
 *
 * Small primitives used by the three management surfaces this agent owns.
 * Deliberately local to this agent's files — other console agents own their
 * own helpers (per the CONSOLE-S1 handoff rules).
 */
import { ReactNode, useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import { useConsoleApi } from '@/components/console/ui/console-api'

/**
 * Latest-ref handle over useConsoleApi — the hook returns fresh function
 * identities on every render (new closures over the token), while list
 * effects need one stable object in their dependency-stable closures.
 * Read `ref.current` inside effects/handlers; never list it as a dependency.
 */
export function useLatestApi() {
  const api = useConsoleApi()
  const ref = useRef(api)
  useEffect(() => {
    ref.current = api
  })
  return ref
}

/** Debounce a fast-changing input before it reaches a server query param. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

/** ENUM_VALUE → "enum value" (table cells, selects, badges). */
export function pretty(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace(/_/g, ' ').toLowerCase()
}

/** §24 editor verification state — emerald when trusted, red when revoked. */
export function TrustBadge({ state, className }: { state: string | null | undefined; className?: string }) {
  if (!state) return <span className="text-xs text-zinc-400">—</span>
  const tones: Record<string, string> = {
    VERIFIED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    UNVERIFIED: 'border-zinc-200 bg-zinc-100 text-zinc-600',
    UNRELIABLE: 'border-red-200 bg-red-50 text-red-700',
  }
  return (
    <Badge
      variant="outline"
      className={cn('px-2 py-0 text-[11px] font-medium tracking-wide', tones[state] ?? tones.UNVERIFIED, className)}
    >
      {pretty(state)}
    </Badge>
  )
}

/** Compact registry summary chips (counts row above a table). */
export function SummaryChips({ chips }: { chips: Array<{ label: string; value: ReactNode; tone?: 'default' | 'emerald' | 'red' }> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2 py-1',
            chip.tone === 'emerald' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
            chip.tone === 'red' && 'border-red-200 bg-red-50 text-red-700',
            (!chip.tone || chip.tone === 'default') && 'border-zinc-200 bg-white text-zinc-600'
          )}
        >
          <span className="font-semibold text-zinc-800">{chip.value}</span> {chip.label}
        </span>
      ))}
    </div>
  )
}
