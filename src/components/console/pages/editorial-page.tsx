'use client'

/**
 * GKSetu Console — Editorial Board (CONSOLE-S1-F): the §19 task board,
 * wired to /api/editorial/tasks* + /api/editorial/assignees following the
 * P2-S4 editorial-section demo's exact patterns.
 *
 * §18 role rules made visible: writers claim/start/resolve THEIR tasks;
 * editors (content:publish) create, reassign, cancel and reopen. The
 * allowedActions array is server-driven truth — the UI renders it, the
 * server re-checks every action.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Loader2,
  PlayCircle,
  Plus,
  RotateCcw,
  UserCheck,
  XCircle,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { fieldErrorMap, useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import {
  ConsolePageHeader,
  ErrorNotice,
  formatDate,
  formatWhen,
  StatusBadge,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { Field, SelectInput, TextArea, TextInput } from '@/components/console/ui/form-fields'

// ---------- Contracts (mirror src/modules/editorial/types.ts) ----------

type TaskAction = 'start' | 'claim' | 'resolve' | 'cancel' | 'reopen'

interface EditorialTask {
  id: string
  type: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  countryIso: string | null
  language: { code: string; name: string } | null
  objectType: string
  objectId: string
  objectLabel: string
  title: string
  notes: string | null
  resolutionNote: string | null
  assignee: { id: string; email: string; name: string | null } | null
  dueAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
  allowedActions: TaskAction[]
  canManage: boolean
}

interface BoardResult {
  tasks: EditorialTask[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; open: number; inProgress: number; resolved: number; cancelled: number }
  facets: { types: string[] }
}

interface AssignableStaff {
  id: string
  email: string
  name: string | null
  role: 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'
  homeCountryIso: string | null
  languageScopeCode: string | null
}

interface ContentItemPick {
  id: string
  title: string
  status: string
  objectLabel: string
}

const TASK_TYPES = [
  'EDITORIAL_REVIEW',
  'FACT_CHECK',
  'LOCALISATION_REVIEW',
  'SEO_REVIEW',
  'EXAM_MAPPING_REVIEW',
  'CORRECTION',
  'GENERAL',
] as const

const TYPE_LABELS: Record<string, string> = {
  EDITORIAL_REVIEW: 'Editorial review',
  FACT_CHECK: 'Fact / source check',
  LOCALISATION_REVIEW: 'Localisation review',
  SEO_REVIEW: 'SEO review',
  EXAM_MAPPING_REVIEW: 'Exam mapping review',
  CORRECTION: 'Correction',
  GENERAL: 'General',
}

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'border-zinc-200 bg-zinc-50 text-zinc-500',
  MEDIUM: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-700',
  URGENT: 'border-red-200 bg-red-50 text-red-700',
}

const UNASSIGNED = '__unassigned__'

const PAGE_SIZE = 15

// ==================================================================

export function EditorialPage() {
  const api = useConsoleApi()
  const { toast } = useToast()
  const user = useAuth((state) => state.user)
  const isAdmin = user?.role === 'ADMIN'
  const canPublish = useHasPermission('content:publish') // editors (§18)

  // Board state.
  const [board, setBoard] = useState<BoardResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // Filters.
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  // Assignee directory (editors).
  const [staff, setStaff] = useState<AssignableStaff[]>([])
  const [countryOptions, setCountryOptions] = useState<Array<{ isoCode: string; name: string }>>([])

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    type: 'FACT_CHECK',
    title: '',
    notes: '',
    assigneeId: '',
    priority: 'MEDIUM',
    dueAt: '',
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [itemPicks, setItemPicks] = useState<ContentItemPick[] | null>(null)
  const [itemSearching, setItemSearching] = useState(false)
  const [pickedItemId, setPickedItemId] = useState('')

  // Resolve dialog.
  const [resolveTarget, setResolveTarget] = useState<EditorialTask | null>(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolving, setResolving] = useState(false)

  // Cancel confirm.
  const [cancelTarget, setCancelTarget] = useState<EditorialTask | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // ---------- Loads ----------

  const fetchBoard = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (typeFilter) params.set('type', typeFilter)
    if (assigneeFilter) params.set('assignee', assigneeFilter)
    if (countryFilter) params.set('country', countryFilter)
    if (query.trim()) params.set('q', query.trim())
    params.set('page', String(page))
    params.set('pageSize', String(PAGE_SIZE))
    const { data, error } = await api.get<BoardResult>(`/api/editorial/tasks?${params.toString()}`)
    if (error) {
      setError(error.message)
      setBoard(null)
    } else {
      setBoard(data ?? null)
    }
    setLoading(false)
  }, [api, statusFilter, typeFilter, assigneeFilter, countryFilter, query, page])

  useEffect(() => {
    // Deferred (set-state-in-effect guard — fetchBoard sets state up front).
    const timer = setTimeout(() => {
      void fetchBoard()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [fetchBoard])

  // Assignee directory (editors only — the endpoint requires content:publish).
  useEffect(() => {
    if (!canPublish) return
    let cancelled = false
    void (async () => {
      const { data } = await api.get<{ staff: AssignableStaff[] }>('/api/editorial/assignees')
      if (!cancelled) setStaff(data?.staff ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [api, canPublish])

  // Country filter options (ADMIN only).
  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    void (async () => {
      const { data } = await api.get<{ countries: Array<{ isoCode: string; name: string }> }>(
        '/api/countries?include=inactive'
      )
      if (!cancelled) setCountryOptions(data?.countries ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [api, isAdmin])

  // Content item search for the create form (debounced — the demo pattern;
  // every state update lives inside the macrotask callback so the effect
  // body itself stays render-pure).
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      if (!createOpen || itemSearch.trim().length < 3 || pickedItemId !== '') {
        setItemPicks(null)
        setItemSearching(false)
        return
      }
      setItemSearching(true)
      void (async () => {
        const { data } = await api.get<{
          items: Array<{ id: string; title: string; status: string; unit: { slug: string }; language: { code: string }; format: string }>
        }>(`/api/content/admin/items?q=${encodeURIComponent(itemSearch.trim())}&pageSize=8`)
        setItemPicks(
          data?.items.map((item) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            objectLabel: `${item.unit.slug}/${item.language.code}/${item.format}`,
          })) ?? []
        )
        setItemSearching(false)
      })()
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [createOpen, itemSearch, pickedItemId, api])

  // ---------- Actions ----------

  const runTransition = async (task: EditorialTask, action: TaskAction, resolutionNote?: string) => {
    const key = `${task.id}:${action}`
    if (busyKey) return
    setBusyKey(key)
    const { data, error } = await api.post<{ task: EditorialTask }>(
      `/api/editorial/tasks/${task.id}/transition`,
      resolutionNote !== undefined ? { action, resolutionNote } : { action }
    )
    setBusyKey(null)
    if (error) {
      toast({ title: 'Action failed', description: error.message, variant: 'destructive' })
      return
    }
    toast({ title: `Done — ${action}`, description: `"${task.title}" is now ${data!.task.status.replace(/_/g, ' ').toLowerCase()}.` })
    setResolveTarget(null)
    setResolveNote('')
    void fetchBoard()
  }

  const reassign = async (task: EditorialTask, assigneeId: string | null) => {
    const key = `${task.id}:assign`
    if (busyKey) return
    setBusyKey(key)
    const { data, error } = await api.patch<{ task: EditorialTask }>(`/api/editorial/tasks/${task.id}`, {
      assigneeId,
    })
    setBusyKey(null)
    if (error) {
      toast({ title: 'Could not assign', description: error.message, variant: 'destructive' })
      return
    }
    toast({
      title: assigneeId ? 'Task assigned' : 'Assignment cleared',
      description: assigneeId
        ? `"${data!.task.title}" → ${data!.task.assignee?.name ?? data!.task.assignee?.email}.`
        : 'Back to the unclaimed pool.',
    })
    void fetchBoard()
  }

  const submitCreate = async () => {
    if (creating) return
    setCreating(true)
    setCreateErrors({})
    const payload: Record<string, unknown> = {
      type: createForm.type,
      objectId: pickedItemId,
      title: createForm.title.trim(),
      priority: createForm.priority,
    }
    if (createForm.notes.trim()) payload.notes = createForm.notes.trim()
    if (createForm.assigneeId) payload.assigneeId = createForm.assigneeId
    if (createForm.dueAt) payload.dueAt = new Date(createForm.dueAt).toISOString()
    const { error } = await api.post('/api/editorial/tasks', payload)
    setCreating(false)
    if (error) {
      setCreateErrors(fieldErrorMap(error.details))
      toast({ title: 'Could not create the task', description: error.message, variant: 'destructive' })
      return
    }
    setCreateOpen(false)
    setCreateForm({ type: 'FACT_CHECK', title: '', notes: '', assigneeId: '', priority: 'MEDIUM', dueAt: '' })
    setPickedItemId('')
    setItemSearch('')
    setItemPicks(null)
    toast({ title: 'Work item created', description: 'Opened on the board (§19).' })
    setPage(1)
    void fetchBoard()
  }

  // ---------- Table ----------

  const tasks = board?.tasks ?? []

  const columns: Array<ResourceColumn<EditorialTask>> = useMemo(
    () => [
      {
        key: 'title',
        header: 'Task',
        className: 'min-w-[280px]',
        render: (task) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-800" title={task.title}>
              {task.title}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="border-teal-200 bg-teal-50 px-1.5 py-0 text-[10px] font-normal text-teal-700">
                {TYPE_LABELS[task.type] ?? task.type}
              </Badge>
              <Badge variant="outline" className={`px-1.5 py-0 text-[10px] font-normal ${PRIORITY_STYLES[task.priority] ?? ''}`}>
                {task.priority.toLowerCase()}
              </Badge>
              {task.countryIso ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{task.countryIso}</Badge>
              ) : (
                <Badge variant="outline" className="border-zinc-200 bg-zinc-50 px-1.5 py-0 text-[10px] font-normal text-zinc-500">
                  global
                </Badge>
              )}
              {task.language && (
                <code className="font-mono text-[10px] text-zinc-400">{task.language.code}</code>
              )}
            </div>
            {task.notes && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-400" title={task.notes}>
                {task.notes}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'object',
        header: 'Object',
        render: (task) => (
          <code className="font-mono text-[11px] text-zinc-500" title={`${task.objectType} · ${task.objectId}`}>
            {task.objectLabel}
          </code>
        ),
      },
      {
        key: 'assignee',
        header: 'Assignee',
        render: (task) =>
          task.assignee ? (
            <div>
              <span className="text-[13px] text-zinc-700">{task.assignee.name ?? task.assignee.email}</span>
              <span className="block text-[10px] text-zinc-400">{task.assignee.email}</span>
            </div>
          ) : (
            <span className="text-[11px] italic text-zinc-400">unclaimed</span>
          ),
      },
      {
        key: 'dueAt',
        header: 'Due',
        render: (task) => {
          if (!task.dueAt) return <span className="text-zinc-300">—</span>
          const overdue = new Date(task.dueAt).getTime() < Date.now() && task.status !== 'RESOLVED'
          return (
            <span className={`flex items-center gap-1 text-[12px] ${overdue ? 'font-medium text-red-600' : 'text-zinc-500'}`}>
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {formatDate(task.dueAt)}
            </span>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (task) => <StatusBadge status={task.status} />,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (task) => <span className="text-[12px] text-zinc-400">{formatWhen(task.updatedAt)}</span>,
      },
    ],
    []
  )

  const summary = board?.summary

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Editorial Board"
        description="The §19 workflow board — every submission opens a review item; publishing or retiring closes them. Writers claim and resolve their tasks; editors create, assign, cancel and reopen. Affordances are server-driven and re-checked on every action."
        icon={<ClipboardList className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void fetchBoard()} disabled={loading}>
              <RotateCcw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canPublish && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  setCreateForm({ type: 'FACT_CHECK', title: '', notes: '', assigneeId: '', priority: 'MEDIUM', dueAt: '' })
                  setCreateErrors({})
                  setPickedItemId('')
                  setItemSearch('')
                  setItemPicks(null)
                  setCreateOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New work item
              </Button>
            )}
          </>
        }
      />

      {/* Summary chips */}
      {summary ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setPage(1)
              setStatusFilter('')
            }}
            className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
              statusFilter === '' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
            }`}
          >
            {summary.total} in your scope
          </button>
          {(
            [
              ['OPEN', summary.open, 'sky'],
              ['IN_PROGRESS', summary.inProgress, 'amber'],
              ['RESOLVED', summary.resolved, 'emerald'],
              ['CANCELLED', summary.cancelled, 'zinc'],
            ] as const
          ).map(([status, count]) => (
            <button
              key={status}
              type="button"
              onClick={() => {
                setPage(1)
                setStatusFilter(statusFilter === status ? '' : status)
              }}
              className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                statusFilter === status
                  ? status === 'OPEN'
                    ? 'border-sky-300 bg-sky-50 text-sky-700'
                    : status === 'IN_PROGRESS'
                      ? 'border-amber-300 bg-amber-50 text-amber-700'
                      : status === 'RESOLVED'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-zinc-300 bg-zinc-100 text-zinc-500'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
              }`}
            >
              {count} {status === 'IN_PROGRESS' ? 'in progress' : status.toLowerCase()}
            </button>
          ))}
          {user?.languageScope && (
            <span className="text-zinc-400">· language-scoped: {user.languageScope.name}</span>
          )}
        </div>
      ) : loading ? (
        <div className="flex gap-2">
          <div className="h-7 w-24 animate-pulse rounded-full bg-zinc-100" />
          <div className="h-7 w-20 animate-pulse rounded-full bg-zinc-100" />
          <div className="h-7 w-24 animate-pulse rounded-full bg-zinc-100" />
        </div>
      ) : null}

      {error && <ErrorNotice message={error} onRetry={() => void fetchBoard()} />}

      <ResourceTable
        columns={columns}
        rows={tasks}
        rowKey={(task) => task.id}
        loading={loading}
        emptyTitle="No tasks match this view"
        emptyHint="Submit content for review to open one (§19), or create a work item — filters apply."
        search={{
          value: query,
          onChange: (value) => {
            setPage(1)
            setQuery(value)
          },
          placeholder: 'Search title or object…',
        }}
        toolbar={
          <>
            <div className="w-[130px]">
              <SelectInput
                value={statusFilter}
                onChange={(value) => {
                  setPage(1)
                  setStatusFilter(value)
                }}
                placeholder="All statuses"
                options={[
                  { value: 'OPEN', label: 'Open' },
                  { value: 'IN_PROGRESS', label: 'In progress' },
                  { value: 'RESOLVED', label: 'Resolved' },
                  { value: 'CANCELLED', label: 'Cancelled' },
                ]}
              />
            </div>
            <div className="w-[150px]">
              <SelectInput
                value={typeFilter}
                onChange={(value) => {
                  setPage(1)
                  setTypeFilter(value)
                }}
                placeholder="All types"
                options={TASK_TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] ?? type }))}
              />
            </div>
            <div className="w-[160px]">
              <SelectInput
                value={assigneeFilter}
                onChange={(value) => {
                  setPage(1)
                  setAssigneeFilter(value)
                }}
                placeholder="Any assignee"
                options={[
                  { value: 'me', label: 'Assigned to me' },
                  { value: 'unassigned', label: 'Unclaimed pool' },
                  ...staff.map((member) => ({
                    value: member.id,
                    label: member.name ?? member.email,
                  })),
                ]}
              />
            </div>
            {isAdmin && (
              <div className="w-[150px]">
                <SelectInput
                  value={countryFilter}
                  onChange={(value) => {
                    setPage(1)
                    setCountryFilter(value)
                  }}
                  placeholder="All workspaces"
                  options={[
                    { value: 'global', label: 'Global (platform)' },
                    ...countryOptions.map((country) => ({ value: country.isoCode, label: country.name })),
                  ]}
                />
              </div>
            )}
          </>
        }
        pagination={
          board && board.pagination.totalPages > 1
            ? {
                page: board.pagination.page,
                totalPages: board.pagination.totalPages,
                total: board.pagination.total,
                onPage: setPage,
              }
            : undefined
        }
        actions={(task) => (
          <>
            {task.allowedActions.includes('claim') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                title="Claim this task for yourself"
                disabled={busyKey !== null}
                onClick={() => void runTransition(task, 'claim')}
              >
                {busyKey === `${task.id}:claim` ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <UserCheck className="h-3 w-3" aria-hidden="true" />
                )}
                Claim
              </Button>
            )}
            {task.allowedActions.includes('start') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                title="Mark in progress"
                disabled={busyKey !== null}
                onClick={() => void runTransition(task, 'start')}
              >
                {busyKey === `${task.id}:start` ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <PlayCircle className="h-3 w-3" aria-hidden="true" />
                )}
                Start
              </Button>
            )}
            {task.allowedActions.includes('resolve') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 border-emerald-300 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50"
                title="Resolve with an optional outcome note"
                disabled={busyKey !== null}
                onClick={() => {
                  setResolveTarget(task)
                  setResolveNote('')
                }}
              >
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Resolve
              </Button>
            )}
            {task.allowedActions.includes('cancel') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 border-red-200 px-2 text-[11px] text-red-600 hover:bg-red-50"
                title="Cancel this work item (editor decision)"
                disabled={busyKey !== null}
                onClick={() => setCancelTarget(task)}
              >
                <XCircle className="h-3 w-3" aria-hidden="true" />
                Cancel
              </Button>
            )}
            {task.allowedActions.includes('reopen') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                title="Reopen (editor decision)"
                disabled={busyKey !== null}
                onClick={() => void runTransition(task, 'reopen')}
              >
                {busyKey === `${task.id}:reopen` ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                )}
                Reopen
              </Button>
            )}
            {canPublish && staff.length > 0 && task.status !== 'RESOLVED' && task.status !== 'CANCELLED' && (
              <div className="w-[150px]">
                <SelectInput
                  value={task.assignee?.id ?? UNASSIGNED}
                  onChange={(value) => void reassign(task, value === UNASSIGNED ? null : value)}
                  options={[
                    { value: UNASSIGNED, label: 'Unassigned (pool)' },
                    ...staff.map((member) => ({
                      value: member.id,
                      label: `${member.name ?? member.email}${member.languageScopeCode ? ` (${member.languageScopeCode})` : ''}`,
                    })),
                  ]}
                />
              </div>
            )}
          </>
        )}
      />

      {/* ---------- Create work item ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New work item</DialogTitle>
            <DialogDescription>
              Editors create tasks on a content object (§18) — the task inherits the content&apos;s
              country and language; assignees are validated against their §20 scopes server-side.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="task-type" required error={createErrors.type}>
                <SelectInput
                  id="task-type"
                  value={createForm.type}
                  onChange={(value) => setCreateForm((state) => ({ ...state, type: value }))}
                  options={TASK_TYPES.map((type) => ({ value: type, label: TYPE_LABELS[type] ?? type }))}
                />
              </Field>
              <Field label="Priority" htmlFor="task-priority" error={createErrors.priority}>
                <SelectInput
                  id="task-priority"
                  value={createForm.priority}
                  onChange={(value) => setCreateForm((state) => ({ ...state, priority: value }))}
                  options={['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => ({
                    value: priority,
                    label: priority.toLowerCase(),
                  }))}
                />
              </Field>
            </div>

            <Field label="Title" htmlFor="task-title" required error={createErrors.title} hint="A short, actionable summary.">
              <TextInput
                id="task-title"
                value={createForm.title}
                onChange={(value) => setCreateForm((state) => ({ ...state, title: value }))}
                placeholder="Verify the National Space Day citation"
                invalid={Boolean(createErrors.title)}
              />
            </Field>

            <Field
              label="Work object — content item"
              htmlFor="task-item"
              required
              error={createErrors.objectId}
              hint={pickedItemId ? `Selected: ${pickedItemId}` : 'Search by title (3+ characters) and pick the item.'}
            >
              <div className="space-y-1.5">
                <TextInput
                  id="task-item"
                  value={itemSearch}
                  onChange={(value) => {
                    setPickedItemId('')
                    setItemSearch(value)
                  }}
                  placeholder="Type 3+ characters to search content…"
                  invalid={Boolean(createErrors.objectId)}
                />
                {itemSearching && <p className="text-xs text-zinc-400">Searching…</p>}
                {itemPicks && itemPicks.length === 0 && !itemSearching && (
                  <p className="text-xs text-zinc-400">No matching content items.</p>
                )}
                {itemPicks && itemPicks.length > 0 && (
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1">
                    {itemPicks.map((pick) => (
                      <button
                        key={pick.id}
                        type="button"
                        onClick={() => {
                          setPickedItemId(pick.id)
                          setItemSearch(pick.title)
                        }}
                        className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          pickedItemId === pick.id
                            ? 'bg-emerald-50 text-emerald-800'
                            : 'text-zinc-700 hover:bg-zinc-50'
                        }`}
                      >
                        <span className="font-medium">{pick.title}</span>
                        <span className="ml-1 text-zinc-400">
                          · {pick.objectLabel} · {pick.status.toLowerCase()}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Assignee (optional)" htmlFor="task-assignee" error={createErrors.assigneeId}>
                <SelectInput
                  id="task-assignee"
                  value={createForm.assigneeId}
                  onChange={(value) => setCreateForm((state) => ({ ...state, assigneeId: value }))}
                  placeholder="Unassigned (unclaimed pool)"
                  options={staff.map((member) => ({
                    value: member.id,
                    label: `${member.name ?? member.email} · ${member.role.toLowerCase()}${
                      member.languageScopeCode ? ` (${member.languageScopeCode})` : ''
                    }`,
                  }))}
                />
              </Field>
              <Field label="Due (optional)" htmlFor="task-due" error={createErrors.dueAt}>
                <TextInput
                  id="task-due"
                  type="datetime-local"
                  value={createForm.dueAt}
                  onChange={(value) => setCreateForm((state) => ({ ...state, dueAt: value }))}
                />
              </Field>
            </div>

            <Field label="Notes (optional)" htmlFor="task-notes" error={createErrors.notes} hint="Instructions for the assignee.">
              <TextArea
                id="task-notes"
                value={createForm.notes}
                onChange={(value) => setCreateForm((state) => ({ ...state, notes: value }))}
                rows={3}
                placeholder="What to check and which sources count…"
              />
            </Field>

            {createErrors.form && <p className="text-xs text-red-600">{createErrors.form}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitCreate()}
              disabled={creating || !pickedItemId || createForm.title.trim().length < 3}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Create task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Resolve with note ---------- */}
      <Dialog open={resolveTarget !== null} onOpenChange={(open) => !open && setResolveTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Resolve “{resolveTarget?.title}”
            </DialogTitle>
            <DialogDescription>
              Resolving records the outcome on the task (§19). If this task came from a public feedback
              report, resolving it closes the report with the same note.
            </DialogDescription>
          </DialogHeader>
          <Field label="Resolution note (optional)" htmlFor="resolve-note">
            <TextArea
              id="resolve-note"
              value={resolveNote}
              onChange={setResolveNote}
              rows={3}
              placeholder="e.g. Verified against the ISRO record; the claim stands."
            />
          </Field>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={resolving}
              onClick={() => {
                if (resolveTarget) {
                  setResolving(true)
                  void runTransition(resolveTarget, 'resolve', resolveNote.trim()).then(() => setResolving(false))
                }
              }}
            >
              {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Cancel confirm ---------- */}
      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel “{cancelTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling is an editorial decision (§18) — the item moves to CANCELLED and leaves the
              active board. A cancelled task can be reopened later from its row.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 bg-red-600 text-white hover:bg-red-700"
              disabled={cancelling}
              onClick={(event) => {
                event.preventDefault()
                if (cancelTarget) {
                  setCancelling(true)
                  void runTransition(cancelTarget, 'cancel').then(() => {
                    setCancelling(false)
                    setCancelTarget(null)
                  })
                }
              }}
            >
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
              Cancel task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
