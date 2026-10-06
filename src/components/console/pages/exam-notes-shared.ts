'use client'

/**
 * GKSetu Console — ExamNotes shared helpers (SITE-S13 Console UI).
 *
 * The small utilities the ExamNotes console page (list + create + edit) and
 * the Premium console page share: the exam/chapter pickers, the kind labels,
 * the status badges. Types come straight from the modules (§37 client-agnostic
 * contract) — nothing is duplicated.
 */
import type { Envelope } from '@/components/home/types'
import type {
  AdminExamNote,
  ExamNoteKind,
  ExamNoteStatus,
} from '@/modules/exam-notes'
import { EXAM_NOTE_KIND_LABELS } from '@/modules/exam-notes'

// ---------- Type mirrors (the API envelope's data) ----------

export interface ExamOption {
  id: string
  slug: string
  name: string
  code: string
  countryIso: string
}

/** One pickable chapter (the current version's tree, flattened). */
export interface ChapterOption {
  id: string
  name: string
  slug: string | null
  /** The indented display name with depth-based prefix (e.g. "├─ Indian Polity"). */
  label: string
  depth: number
}

// ---------- Public fetchers (the dialogs use these) ----------

/** Fetches the ACTIVE exams (for the picker — scoped to ADMIN's view). */
export async function fetchExamsForPicker(countryIso?: string): Promise<ExamOption[]> {
  const params = new URLSearchParams({ pageSize: '300' })
  if (countryIso) params.set('country', countryIso)
  const response = await fetch(`/api/exams/admin/exams?${params.toString()}`, { cache: 'no-store' })
  const payload = (await response.json()) as Envelope<{
    exams: Array<{
      id: string
      slug: string
      name: string
      code: string
      countryIso: string
      status: string
    }>
  }>
  if (payload.status !== 'ok' || !payload.data) return []
  return payload.data.exams
    .filter((e) => e.status === 'ACTIVE' || e.status === 'DRAFT' || e.status === 'INACTIVE')
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      name: e.name,
      code: e.code,
      countryIso: e.countryIso,
    }))
}

/** Fetches an exam's current version's chapter tree (flattened, indented labels).
 *  Uses the dedicated /api/exam-notes/admin/chapters endpoint (note:manage gated). */
export async function fetchChaptersForExam(examRef: string): Promise<ChapterOption[]> {
  const response = await fetch(
    `/api/exam-notes/admin/chapters?exam=${encodeURIComponent(examRef)}`,
    { cache: 'no-store' }
  )
  const payload = (await response.json()) as Envelope<{
    chapters: Array<{ id: string; name: string; slug: string | null; depth: number; label: string }>
  }>
  if (payload.status !== 'ok' || !payload.data) return []
  return payload.data.chapters.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    label: c.label,
    depth: c.depth,
  }))
}

// ---------- Presentation helpers ----------

export const KIND_OPTIONS: Array<{ value: ExamNoteKind; label: string; description: string }> = (
  Object.keys(EXAM_NOTE_KIND_LABELS) as ExamNoteKind[]
).map((kind) => ({
  value: kind,
  label: EXAM_NOTE_KIND_LABELS[kind].label,
  description: EXAM_NOTE_KIND_LABELS[kind].description,
}))

export const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'INACTIVE', label: 'Inactive' },
] as const

export const KIND_FILTER_OPTIONS = [
  { value: '', label: 'All kinds' },
  ...KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label })),
] as const

/** A short label for the kind (the list table + the create dialog). */
export function kindLabel(kind: ExamNoteKind): string {
  return EXAM_NOTE_KIND_LABELS[kind].label
}

/** A short label for the status (the list table + the badges). */
export function statusLabel(status: ExamNoteStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'Draft'
    case 'PUBLISHED':
      return 'Published'
    case 'INACTIVE':
      return 'Inactive'
    default:
      return status
  }
}

/** The Tailwind classes for the status badge (the StatusBadge helper convention). */
export function statusClassName(status: ExamNoteStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'PUBLISHED':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'INACTIVE':
      return 'border-zinc-200 bg-zinc-50 text-zinc-500'
    default:
      return 'border-zinc-200 bg-zinc-50 text-zinc-500'
  }
}

/** Truncates a long body to a preview (the list table shows the preview, not the full body). */
export function previewText(body: string, max = 80): string {
  const trimmed = body.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max).trimEnd()}…`
}

// ---------- The note row + the create/edit form values ----------

export type { AdminExamNote }

export interface ExamNoteFormValues {
  examRef: string
  syllabusNodeId: string
  kind: ExamNoteKind
  body: string
}

export const EMPTY_FORM: ExamNoteFormValues = {
  examRef: '',
  syllabusNodeId: '',
  kind: 'PATTERN_BRIEF',
  body: '',
}
