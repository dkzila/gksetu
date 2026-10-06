'use client'

/**
 * GKSetu Console — ExamNote detail (SITE-S13).
 *
 * The note's full body + the revision history (the §36 append-only audit trail
 * of every publish action — who published, when, the body preview at that
 * moment). Reachable from the ExamNotes list (row click → /console/exam-notes/{id}).
 *
 * Renders:
 *   - The note's header (exam, chapter, kind, status, last-updated)
 *   - The full body (read-only — editing happens via the edit dialog on the list page)
 *   - The transition buttons (publish / unpublish — note:publish gated)
 *   - The revision history (the immutable trail)
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft,
  Clock,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type { AdminExamNoteDetail, ExamNoteStatus } from '@/modules/exam-notes'

import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { navigateToPath } from '@/components/home/app-router'
import {
  ConsolePageHeader,
  ErrorNotice,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import {
  useConsoleApi,
  useHasPermission,
} from '@/components/console/ui/console-api'
import {
  kindLabel,
  statusClassName,
  statusLabel,
  previewText,
} from './exam-notes-shared'
import { RichContent } from '@/components/premium/rich-content'

export function ExamNoteDetailPage({ noteId }: { noteId: string }) {
  const canManage = useHasPermission('note:manage')
  const canPublish = useHasPermission('note:publish')
  const { post } = useConsoleApi()
  const { toast } = useToast()

  const [note, setNote] = useState<AdminExamNoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    void (async () => {
      const response = await fetch(`/api/exam-notes/admin/${noteId}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ note: AdminExamNoteDetail }>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setNote(payload.data.note)
        setError(null)
      } else {
        setError(payload.error?.message ?? 'Could not load the exam note')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [noteId, reloadKey])

  const retryLoad = useCallback(() => setReloadKey((k) => k + 1), [])

  const runTransition = async (action: 'publish' | 'unpublish') => {
    setBusy(true)
    const { data, error } = await post<{ note: AdminExamNoteDetail }>(
      `/api/exam-notes/admin/${noteId}/transition`,
      { action }
    )
    setBusy(false)
    if (data) {
      setNote(data.note)
      toast({
        title: action === 'publish' ? 'Note published' : 'Note unpublished',
        description: `${kindLabel(data.note.kind)} is now ${data.note.status.toLowerCase()}.`,
      })
    } else if (error) {
      toast({ title: 'Transition failed', description: error.message, variant: 'destructive' })
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigateToPath('/console/exam-notes')} className="gap-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to exam notes
        </Button>
        <ErrorNotice message={error ?? 'Note not found'} onRetry={retryLoad} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigateToPath('/console/exam-notes')} className="gap-2">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to exam notes
      </Button>

      <ConsolePageHeader
        title={kindLabel(note.kind)}
        description={`${note.examName} · ${note.syllabusNodeName}`}
        icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
        actions={
          canPublish && note.allowedTransitions.includes('publish') ? (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={busy}
              onClick={() => void runTransition('publish')}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-2 h-4 w-4" aria-hidden="true" />}
              Publish
            </Button>
          ) : canPublish && note.allowedTransitions.includes('unpublish') ? (
            <Button
              variant="outline"
              size="sm"
              className="border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              disabled={busy}
              onClick={() => void runTransition('unpublish')}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Unpublish
            </Button>
          ) : null
        }
      />

      {/* ---------- The note header ---------- */}
      <Card>
        <CardContent className="grid gap-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Exam</p>
            <p className="font-medium text-zinc-900">{note.examName}</p>
            <p className="text-xs text-zinc-500">{note.examSlug}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Chapter</p>
            <p className="font-medium text-zinc-900">{note.syllabusNodeName}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Status</p>
            <StatusBadge status={note.status} className={statusClassName(note.status as ExamNoteStatus)} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Last updated</p>
            <p className="font-medium text-zinc-900">{formatWhen(note.updatedAt)}</p>
            <p className="text-xs text-zinc-500">{note.revisionCount} revision{note.revisionCount === 1 ? '' : 's'}</p>
          </div>
        </CardContent>
      </Card>

      {/* ---------- The full body ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            Body
          </CardTitle>
        </CardHeader>
        <CardContent>
          {note.status === 'PUBLISHED' && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Published notes are immutable (§36). Unpublish to edit — a new revision is created on re-publish.
            </p>
          )}
          <RichContent body={note.body} kind={note.kind} />
        </CardContent>
      </Card>

      {/* ---------- Revision history ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-zinc-500" aria-hidden="true" />
            Revision history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {note.revisions.length === 0 ? (
            <p className="text-sm text-zinc-500">No revisions yet — the note has never been published.</p>
          ) : (
            <ol className="space-y-3" role="list">
              {note.revisions.map((revision) => (
                <li key={revision.id} className="rounded-md border border-zinc-200 bg-white px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800">
                        Published {formatWhen(revision.publishedAt)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        by {revision.publishedByEmail ?? 'unknown'} · {previewText(revision.bodyPreview, 120)}
                      </p>
                    </div>
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] text-zinc-500">
                      §36 immutable
                    </Badge>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
