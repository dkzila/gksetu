'use client'

/**
 * GKSetu Console — Posts (CONSOLE-S1-B).
 *
 * The WordPress-simple loop over content representations: list with
 * server-side filters (status/language/format/q/page) → create/edit dialog
 * (§7 anchor × language × format identity, §23 per-format bodies) → lifecycle
 * transitions (§19: submit → review → schedule/publish → retire) driven by the
 * server-computed allowedTransitions → per-item evidence manager (§24).
 *
 * Verified live against /api/content/admin/items*, /api/knowledge/admin/units,
 * /api/current-affairs/admin/events and /api/languages. Note: content items
 * have no hard delete — RETIRE is the terminal action (§36).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  BookMarked,
  Clock8,
  FilePlus2,
  FileText,
  Link2,
  Loader2,
  MoreHorizontal,
  Newspaper,
  Pencil,
  RefreshCw,
  Send,
  Undo2,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SelectInput, Field, TextInput } from '@/components/console/ui/form-fields'
import { useHasPermission } from '@/components/console/ui/console-api'
import { ConsolePageHeader, formatWhen, StatusBadge } from '@/components/console/ui/primitives'
import { ResourceColumn, ResourceTable } from '@/components/console/ui/resource-table'
import { useToast } from '@/hooks/use-toast'

import { AiFlag, AdminItem, LanguageOption, PostEditorDialog, POST_FORMATS, PostSourcesDialog, TransitionAction } from './posts-parts'
import { pretty, useDebounced, useLatestApi } from './s1b-shared'

interface ListResult {
  items: AdminItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

const STATUS_OPTIONS = ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']

const TRANSITION_META: Record<TransitionAction, { label: string; icon: typeof Send }> = {
  submit_review: { label: 'Submit for review', icon: Send },
  send_back: { label: 'Send back to draft', icon: Undo2 },
  schedule: { label: 'Schedule release…', icon: Clock8 },
  publish: { label: 'Publish now', icon: BadgeCheck },
  retire: { label: 'Retire', icon: Archive },
}

export function PostsPage() {
  const api = useLatestApi()
  const { toast } = useToast()
  const canManage = useHasPermission('content:manage')

  // List + server-side filters.
  const [result, setResult] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [language, setLanguage] = useState('')
  const [format, setFormat] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 350)

  const [languages, setLanguages] = useState<LanguageOption[]>([])

  // Dialogs.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminItem | null>(null)
  const [sourcesFor, setSourcesFor] = useState<AdminItem | null>(null)
  const [scheduleTarget, setScheduleTarget] = useState<AdminItem | null>(null)
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [republishTarget, setRepublishTarget] = useState<AdminItem | null>(null)
  const [changeSummary, setChangeSummary] = useState('')
  const [republishError, setRepublishError] = useState<string | null>(null)
  const [retireTarget, setRetireTarget] = useState<AdminItem | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // ---------- Data ----------

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (status) params.set('status', status)
    if (language) params.set('language', language)
    if (format) params.set('format', format)
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
    void (async () => {
      try {
        const { data, error: apiError } = await api.current.get<ListResult>(`/api/content/admin/items?${params.toString()}`)
        if (cancelled) return
        if (data) setResult(data)
        else {
          setResult(null)
          setError(apiError?.message ?? 'Could not load posts')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManage, api, page, status, language, format, debouncedSearch, tick])

  // Language options for the filter + create dialog (§35 registry).
  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    void (async () => {
      const { data } = await api.current.get<{ languages: LanguageOption[] }>('/api/languages')
      if (!cancelled && data) setLanguages(data.languages)
    })()
    return () => {
      cancelled = true
    }
  }, [api, canManage])

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  const applyItem = useCallback((item: AdminItem) => {
    setResult((current) =>
      current ? { ...current, items: current.items.map((entry) => (entry.id === item.id ? item : entry)) } : current
    )
  }, [])

  // ---------- Actions ----------

  async function runTransition(item: AdminItem, action: TransitionAction, extra?: { changeSummary?: string; scheduledFor?: string }) {
    setBusy(`${item.id}:${action}`)
    const { data, error: apiError } = await api.current.post<{ item: AdminItem }>(
      `/api/content/admin/items/${item.id}/transition`,
      { action, ...extra }
    )
    setBusy(null)
    if (data) {
      applyItem(data.item)
      if (data.item.status === 'PUBLISHED' && (item.status === 'IN_REVIEW' || item.status === 'SCHEDULED')) {
        toast({ title: `Published revision ${data.item.liveRevision?.revisionNumber ?? 1}`, description: 'An immutable snapshot was appended — previous versions are preserved (§36).' })
      } else if (action === 'publish') {
        toast({ title: 'Correction published', description: 'A new revision replaced the live pointer with full provenance.' })
      } else if (action === 'schedule') {
        toast({ title: 'Release scheduled', description: `Goes live ${formatWhen(data.item.scheduledFor)} (or on the next read after that).` })
      } else {
        toast({ title: TRANSITION_META[action].label })
      }
    } else {
      toast({ title: 'Transition failed', description: apiError?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  function onTransitionPick(item: AdminItem, action: TransitionAction) {
    if (action === 'schedule') {
      setScheduleTarget(item)
      setScheduleAt('')
      setScheduleError(null)
    } else if (action === 'publish' && item.status === 'PUBLISHED') {
      setRepublishTarget(item)
      setChangeSummary('')
      setRepublishError(null)
    } else if (action === 'retire') {
      setRetireTarget(item)
    } else {
      void runTransition(item, action)
    }
  }

  async function submitSchedule() {
    if (!scheduleTarget || !scheduleAt) return
    const scheduledFor = new Date(scheduleAt).toISOString()
    setScheduleError(null)
    setBusy(`${scheduleTarget.id}:schedule`)
    const { data, error: apiError } = await api.current.post<{ item: AdminItem }>(
      `/api/content/admin/items/${scheduleTarget.id}/transition`,
      { action: 'schedule', scheduledFor }
    )
    setBusy(null)
    if (data) {
      applyItem(data.item)
      setScheduleTarget(null)
      toast({ title: 'Release scheduled', description: `Goes live ${formatWhen(data.item.scheduledFor)}.` })
    } else {
      setScheduleError(apiError?.message ?? 'Could not schedule the release')
    }
  }

  async function submitRepublish() {
    if (!republishTarget) return
    setRepublishError(null)
    if (changeSummary.trim().length < 3) {
      setRepublishError('A change summary is required when re-publishing live content (§36).')
      return
    }
    setBusy(`${republishTarget.id}:publish`)
    const { data, error: apiError } = await api.current.post<{ item: AdminItem }>(
      `/api/content/admin/items/${republishTarget.id}/transition`,
      { action: 'publish', changeSummary: changeSummary.trim() }
    )
    setBusy(null)
    if (data) {
      applyItem(data.item)
      setRepublishTarget(null)
      toast({ title: `Published revision ${data.item.liveRevision?.revisionNumber ?? ''}`, description: 'The correction is live with full provenance.' })
    } else {
      setRepublishError(apiError?.message ?? 'Could not publish')
    }
  }

  // ---------- Table ----------

  const columns: Array<ResourceColumn<AdminItem>> = [
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div className="min-w-0 max-w-[320px]">
          <p className="flex items-center gap-2 truncate font-medium text-zinc-900">
            <span className="truncate">{row.title}</span>
            <AiFlag on={row.aiAssisted} />
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-zinc-400">
            {row.event ? <Newspaper className="h-3 w-3 shrink-0" aria-hidden="true" /> : <BookMarked className="h-3 w-3 shrink-0" aria-hidden="true" />}
            <span className="truncate">{row.unit?.canonicalName ?? row.event?.title ?? '—'}</span>
          </p>
        </div>
      ),
      className: 'min-w-[220px]',
    },
    { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'language',
      header: 'Lang',
      render: (row) => <span className="font-medium uppercase text-zinc-700">{row.language.code}</span>,
    },
    { key: 'format', header: 'Format', render: (row) => <span className="text-zinc-600">{pretty(row.format)}</span> },
    {
      key: 'release',
      header: 'Release',
      render: (row) => (
        <span className="text-zinc-600">
          {row.liveRevision ? `live · ${formatWhen(row.liveRevision.publishedAt)}` : row.scheduledFor ? `due ${formatWhen(row.scheduledFor)}` : '—'}
        </span>
      ),
    },
    { key: 'sources', header: 'Cites', render: (row) => <span className="text-zinc-600">{row.sourceCount}</span> },
    { key: 'updatedAt', header: 'Updated', render: (row) => <span className="text-zinc-500">{formatWhen(row.updatedAt)}</span> },
  ]

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Posts"
        description="Knowledge & current-affairs representations — one rendering per anchor × language × format. Draft, review, schedule, publish."
        icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                className="h-8 gap-2 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => {
                  setEditing(null)
                  setEditorOpen(true)
                }}
              >
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                New post
              </Button>
            )}
          </>
        }
      />

      <ResourceTable
        columns={columns}
        rows={result?.items ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        emptyTitle="No posts match"
        emptyHint="Create the first representation — pick a knowledge unit or current event as its anchor, choose a language × format, and write the body."
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value)
            setPage(1)
          },
          placeholder: 'Search titles and anchors…',
        }}
        toolbar={
          <>
            <SelectInput
              value={status}
              onChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
              placeholder="All statuses"
              options={STATUS_OPTIONS.map((value) => ({ value, label: pretty(value) }))}
            />
            <SelectInput
              value={language}
              onChange={(value) => {
                setLanguage(value)
                setPage(1)
              }}
              placeholder="All languages"
              options={languages.map((entry) => ({ value: entry.code, label: entry.name }))}
            />
            <SelectInput
              value={format}
              onChange={(value) => {
                setFormat(value)
                setPage(1)
              }}
              placeholder="All formats"
              options={POST_FORMATS.map((value) => ({ value, label: pretty(value) }))}
            />
          </>
        }
        pagination={
          result
            ? {
                page: result.pagination.page,
                totalPages: result.pagination.totalPages,
                total: result.pagination.total,
                onPage: setPage,
              }
            : undefined
        }
        onRowClick={(row) => {
          setEditing(row)
          setEditorOpen(true)
        }}
        actions={(row) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700"
              onClick={() => setSourcesFor(row)}
              aria-label={`Evidence (${row.sourceCount})`}
              title="Manage evidence"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-[11px] font-medium">{row.sourceCount}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500" aria-label="Row actions">
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => {
                    setEditing(row)
                    setEditorOpen(true)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] text-zinc-400">Lifecycle</DropdownMenuLabel>
                {row.anchorBlockReason && (
                  <p className="px-2 pb-1.5 text-[11px] leading-snug text-amber-600">{row.anchorBlockReason}</p>
                )}
                {row.allowedTransitions.length === 0 && (
                  <p className="px-2 pb-1.5 text-[11px] text-zinc-400">Terminal state — no transitions available.</p>
                )}
                {row.allowedTransitions.map((action) => {
                  const meta = TRANSITION_META[action as TransitionAction]
                  if (!meta) return null
                  const blocked =
                    (action === 'publish' || action === 'schedule') && Boolean(row.anchorBlockReason)
                  return (
                    <DropdownMenuItem
                      key={action}
                      variant={action === 'retire' ? 'destructive' : 'default'}
                      disabled={blocked || busy === `${row.id}:${action}`}
                      onClick={() => onTransitionPick(row, action as TransitionAction)}
                    >
                      {busy === `${row.id}:${action}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <meta.icon className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      {meta.label}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      />

      {/* Create / edit */}
      <PostEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
        item={editing}
        languages={languages}
        onSaved={(item) => {
          if (editing) applyItem(item)
          else refresh()
        }}
      />

      {/* Evidence manager */}
      <PostSourcesDialog
        open={sourcesFor !== null}
        onOpenChange={(open) => {
          if (!open) setSourcesFor(null)
        }}
        item={sourcesFor}
        onLinksChanged={refresh}
      />

      {/* Schedule release (§19 step 7) */}
      <Dialog open={scheduleTarget !== null} onOpenChange={(open) => { if (!open) setScheduleTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule release</DialogTitle>
            <DialogDescription>
              Pick a future release time for “{scheduleTarget?.title}”. Due items materialize to PUBLISHED automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Release at" htmlFor="post-schedule-at" required error={scheduleError} hint="Within the next year; must be in the future.">
              <TextInput id="post-schedule-at" type="datetime-local" value={scheduleAt} onChange={setScheduleAt} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setScheduleTarget(null)}>Cancel</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submitSchedule()} disabled={!scheduleAt || busy?.endsWith(':schedule') === true}>
              {busy?.endsWith(':schedule') && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Republish (correction — §25/§36) */}
      <Dialog open={republishTarget !== null} onOpenChange={(open) => { if (!open) setRepublishTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish a correction</DialogTitle>
            <DialogDescription>
              This post is already live. Publishing appends a new immutable revision and moves the live pointer — a
              change summary is the provenance for why (§36).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Change summary" htmlFor="post-change-summary" required error={republishError}>
              <TextInput id="post-change-summary" value={changeSummary} onChange={setChangeSummary} placeholder="e.g. Updated the member count after the 2026 expansion" />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRepublishTarget(null)}>Cancel</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submitRepublish()} disabled={busy?.endsWith(':publish') === true}>
              {busy?.endsWith(':publish') && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Publish revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retire confirm (§36 — no hard delete on content items) */}
      <AlertDialog open={retireTarget !== null} onOpenChange={(open) => { if (!open) setRetireTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this post?</AlertDialogTitle>
            <AlertDialogDescription>
              “{retireTarget?.title}” stops serving publicly and becomes read-only. Its revisions are preserved forever
              (§36) — retiring is the terminal state and cannot be undone from the console.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (retireTarget) void runTransition(retireTarget, 'retire')
                setRetireTarget(null)
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
