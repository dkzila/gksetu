'use client'

/**
 * GKSetu Console — Books management (SITE-S15).
 *
 * The marketplace registry's management surface: create/edit/transition books
 * + manage editions (format × language × price) + link exams (the autosuggest
 * source). Rides `book:manage` (ADMIN + COUNTRY_ADMIN, own country).
 *
 * The page is a single list + a create/edit dialog. Editions + exam links are
 * managed inline on the row's expandable detail (click the row to expand).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type {
  AdminBook,
  AdminBookDetail,
  AdminBookListResult,
  BookFormat,
  BookType,
} from '@/modules/books'

import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

import {
  ConsolePageHeader,
  EmptyState,
  ErrorNotice,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { Field, SelectInput, TextInput } from '@/components/console/ui/form-fields'
import { VisualEditor } from '@/components/console/ui/visual-editor'
import {
  fieldErrorMap,
  useConsoleApi,
  useHasPermission,
} from '@/components/console/ui/console-api'
import { fetchActiveCountries, slugify, type CountryRef } from './exam-console-shared'

const PAGE_SIZE = 20

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'BOOK', label: 'Books' },
  { value: 'MAGAZINE', label: 'Magazines' },
  { value: 'NOTE_COMPILATION', label: 'Notes' },
  { value: 'CURRENT_AFFAIRS_DIGEST', label: 'CA Digests' },
] as const

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'RETIRED', label: 'Retired' },
] as const

const TYPE_CREATE_OPTIONS = [
  { value: 'BOOK', label: 'Book' },
  { value: 'MAGAZINE', label: 'Magazine' },
  { value: 'NOTE_COMPILATION', label: 'Note Compilation' },
  { value: 'CURRENT_AFFAIRS_DIGEST', label: 'CA Digest' },
] as const

const FORMAT_OPTIONS = [
  { value: 'PDF', label: 'PDF (digital download)' },
  { value: 'PRINT', label: 'Print (physical shipped)' },
] as const

interface BookFormValues {
  title: string
  slug: string
  type: BookType
  subtitle: string
  description: string
  coverImageUrl: string
  category: string
  author: string
  country: string
}

const EMPTY_FORM: BookFormValues = {
  title: '',
  slug: '',
  type: 'BOOK',
  subtitle: '',
  description: '',
  coverImageUrl: '',
  category: '',
  author: '',
  country: '',
}

export function BooksPage() {
  const canManage = useHasPermission('book:manage')
  const { post, patch } = useConsoleApi()
  const { toast } = useToast()

  // List state
  const [result, setResult] = useState<AdminBookListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [listTick, setListTick] = useState(0)
  const [countries, setCountries] = useState<CountryRef[]>([])

  // Dialog state
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; open: boolean; book: AdminBook | null }>({ mode: 'create', open: false, book: null })
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void fetchActiveCountries().then((list) => setCountries(list))
  }, [])

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

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (typeFilter) params.set('type', typeFilter)
      if (statusFilter) params.set('status', statusFilter)
      const response = await fetch(`/api/books/admin?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<AdminBookListResult>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
        setError(null)
      } else {
        setResult(null)
        setError(payload.error?.message ?? 'Could not load books')
      }
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, typeFilter, statusFilter, listTick])

  const refreshList = useCallback(() => {
    setLoading(true)
    setListTick((t) => t + 1)
  }, [])

  // ---------- Mutations ----------

  const createBook = async (values: BookFormValues): Promise<true | Record<string, string>> => {
    setBusy(true)
    const { data, error } = await post<{ book: AdminBookDetail }>('/api/books/admin', {
      title: values.title.trim(),
      slug: values.slug.trim(),
      type: values.type,
      ...(values.subtitle.trim() ? { subtitle: values.subtitle.trim() } : {}),
      description: values.description.trim(),
      ...(values.coverImageUrl.trim() ? { coverImageUrl: values.coverImageUrl.trim() } : {}),
      ...(values.category.trim() ? { category: values.category.trim() } : {}),
      ...(values.author.trim() ? { author: values.author.trim() } : {}),
      country: values.country || null,
    })
    setBusy(false)
    if (data) {
      toast({ title: 'Book created', description: `${data.book.title} entered DRAFT.` })
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not create the book', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const updateBook = async (id: string, values: BookFormValues): Promise<true | Record<string, string>> => {
    setBusy(true)
    const { data, error } = await patch<{ book: AdminBookDetail }>(`/api/books/admin/${id}`, {
      title: values.title.trim(),
      ...(values.subtitle.trim() ? { subtitle: values.subtitle.trim() } : { subtitle: null }),
      description: values.description.trim(),
      ...(values.coverImageUrl.trim() ? { coverImageUrl: values.coverImageUrl.trim() } : { coverImageUrl: null }),
      ...(values.category.trim() ? { category: values.category.trim() } : { category: null }),
      ...(values.author.trim() ? { author: values.author.trim() } : { author: null }),
      country: values.country || null,
    })
    setBusy(false)
    if (data) {
      toast({ title: 'Book updated' })
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not update the book', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const runTransition = async (book: AdminBook, action: 'publish' | 'retire' | 'reactivate') => {
    setBusy(true)
    const { data, error } = await post<{ book: AdminBook }>(`/api/books/admin/${book.id}/transition`, { action })
    setBusy(false)
    if (data) {
      toast({
        title: `Book ${action === 'publish' ? 'published' : action === 'retire' ? 'retired' : 'reactivated'}`,
        description: `${data.book.title} is now ${data.book.status.toLowerCase()}.`,
      })
      refreshList()
    } else if (error) {
      toast({ title: 'Transition failed', description: error.message, variant: 'destructive' })
    }
  }

  // ---------- Table columns ----------

  const columns = useMemo<Array<ResourceColumn<AdminBook>>>(
    () => [
      {
        key: 'title',
        header: 'Book',
        render: (book) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{book.title}</p>
            <p className="truncate font-mono text-[11px] text-zinc-400">{book.slug}</p>
          </div>
        ),
        className: 'max-w-[280px]',
      },
      {
        key: 'type',
        header: 'Type',
        render: (book) => (
          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[11px] text-zinc-600">
            {book.type === 'BOOK' ? 'Book' : book.type === 'MAGAZINE' ? 'Magazine' : book.type === 'NOTE_COMPILATION' ? 'Notes' : 'CA Digest'}
          </Badge>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        render: (book) => <span className="truncate text-xs text-zinc-600">{book.category ?? '—'}</span>,
        className: 'max-w-[140px] hidden md:table-cell',
      },
      {
        key: 'editions',
        header: 'Editions',
        render: (book) => <span className="tabular-nums text-zinc-500">{book.editionCount}</span>,
        className: 'hidden sm:table-cell',
      },
      {
        key: 'examLinks',
        header: 'Exams',
        render: (book) => <span className="tabular-nums text-zinc-500">{book.examLinkCount}</span>,
        className: 'hidden sm:table-cell',
      },
      {
        key: 'status',
        header: 'Status',
        render: (book) => <StatusBadge status={book.status} />,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (book) => <span className="whitespace-nowrap text-zinc-500">{formatWhen(book.updatedAt)}</span>,
        className: 'hidden lg:table-cell',
      },
    ],
    []
  )

  const rows = result?.books ?? []
  const pagination = result?.pagination

  // ---------- Render ----------

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Books"
        description="The marketplace registry — books, magazines, exam-notes compilations. Manage editions (format × language × price) + link exams (the autosuggest source)."
        icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={refreshList} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setDialog({ mode: 'create', open: true, book: null })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New book
              </Button>
            )}
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, author, category…"
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[13px] text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            aria-label="Search books"
          />
        </div>
        <div className="w-[140px]">
          <SelectInput
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setPage(1); setLoading(true) }}
            options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            id="book-type-filter"
          />
        </div>
        <div className="w-[140px]">
          <SelectInput
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); setLoading(true) }}
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            id="book-status-filter"
          />
        </div>
        {pagination && (
          <span className="ml-auto text-xs tabular-nums text-zinc-400">
            {pagination.total} book{pagination.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {!canManage ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">Book management requires the book:manage permission</p>
              <p className="text-sm text-amber-800">Your role doesn't grant this capability.</p>
            </div>
          </CardContent>
        </Card>
      ) : error && !loading && rows.length === 0 ? (
        <ErrorNotice message={error} onRetry={refreshList} />
      ) : (
        <ResourceTable
          columns={columns}
          rows={rows}
          rowKey={(book) => book.id}
          loading={loading}
          emptyTitle="No books match these filters"
          emptyHint="Try clearing the filters — or create the first book."
          onRowClick={(book) => setExpandedRow((current) => (current === book.id ? null : book.id))}
          pagination={
            pagination
              ? {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  total: pagination.total,
                  onPage: (next) => { setPage(next); setLoading(true) },
                }
              : undefined
          }
          actions={(book) => (
            <>
              {book.allowedTransitions.includes('publish') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-emerald-300 bg-emerald-50 px-2 text-[11px] text-emerald-700 hover:bg-emerald-100"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); void runTransition(book, 'publish') }}
                  title="Publish (makes it visible in /store/)"
                >
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden xl:inline">Publish</span>
                </Button>
              )}
              {book.allowedTransitions.includes('retire') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-red-200 bg-red-50 px-2 text-[11px] text-red-600 hover:bg-red-100"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); void runTransition(book, 'retire') }}
                  title="Retire (end-of-life, no longer purchasable)"
                >
                  <span className="hidden xl:inline">Retire</span>
                </Button>
              )}
              {book.allowedTransitions.includes('reactivate') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-emerald-300 bg-emerald-50 px-2 text-[11px] text-emerald-700 hover:bg-emerald-100"
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); void runTransition(book, 'reactivate') }}
                  title="Reactivate (re-publish)"
                >
                  <span className="hidden xl:inline">Reactivate</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={book.status === 'RETIRED'}
                onClick={(e) => { e.stopPropagation(); setDialog({ mode: 'edit', open: true, book }) }}
                title="Edit metadata"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => { e.stopPropagation(); setExpandedRow((current) => (current === book.id ? null : book.id)) }}
                title="Expand editions + exam links"
              >
                {expandedRow === book.id ? (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
            </>
          )}
        />
      )}

      {/* Create / edit dialog */}
      {dialog.open && (
        <BookFormDialog
          mode={dialog.mode}
          book={dialog.book}
          countries={countries}
          busy={busy}
          onClose={() => setDialog((c) => ({ ...c, open: false }))}
          onSubmit={async (values) => {
            if (dialog.mode === 'create') return createBook(values)
            if (dialog.mode === 'edit' && dialog.book) return updateBook(dialog.book.id, values)
            return {}
          }}
        />
      )}
    </div>
  )
}

// ---------- The create/edit form ----------

function BookFormDialog({
  mode,
  book,
  countries,
  busy,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  book: AdminBook | null
  countries: CountryRef[]
  busy: boolean
  onClose: () => void
  onSubmit: (values: BookFormValues) => Promise<true | Record<string, string>>
}) {
  const [values, setValues] = useState<BookFormValues>(() =>
    mode === 'edit' && book
      ? {
          title: book.title,
          slug: book.slug,
          type: book.type,
          subtitle: book.subtitle ?? '',
          description: book.description,
          coverImageUrl: book.coverImageUrl ?? '',
          category: book.category ?? '',
          author: book.author ?? '',
          country: book.countryIso ?? '',
        }
      : { ...EMPTY_FORM, country: countries[0]?.isoCode ?? '' }
  )
  const [slugTouched, setSlugTouched] = useState(mode === 'edit')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const set = <K extends keyof BookFormValues>(key: K, value: BookFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    setErrors({})
    setFormError(null)
    if (!values.title.trim()) {
      setErrors({ title: 'Title is required' })
      setFormError('Add a title.')
      return
    }
    if (mode === 'create' && !values.slug.trim()) {
      setErrors({ slug: 'Slug is required' })
      setFormError('Add a slug.')
      return
    }
    if (values.description.trim().length < 20) {
      setErrors({ description: 'Description must be at least 20 characters' })
      setFormError('The description is too short.')
      return
    }
    const result = await onSubmit(values)
    if (result === true) {
      onClose()
      return
    }
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New book' : 'Edit book'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Enters DRAFT. Slug + type are immutable identity — set them carefully.'
              : 'Descriptive fields only — slug + type are immutable; status changes go through transitions.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="Title" htmlFor="book-title" required error={errors.title}>
            <TextInput
              id="book-title"
              value={values.title}
              onChange={(value) => {
                set('title', value)
                if (mode === 'create' && !slugTouched) set('slug', slugify(value))
              }}
              placeholder="Indian Polity — the GKSetu edition"
              invalid={Boolean(errors.title)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Slug" htmlFor="book-slug" required={mode === 'create'} error={errors.slug} hint={mode === 'edit' ? 'Immutable' : 'URL-stable, lowercase kebab-case'}>
              <TextInput
                id="book-slug"
                value={values.slug}
                onChange={(value) => { setSlugTouched(true); set('slug', slugify(value)) }}
                placeholder="indian-polity-gksetu"
                invalid={Boolean(errors.slug)}
                disabled={mode === 'edit'}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Type" htmlFor="book-type" required error={errors.type} hint={mode === 'edit' ? 'Immutable' : undefined}>
              <SelectInput
                id="book-type"
                value={values.type}
                onChange={(v) => set('type', v as BookType)}
                options={TYPE_CREATE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                disabled={mode === 'edit'}
              />
            </Field>
          </div>

          <Field label="Subtitle (optional)" htmlFor="book-subtitle" error={errors.subtitle}>
            <TextInput
              id="book-subtitle"
              value={values.subtitle}
              onChange={(v) => set('subtitle', v)}
              placeholder="A short tagline (the card subtitle)"
              invalid={Boolean(errors.subtitle)}
            />
          </Field>

          <Field label="Description (marketing copy)" htmlFor="book-description" required error={errors.description} hint={`${values.description.length} characters`}>
            <VisualEditor
              value={values.description}
              onChange={(v) => set('description', v)}
              placeholder="The long-form marketing copy. What this book is, who it's for, what it covers."
              minHeight={150}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="book-category" error={errors.category} hint="e.g. Polity, History, CA">
              <TextInput
                id="book-category"
                value={values.category}
                onChange={(v) => set('category', v)}
                placeholder="Polity"
                invalid={Boolean(errors.category)}
              />
            </Field>
            <Field label="Author / publisher" htmlFor="book-author" error={errors.author}>
              <TextInput
                id="book-author"
                value={values.author}
                onChange={(v) => set('author', v)}
                placeholder="GKSetu Editorial Board"
                invalid={Boolean(errors.author)}
              />
            </Field>
          </div>

          <Field label="Cover image URL" htmlFor="book-cover" error={errors.coverImageUrl} hint="A public URL (Supabase Storage)">
            <TextInput
              id="book-cover"
              value={values.coverImageUrl}
              onChange={(v) => set('coverImageUrl', v)}
              placeholder="https://…"
              invalid={Boolean(errors.coverImageUrl)}
              className="font-mono text-xs"
            />
          </Field>

          <Field label="Country" htmlFor="book-country" error={errors.country} hint="§14 — the home-market country (null = global)">
            <SelectInput
              id="book-country"
              value={values.country}
              onChange={(v) => set('country', v)}
              options={[
                { value: '', label: 'Global (no country)' },
                ...countries.map((c) => ({ value: c.isoCode, label: `${c.name} (${c.isoCode})` })),
              ]}
            />
          </Field>

          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {mode === 'create' ? 'Create book (DRAFT)' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
