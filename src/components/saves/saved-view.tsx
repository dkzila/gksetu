'use client'

/**
 * GKSetu — the Saved view (P5-S2, #/saved)
 * Master Plan §10 (Save = retrieval into user-defined collections; default
 * "Saved"; tombstones for withdrawn content), §31 (the account-control
 * surface over saved data — review, move, remove, organise), §16 (private
 * authenticated surface: noindex, never in the sitemap).
 *
 * The symmetric management surface to #/following (the P5-S1 precedent):
 * collections with live counts, saved items with honest §36 states, one-click
 * move/remove, and the §10 boundary footnote (saves are bookmarks — they
 * never feed recommendations; follows are the personalisation half).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bookmark,
  BookmarkX,
  CalendarClock,
  Check,
  FolderInput,
  FolderPlus,
  Link2,
  Loader2,
  LogIn,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
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
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * §10/§36 honesty: withdrawn/end-of-life objects stay listed as tombstones —
 * the collection never silently corrupts or loses rows without explanation.
 */
const TOMBSTONE_NOTES: Record<string, { label: string; className: string }> = {
  RETIRED: { label: 'Withdrawn — kept as a record', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  ARCHIVED: { label: 'Archived — kept for reference', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  OUTDATED: { label: 'Flagged for correction', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
  DRAFT: { label: 'Not public anymore', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
  IN_REVIEW: { label: 'Not public anymore', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
  SCHEDULED: { label: 'Scheduled — not live yet', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
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
      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bookmark className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Your collections live behind sign-in
          </CardTitle>
          <CardDescription>
            Saving keeps any knowledge page or published content in your personal
            collections — the default “Saved”, or one of your own. Saves are just
            bookmarks: they never feed recommendations.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Sign in to see your collections
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 text-zinc-500" onClick={onGoHome}>
            Browse GKSetu instead
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
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
      // canonicalPath is the server-built §16 URL, mirrored after the hash.
      window.location.hash = `#${save.object.canonicalPath}`
    } else {
      // The item's own language market — the summary resolved it (§35).
      // P7-S1: saved Q&A rows reopen the unit's §22 page (the Practice —
      // Q&A layer the entry lives in), in the entry's own language.
      // P7-S2: saved QUESTION rows do the same — their retrieval surface is
      // the unit's scored "Practice — Test yourself" layer.
      onOpenSavedUnit(save.object.topicSlug, save.object.unit.slug, save.object.languageCode)
    }
  }

  return (
    <div className="space-y-8">
      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="saved-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Collections</Badge>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            Personal bookmarks — never used for recommendations
          </Badge>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="saved-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Saved
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              Your bookmarks across GKSetu — knowledge pages and published content,
              organised into collections. Saved rows keep pointing at the same content, so
              updates never create duplicates.
            </p>
          </div>
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
        {data && (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <Bookmark className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold">{data.counts.total}</strong>
              <span className="text-zinc-500">saved</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <strong className="font-semibold">{data.counts.KNOWLEDGE_UNIT}</strong>
              <span className="text-zinc-500">knowledge pages</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <strong className="font-semibold">{data.counts.CONTENT_ITEM}</strong>
              <span className="text-zinc-500">content items</span>
            </span>
            {data.counts.CURRENT_EVENT > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                <strong className="font-semibold">{data.counts.CURRENT_EVENT}</strong>
                <span className="text-zinc-500">current events</span>
              </span>
            )}
            {data.counts.QNA > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                <strong className="font-semibold">{data.counts.QNA}</strong>
                <span className="text-zinc-500">Q&amp;A</span>
              </span>
            )}
            {data.counts.QUESTION > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                <strong className="font-semibold">{data.counts.QUESTION}</strong>
                <span className="text-zinc-500">
                  {data.counts.QUESTION === 1 ? 'question' : 'questions'}
                </span>
              </span>
            )}
            {data.counts.MOCK_TEST > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                <strong className="font-semibold">{data.counts.MOCK_TEST}</strong>
                <span className="text-zinc-500">
                  {data.counts.MOCK_TEST === 1 ? 'test' : 'tests'}
                </span>
              </span>
            )}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="collections-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <FolderPlus className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Collections
              </h2>
              {/* New collection inline form */}
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="new-collection" className="sr-only">
                  New collection name
                </label>
                <Input
                  id="new-collection"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="e.g. Revision, Important Polity"
                  className="h-9 w-56 border-zinc-200 bg-white text-sm"
                  maxLength={60}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createCollection()
                  }}
                />
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void createCollection()}
                  disabled={creating || newName.trim().length === 0}
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  New collection
                </Button>
              </div>
            </div>

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
            <Card className="border-zinc-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookmarkX className="h-5 w-5 text-zinc-400" aria-hidden="true" />
                  Nothing saved yet
                </CardTitle>
                <CardDescription>
                  Open any knowledge page and press “Save” — the page joins your default
                  “Saved” collection, and you can organise it into custom collections here.
                  Saves are just bookmarks: they never influence recommendations.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onGoHome}>
                  Browse knowledge
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          ) : items.length === 0 ? (
            <Card className="border-zinc-200 bg-white">
              <CardHeader>
                <CardTitle className="text-base">This collection is empty</CardTitle>
                <CardDescription>
                  Move saved items into “{activeCollectionRow?.name ?? 'this collection'}” with the
                  move control on each card below — or save something new from any knowledge page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" variant="outline" className="gap-2 border-zinc-200" onClick={() => setActiveCollection(null)}>
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
              <ul className="space-y-3">
                {items.map((save) => {
                  const object = save.object
                  const isUnit = object.kind === 'KNOWLEDGE_UNIT'
                  const isEvent = object.kind === 'CURRENT_EVENT'
                  const isQna = object.kind === 'QNA'
                  const isQuestion = object.kind === 'QUESTION'
                  const isMockTest = object.kind === 'MOCK_TEST'
                  const title = isUnit
                    ? object.canonicalName
                    : isQna || isQuestion
                      ? object.question
                      : object.title
                  const statusNote = TOMBSTONE_NOTES[isUnit ? object.status : isEvent ? object.lifecycleState : object.status]
                  const collection = collectionById.get(save.collectionId)
                  return (
                    <li key={save.id}>
                      <Card className="border-zinc-200 bg-white shadow-sm transition-colors hover:border-emerald-300">
                        <CardContent className="flex flex-wrap items-center gap-3 p-4">
                          {/* basis-52: at narrow widths the actions wrap to their
                              own line instead of squeezing the title (the
                              truncate span needs a width-constrained block
                              button — inline-block shrinks to the full
                              single-line text width). */}
                          <div className="min-w-0 flex-1 basis-52 sm:basis-64">
                            <button type="button" onClick={() => openItem(save)} className="block w-full min-h-[32px] text-left">
                              <span className="block truncate font-semibold text-zinc-900 hover:text-emerald-700">
                                {title}
                              </span>
                            </button>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                              <Badge
                                variant="outline"
                                className={`font-mono text-[10px] font-normal ${
                                  isUnit
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : isEvent
                                      ? 'border-orange-200 bg-orange-50 text-orange-700'
                                      : isQna
                                        ? 'border-violet-200 bg-violet-50 text-violet-700'
                                        : isQuestion
                                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                                          : isMockTest
                                            ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                            : 'border-teal-200 bg-teal-50 text-teal-700'
                                }`}
                              >
                                {isUnit
                                  ? 'UNIT'
                                  : isEvent
                                    ? 'EVENT'
                                    : isQna
                                      ? 'Q&A'
                                      : isQuestion
                                        ? 'MCQ'
                                        : isMockTest
                                          ? 'MOCK TEST'
                                          : object.format}
                              </Badge>
                              {isQuestion && (
                                <Badge
                                  variant="outline"
                                  className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500"
                                  title="The difficulty from the revision you saved"
                                >
                                  {object.difficulty}
                                </Badge>
                              )}
                              {!isUnit && !isMockTest && <span>{object.languageCode}</span>}
                              {!isUnit && !isMockTest && <span aria-hidden="true">·</span>}
                              {isMockTest ? (
                                <>
                                  <span>
                                    {object.questionCount} question{object.questionCount === 1 ? '' : 's'} ·{' '}
                                    {object.durationMinutes} min · pass {object.passPercent}%
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>{object.scopeLabel}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{object.languageCode}</span>
                                </>
                              ) : (
                                <>
                                  <span>{object.topicCanonicalName}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    {isUnit
                                      ? object.type.toLowerCase().replace('_', ' ')
                                      : isEvent
                                        ? `event of ${new Date(object.eventDate).toLocaleDateString(undefined, {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                          })}`
                                        : object.unit.canonicalName}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                              <CalendarClock className="h-3 w-3" aria-hidden="true" />
                              <span>saved {formatSavedAt(save.savedAt)}</span>
                              {collection && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <Bookmark className="h-3 w-3" aria-hidden="true" />
                                    {collection.name}
                                  </span>
                                </>
                              )}
                            </div>
                            {statusNote && (
                              <Badge variant="outline" className={`mt-2 text-[10px] font-normal ${statusNote.className}`}>
                                {statusNote.label}
                              </Badge>
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

          {/* ---------- Footer note (§10 boundary) ---------- */}
          {data.counts.total > 0 && (
            <p className="flex items-start gap-2 text-xs text-zinc-400">
              <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Saves are retrieval bookmarks — they never feed your feed, notifications or
              recommendations. Following exams/topics (the personalisation half) lives at #/following.
            </p>
          )}
        </>
      )}
    </div>
  )
}
