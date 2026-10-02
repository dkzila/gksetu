'use client'

/**
 * GKSetu — the "Asked in …" provenance badge line (SITE-S7).
 *
 * One shared renderer for every public question/Q&A card: the exam-sitting
 * appearances a question carries (PYQ provenance — which exam, which year,
 * which paper) surface as small amber pills below the question text. The
 * payload already carries `provenance: [{ examSlug, examName, year, paper }]`
 * on every practice card (the SITE-S7-A batch loader); empty array or missing
 * renders nothing.
 *
 * Design: amber distinguishes real exam provenance from the emerald action
 * language; up to 2 pills + a "+N more" overflow; the whole line flex-wraps
 * and a long exam name truncates inside its pill (never breaks a 390px card).
 */
import { History } from 'lucide-react'

import { cn } from '@/lib/utils'

/** One exam-sitting appearance — the frozen public badge shape (SITE-S7-A). */
export interface ProvenanceBadgeItem {
  examSlug: string
  examName: string
  year: number
  /** "" = the sitting did not name a paper (never fabricated). */
  paper: string
}

/** How many appearances render inline before the "+N more" overflow. */
const MAX_BADGES = 2

/** "Asked in {exam} · {year} (paper)" — the visible + tooltip text. */
export function provenanceLabel(item: ProvenanceBadgeItem): string {
  return `Asked in ${item.examName} · ${item.year}${item.paper ? ` (${item.paper})` : ''}`
}

/**
 * The compact badge line — renders null when the item carries no provenance.
 * `className` rides the row (spacing/mt-* at the call sites).
 */
export function ProvenanceBadgeLine({
  items,
  className,
}: {
  items?: ProvenanceBadgeItem[] | null
  className?: string
}) {
  if (!items || items.length === 0) return null
  const shown = items.slice(0, MAX_BADGES)
  const rest = items.slice(MAX_BADGES)
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {shown.map((item) => (
        <span
          key={`${item.examSlug}-${item.year}-${item.paper}`}
          title={provenanceLabel(item)}
          className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
        >
          <History className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{provenanceLabel(item)}</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span
          title={rest.map(provenanceLabel).join(', ')}
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
        >
          +{rest.length} more
        </span>
      )}
    </div>
  )
}
