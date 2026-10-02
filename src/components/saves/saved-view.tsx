'use client'

import { navigateToPath } from '@/components/home/app-router'

/**
 * GKSetu — the Saved view (P5-S2, /saved; SITE-S4-A redesign)
 * Master Plan §10 (Save = retrieval into user-defined collections; default
 * "Saved"; tombstones for withdrawn content), §31 (the account-control
 * surface over saved data — review, move, remove, organise), §16 (private
 * authenticated surface: noindex, never in the sitemap).
 *
 * SITE-S4-A: one compact redesign — a single header (title + inline count +
 * New collection / Refresh actions), the collection tab row, and clean item
 * rows: plain-words type + icon, title, snippet, "Saved {date}", compact
 * move/remove controls. No mono kind badges, difficulty chips, raw language
 * codes or status badges — only honest plain-language tombstones.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  BookmarkX,
  CalendarClock,
  Check,
  CircleHelp,
  FileText,
  FolderInput,
  Link2,
  ListChecks,
  Loader2,
  LogIn,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Timer,
  Trash2,
  X,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import { CollectionShareControl } from './collection-share-control'
import type { ApiCollection, ApiSave, ApiSaveList, SaveEnvelope } from './types'

// ---------- Props ----------

export interface SavedViewProps {
  /** Opens the knowledge page in the summary's market (§16 grammar in-app). */
  onOpenSavedUnit: (topicSlug: string, unitSlug: string, language: string | null) => void
  /** P6-S3: opens the saved event's §16 page (/current-affairs/{slug}/). */
  onOpenEvent: (eventSlug: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- Helpers ----------

function formatSavedAt(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * §10/§36 honesty: withdrawn/end-of-life objects stay listed as tombstones —
 * plain words, never raw status codes.
 */
const TOMBSTONE_NOTES: Record<string, string> = {
  RETIRED: 'No longer available — kept for your history',
  ARCHIVED: 'Archived — kept for reference',
  OUTDATED: 'Being corrected — details may change',
  DRAFT: 'Not available right now',
  IN_REVIEW: 'Not available right now',
  SCHEDULED: 'Not published yet',
}

/** The plain-words type + icon for each saved object (no mono badges). */
function saveTypeMeta(save: ApiSave): { icon: typeof BookOpen; label: string } {
  switch (save.object.kind) {
    case 'CURRENT_EVENT':
      return { icon: Newspaper, label: 'Current affairs' }
    case 'QNA':
      return { icon: CircleHelp, label: 'Q&A' }
    case 'QUESTION':
      return { icon: ListChecks, label: 'MCQ' }
    case 'MOCK_TEST':
      return { icon: Timer, label: 'Mock test' }
    case 'CONTENT_ITEM':
      return { icon: FileText, label: 'Article' }
    default:
      return { icon: BookOpen, label: 'Notes' }
  }
}

// ---------- Component ----------

export function SavedView({ onOpenSavedUnit, onOpenEvent, onGoHome, onSignIn }: SavedViewProps) {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiSaveList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeCollection, setActiveCollection] = useState<string | null>(null) // null = All
  const [busyId, setBusyId] = useState<string | null>(null)

  // Collection create / rename inline forms.
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Saved | GKSetu',
    description: 'Your saved knowledge and content, organised into collections — your personal GKSetu bookmarks.',
    noindex: true,
  })

  const fetchList = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/saves', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as SaveEnvelope<ApiSaveList>
      if (payload.status === 'ok' && payload.data) {
        setData(payload.data)
      } else {
        setError(payload.error?.message ?? 'Could not load your saved items')
      }
    } catch {
      setError('Could not reach the save service')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  const collectionById = useMemo(
    () => new Map((data?.collections ?? []).map((entry) => [entry.id, entry])),
    [data]
  )
  const activeCollectionRow = activeCollection ? collectionById.get(activeCollection) ?? null : null

  // The collection filter is applied client-side over the full list — the
  // counts stay coherent with the whole save set, exactly like the API's.
  const items = useMemo(
    () => (data?.items ?? []).filter((item) => !activeCollection || item.collectionId === activeCollection),
    [data, activeCollection]
  )

  // ---------- Mutations ----------

  const removeSave = useCallback(
    async (save: ApiSave) => {
      if (!token || busyId) return
      setBusyId(save.id)
      try {
        const response = await fetch(`/api/saves/${encodeURIComponent(save.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as SaveEnvelope<{ removed: boolean }>
        if (payload.status === 'ok') {
          const name =
            save.object.kind === 'KNOWLEDGE_UNIT'
              ? save.object.canonicalName
              : save.object.kind === 'QNA' || save.object.kind === 'QUESTION'
                ? save.object.question
                : save.object.title
          toast({ title: `Removed “${name}”`, description: 'Removed from your collections — you can re-save it anytime.' })
          await fetchList()
        } else {
          toast({
            title: 'Could not remove',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach the save service.', variant: 'destructive' })
      } finally {
        setBusyId(null)
      }
    },
    [token, busyId, toast, fetchList]
  )

  const moveSave = useCallback(
    async (save: ApiSave, collectionId: string) => {
      if (!token || busyId || collectionId === save.collectionId) return
      setBusyId(save.id)
      try {
        const response = await fetch(`/api/saves/${encodeURIComponent(save.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ collectionId }),
        })
        const payload = (await response.json()) as SaveEnvelope<{ save: ApiSave }>
        if (payload.status === 'ok') {
          const target = collectionById.get(collectionId)
          toast({ title: `Moved to “${target?.name ?? 'collection'}”`, description: 'Re-organising moves the item — it is never duplicated.' })
          await fetchList()
        } else {
          toast({
            title: 'Could not move',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach the save service.', variant: 'destructive' })
      } finally {
        setBusyId(null)
      }
    },
    [token, busyId, toast, fetchList, collectionById]
  )

  const createCollection = useCallback(async () => {
    const name = newName.trim()
    if (!token || !name || creating) return
    setCreating(true)
    try {
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      })
      const payload = (await response.json()) as SaveEnvelope<{ collection: ApiCollection }>
      if (payload.status === 'ok' && payload.data) {
        toast({ title: `Collection “${name}” created`, description: 'Move saved items into it below.' })
        setNewName('')
        setShowNewForm(false)
        await fetchList()
        setActiveCollection(payload.data.collection.id)
      } else {
        toast({
          title: 'Could not create the collection',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the save service.', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }, [token, newName, creating, toast, fetchList])

  const renameActiveCollection = useCallback(async () => {
    const name = renameValue.trim()
    if (!token || !activeCollectionRow || !name || busyId === activeCollectionRow.id) return
    setBusyId(activeCollectionRow.id)
    try {
      const response = await fetch(`/api/collections/${encodeURIComponent(activeCollectionRow.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      })
      const payload = (await response.json()) as SaveEnvelope<{ collection: ApiCollection }>
      if (payload.status === 'ok') {
        toast({ title: `Renamed to “${name}”` })
        setRenameValue('')
        setRenaming(null) // close the inline form on success
        await fetchList()
      } else {
        toast({
          title: 'Could not rename',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the save service.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }, [token, activeCollectionRow, busyId, renameValue, toast, fetchList])

  const deleteActiveCollection = useCallback(async () => {
    if (!token || !activeCollectionRow || busyId) return
    setBusyId(activeCollectionRow.id)
    try {
      const response = await fetch(`/api/collections/${encodeURIComponent(activeCollectionRow.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as SaveEnvelope<{ removed: boolean; movedItems: number; name: string }>
      if (payload.status === 'ok' && payload.data) {
        toast({
          title: `Collection “${payload.data.name}” deleted`,
          description:
            payload.data.movedItems > 0
              ? `${payload.data.movedItems} saved ${payload.data.movedItems === 1 ? 'item' : 'items'} moved back to “Saved” — saves are never destroyed.`
              : 'It was empty. Your saves are untouched.',
        })
        setActiveCollection(null)
        setConfirmDelete(false)
        await fetchList()
      } else {
        toast({
          title: 'Could not delete',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the save service.', variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }, [token, activeCollectionRow, busyId, toast, fetchList])

  // ---------- Signed-out state (§38: one auth surface) ----------

  if (status !== 'authenticated' || !user) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="saved-heading"
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 bg-white shadow-sm">
          <CardHeader className="text-center">
            <span
              className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <Bookmark className="h-5 w-5 text-emerald-600" />
            </span>
            <CardTitle id="saved-heading" className="text-xl">
              Your saved items
            </CardTitle>
            <CardDescription>
              Keep any knowledge page, story, Q&A or mock test in your personal collections.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in to see your saves
            </Button>
            <Button variant="ghost" size="sm" className="text-zinc-500" onClick={onGoHome}>
              Browse GKSetu instead
            </Button>
          </CardContent>
        </Card>
      </motion.section>
    )
  }

  const openItem = (save: ApiSave) => {
    if (save.object.kind === 'KNOWLEDGE_UNIT') {
      onOpenSavedUnit(save.object.topicSlug, save.object.slug, null)
    } else if (save.object.kind === 'CURRENT_EVENT') {
      // P6-S3 §10/§16 — the event's own page is the retrieval surface.
      onOpenEvent(save.object.slug)
    } else if (save.object.kind === 'MOCK_TEST') {
      // P7-S3 §10/§16 — the test's own runner page is the retrieval surface;
      // canonicalPath is the server-built §16 URL.
      navigateToPath(save.object.canonicalPath)
    } else {
      // The item's own language market — the summary resolved it (§35).
      // P7-S1/P7-S2: saved Q&A and MCQ rows reopen the unit's §22 page in
      // the entry's own language.
      onOpenSavedUnit(save.object.topicSlug, save.object.unit.slug, save.object.languageCode)
    }
  }

  return (
    <div className="space-y-8">
      {/* ---------- Header — title + inline count + actions ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="saved-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="saved-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Saved
              {data && data.counts.total > 0 && (
                <span className="ml-2 align-middle text-base font-normal text-zinc-400">
                  ({data.counts.total} {data.counts.total === 1 ? 'item' : 'items'})
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Your bookmarks across GKSetu, organised into collections.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => setShowNewForm((open) => !open)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New collection
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
              onClick={() => void fetchList()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>

        {/* New collection inline form */}
        {showNewForm && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3">
            <label htmlFor="new-collection" className="sr-only">
              New collection name
            </label>
            <Input
              id="new-collection"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="e.g. Revision, Important Polity"
              className="h-9 w-full sm:w-64 border-zinc-200 text-sm"
              maxLength={60}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createCollection()
                if (event.key === 'Escape') {
                  setNewName('')
                  setShowNewForm(false)
                }
              }}
            />
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void createCollection()}
              disabled={creating || newName.trim().length === 0}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-zinc-500"
              onClick={() => {
                setNewName('')
                setShowNewForm(false)
              }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </Button>
          </div>
        )}
      </motion.section>

      {/* ---------- Loading ---------- */}
      {loading && !data && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading your saved items">
          <Skeleton className="h-10 w-full max-w-xl rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      )}

      {/* ---------- Error ---------- */}
      {error && (
        <Card className="border-red-200 bg-red-50/60">
          <CardHeader>
            <CardTitle className="text-base text-red-800">Could not load your saved items</CardTitle>
            <CardDescription className="text-red-700">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
              onClick={() => void fetchList()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* ---------- Collections bar (§10) ---------- */}
          <section aria-labelledby="collections-heading" className="space-y-3">
            <h2 id="collections-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              Collections
            </h2>

            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter by collection">
              <button
                type="button"
                role="tab"
                aria-selected={activeCollection === null}
                onClick={() => setActiveCollection(null)}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                  activeCollection === null
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300 hover:text-emerald-700'
                }`}
              >
                All
                <span className={`text-xs ${activeCollection === null ? 'text-emerald-100' : 'text-zinc-400'}`}>
                  {data.counts.total}
                </span>
              </button>
              {data.collections.map((collection) => {
                const active = activeCollection === collection.id
                return (
                  <button
                    key={collection.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setActiveCollection(collection.id)
                      setConfirmDelete(false)
                      setRenameValue('')
                    }}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                      active
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300 hover:text-emerald-700'
                    }`}
                  >
                    {collection.isDefault && <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />}
                    {collection.name}
                    <span className={`text-xs ${active ? 'text-emerald-100' : 'text-zinc-400'}`}>
                      {collection.itemCount}
                    </span>
                    {/* P8-S1 §21: the shareable state is visible at a glance. */}
                    {collection.visibility === 'LINK' && (
                      <Link2
                        className={`h-3 w-3 ${active ? 'text-emerald-100' : 'text-emerald-600'}`}
                        aria-label="Shared via link"
                      />
                    )}
                  </button>
                )
              })}
            </div>

            {/* P8-S1 §21: the collection share opt-in/revoke — available for
                ANY collection incl. the default (the owner's explicit choice,
                §10/§21); rename/delete below stay custom-only. */}
            {activeCollectionRow && (
              <CollectionShareControl collection={activeCollectionRow} onUpdated={() => void fetchList()} />
            )}

            {/* Custom-collection management (rename/delete — the default is immutable, §10) */}
            {activeCollectionRow && !activeCollectionRow.isDefault && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3">
                <p className="mr-auto text-sm text-zinc-600">
                  Managing <strong className="text-zinc-900">“{activeCollectionRow.name}”</strong> ·{' '}
                  {activeCollectionRow.itemCount} saved {activeCollectionRow.itemCount === 1 ? 'item' : 'items'}
                </p>
                {renaming === activeCollectionRow.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <label htmlFor="rename-collection" className="sr-only">
                      Rename collection
                    </label>
                    <Input
                      id="rename-collection"
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      className="h-9 w-48 border-zinc-200 text-sm"
                      maxLength={60}
                      disabled={busyId === activeCollectionRow.id}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void renameActiveCollection()
                      }}
                    />
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => void renameActiveCollection()}
                      disabled={busyId === activeCollectionRow.id}
                    >
                      {busyId === activeCollectionRow.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      )}
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-zinc-500"
                      onClick={() => {
                        setRenameValue('')
                        setRenaming(null)
                      }}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
                    onClick={() => {
                      setRenameValue(activeCollectionRow.name)
                      setRenaming(activeCollectionRow.id)
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Rename
                  </Button>
                )}
                {confirmDelete ? (
                  <span className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                      onClick={() => void deleteActiveCollection()}
                      disabled={busyId === activeCollectionRow.id}
                    >
                      {busyId === activeCollectionRow.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      Confirm delete
                    </Button>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-zinc-500" onClick={() => setConfirmDelete(false)}>
                      <X className="h-4 w-4" aria-hidden="true" />
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </Button>
                )}
              </div>
            )}
          </section>

          {/* ---------- Empty states ---------- */}
          {data.counts.total === 0 ? (
            <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
              <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <BookmarkX className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Nothing saved yet</p>
                    <p className="mt-0.5 max-w-xl text-sm text-zinc-600">
                      Tap Save on any knowledge page, story, Q&A or mock test — it lands in your
                      default “Saved” collection, and you can organise it into collections here.
                    </p>
                  </div>
                </div>
                <Button size="sm" className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onGoHome}>
                  Browse knowledge
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          ) : items.length === 0 ? (
            <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
              <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-zinc-600">
                  Nothing in “{activeCollectionRow?.name ?? 'this collection'}” yet — move saved
                  items here with the collection control on each row below.
                </p>
                <Button size="sm" variant="outline" className="shrink-0 gap-2 border-zinc-200 bg-white" onClick={() => setActiveCollection(null)}>
                  See all saved items
                </Button>
              </CardContent>
            </Card>
          ) : (
            <section aria-labelledby="saved-items-heading" className="space-y-3">
              <h2 id="saved-items-heading" className="text-lg font-semibold tracking-tight">
                {activeCollectionRow ? `In “${activeCollectionRow.name}”` : 'All saved items'}
                <span className="ml-2 text-sm font-normal text-zinc-400">({items.length})</span>
              </h2>
              {/* >8 rows: a capped, slim-scrollbar list keeps the page compact */}
              <ul
                className={
                  items.length > 8
                    ? 'gksetu-scroll max-h-[640px] space-y-3 overflow-y-auto pr-1'
                    : 'space-y-3'
                }
              >
                {items.map((save) => {
                  const object = save.object
                  const type = saveTypeMeta(save)
                  const TypeIcon = type.icon
                  const title =
                    object.kind === 'KNOWLEDGE_UNIT'
                      ? object.canonicalName
                      : object.kind === 'QNA' || object.kind === 'QUESTION'
                        ? object.question
                        : object.title
                  const tombstone =
                    TOMBSTONE_NOTES[
                      object.kind === 'CURRENT_EVENT' ? object.lifecycleState : object.status
                    ] ?? null
                  const collection = collectionById.get(save.collectionId)
                  // Context after the type word — plain, one line.
                  let context: string
                  if (object.kind === 'CURRENT_EVENT') {
                    context = `${object.topicCanonicalName} · ${new Date(object.eventDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                  } else if (object.kind === 'QNA' || object.kind === 'QUESTION') {
                    context = `${object.topicCanonicalName} · from ${object.unit.canonicalName}`
                  } else if (object.kind === 'MOCK_TEST') {
                    context = `${object.scopeLabel} · ${object.questionCount} ${object.questionCount === 1 ? 'question' : 'questions'} · ${object.durationMinutes} min`
                  } else {
                    // KNOWLEDGE_UNIT and CONTENT_ITEM both carry the topic name.
                    context = object.topicCanonicalName
                  }
                  const snippet =
                    object.kind === 'QNA'
                      ? object.answerExcerpt
                      : object.kind === 'KNOWLEDGE_UNIT'
                        ? object.canonicalSummary
                        : null
                  return (
                    <li key={save.id}>
                      <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                        <CardContent className="flex flex-wrap items-start gap-3 p-4">
                          <span
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-500"
                            aria-hidden="true"
                          >
                            <TypeIcon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1 basis-52 sm:basis-64">
                            <button type="button" onClick={() => openItem(save)} className="flex w-full min-h-[44px] items-center text-left">
                              <span className="min-w-0 truncate font-semibold leading-snug text-zinc-900 hover:text-emerald-700">
                                {title}
                              </span>
                            </button>
                            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                              <span className="font-medium text-zinc-600">{type.label}</span>
                              <span aria-hidden="true">·</span>
                              <span>{context}</span>
                            </p>
                            {snippet && (
                              <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{snippet}</p>
                            )}
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                              <CalendarClock className="h-3 w-3" aria-hidden="true" />
                              <span>Saved {formatSavedAt(save.savedAt)}</span>
                              {collection && activeCollection === null && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <Bookmark className="h-3 w-3" aria-hidden="true" />
                                    {collection.name}
                                  </span>
                                </>
                              )}
                            </p>
                            {tombstone && (
                              <p className="mt-1.5 text-xs text-amber-700">{tombstone}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {(data.collections.length > 1) && (
                              <span className="inline-flex items-center gap-1.5">
                                <FolderInput className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                                <span className="sr-only">Move to another collection</span>
                                <Select
                                  value={save.collectionId}
                                  onValueChange={(value) => void moveSave(save, value)}
                                  disabled={busyId === save.id}
                                >
                                  <SelectTrigger
                                    className="h-9 w-[150px] border-zinc-200 bg-white text-xs font-medium"
                                    aria-label={`Move “${title}” to another collection`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {data.collections.map((entry) => (
                                      <SelectItem key={entry.id} value={entry.id} className="text-xs">
                                        {entry.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </span>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                              disabled={busyId === save.id}
                              onClick={() => void removeSave(save)}
                              aria-label={`Remove ${title}`}
                            >
                              {busyId === save.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              )}
                              Remove
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
