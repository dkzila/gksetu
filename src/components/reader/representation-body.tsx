'use client'

/**
 * GKSetu — the shared §23 format-aware representation renderer (SITE-S10-A).
 *
 * Extracted from reader/knowledge-page-view.tsx so the knowledge page and the
 * tutorials' inline lesson cards render representation bodies through ONE
 * component — never a forked rendering. This module owns:
 *   · the representation API mirrors (ParsedRepresentation + PageRepresentation);
 *   · the FORMAT_META table (§23 formats → label, icon, tone);
 *   · formatDate (the en-IN revision-meta date);
 *   · the five body renderers (prose, timeline, comparison, profile,
 *     revision-note) behind <RepresentationBody/>.
 */

import {
  CalendarClock,
  Columns3,
  FileText,
  History,
  Landmark,
  ListChecks,
} from 'lucide-react'

// ---------- API mirrors (shared: knowledge page + tutorial inline lessons) ----------

export interface ParsedRepresentation {
  timeline?: { date: string; event: string }[]
  comparison?: { axis: string; left: string; right: string }[]
  profile?: { key: string; value: string }[]
}

export interface PageRepresentation {
  id: string
  format: string
  title: string
  body: string
  parsed: ParsedRepresentation | null
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  aiAssisted: boolean
  sourceCount: number
}

// ---------- §23 format metadata ----------

export const FORMAT_META: Record<string, { label: string; icon: typeof FileText; tone: string }> = {
  EXPLAINER: { label: 'Explainer', icon: FileText, tone: 'border-zinc-200 bg-white text-zinc-700' },
  PROFILE: { label: 'Profile', icon: Landmark, tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  COMPARISON: { label: 'Comparison', icon: Columns3, tone: 'border-violet-200 bg-violet-50 text-violet-800' },
  TIMELINE: { label: 'Timeline', icon: History, tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  REVISION_NOTE: { label: 'Revision note', icon: ListChecks, tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  CURRENT_EVENT_UPDATE: { label: 'Update', icon: CalendarClock, tone: 'border-orange-200 bg-orange-50 text-orange-800' },
}

/** The fallback meta for an unknown format (the §23 forward-compat rule). */
export const FALLBACK_FORMAT_META: { label: string; icon: typeof FileText; tone: string } = {
  label: 'Note',
  icon: FileText,
  tone: 'border-zinc-200 bg-white text-zinc-700',
}

// ---------- Helpers ----------

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Prose renderer — paragraphs split on blank lines (EXPLAINER + fallback). */
function ProseBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-zinc-700">
      {(paragraphs.length ? paragraphs : [body]).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

// ---------- §23 format-aware body renderers ----------

function TimelineView({ entries }: { entries: { date: string; event: string }[] }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-sky-200 pl-5" aria-label="Timeline">
      {entries.map((entry, index) => (
        <li key={index} className="relative">
          <span
            className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-sky-500 shadow"
            aria-hidden="true"
          />
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{entry.date}</p>
          <p className="mt-0.5 text-[15px] leading-relaxed text-zinc-700">{entry.event}</p>
        </li>
      ))}
    </ol>
  )
}

function ComparisonView({ rows }: { rows: { axis: string; left: string; right: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-violet-200">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <caption className="sr-only">Side-by-side comparison by axis</caption>
        <thead>
          <tr className="bg-violet-50 text-left text-violet-900">
            <th scope="col" className="px-3 py-2 font-semibold">Axis</th>
            <th scope="col" className="px-3 py-2 font-semibold">Left</th>
            <th scope="col" className="px-3 py-2 font-semibold">Right</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-zinc-50/60'}>
              <th scope="row" className="px-3 py-2 text-left font-medium text-zinc-800">{row.axis}</th>
              <td className="px-3 py-2 text-zinc-700">{row.left}</td>
              <td className="px-3 py-2 text-zinc-700">{row.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProfileView({ fields }: { fields: { key: string; value: string }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2" aria-label="Profile fields">
      {fields.map((field, index) => (
        <div key={index} className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-amber-800">{field.key}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-zinc-700">{field.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RevisionNoteView({ body }: { body: string }) {
  const points = body.split('\n').map((line) => line.trim()).filter(Boolean)
  return (
    <ul className="space-y-2">
      {points.map((point, index) => (
        <li key={index} className="flex gap-2 text-[15px] leading-relaxed text-zinc-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          {point}
        </li>
      ))}
    </ul>
  )
}

// ---------- The one shared body renderer ----------

/**
 * Renders one representation's BODY (§23 format-aware), shared by the
 * knowledge page's RepresentationCard and the tutorials' inline lessons —
 * identical markup, one component.
 */
export function RepresentationBody({
  format,
  body,
  parsed,
}: {
  format: string
  body: string
  parsed: ParsedRepresentation | null
}) {
  if (format === 'TIMELINE' && parsed?.timeline) {
    return <TimelineView entries={parsed.timeline} />
  }
  if (format === 'COMPARISON' && parsed?.comparison) {
    return <ComparisonView rows={parsed.comparison} />
  }
  if (format === 'PROFILE' && parsed?.profile) {
    return <ProfileView fields={parsed.profile} />
  }
  if (format === 'REVISION_NOTE') {
    return <RevisionNoteView body={body} />
  }
  if (format === 'CURRENT_EVENT_UPDATE') {
    return (
      <div className="rounded-lg border border-orange-100 bg-orange-50/40 p-4">
        <ProseBody body={body} />
      </div>
    )
  }
  return <ProseBody body={body} />
}
