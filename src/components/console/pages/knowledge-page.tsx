'use client'

/**
 * GKSetu Console — Knowledge Units page (CONSOLE-S1-C).
 *
 * The §7 canonical-record workspace: status-filtered list, create/edit editor
 * (editability per status — full in DRAFT/IN_REVIEW/OUTDATED, metadata-only in
 * VERIFIED, none in ARCHIVED), the §36 lifecycle state machine (submit →
 * verify → flag outdated → re-verify, archive as the end-of-life — there is no
 * destructive delete on canonical knowledge) and field-level validation
 * errors from the API envelope.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  BookOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Undo2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
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
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import { fieldErrorMap, useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { Field, SelectInput, TextArea, TextInput } from '@/components/console/ui/form-fields'
import { ConsolePageHeader, ErrorNotice, formatWhen, StatusBadge } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'

// ---------- DTOs (mirror /api/knowledge/admin/units payloads) ----------

interface AdminUnit {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  canonicalBody: string
  type: string
  status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { id: string; slug: string; canonicalName: string; status: string }
  validity: { from: string | null; until: string | null; currentlyValid: boolean }
  notes: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'metadata' | 'none'
  allowedTransitions: string[]
}

interface AdminListResult {
  units: AdminUnit[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

const STATUS_OPTIONS = ['DRAFT', 'IN_REVIEW', 'VERIFIED', 'OUTDATED', 'ARCHIVED'] as const
const TYPE_OPTIONS = ['FACT', 'CONCEPT', 'TIMELINE', 'PERSON_PROFILE', 'PLACE_PROFILE', 'ORGANISATION_PROFILE', 'COMPARISON'] as const
const DIFFICULTY_OPTIONS = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const

const TRANSITION_META: Record<string, { label: string; icon: typeof Send }> = {
  submit_review: { label: 'Submit for review', icon: Send },
  send_back: { label: 'Send back to draft', icon: Undo2 },
  verify: { label: 'Verify & publish', icon: BadgeCheck },
  flag_outdated: { label: 'Flag outdated…', icon: ShieldAlert },
  reverify: { label: 'Re-verify', icon: BadgeCheck },
  archive: { label: 'Archive', icon: Archive },
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

/** VERIFIED gets the emerald accent; every other state rides the shared badge map. */
function UnitStatusBadge({ status }: { status: AdminUnit['status'] }) {
  if (status === 'VERIFIED') {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2 py-0 text-[11px] font-medium tracking-wide text-emerald-700">
        verified
      </Badge>
    )
  }
  return <StatusBadge status={status} />
}

/** The toolkit inputs have no `disabled` prop — freeze them visually instead. */
function Guard({ disabled, children }: { disabled: boolean; children: React.ReactNode }) {
  if (!disabled) return <>{children}</>
  return <div className="pointer-events-none opacity-60">{children}</div>
}

const PAGE_SIZE = 20

export function KnowledgePage() {
  const api = useConsoleApi()
  const { toast } = useToast()
  const canManage = useHasPermission('knowledge:manage')
  const role = useAuth((state) => state.user?.role ?? 'READER')

  // ----- list + filters -----
  const [result, setResult] = useState<AdminListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  // Topic options (create form, §13 tree).
  const [topics, setTopics] = useState<Array<{ slug: string; name: string }>>([])
  const [countries, setCountries] = useState<Array<{ isoCode: string; name: string }>>([])

  // Dialogs.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorUnit, setEditorUnit] = useState<AdminUnit | null>(null)
  const [flagUnit, setFlagUnit] = useState<AdminUnit | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [archiveUnit, setArchiveUnit] = useState<AdminUnit | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (status) params.set('status', status)
    const response = await api.get<AdminListResult>(`/api/knowledge/admin/units?${params.toString()}`)
    setLoading(false)
    if (response.data) setResult(response.data)
    else {
      setResult(null)
      setError(response.error?.message ?? 'Could not load knowledge units.')
    }
  }, [api, page, debouncedSearch, status])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // Feeds: taxonomy tree + countries (for the create form).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [treeRes, countriesRes] = await Promise.all([
        api.get<{ tree: Array<{ slug: string; canonicalName: string; children: unknown[] }> }>('/api/taxonomy/admin/tree'),
        api.get<{ countries: Array<{ isoCode: string; name: string }> }>('/api/countries'),
      ])
      if (cancelled) return
      const flat: Array<{ slug: string; name: string }> = []
      const walk = (nodes: Array<{ slug: string; canonicalName: string; children: unknown[] }>): void => {
        for (const node of nodes) {
          flat.push({ slug: node.slug, name: node.canonicalName })
          walk(node.children as typeof nodes)
        }
      }
      if (treeRes.data) walk(treeRes.data.tree)
      setTopics(flat)
      setCountries((countriesRes.data?.countries ?? []).map((entry) => ({ isoCode: entry.isoCode, name: entry.name })))
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [api])

  // ----- lifecycle (§36) -----
  async function runTransition(unit: AdminUnit, action: string, reason?: string) {
    setBusyId(unit.id)
    try {
      const response = await api.post<{ unit: AdminUnit }>(`/api/knowledge/admin/units/${unit.id}/transition`, {
        action,
        ...(reason ? { reason } : {}),
      })
      if (response.data) {
        toast({ title: `Unit is now ${response.data.unit.status.toLowerCase().replace('_', ' ')}`, description: 'The transition is audited (§36).' })
        if (editorUnit?.id === unit.id) setEditorUnit(response.data.unit)
        await fetchList()
        return true
      }
      toast({ title: 'Transition rejected', description: response.error?.message, variant: 'destructive' })
      return false
    } finally {
      setBusyId(null)
    }
  }

  const rows = result?.units ?? []

  const columns: Array<ResourceColumn<AdminUnit>> = useMemo(
    () => [
      {
        key: 'canonicalName',
        header: 'Unit',
        className: 'min-w-[280px]',
        render: (unit) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{unit.canonicalName}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
              {unit.slug} · {unit.topic.canonicalName}
            </p>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (unit) => <span className="whitespace-nowrap text-[12px] text-zinc-500">{unit.type.replace('_', ' ').toLowerCase()}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (unit) => <UnitStatusBadge status={unit.status} />,
      },
      {
        key: 'scope',
        header: 'Scope',
        render: (unit) => <span className="font-mono text-[11px] text-zinc-500">{unit.scope === 'COUNTRY' ? unit.countryIso : 'GLOBAL'}</span>,
      },
      {
        key: 'difficulty',
        header: 'Level',
        render: (unit) => <span className="text-[12px] text-zinc-500">{unit.difficulty.toLowerCase()}</span>,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (unit) => <span className="whitespace-nowrap text-zinc-500">{formatWhen(unit.updatedAt)}</span>,
      },
    ],
    []
  )

  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Knowledge Units"
        description="The §7 canonical knowledge base every representation, question and event hangs from — one record per fact, deduplicated by canonical identity, with a full §36 lifecycle."
        icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                onClick={() => {
                  setEditorUnit(null)
                  setEditorOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New unit
              </Button>
            )}
          </>
        }
      />

      {error && rows.length === 0 && !loading && <ErrorNotice message={error} onRetry={() => void fetchList()} />}

      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(unit) => unit.id}
        loading={loading}
        onRowClick={canManage ? (unit) => {
          setEditorUnit(unit)
          setEditorOpen(true)
        } : undefined}
        search={{ value: search, onChange: setSearch, placeholder: 'Search name or slug…' }}
        toolbar={
          <div className="w-40">
            <SelectInput
              value={status}
              onChange={(value) => {
                setStatus(value)
                setPage(1)
              }}
              placeholder="All statuses"
              options={STATUS_OPTIONS.map((option) => ({ value: option, label: option.replace('_', ' ') }))}
            />
          </div>
        }
        emptyTitle="No units match"
        emptyHint="Adjust the filters, or create the first canonical unit for this topic."
        pagination={
          result
            ? { page: result.pagination.page, totalPages: result.pagination.totalPages, total: result.pagination.total, onPage: setPage }
            : undefined
        }
        actions={(unit) =>
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busyId === unit.id} aria-label="Row actions">
                  {busyId === unit.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MoreHorizontal className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => {
                    setEditorUnit(unit)
                    setEditorOpen(true)
                  }}
                  disabled={!unit.canEdit || unit.editability === 'none'}
                >
                  <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Edit unit
                </DropdownMenuItem>
                {unit.allowedTransitions.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-400">Lifecycle (§36)</DropdownMenuLabel>
                    {unit.allowedTransitions.map((action) => {
                      const meta = TRANSITION_META[action]
                      if (!meta) return null
                      const Icon = meta.icon
                      return (
                        <DropdownMenuItem
                          key={action}
                          className={cn(action === 'archive' && 'text-red-600 focus:text-red-600')}
                          disabled={!unit.canEdit}
                          onClick={() => {
                            if (action === 'flag_outdated') {
                              setFlagUnit(unit)
                              setFlagReason('')
                            } else if (action === 'archive') {
                              setArchiveUnit(unit)
                            } else {
                              void runTransition(unit, action)
                            }
                          }}
                        >
                          <Icon className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {meta.label}
                        </DropdownMenuItem>
                      )
                    })}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      {/* Create / edit editor */}
      <UnitEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        unit={editorUnit}
        topics={topics}
        countries={countries}
        isAdmin={role === 'ADMIN'}
        onSaved={() => void fetchList()}
      />

      {/* flag_outdated — reason required (§25/§36 correction provenance) */}
      <Dialog open={flagUnit !== null} onOpenChange={(open) => !open && setFlagUnit(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-orange-600" aria-hidden="true" />
              Flag as outdated
            </DialogTitle>
            <DialogDescription>
              This opens the correction cycle (§36): the body becomes editable, and the unit must be re-verified before it
              publishes again. The reason is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason" required hint="e.g. 2024 amendment changed the composition…">
            <TextArea id="ku-flag-reason" value={flagReason} onChange={setFlagReason} rows={3} placeholder="What changed in the world?" />
          </Field>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFlagUnit(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!flagReason.trim()}
              onClick={() => {
                if (flagUnit) void runTransition(flagUnit, 'flag_outdated', flagReason.trim())
                setFlagUnit(null)
              }}
            >
              Flag outdated
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive — the §36 end-of-life (canonical knowledge is never hard-deleted) */}
      <AlertDialog open={archiveUnit !== null} onOpenChange={(open) => !open && setArchiveUnit(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-red-600" aria-hidden="true" />
              Archive this unit?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveUnit?.canonicalName}” becomes a read-only end-of-life record (§36). Canonical knowledge has no
              destructive delete — prefer keeping it verified if unsure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (archiveUnit) void runTransition(archiveUnit, 'archive')
                setArchiveUnit(null)
              }}
            >
              Archive unit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------- the create/edit editor ----------

interface UnitEditorState {
  canonicalName: string
  slug: string
  canonicalSummary: string
  canonicalBody: string
  type: string
  difficulty: string
  scope: 'GLOBAL' | 'COUNTRY'
  country: string
  topic: string
  validFrom: string
  notes: string
  orderIndex: string
}

const EMPTY_UNIT: UnitEditorState = {
  canonicalName: '',
  slug: '',
  canonicalSummary: '',
  canonicalBody: '',
  type: 'FACT',
  difficulty: 'BASIC',
  scope: 'GLOBAL',
  country: '',
  topic: '',
  validFrom: '',
  notes: '',
  orderIndex: '0',
}

function UnitEditorDialog({
  open,
  onOpenChange,
  unit,
  topics,
  countries,
  isAdmin,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unit: AdminUnit | null
  topics: Array<{ slug: string; name: string }>
  countries: Array<{ isoCode: string; name: string }>
  isAdmin: boolean
  onSaved: () => void
}) {
  const api = useConsoleApi()
  const { toast } = useToast()
  const editing = unit !== null

  const [form, setForm] = useState<UnitEditorState>(EMPTY_UNIT)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const set = <K extends keyof UnitEditorState>(key: K, value: UnitEditorState[K]) => setForm((prev) => ({ ...prev, [key]: value }))

  useEffect(() => {
    if (!open) return
    setErrors({})
    if (!unit) {
      setForm({ ...EMPTY_UNIT, topic: topics[0]?.slug ?? '' })
      return
    }
    setForm({
      canonicalName: unit.canonicalName,
      slug: unit.slug,
      canonicalSummary: unit.canonicalSummary ?? '',
      canonicalBody: unit.canonicalBody,
      type: unit.type,
      difficulty: unit.difficulty,
      scope: unit.scope,
      country: unit.countryIso ?? '',
      topic: unit.topic.slug,
      validFrom: toDateInput(unit.validity.from),
      notes: unit.notes ?? '',
      orderIndex: String(unit.orderIndex),
    })
  }, [open, unit?.id])

  const contentEditable = !editing || unit?.editability === 'full'
  const metadataEditable = !editing || unit?.editability === 'full' || unit?.editability === 'metadata'
  const editable = !editing || (unit?.canEdit ?? true)

  async function handleSave() {
    setSaving(true)
    setErrors({})
    try {
      let response
      if (editing && unit) {
        // Only send what changed — audited diffs stay honest (§36).
        const patch: Record<string, unknown> = {}
        if (contentEditable) {
          if (form.canonicalName !== unit.canonicalName) patch.canonicalName = form.canonicalName.trim()
          if (form.canonicalSummary !== (unit.canonicalSummary ?? '')) patch.canonicalSummary = form.canonicalSummary.trim() || null
          if (form.canonicalBody !== unit.canonicalBody) patch.canonicalBody = form.canonicalBody.trim()
        }
        if (metadataEditable) {
          if (form.difficulty !== unit.difficulty) patch.difficulty = form.difficulty
          if (form.notes !== (unit.notes ?? '')) patch.notes = form.notes.trim() || null
          const order = Number.parseInt(form.orderIndex, 10)
          if (!Number.isNaN(order) && order !== unit.orderIndex) patch.orderIndex = order
          if (form.validFrom !== toDateInput(unit.validity.from)) {
            patch.validFrom = form.validFrom ? new Date(form.validFrom).toISOString() : null
          }
        }
        if (Object.keys(patch).length === 0) {
          toast({ title: 'Nothing to save' })
          return
        }
        response = await api.patch<{ unit: AdminUnit }>(`/api/knowledge/admin/units/${unit.id}`, patch)
      } else {
        const body: Record<string, unknown> = {
          canonicalName: form.canonicalName.trim(),
          slug: form.slug.trim() || slugify(form.canonicalName),
          canonicalBody: form.canonicalBody.trim(),
          type: form.type,
          difficulty: form.difficulty,
          scope: isAdmin ? form.scope : 'COUNTRY',
          topic: form.topic,
          ...(isAdmin && form.scope === 'COUNTRY' && form.country ? { country: form.country } : {}),
          ...(form.canonicalSummary.trim() ? { canonicalSummary: form.canonicalSummary.trim() } : {}),
          ...(form.validFrom ? { validFrom: new Date(form.validFrom).toISOString() } : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          orderIndex: Number.parseInt(form.orderIndex, 10) || 0,
        }
        response = await api.post<{ unit: AdminUnit }>('/api/knowledge/admin/units', body)
      }
      if (response.data) {
        toast({
          title: editing ? 'Unit saved' : 'Unit created as draft',
          description: editing ? 'The audited diff landed (§36).' : 'Submit it for review when ready.',
        })
        onOpenChange(false)
        onSaved()
      } else if (response.error) {
        setErrors(fieldErrorMap(response.error.details))
        toast({ title: 'Could not save the unit', description: response.error.message, variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const topicOptions = useMemo(() => topics.map((topic) => ({ value: topic.slug, label: topic.name })), [topics])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit knowledge unit' : 'New knowledge unit'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Slug, type, topic and scope are immutable (§36). Editability follows the status: the VERIFIED body is locked — flag outdated to open the correction cycle.'
              : 'One canonical record per fact (§7) — enters DRAFT; dedup is by unique slug + one canonical name per topic (§11).'}
          </DialogDescription>
        </DialogHeader>

        {editing && unit && unit.editability !== 'full' && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
            {unit.editability === 'metadata'
              ? 'VERIFIED — body locked (§36 no silent edits). Metadata (difficulty, validity, notes, order) stays editable.'
              : 'ARCHIVED — read-only end-of-life record.'}
          </p>
        )}

        <div className="gksetu-scroll max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Canonical name" required error={errors.canonicalName} className="sm:col-span-2">
              <TextInput
                id="ku-name"
                value={form.canonicalName}
                onChange={(value) => {
                  set('canonicalName', value)
                  if (!editing && !form.slug) set('slug', slugify(value))
                }}
                placeholder="e.g. Kesavananda Bharati Case — 1973"
                invalid={!!errors.canonicalName}
                disabled={!editable || !contentEditable}
              />
            </Field>
            <Field label="Slug" hint={editing ? 'Immutable URL identity (§16).' : 'Optional — generated from the name.'} error={errors.slug}>
              <TextInput
                id="ku-slug"
                value={form.slug}
                onChange={(value) => set('slug', slugify(value))}
                placeholder="auto-generated"
                className="font-mono text-xs"
                invalid={!!errors.slug}
                disabled={!editable || editing}
              />
            </Field>
            <Field label="Canonical topic" required error={errors.topic}>
              {editing ? (
                <TextInput id="ku-topic" value={unit?.topic.canonicalName ?? ''} onChange={() => undefined} disabled />
              ) : (
                <SelectInput
                  id="ku-topic"
                  value={form.topic}
                  onChange={(value) => set('topic', value)}
                  options={topicOptions}
                  placeholder={topicOptions.length ? 'Choose…' : 'Loading…'}
                  invalid={!!errors.topic}
                />
              )}
            </Field>
            <Field label="One-line summary" hint="The quick fact a learner retains (§22)." className="sm:col-span-2" error={errors.canonicalSummary}>
              <TextInput
                id="ku-summary"
                value={form.canonicalSummary}
                onChange={(value) => set('canonicalSummary', value)}
                placeholder="One sentence."
                invalid={!!errors.canonicalSummary}
                disabled={!editable || !contentEditable}
              />
            </Field>
            <Field
              label="Canonical body"
              required
              className="sm:col-span-2"
              error={errors.canonicalBody}
              hint="The English-reference full record — other languages are representations (P2-S2)."
            >
              <Guard disabled={!editable || !contentEditable}>
                <TextArea
                  id="ku-body"
                  value={form.canonicalBody}
                  onChange={(value) => set('canonicalBody', value)}
                  rows={6}
                  invalid={!!errors.canonicalBody}
                />
              </Guard>
            </Field>
            <Field label="Type" hint={editing ? 'Immutable (§23).' : undefined}>
              {editing ? (
                <TextInput id="ku-type" value={form.type.replace('_', ' ')} onChange={() => undefined} disabled />
              ) : (
                <SelectInput
                  id="ku-type"
                  value={form.type}
                  onChange={(value) => set('type', value)}
                  options={TYPE_OPTIONS.map((option) => ({ value: option, label: option.replace('_', ' ') }))}
                />
              )}
            </Field>
            <Field label="Difficulty">
              <Guard disabled={!editable || !metadataEditable}>
                <SelectInput
                  id="ku-difficulty"
                  value={form.difficulty}
                  onChange={(value) => set('difficulty', value)}
                  options={DIFFICULTY_OPTIONS.map((option) => ({ value: option, label: option.charAt(0) + option.slice(1).toLowerCase() }))}
                />
              </Guard>
            </Field>
            {editing ? (
              <Field label="Scope (immutable)">
                <TextInput
                  id="ku-scope"
                  value={form.scope === 'GLOBAL' ? 'GLOBAL' : `COUNTRY · ${form.country || '—'}`}
                  onChange={() => undefined}
                  disabled
                />
              </Field>
            ) : (
              isAdmin && (
                <>
                  <Field label="Country scope (§14)">
                    <SelectInput
                      id="ku-scope"
                      value={form.scope}
                      onChange={(value) => {
                        set('scope', value as 'GLOBAL' | 'COUNTRY')
                        if (value === 'GLOBAL') set('country', '')
                      }}
                      options={[
                        { value: 'GLOBAL', label: 'GLOBAL — all markets' },
                        { value: 'COUNTRY', label: 'COUNTRY — one market' },
                      ]}
                    />
                  </Field>
                  {form.scope === 'COUNTRY' && (
                    <Field label="Country" error={errors.country}>
                      <SelectInput
                        id="ku-country"
                        value={form.country}
                        onChange={(value) => set('country', value)}
                        options={countries.map((entry) => ({ value: entry.isoCode, label: `${entry.isoCode} — ${entry.name}` }))}
                        placeholder="Choose…"
                        invalid={!!errors.country}
                      />
                    </Field>
                  )}
                </>
              )
            )}
            <Field label="Valid from (optional)">
              <TextInput
                id="ku-validfrom"
                type="date"
                value={form.validFrom}
                onChange={(value) => set('validFrom', value)}
                disabled={!editable || !metadataEditable}
              />
            </Field>
            <Field label="Order index" hint="Sequence inside the topic (§13).">
              <TextInput
                id="ku-order"
                value={form.orderIndex}
                onChange={(value) => set('orderIndex', value.replace(/[^0-9]/g, ''))}
                disabled={!editable || !metadataEditable}
                className="font-mono"
              />
            </Field>
            <Field label="Internal notes (optional)" className="sm:col-span-2">
              <Guard disabled={!editable || !metadataEditable}>
                <TextArea id="ku-notes" value={form.notes} onChange={(value) => set('notes', value)} rows={2} />
              </Guard>
            </Field>
          </div>

          {editing && unit && (
            <p className="text-xs text-zinc-500">
              Validity: {unit.validity.from ? `from ${toDateInput(unit.validity.from)}` : 'evergreen'}
              {unit.validity.until ? ` until ${toDateInput(unit.validity.until)}` : ''} ·{' '}
              <span className={unit.validity.currentlyValid ? 'text-emerald-700' : 'text-red-600'}>
                {unit.validity.currentlyValid ? 'currently valid' : 'outside window'}
              </span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !editable || unit?.editability === 'none'}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {editing ? 'Save changes' : 'Create draft unit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
