'use client'

/**
 * GKSetu — Exam Notes Section (SITE-S13)
 *
 * The premium editorial overlay on the tutorial chapter page. Renders 4
 * exam-pattern-specific blocks (Pattern Brief → Cheat Sheet → Worked MCQs →
 * Revision Notes) below the existing tutorials blocks (Lessons → Practice →
 * PYQs → Q&A → Mocks).
 *
 * When a note is gated and the user lacks access: locked card with a blurred
 * preview + "Unlock for ₹99" CTA → opens the paywall modal (SITE-S14 wires
 * the actual payment). When gating is OFF (the default "free for now" state),
 * every PUBLISHED note's full body is shown.
 *
 * Fetches from `/api/exams/{ref}/notes?chapter={nodeId}` — the public
 * chapter-page payload (rate-limited, anonymous-safe). The fetch only runs
 * when the chapter payload is loaded (no separate loading state — the notes
 * appear after the chapter, with a subtle skeleton).
 */
import { useEffect, useState } from 'react'
import {
  Brain,
  FileText,
  Gauge,
  Lock,
  PenLine,
  Sparkles,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { EXAM_NOTE_KIND_LABELS, type ExamNoteKind, type PublicExamNote, type PublicExamNotesResult } from '@/modules/exam-notes'
import { RichContent } from '@/components/premium/rich-content'

// ---------- Props ----------

export interface ExamNotesSectionProps {
  /** The exam slug (used in the API path). */
  examSlug: string
  /** The chapter (syllabus node) id — links to the tutorial chapter. */
  syllabusNodeId: string
  /** When true, the user is signed in (the gating check uses the bearer token
   *  server-side; this is just for the paywall CTA copy). */
  isSignedIn: boolean
  /** The callback to open the paywall modal (the parent owns the modal). */
  onUnlock: (scope: 'SINGLE_EXAM' | 'ALL_EXAMS') => void
}

// ---------- The icon map (matches the kind labels) ----------

const KIND_ICON: Record<ExamNoteKind, typeof Gauge> = {
  PATTERN_BRIEF: Gauge,
  CHEAT_SHEET: FileText,
  WORKED_MCQ: PenLine,
  REVISION_NOTES: Brain,
}

// ---------- The section ----------

export function ExamNotesSection({ examSlug, syllabusNodeId, isSignedIn, onUnlock }: ExamNotesSectionProps) {
  const [result, setResult] = useState<PublicExamNotesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ chapter: syllabusNodeId })
    fetch(`/api/exams/${examSlug}/notes?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<PublicExamNotesResult>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setResult(payload.data)
        } else {
          setError(payload.error?.message ?? 'Could not load exam notes')
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error — could not load exam notes')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [examSlug, syllabusNodeId])

  // ---------- Loading (skeleton — mirrors the chapter blocks' layout) ----------

  if (loading) {
    return (
      <section aria-labelledby="exam-notes-heading" className="space-y-3" aria-busy="true">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <h2 id="exam-notes-heading" className="text-base font-semibold tracking-tight">
            Exam notes
          </h2>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            Premium
          </Badge>
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </section>
    )
  }

  // ---------- Error ----------

  if (error && !result) {
    // Silent — the section is an enhancement; an error shouldn't break the
    // chapter page. Render nothing (the user sees the existing free content).
    return null
  }

  const notes = result?.notes ?? []
  if (notes.length === 0) {
    // No published notes for this chapter yet — render the CTA but no cards.
    return (
      <section aria-labelledby="exam-notes-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <h2 id="exam-notes-heading" className="text-base font-semibold tracking-tight">
            Exam notes
          </h2>
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
            Premium
          </Badge>
        </div>
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-700">
                Exam notes for this chapter are being written
              </p>
              <p className="text-sm text-zinc-500">
                Pattern briefs, cheat sheets, worked PYQs and revision notes land here soon — the
                exam-pattern-specific editorial layer that beats coaching notes.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
    )
  }

  // ---------- Render ----------

  return (
    <section aria-labelledby="exam-notes-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <h2 id="exam-notes-heading" className="text-base font-semibold tracking-tight">
          Exam notes
        </h2>
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
          Premium
        </Badge>
        {result?.gatingEnabled === false && (
          <span className="text-[11px] font-normal text-emerald-700">· Free preview</span>
        )}
      </div>

      <div className="space-y-3">
        {notes.map((note) => (
          <ExamNoteCard
            key={note.id}
            note={note}
            isSignedIn={isSignedIn}
            onUnlock={onUnlock}
          />
        ))}
      </div>
    </section>
  )
}

// ---------- One note card (locked or unlocked) ----------

function ExamNoteCard({
  note,
  isSignedIn,
  onUnlock,
}: {
  note: PublicExamNote
  isSignedIn: boolean
  onUnlock: (scope: 'SINGLE_EXAM' | 'ALL_EXAMS') => void
}) {
  const Icon = KIND_ICON[note.kind]
  const label = EXAM_NOTE_KIND_LABELS[note.kind]
  const locked = note.isLocked

  return (
    <Card
      id={note.canonicalAnchor.replace('#', '')}
      className={`overflow-hidden ${locked ? 'border-amber-200 bg-amber-50/30' : 'border-zinc-200 bg-white'}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-600">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <CardTitle className="text-sm font-semibold leading-snug">{label.label}</CardTitle>
              <p className="text-[11px] text-zinc-500">{label.description}</p>
            </div>
          </div>
          {locked && (
            <Badge variant="outline" className="shrink-0 border-amber-300 bg-amber-100 text-amber-800">
              <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
              Locked
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {locked ? (
          <>
            {/* Blurred preview — the first 100 chars (the API returns just the preview when locked). */}
            <div className="pointer-events-none select-none blur-sm">
              <RichContent body={note.body} kind={note.kind} />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Lock className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-amber-900">Unlock this exam's notes</p>
                <p className="text-xs text-amber-700">
                  {isSignedIn
                    ? '₹99 one-time for this exam · ₹499/year for every exam'
                    : 'Sign in to unlock — ₹99 one-time for this exam · ₹499/year for every exam'}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => onUnlock('SINGLE_EXAM')}
              >
                Unlock for ₹99
              </Button>
            </div>
          </>
        ) : (
          <RichContent body={note.body} kind={note.kind} />
        )}
      </CardContent>
    </Card>
  )
}
