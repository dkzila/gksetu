'use client'

/**
 * GKSetu Console — Sources (CONSOLE-S1-B).
 *
 * The §24 evidence registry: list with server-side filters (q/type/verification
 * + pagination), evidence registration, metadata corrections, and the editor
 * verification workflow (verify / reject / recheck) driven by the
 * server-computed allowedTransitions. Evidence is never deleted (§36) —
 * revoked trust is MARKED UNRELIABLE and preserved as history, so this surface
 * has no delete action by design.
 *
 * Verified live against /api/content/admin/sources*.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  ExternalLink,
  Link2,
  Loader2,
  MoreHorizontal,
  Pencil,
  PlusCircle,
  RefreshCw,
  ShieldX,
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
import { Field, SelectInput, TextArea, TextInput } from '@/components/console/ui/form-fields'
import { useHasPermission } from '@/components/console/ui/console-api'
import { ConsolePageHeader, formatDate, formatWhen } from '@/components/console/ui/primitives'
import { ResourceColumn, ResourceTable } from '@/components/console/ui/resource-table'
import { useToast } from '@/hooks/use-toast'

import { pretty, SummaryChips, TrustBadge, useDebounced, useLatestApi } from './s1b-shared'

// ---------- Row / API types (verified against the live API) ----------

interface AdminSource {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: 'UNVERIFIED' | 'VERIFIED' | 'UNRELIABLE'
  publishedAt: string | null
  retrievedAt: string
  verifiedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  usageCount: number
  allowedTransitions: Array<'verify' | 'reject' | 'recheck'>
}

interface ListResult {
  sources: AdminSource[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { UNVERIFIED: number; VERIFIED: number; UNRELIABLE: number }
}

const TYPE_OPTIONS = ['OFFICIAL', 'NEWS_MEDIA', 'INSTITUTIONAL', 'ACADEMIC', 'DATA', 'OTHER']
const VERIFICATION_OPTIONS = ['UNVERIFIED', 'VERIFIED', 'UNRELIABLE']

const VERIFICATION_META: Record<string, { label: string; icon: typeof BadgeCheck }> = {
  verify: { label: 'Verify — mark trusted', icon: BadgeCheck },
  reject: { label: 'Reject — mark UNRELIABLE', icon: ShieldX },
  recheck: { label: 'Recheck — back under assessment', icon: Undo2 },
}

const EMPTY_FORM = { title: '', publisher: '', url: '', type: 'OFFICIAL', publishedAt: '', retrievedAt: '', notes: '' }

export function SourcesPage() {
  const api = useLatestApi()
  const { toast } = useToast()
  const canManage = useHasPermission('source:manage')

  const [result, setResult] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [page, setPage] = useState(1)
  const [type, setType] = useState('')
  const [verification, setVerification] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 350)

  // Dialogs.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminSource | null>(null)
  const [rejectTarget, setRejectTarget] = useState<AdminSource | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // ---------- Data ----------

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '20' })
    if (type) params.set('type', type)
    if (verification) params.set('verification', verification)
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim())
    void (async () => {
      try {
        const { data, error: apiError } = await api.current.get<ListResult>(`/api/content/admin/sources?${params.toString()}`)
        if (cancelled) return
        if (data) setResult(data)
        else {
          setResult(null)
          setError(apiError?.message ?? 'Could not load the registry')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManage, api, page, type, verification, debouncedSearch, tick])

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  // ---------- Actions ----------

  async function runVerification(source: AdminSource, action: 'verify' | 'reject' | 'recheck') {
    setBusy(`${source.id}:${action}`)
    const { data, error: apiError } = await api.current.post<{ source: AdminSource }>(
      `/api/content/admin/sources/${source.id}/verify`,
      { action }
    )
    setBusy(null)
    if (data) {
      refresh() // row + §24 summary counts both change
      toast({
        title:
          action === 'verify'
            ? 'Source verified'
            : action === 'reject'
              ? 'Source marked UNRELIABLE'
              : 'Source back under assessment',
        description: action === 'reject' ? 'Existing citations remain as preserved provenance history (§36).' : undefined,
      })
    } else {
      toast({ title: 'Verification failed', description: apiError?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  // ---------- Table ----------

  const columns: Array<ResourceColumn<AdminSource>> = [
    {
      key: 'title',
      header: 'Evidence',
      render: (row) => (
        <div className="min-w-0 max-w-[300px]">
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 truncate font-medium text-zinc-900 hover:text-emerald-700"
          >
            <span className="truncate">{row.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" aria-hidden="true" />
          </a>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">{row.publisher}</p>
        </div>
      ),
      className: 'min-w-[220px]',
    },
    { key: 'type', header: 'Category', render: (row) => <span className="text-zinc-600">{pretty(row.type)}</span> },
    { key: 'verification', header: 'Trust', render: (row) => <TrustBadge state={row.verification} /> },
    { key: 'usageCount', header: 'Cited by', render: (row) => <span className="text-zinc-600">{row.usageCount}</span> },
    { key: 'publishedAt', header: 'Published', render: (row) => <span className="text-zinc-500">{formatDate(row.publishedAt)}</span> },
    { key: 'verifiedAt', header: 'Verified', render: (row) => <span className="text-zinc-500">{formatWhen(row.verifiedAt)}</span> },
    { key: 'updatedAt', header: 'Updated', render: (row) => <span className="text-zinc-500">{formatWhen(row.updatedAt)}</span> },
  ]

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Sources"
        description="The evidence registry — where every fact came from. One canonical record per URL; verification is an editorial decision; records are never deleted (§36)."
        icon={<Link2 className="h-5 w-5" aria-hidden="true" />}
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
                <PlusCircle className="h-4 w-4" aria-hidden="true" />
                Register evidence
              </Button>
            )}
          </>
        }
      />

      {result && (
        <SummaryChips
          chips={[
            { label: 'verified', value: result.summary.VERIFIED, tone: 'emerald' },
            { label: 'unverified', value: result.summary.UNVERIFIED },
            { label: 'unreliable', value: result.summary.UNRELIABLE, tone: 'red' },
            { label: 'records total', value: result.pagination.total },
          ]}
        />
      )}

      <ResourceTable
        columns={columns}
        rows={result?.sources ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={refresh}
        emptyTitle="No evidence matches"
        emptyHint="Register the first record — publisher, URL and category. New records start UNVERIFIED and enter the trust workflow."
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value)
            setPage(1)
          },
          placeholder: 'Search title, publisher, URL…',
        }}
        toolbar={
          <>
            <SelectInput
              value={type}
              onChange={(value) => {
                setType(value)
                setPage(1)
              }}
              placeholder="All categories"
              options={TYPE_OPTIONS.map((value) => ({ value, label: pretty(value) }))}
            />
            <SelectInput
              value={verification}
              onChange={(value) => {
                setVerification(value)
                setPage(1)
              }}
              placeholder="All trust states"
              options={VERIFICATION_OPTIONS.map((value) => ({ value, label: pretty(value) }))}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-500" aria-label="Row actions">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem
                onClick={() => {
                  setEditing(row)
                  setEditorOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit metadata
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] text-zinc-400">Verification (§24)</DropdownMenuLabel>
              {row.allowedTransitions.map((action) => {
                const meta = VERIFICATION_META[action]
                if (!meta) return null
                return (
                  <DropdownMenuItem
                    key={action}
                    variant={action === 'reject' ? 'destructive' : 'default'}
                    disabled={busy === `${row.id}:${action}`}
                    onClick={() => {
                      if (action === 'reject') setRejectTarget(row)
                      else void runVerification(row, action)
                    }}
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
        )}
      />

      {/* Create / edit dialog (DialogContent unmounts on close → fresh form state). */}
      <SourceEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
        source={editing}
        onSaved={() => refresh()}
      />

      {/* Reject confirm — trust revoked, record preserved (§36). */}
      <AlertDialog open={rejectTarget !== null} onOpenChange={(open) => { if (!open) setRejectTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this source?</AlertDialogTitle>
            <AlertDialogDescription>
              “{rejectTarget?.title}” will be marked UNRELIABLE — it cannot back new content. Existing citations stay
              attached as preserved provenance history. The record itself is never deleted (§36).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (rejectTarget) void runVerification(rejectTarget, 'reject')
                setRejectTarget(null)
              }}
            >
              Mark UNRELIABLE
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ==================================================================
// Create / edit dialog
// ==================================================================

function SourceEditorDialog({
  open,
  onOpenChange,
  source,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null → register mode; otherwise metadata correction (audited, §36). */
  source: AdminSource | null
  onSaved: () => void
}) {
  const api = useLatestApi()
  const { toast } = useToast()
  const [form, setForm] = useState(() =>
    source
      ? {
          title: source.title,
          publisher: source.publisher,
          url: source.url,
          type: source.type,
          publishedAt: source.publishedAt ? source.publishedAt.slice(0, 10) : '',
          retrievedAt: source.retrievedAt.slice(0, 10),
          notes: source.notes ?? '',
        }
      : { ...EMPTY_FORM }
  )
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setFieldErrors({})
    const body = source
      ? {
          title: form.title,
          publisher: form.publisher,
          url: form.url,
          type: form.type,
          publishedAt: form.publishedAt || null,
          ...(form.retrievedAt ? { retrievedAt: form.retrievedAt } : {}),
          notes: form.notes || null,
        }
      : {
          title: form.title,
          publisher: form.publisher,
          url: form.url,
          type: form.type,
          ...(form.publishedAt ? { publishedAt: form.publishedAt } : {}),
          ...(form.retrievedAt ? { retrievedAt: form.retrievedAt } : {}),
          ...(form.notes ? { notes: form.notes } : {}),
        }
    const { data, error } = source
      ? await api.current.patch<{ source: AdminSource }>(`/api/content/admin/sources/${source.id}`, body)
      : await api.current.post<{ source: AdminSource }>('/api/content/admin/sources', body)
    setSaving(false)
    if (data) {
      toast({
        title: source ? 'Metadata corrected' : 'Evidence registered',
        description: source
          ? 'Every edit is audited — the record itself is preserved (§36).'
          : 'Starts UNVERIFIED — run the verification workflow to mark it trusted (§24).',
      })
      onSaved()
      onOpenChange(false)
    } else {
      const details = error?.details as Record<string, string[]> | undefined
      setFieldErrors(details ? Object.fromEntries(Object.entries(details).map(([key, value]) => [key, Array.isArray(value) ? value[0] : String(value)])) : {})
      if (!details) toast({ title: 'Could not save', description: error?.message ?? 'The operation failed', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{source ? 'Edit evidence' : 'Register evidence'}</DialogTitle>
          <DialogDescription>
            {source
              ? 'Metadata corrections are audited; the URL stays the record’s deduplicated identity.'
              : 'One canonical record per URL — evidence is deduplicated, never duplicated. New records start UNVERIFIED.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Title" htmlFor="source-title" error={fieldErrors.title} required>
            <TextInput id="source-title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} placeholder="e.g. ISRO — Chandrayaan-3 soft-landing update" invalid={Boolean(fieldErrors.title)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Publisher" htmlFor="source-publisher" error={fieldErrors.publisher} required>
              <TextInput id="source-publisher" value={form.publisher} onChange={(value) => setForm((current) => ({ ...current, publisher: value }))} placeholder="e.g. ISRO, The Hindu, PIB" invalid={Boolean(fieldErrors.publisher)} />
            </Field>
            <Field label="Category" htmlFor="source-type" error={fieldErrors.type}>
              <SelectInput id="source-type" value={form.type} onChange={(value) => setForm((current) => ({ ...current, type: value }))} options={TYPE_OPTIONS.map((value) => ({ value, label: pretty(value) }))} invalid={Boolean(fieldErrors.type)} />
            </Field>
          </div>
          <Field label="URL" htmlFor="source-url" error={fieldErrors.url} hint="http(s) — normalized on save (lowercase host, no fragment)." required>
            <TextInput id="source-url" value={form.url} onChange={(value) => setForm((current) => ({ ...current, url: value }))} placeholder="https://…" className="font-mono text-xs" invalid={Boolean(fieldErrors.url)} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Published at" htmlFor="source-published" error={fieldErrors.publishedAt} hint="When the underlying material was published (optional).">
              <TextInput id="source-published" type="date" value={form.publishedAt} onChange={(value) => setForm((current) => ({ ...current, publishedAt: value }))} invalid={Boolean(fieldErrors.publishedAt)} />
            </Field>
            <Field label="Retrieved at" htmlFor="source-retrieved" error={fieldErrors.retrievedAt} hint="When GKSetu editors retrieved it (defaults to now).">
              <TextInput id="source-retrieved" type="date" value={form.retrievedAt} onChange={(value) => setForm((current) => ({ ...current, retrievedAt: value }))} invalid={Boolean(fieldErrors.retrievedAt)} />
            </Field>
          </div>
          <Field label="Notes" htmlFor="source-notes" error={fieldErrors.notes}>
            <TextArea id="source-notes" value={form.notes} onChange={(value) => setForm((current) => ({ ...current, notes: value }))} rows={3} placeholder="Editorial notes on reliability, paywalls, update cadence…" />
          </Field>
          {source && source.usageCount > 0 && (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs leading-relaxed text-zinc-500">
              Cited by {source.usageCount} content {source.usageCount === 1 ? 'item' : 'items'} — corrections propagate
              through every citation, and links keep pointing at this record.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {source ? 'Save changes' : 'Register'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
