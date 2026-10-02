'use client'

/**
 * GKSetu Console — Pages (CONSOLE-S1-F): the managed static-page surface
 * (About / Contact / Privacy / any custom page), wired to /api/pages/admin*.
 *
 * Model (src/modules/site-pages): one row per page; `body` is the working
 * copy, publishing snapshots it into publishedTitle/publishedBody; the slug
 * is immutable after creation; reserved slugs render at /{slug}, everything
 * else at /p/{slug}. Drift (working copy ≠ live snapshot) shows as an amber
 * marker on published pages.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { navigateToPath } from '@/components/home/app-router'

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
import { Badge } from '@/components/ui/badge'

import { fieldErrorMap, useConsoleApi } from '@/components/console/ui/console-api'
import {
  ConsolePageHeader,
  ErrorNotice,
  formatWhen,
  StatusBadge,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import {
  Field,
  SwitchField,
  TextArea,
  TextInput,
} from '@/components/console/ui/form-fields'

// ---------- Contracts (mirror src/modules/site-pages/service.ts — copied, never
// imported: that module pulls Prisma into its graph and must not reach a client
// bundle). ----------

interface AdminSitePage {
  id: string
  slug: string
  title: string
  body: string
  status: 'DRAFT' | 'PUBLISHED'
  publishedTitle: string | null
  publishedBody: string | null
  publishedAt: string | null
  showInFooter: boolean
  sortOrder: number
  seoTitle: string | null
  seoDescription: string | null
  updatedAt: string
  updatedBy: { email: string | null } | null
}

/** Slugs that render at the top level; everything else lives under /p/. */
const RESERVED_PAGE_SLUGS = ['about', 'contact', 'privacy-policy', 'terms', 'disclaimer'] as const

function isReservedSlug(slug: string): boolean {
  return (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug)
}

function pageUrl(slug: string): string {
  return isReservedSlug(slug) ? `/${slug}` : `/p/${slug}`
}

/** Published but the working copy has moved on from the live snapshot. */
function hasLiveDrift(page: AdminSitePage): boolean {
  if (page.status !== 'PUBLISHED') return false
  return page.body !== page.publishedBody || page.title !== page.publishedTitle
}

// ---------- Form state ----------

interface PageFormState {
  slug: string
  title: string
  body: string
  seoTitle: string
  seoDescription: string
  showInFooter: boolean
  sortOrder: string
}

const EMPTY_FORM: PageFormState = {
  slug: '',
  title: '',
  body: '',
  seoTitle: '',
  seoDescription: '',
  showInFooter: true,
  sortOrder: '0',
}

function toForm(page: AdminSitePage): PageFormState {
  return {
    slug: page.slug,
    title: page.title,
    body: page.body,
    seoTitle: page.seoTitle ?? '',
    seoDescription: page.seoDescription ?? '',
    showInFooter: page.showInFooter,
    sortOrder: String(page.sortOrder),
  }
}

// ---------- Page ----------

export function PagesPage() {
  const api = useConsoleApi()
  const { toast } = useToast()

  const [pages, setPages] = useState<AdminSitePage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Create / edit dialogs.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminSitePage | null>(null) // null = create
  const [form, setForm] = useState<PageFormState>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Lifecycle + delete confirms.
  const [confirmAction, setConfirmAction] = useState<'publish' | 'unpublish' | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<AdminSitePage | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminSitePage | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await api.get<{ pages: AdminSitePage[] }>('/api/pages/admin')
    if (error) {
      setLoadError(error.message)
      setPages([])
    } else {
      setPages(data?.pages ?? [])
    }
    setLoading(false)
  }, [api])

  useEffect(() => {
    // Deferred through a macrotask: the loader sets state synchronously at its
    // start, which the react-hooks/set-state-in-effect rule forbids in an
    // effect body (cascading-render guard).
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [load])

  // ---------- Editor dialog ----------

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFieldErrors({})
    setEditorOpen(true)
  }

  const openEdit = (page: AdminSitePage) => {
    setEditing(page)
    setForm(toForm(page))
    setFieldErrors({})
    setEditorOpen(true)
  }

  const submitEditor = async () => {
    if (saving) return
    setSaving(true)
    setFieldErrors({})

    const sortOrder = Number.parseInt(form.sortOrder, 10)
    const payload: Record<string, unknown> = {
      title: form.title,
      body: form.body,
      seoTitle: form.seoTitle.trim() === '' ? null : form.seoTitle.trim(),
      seoDescription: form.seoDescription.trim() === '' ? null : form.seoDescription.trim(),
      showInFooter: form.showInFooter,
      sortOrder: Number.isNaN(sortOrder) ? 0 : Math.max(0, Math.min(9999, sortOrder)),
    }
    if (!editing) payload.slug = form.slug.trim().toLowerCase()

    const { data, error } = editing
      ? await api.patch<{ page: AdminSitePage }>(`/api/pages/admin/${editing.id}`, payload)
      : await api.post<{ page: AdminSitePage }>('/api/pages/admin', payload)

    if (error) {
      setFieldErrors(fieldErrorMap(error.details))
      toast({ title: 'Could not save the page', description: error.message, variant: 'destructive' })
      setSaving(false)
      return
    }

    setEditorOpen(false)
    toast({
      title: editing ? 'Page saved' : 'Page created',
      description: editing
        ? hasLiveDrift(data!.page)
          ? 'Working copy saved. It differs from the live snapshot — publish again to refresh it.'
          : 'The working copy is updated.'
        : `"${data!.page.title}" created as a draft — publish it when it is ready.`,
    })
    await load()
    setSaving(false)
  }

  // ---------- Lifecycle + delete ----------

  const runTransition = async (page: AdminSitePage, action: 'publish' | 'unpublish') => {
    if (transitioning) return
    setTransitioning(true)
    const { data, error } = await api.post<{ page: AdminSitePage }>(
      `/api/pages/admin/${page.id}/transition`,
      { action }
    )
    setTransitioning(false)
    setConfirmAction(null)
    setConfirmTarget(null)
    if (error) {
      toast({ title: `Could not ${action} the page`, description: error.message, variant: 'destructive' })
      return
    }
    toast({
      title: action === 'publish' ? 'Page published' : 'Page unpublished',
      description:
        action === 'publish'
          ? `"${data!.page.title}" is live at ${pageUrl(page.slug)} — the working copy was snapshotted.`
          : `"${data!.page.title}" is withdrawn from the public surface. The snapshot is kept for the next publish.`,
    })
    await load()
  }

  const runDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    const { error } = await api.del(`/api/pages/admin/${deleteTarget.id}`)
    setDeleting(false)
    if (error) {
      toast({ title: 'Could not delete the page', description: error.message, variant: 'destructive' })
      return
    }
    toast({ title: 'Page deleted', description: `"${deleteTarget.title}" (${deleteTarget.slug}) was removed entirely.` })
    setDeleteTarget(null)
    await load()
  }

  // ---------- Table ----------

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return pages
    return pages.filter(
      (page) =>
        page.title.toLowerCase().includes(needle) ||
        page.slug.toLowerCase().includes(needle) ||
        pageUrl(page.slug).toLowerCase().includes(needle)
    )
  }, [pages, search])

  const columns: Array<ResourceColumn<AdminSitePage>> = [
    {
      key: 'title',
      header: 'Title',
      className: 'min-w-[220px]',
      render: (page) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-zinc-800">{page.title}</span>
            {hasLiveDrift(page) && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700"
                title="The working copy differs from the live snapshot — publish again to refresh it."
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                edited
              </span>
            )}
          </div>
          <span className="text-[11px] text-zinc-400">
            {page.status === 'PUBLISHED'
              ? `live since ${formatWhen(page.publishedAt)}`
              : `draft · by ${page.updatedBy?.email ?? 'system'}`}
          </span>
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      render: (page) => <code className="font-mono text-xs text-zinc-600">{page.slug}</code>,
    },
    {
      key: 'url',
      header: 'URL',
      render: (page) => (
        <span className="font-mono text-[11px] text-zinc-500">{pageUrl(page.slug)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (page) => <StatusBadge status={page.status} />,
    },
    {
      key: 'showInFooter',
      header: 'Footer',
      render: (page) => (
        <span className={page.showInFooter ? 'text-[13px] text-emerald-700' : 'text-zinc-300'} aria-hidden="true">
          {page.showInFooter ? '●' : '—'}
        </span>
      ),
    },
    { key: 'sortOrder', header: 'Order', className: 'w-16 text-center' },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (page) => (
        <span className="text-[12px] text-zinc-500" title={page.updatedBy?.email ?? undefined}>
          {formatWhen(page.updatedAt)}
        </span>
      ),
    },
  ]

  const confirmCopy =
    confirmAction === 'publish'
      ? {
          title: 'Publish this page?',
          body:
            'Publishing snapshots the current working copy (title + body) into the live fields and serves it to every visitor at ' +
            (confirmTarget ? pageUrl(confirmTarget.slug) : '') +
            '. You can keep editing afterwards — the snapshot stays live until you publish again.',
          cta: 'Publish',
        }
      : {
          title: 'Unpublish this page?',
          body: 'Unpublishing withdraws the page from the public surface immediately. Nothing is lost — the published snapshot is kept, so a later publish restores it without re-editing.',
          cta: 'Unpublish',
        }

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Pages"
        description="The managed static pages — About, Contact, Privacy Policy and anything the team creates. Edit the working copy, publish to snapshot it live, link it in the footer."
        icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New page
            </Button>
          </>
        }
      />

      {loadError && <ErrorNotice message={loadError} onRetry={() => void load()} />}

      <ResourceTable
        columns={columns}
        rows={filtered}
        rowKey={(page) => page.id}
        loading={loading}
        emptyTitle="No pages yet"
        emptyHint="Create the About, Contact and Privacy Policy pages first — reserved slugs render at the top level (/about), custom pages live under /p/."
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search title, slug or URL…',
        }}
        actions={(page) => (
          <>
            {page.status === 'PUBLISHED' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-1"
                title="View the live page"
                aria-label="View the live page"
                onClick={() => navigateToPath(pageUrl(page.slug))}
              >
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-1"
              title="Edit the working copy"
              aria-label="Edit the working copy"
              onClick={() => openEdit(page)}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            {page.status === 'DRAFT' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-1 text-emerald-700 hover:bg-emerald-50"
                title="Publish — snapshot the working copy live"
                aria-label="Publish"
                disabled={transitioning || deleting}
                onClick={() => {
                  setConfirmTarget(page)
                  setConfirmAction('publish')
                }}
              >
                <Rocket className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-1 text-amber-700 hover:bg-amber-50"
                title="Unpublish — withdraw from the public surface"
                aria-label="Unpublish"
                disabled={transitioning || deleting}
                onClick={() => {
                  setConfirmTarget(page)
                  setConfirmAction('unpublish')
                }}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-1 text-red-600 hover:bg-red-50"
              title="Delete the page entirely"
              aria-label="Delete the page"
              onClick={() => setDeleteTarget(page)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </>
        )}
      />

      {/* ---------- Create / edit editor ---------- */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit page — ${editing.slug}` : 'Create a page'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `The slug is immutable (URL stability). ${pageUrl(editing.slug)} serves the published snapshot — this form edits the working copy.`
                : 'Reserved slugs (about, contact, privacy-policy, terms, disclaimer) render at /{slug}; every other kebab-case slug lives under /p/{slug}.'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Slug"
                htmlFor="page-slug"
                required
                error={fieldErrors.slug}
                hint={editing ? 'Immutable after creation — create a new page to change its URL.' : 'kebab-case, e.g. about or editorial-guidelines'}
              >
                {editing ? (
                  <TextInput id="page-slug" value={form.slug} onChange={() => undefined} disabled />
                ) : (
                  <TextInput
                    id="page-slug"
                    value={form.slug}
                    onChange={(value) => setForm((state) => ({ ...state, slug: value.toLowerCase() }))}
                    placeholder="about"
                    invalid={Boolean(fieldErrors.slug)}
                  />
                )}
              </Field>
              <Field label="Title" htmlFor="page-title" required error={fieldErrors.title} hint="Shown as the page heading and in the footer link.">
                <TextInput
                  id="page-title"
                  value={form.title}
                  onChange={(value) => setForm((state) => ({ ...state, title: value }))}
                  placeholder="About GKSetu"
                  invalid={Boolean(fieldErrors.title)}
                />
              </Field>
            </div>

            <Field
              label="Body — working copy"
              htmlFor="page-body"
              required
              error={fieldErrors.body}
              hint="Raw HTML is allowed. Publishing snapshots this into the live page; the public site only ever serves the snapshot."
            >
              <TextArea
                id="page-body"
                value={form.body}
                onChange={(value) => setForm((state) => ({ ...state, body: value }))}
                rows={10}
                mono
                placeholder="<p>Write the page…</p>"
                invalid={Boolean(fieldErrors.body)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SEO title" htmlFor="page-seo-title" error={fieldErrors.seoTitle} hint="Overrides the <title> tag; ≤120 chars.">
                <TextInput
                  id="page-seo-title"
                  value={form.seoTitle}
                  onChange={(value) => setForm((state) => ({ ...state, seoTitle: value }))}
                  placeholder="About GKSetu — one GK platform"
                  invalid={Boolean(fieldErrors.seoTitle)}
                />
              </Field>
              <Field label="SEO description" htmlFor="page-seo-desc" error={fieldErrors.seoDescription} hint="The meta description; ≤320 chars.">
                <TextInput
                  id="page-seo-desc"
                  value={form.seoDescription}
                  onChange={(value) => setForm((state) => ({ ...state, seoDescription: value }))}
                  placeholder="What GKSetu is and who it is for."
                  invalid={Boolean(fieldErrors.seoDescription)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Footer order" htmlFor="page-order" error={fieldErrors.sortOrder} hint="Lower numbers appear earlier in the footer link list.">
                <TextInput
                  id="page-order"
                  type="number"
                  value={form.sortOrder}
                  onChange={(value) => setForm((state) => ({ ...state, sortOrder: value }))}
                  invalid={Boolean(fieldErrors.sortOrder)}
                />
              </Field>
              <div className="self-end">
                <SwitchField
                  label="Show in site footer"
                  checked={form.showInFooter}
                  onChange={(checked) => setForm((state) => ({ ...state, showInFooter: checked }))}
                  hint="Footer links come from the published list (Company column)."
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitEditor()}
              disabled={saving || form.title.trim() === '' || (!editing && form.slug.trim() === '')}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {editing ? 'Save working copy' : 'Create draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Publish / unpublish confirm ---------- */}
      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && (setConfirmAction(null), setConfirmTarget(null))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{confirmCopy.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p className="text-[13px] leading-relaxed">{confirmCopy.body}</p>
                {confirmTarget && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <StatusBadge status={confirmTarget.status} />
                    <code className="font-mono text-xs text-zinc-600">{confirmTarget.slug}</code>
                    <span className="font-mono text-[11px] text-zinc-400">{pageUrl(confirmTarget.slug)}</span>
                    {hasLiveDrift(confirmTarget) && confirmAction === 'unpublish' && (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[11px] text-amber-700">
                        edited copy differs from live
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => (setConfirmAction(null), setConfirmTarget(null))}>
              Cancel
            </Button>
            <Button
              size="sm"
              className={
                confirmAction === 'publish'
                  ? 'h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'h-8 gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
              }
              disabled={transitioning}
              onClick={() => confirmTarget && confirmAction && void runTransition(confirmTarget, confirmAction)}
            >
              {transitioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="h-3.5 w-3.5" aria-hidden="true" />}
              {confirmCopy.cta}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Delete confirm ---------- */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The page is removed entirely — working copy and published snapshot. URLs that pointed at{' '}
              <code className="font-mono text-xs">{deleteTarget ? pageUrl(deleteTarget.slug) : ''}</code> will 404. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              Delete page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
