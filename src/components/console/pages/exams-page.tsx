'use client'

/**
 * GKSetu Console — Exams list (CONSOLE-S1-E).
 *
 * The exam registry's management surface: server-side search + status/country
 * filters + pagination over the 137-exam corpus (§37 deterministic pagination),
 * compact table with lifecycle badges (§36), and the WordPress-simple loop —
 * create (enters DRAFT), edit descriptive fields, lifecycle transitions
 * (activate / deactivate / reactivate / retire — exams are configuration, so
 * there is deliberately NO hard delete; retire is the audited end-of-life and
 * needs a reason), then click a row to manage versions, syllabus and mappings
 * on the detail page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  BadgeCheck,
  Ban,
  GraduationCap,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'

import { navigateToPath } from '@/components/home/app-router'
import {
  ConsolePageHeader,
  ErrorNotice,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import {
  Field,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/console/ui/form-fields'
import { fieldErrorMap, useConsoleApi } from '@/components/console/ui/console-api'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import type { AdminExam, AdminExamListResult, ExamTransitionAction } from '@/modules/exams-syllabus'

import { codify, fetchActiveCountries, slugify, type CountryRef } from './exam-console-shared'

const PAGE_SIZE = 20

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'RETIRED', label: 'Retired' },
] as const

const TRANSITION_META: Record<
  ExamTransitionAction,
  { label: string; icon: typeof BadgeCheck; className: string }
> = {
  activate: {
    label: 'Activate',
    icon: BadgeCheck,
    className: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  },
  deactivate: {
    label: 'Deactivate',
    icon: Ban,
    className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  },
  reactivate: {
    label: 'Reactivate',
    icon: RotateCcw,
    className: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  },
  retire: {
    label: 'Retire',
    icon: Trash2,
    className: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100',
  },
}

// ---------- Exam create / edit dialog (mount-per-open; state initialises from props) ----------

interface ExamFormValues {
  name: string
  slug: string
  code: string
  organiser: string
  level: string
  country: string
  description: string
  notes: string
}

const EMPTY_FORM: ExamFormValues = {
  name: '',
  slug: '',
  code: '',
  organiser: '',
  level: 'NATIONAL',
  country: '',
  description: '',
  notes: '',
}

/** Submits the form; resolves `true` on success or a `{ field: message }` map (the API envelope's validation details). */
export type ExamSubmitResult = true | Record<string, string>

export function ExamFormDialog({
  mode,
  exam,
  countries,
  onSubmit,
  busy,
  onClose,
}: {
  mode: 'create' | 'edit'
  exam: AdminExam | null
  countries: CountryRef[]
  onSubmit: (values: ExamFormValues) => Promise<ExamSubmitResult>
  busy: boolean
  onClose: () => void
}) {
  const [values, setValues] = useState<ExamFormValues>(() =>
    mode === 'edit' && exam
      ? {
          name: exam.name,
          slug: exam.slug,
          code: exam.code,
          organiser: exam.organiser,
          level: exam.level,
          country: exam.countryIso,
          description: exam.description ?? '',
          notes: exam.notes ?? '',
        }
      : { ...EMPTY_FORM, country: countries[0]?.isoCode ?? '' }
  )
  const [slugTouched, setSlugTouched] = useState<boolean>(mode === 'edit')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const set = <K extends keyof ExamFormValues>(key: K, value: ExamFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    setErrors({})
    setFormError(null)
    const result = await onSubmit(values)
    if (result === true) {
      onClose()
      return
    }
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New exam' : 'Edit exam'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Enters DRAFT. Slug, code and country are immutable identity — set them carefully.'
              : 'Descriptive fields only — slug, code and country are immutable; status changes go through transitions.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="Exam name" htmlFor="exam-name" required error={errors.name}>
            <TextInput
              id="exam-name"
              value={values.name}
              onChange={(value) => {
                set('name', value)
                if (mode === 'create' && !slugTouched) set('slug', slugify(value))
              }}
              placeholder="UPSC Civil Services Examination"
              invalid={Boolean(errors.name)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Slug"
              htmlFor="exam-slug"
              required
              error={errors.slug}
              hint={mode === 'edit' ? 'Immutable' : 'URL-stable, lowercase kebab-case'}
            >
              <TextInput
                id="exam-slug"
                value={values.slug}
                onChange={(value) => {
                  setSlugTouched(true)
                  set('slug', slugify(value))
                }}
                placeholder="upsc-civil-services"
                invalid={Boolean(errors.slug)}
                disabled={mode === 'edit'}
                className="font-mono text-xs"
              />
            </Field>
            <Field
              label="Code"
              htmlFor="exam-code"
              required
              error={errors.code}
              hint={mode === 'edit' ? 'Immutable' : 'Uppercase, e.g. UPSC-CSE'}
            >
              <TextInput
                id="exam-code"
                value={values.code}
                onChange={(value) => set('code', codify(value))}
                placeholder="UPSC-CSE"
                invalid={Boolean(errors.code)}
                disabled={mode === 'edit'}
                className="font-mono text-xs"
              />
            </Field>
          </div>

          <Field label="Organiser (conducting body)" htmlFor="exam-organiser" required error={errors.organiser}>
            <TextInput
              id="exam-organiser"
              value={values.organiser}
              onChange={(value) => set('organiser', value)}
              placeholder="Union Public Service Commission"
              invalid={Boolean(errors.organiser)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Level" htmlFor="exam-level" required error={errors.level}>
              <SelectInput
                id="exam-level"
                value={values.level}
                onChange={(value) => set('level', value)}
                options={[
                  { value: 'NATIONAL', label: 'National' },
                  { value: 'STATE', label: 'State' },
                  { value: 'REGIONAL', label: 'Regional' },
                ]}
                invalid={Boolean(errors.level)}
              />
            </Field>
            <Field
              label="Country"
              htmlFor="exam-country"
              required
              error={errors.country}
              hint={mode === 'edit' ? 'Immutable — every exam belongs to exactly one country' : undefined}
            >
              {mode === 'edit' ? (
                <TextInput
                  id="exam-country"
                  value={`${exam?.countryName ?? ''} (${exam?.countryIso ?? ''})`}
                  onChange={() => undefined}
                  disabled
                />
              ) : (
                <SelectInput
                  id="exam-country"
                  value={values.country}
                  onChange={(value) => set('country', value)}
                  options={countries.map((country) => ({
                    value: country.isoCode,
                    label: `${country.name} (${country.isoCode})`,
                  }))}
                  placeholder="Pick a country"
                  invalid={Boolean(errors.country)}
                />
              )}
            </Field>
          </div>

          <Field label="Description" htmlFor="exam-description" error={errors.description}>
            <TextArea
              id="exam-description"
              value={values.description}
              onChange={(value) => set('description', value)}
              placeholder="What this exam is, who runs it, what it selects for…"
              rows={2}
            />
          </Field>

          <Field label="Internal notes" htmlFor="exam-notes" error={errors.notes}>
            <TextArea
              id="exam-notes"
              value={values.notes}
              onChange={(value) => set('notes', value)}
              placeholder="Private console notes (never shown publicly)"
              rows={2}
            />
          </Field>

          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
            {mode === 'create' ? 'Create exam' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- The page ----------

export function ExamsPage() {
  const { toast } = useToast()
  const api = useConsoleApi()
  // `useConsoleApi()` returns a fresh object each render — keep the latest one
  // behind a ref (updated in the first effect) so the list effect below runs
  // once per input change, never per render.
  const apiRef = useRef(api)

  // List state (server-side search/filter/pagination — the corpus is 137+)
  const [result, setResult] = useState<AdminExamListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [page, setPage] = useState(1)
  const [countries, setCountries] = useState<CountryRef[]>([])
  const [listTick, setListTick] = useState(0)

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [editExam, setEditExam] = useState<AdminExam | null>(null)
  const [retireExam, setRetireExam] = useState<AdminExam | null>(null)
  const [retireReason, setRetireReason] = useState('')
  const [busy, setBusy] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    apiRef.current = api
  })

  useEffect(() => {
    let cancelled = false
    void fetchActiveCountries().then((list) => {
      if (!cancelled) setCountries(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Debounce the search box into the server-side `q` (§37 search lives in the API).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
      setLoading(true)
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  // Refetch on any input change (and on refreshList() bumps after mutations).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (statusFilter) params.set('status', statusFilter)
      if (countryFilter) params.set('country', countryFilter)
      const { data, error: fetchError } = await apiRef.current.get<AdminExamListResult>(
        `/api/exams/admin/exams?${params.toString()}`
      )
      if (cancelled) return
      if (data) {
        setResult(data)
        setError(null)
      } else {
        setResult(null)
        setError(fetchError?.message ?? 'Could not load exams')
      }
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, statusFilter, countryFilter, listTick])

  /** Re-runs the list fetch (event contexts: buttons, post-mutation callbacks). */
  const refreshList = useCallback(() => {
    setLoading(true)
    setListTick((tick) => tick + 1)
  }, [])

  const columns = useMemo<Array<ResourceColumn<AdminExam>>>(
    () => [
      {
        key: 'name',
        header: 'Exam',
        render: (exam) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{exam.name}</p>
            <p className="truncate font-mono text-[11px] text-zinc-400">
              {exam.slug} · {exam.code}
            </p>
          </div>
        ),
        className: 'max-w-[280px]',
      },
      {
        key: 'organiser',
        header: 'Organiser',
        render: (exam) => <span className="truncate">{exam.organiser}</span>,
        className: 'max-w-[200px] hidden md:table-cell',
      },
      {
        key: 'countryIso',
        header: 'Country',
        render: (exam) => <span className="whitespace-nowrap text-zinc-500">{exam.countryIso}</span>,
      },
      {
        key: 'level',
        header: 'Level',
        render: (exam) => (
          <span className="text-[11px] uppercase tracking-wide text-zinc-400">{exam.level}</span>
        ),
        className: 'hidden lg:table-cell',
      },
      { key: 'status', header: 'Status', render: (exam) => <StatusBadge status={exam.status} /> },
      {
        key: 'versionCount',
        header: 'Versions',
        render: (exam) => <span className="tabular-nums text-zinc-500">{exam.versionCount}</span>,
        className: 'hidden sm:table-cell',
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (exam) => (
          <span className="whitespace-nowrap text-zinc-500">{formatWhen(exam.updatedAt)}</span>
        ),
        className: 'hidden lg:table-cell',
      },
    ],
    []
  )

  // ---------- Mutations ----------

  const applyExamResponse = (exam: AdminExam) => {
    setResult((current) =>
      current
        ? {
            ...current,
            exams: current.exams.map((row) => (row.id === exam.id ? { ...row, ...exam } : row)),
          }
        : current
    )
    setEditExam((current) => (current && current.id === exam.id ? { ...current, ...exam } : current))
  }

  const createExam = async (values: ExamFormValues): Promise<ExamSubmitResult> => {
    setBusy(true)
    const { data, error } = await api.post<{ exam: AdminExam }>('/api/exams/admin/exams', {
      name: values.name.trim(),
      slug: values.slug.trim(),
      code: values.code.trim(),
      organiser: values.organiser.trim(),
      level: values.level,
      country: values.country,
      ...(values.description.trim() ? { description: values.description.trim() } : {}),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
    })
    setBusy(false)
    if (data) {
      toast({
        title: 'Exam created',
        description: `${data.exam.name} entered DRAFT — open it to stage a syllabus version.`,
      })
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not create the exam', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const updateExam = async (values: ExamFormValues): Promise<ExamSubmitResult> => {
    if (!editExam) return {}
    setBusy(true)
    const { data, error } = await api.patch<{ exam: AdminExam }>(`/api/exams/admin/exams/${editExam.id}`, {
      name: values.name.trim(),
      organiser: values.organiser.trim(),
      level: values.level,
      ...(values.description.trim() ? { description: values.description.trim() } : { description: null }),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : { notes: null }),
    })
    setBusy(false)
    if (data) {
      toast({ title: 'Exam updated' })
      applyExamResponse(data.exam)
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not update the exam', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const runTransition = async (exam: AdminExam, action: ExamTransitionAction, reason?: string) => {
    setBusy(true)
    const { data, error } = await api.post<{ exam: AdminExam }>(
      `/api/exams/admin/exams/${exam.id}/transition`,
      { action, ...(reason ? { reason } : {}) }
    )
    setBusy(false)
    if (data) {
      toast({
        title: `Exam ${action === 'retire' ? 'retired' : `${action}d`}`,
        description: `${data.exam.name} is now ${data.exam.status}.`,
      })
      applyExamResponse(data.exam)
      refreshList()
      return true
    }
    if (error) toast({ title: 'Transition failed', description: error.message, variant: 'destructive' })
    return false
  }

  const confirmRetire = async () => {
    if (!retireExam) return
    const ok = await runTransition(retireExam, 'retire', retireReason.trim() || undefined)
    if (ok) {
      setRetireExam(null)
      setRetireReason('')
    }
  }

  const rows = result?.exams ?? []
  const pagination = result?.pagination

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Exams"
        description="The country-scoped exam registry with versioned syllabi — every exam belongs to exactly one country, and syllabus changes create a new version instead of editing history."
        icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={refreshList}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New exam
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, code, organiser…"
            className="h-8 pl-8 text-[13px]"
            aria-label="Search exams"
          />
        </div>
        <div className="w-[140px]">
          <SelectInput
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value)
              setPage(1)
              setLoading(true)
            }}
            options={STATUS_FILTERS.map((option) => ({ value: option.value, label: option.label }))}
            id="exam-status-filter"
          />
        </div>
        <div className="w-[170px]">
          <SelectInput
            value={countryFilter}
            onChange={(value) => {
              setCountryFilter(value)
              setPage(1)
              setLoading(true)
            }}
            options={[
              { value: '', label: 'All countries' },
              ...countries.map((country) => ({
                value: country.isoCode,
                label: `${country.name} (${country.isoCode})`,
              })),
            ]}
            id="exam-country-filter"
          />
        </div>
        {pagination && (
          <span className="ml-auto text-xs tabular-nums text-zinc-400">
            {pagination.total} exam{pagination.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && !loading && rows.length === 0 ? (
        <ErrorNotice message={error} onRetry={refreshList} />
      ) : (
        <ResourceTable
          columns={columns}
          rows={rows}
          rowKey={(exam) => exam.id}
          loading={loading}
          emptyTitle="No exams match these filters"
          emptyHint="Try clearing the search or filters — or create the first exam for this country."
          onRowClick={(exam) => navigateToPath(`/console/exams/${exam.id}`)}
          pagination={
            pagination
              ? {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  total: pagination.total,
                  onPage: (next) => {
                    setPage(next)
                    setLoading(true)
                  },
                }
              : undefined
          }
          actions={(exam) => (
            <>
              {exam.allowedTransitions
                .filter((action) => action !== 'retire')
                .map((action) => {
                  const meta = TRANSITION_META[action]
                  const Icon = meta.icon
                  return (
                    <Button
                      key={action}
                      variant="outline"
                      size="sm"
                      className={`h-7 border px-2 text-[11px] ${meta.className}`}
                      disabled={busy}
                      onClick={() => void runTransition(exam, action)}
                      title={meta.label}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      <span className="hidden xl:inline">{meta.label}</span>
                    </Button>
                  )
                })}
              {exam.allowedTransitions.includes('retire') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border border-red-200 bg-red-50 px-2 text-[11px] text-red-600 hover:bg-red-100"
                  disabled={busy}
                  onClick={() => {
                    setRetireExam(exam)
                    setRetireReason('')
                  }}
                  title="Retire (end-of-life — needs a reason)"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden xl:inline">Retire</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={exam.editability === 'none'}
                onClick={() => setEditExam(exam)}
                title="Edit descriptive fields"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                onClick={() => navigateToPath(`/console/exams/${exam.id}`)}
                title="Open exam"
              >
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </>
          )}
        />
      )}

      {/* Create / edit (mounted per open — fresh state each time) */}
      {createOpen && (
        <ExamFormDialog
          mode="create"
          exam={null}
          countries={countries}
          onSubmit={createExam}
          busy={busy}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editExam && (
        <ExamFormDialog
          mode="edit"
          exam={editExam}
          countries={countries}
          onSubmit={updateExam}
          busy={busy}
          onClose={() => setEditExam(null)}
        />
      )}

      {/* Retire (the §36 end-of-life — audited, reason recorded, no hard delete) */}
      <AlertDialog open={retireExam !== null} onOpenChange={(open) => !open && setRetireExam(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Retire “{retireExam?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Retirement is the end-of-life: the exam becomes read-only and disappears from the public
              directory. Exams are never hard-deleted — history is preserved. A reason is recorded with
              the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="retire-reason" className="text-[13px] font-medium text-zinc-700">
              Reason
            </Label>
            <TextArea
              id="retire-reason"
              value={retireReason}
              onChange={(value) => setRetireReason(value)}
              placeholder="e.g. Merged into the new combined exam from 2027"
              rows={2}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRetireExam(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void confirmRetire()
              }}
            >
              Retire exam
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
