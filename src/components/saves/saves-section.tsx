'use client'

/**
 * GlobIQ — Saves section (P5-S2)
 *
 * The console's verification surface for the save half of the Follow & Save
 * module: documents the /api/saves + /api/collections contracts (§37 — the
 * same endpoints a mobile app calls, §39), then exercises them live for the
 * signed-in user — save (unit + representation), unsave, move between
 * collections, collection create/rename/delete, and the truthful state
 * endpoint. Saves are retrieval (§10) — deliberately separate from follows.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bookmark,
  BookmarkCheck,
  BookOpen,
  FolderInput,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import type { ApiSaveList, ApiSaveState, SaveEnvelope } from './types'

/** The seeded demo objects the toggles exercise. */
const DEMO_UNIT_REF = 'chandrayaan-3-landing-2023'
const DEMO_UNIT_NAME = 'Chandrayaan-3 Landing (2023)'
/** The representation id is resolved live from the public page API — content
 * items are identified by their published representation id (§7 identity). */
const DEMO_ITEM_PAGE = 'chandrayaan-3-landing-2023'
const DEMO_ITEM_NAME = 'Chandrayaan-3 — a published representation'

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/saves?type=&collection=&country=&language=', note: 'My saves — resolved summaries + §16 paths + collections' },
  { method: 'POST', path: '/api/saves', note: 'Save { objectType, objectRef, collectionId? } — idempotent (§37)' },
  { method: 'DELETE', path: '/api/saves/{id}', note: 'Unsave — scoped to the caller, audited' },
  { method: 'PATCH', path: '/api/saves/{id}', note: 'Move between collections — a move, never a copy (§10)' },
  { method: 'GET', path: '/api/saves/state?objectType=&objectRef=', note: 'Single-object button state (truthful, §36)' },
  { method: 'POST', path: '/api/collections', note: 'Create a collection { name } — default "Saved" bootstraps on first save' },
  { method: 'PATCH', path: '/api/collections/{id}', note: 'Rename a custom collection (the default is fixed, §10)' },
  { method: 'DELETE', path: '/api/collections/{id}', note: 'Delete a custom collection — items fall back to "Saved" (§31)' },
]

interface PagePayload {
  representations: { id: string; format: string; title: string }[]
}

export function SavesSection() {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiSaveList | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [demoUnitState, setDemoUnitState] = useState<ApiSaveState | null>(null)
  const [demoItemRef, setDemoItemRef] = useState<string | null>(null)
  const [demoItemState, setDemoItemState] = useState<ApiSaveState | null>(null)

  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const fetchList = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/saves', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as SaveEnvelope<ApiSaveList>
      if (payload.status === 'ok' && payload.data) setData(payload.data)
      else toast({ title: 'Could not load saves', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/saves.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  const checkState = useCallback(
    async (objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM', objectRef: string) => {
      const params = new URLSearchParams({ objectType, objectRef })
      const response = await fetch(`/api/saves/state?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as SaveEnvelope<ApiSaveState>
      return payload.status === 'ok' && payload.data ? payload.data : null
    },
    [token]
  )

  const refreshDemoStates = useCallback(async () => {
    if (!token) {
      setDemoUnitState(null)
      setDemoItemState(null)
      return
    }
    // Resolve the representation id live from the public page API.
    let itemRef: string | null = demoItemRef
    if (!itemRef) {
      try {
        const response = await fetch(`/api/knowledge/page/${DEMO_ITEM_PAGE}?country=IN&language=en`, { cache: 'no-store' })
        const payload = (await response.json()) as SaveEnvelope<PagePayload>
        const page = (payload.data as unknown as { page?: PagePayload } | undefined)?.page
        itemRef = page?.representations?.[0]?.id ?? null
        setDemoItemRef(itemRef)
      } catch {
        itemRef = null
      }
    }
    const [unitState, itemState] = await Promise.all([
      checkState('KNOWLEDGE_UNIT', DEMO_UNIT_REF),
      itemRef ? checkState('CONTENT_ITEM', itemRef) : Promise.resolve(null),
    ])
    setDemoUnitState(unitState)
    setDemoItemState(itemState)
  }, [token, demoItemRef, checkState])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  useEffect(() => {
    void refreshDemoStates()
  }, [refreshDemoStates])

  const saveDemo = useCallback(
    async (objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM', objectRef: string, name: string) => {
      if (!token || busy) return
      setBusy(`save:${objectRef}`)
      try {
        const response = await fetch('/api/saves', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ objectType, objectRef }),
        })
        const payload = (await response.json()) as SaveEnvelope<{ alreadySaved: boolean }>
        if (payload.status === 'ok') {
          toast({
            title: payload.data?.alreadySaved ? `Already saved — “${name}”` : `Saved “${name}”`,
            description: payload.data?.alreadySaved
              ? 'Idempotent save (§37) — the second click is a success, not an error.'
              : 'Row written into the default “Saved” collection + audited (user.save.create). §10: retrieval only.',
          })
        } else {
          toast({ title: 'Save rejected', description: payload.error?.message ?? 'Please try again.', variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/saves.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
        void refreshDemoStates()
      }
    },
    [token, busy, toast, fetchList, refreshDemoStates]
  )

  const unsaveDemo = useCallback(
    async (state: ApiSaveState | null) => {
      if (!token || !state?.save?.id || busy) return
      setBusy(`unsave:${state.objectRef}`)
      try {
        const response = await fetch(`/api/saves/${encodeURIComponent(state.save.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as SaveEnvelope<{ removed: boolean }>
        if (payload.status === 'ok') {
          toast({ title: 'Unsaved', description: 'Row removed + audited (user.save.remove).' })
        } else {
          toast({ title: 'Could not unsave', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/saves.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
        void refreshDemoStates()
      }
    },
    [token, busy, toast, fetchList, refreshDemoStates]
  )

  const moveDemo = useCallback(
    async (collectionId: string) => {
      const saveId = demoUnitState?.save?.id
      if (!token || !saveId || busy) return
      setBusy(`move:${saveId}`)
      try {
        const response = await fetch(`/api/saves/${encodeURIComponent(saveId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ collectionId }),
        })
        const payload = (await response.json()) as SaveEnvelope<{ save: { collectionId: string } }>
        if (payload.status === 'ok') {
          toast({ title: 'Moved', description: 'PATCH /api/saves/{id} — audited (user.save.move).' })
        } else {
          toast({ title: 'Could not move', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/saves.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
        void refreshDemoStates()
      }
    },
    [token, demoUnitState, busy, toast, fetchList, refreshDemoStates]
  )

  const createDemoCollection = useCallback(async () => {
    const name = newName.trim()
    if (!token || !name || busy) return
    setBusy('collection:create')
    try {
      const response = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      })
      const payload = (await response.json()) as SaveEnvelope<{ collection: { name: string } }>
      if (payload.status === 'ok') {
        toast({ title: `Collection “${name}” created`, description: 'Audited (user.collection.create) — move items into it above.' })
        setNewName('')
      } else {
        toast({ title: 'Could not create', description: payload.error?.message, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/collections.', variant: 'destructive' })
    } finally {
      setBusy(null)
      void fetchList()
    }
  }, [token, newName, busy, toast, fetchList])

  const renameDemoCollection = useCallback(
    async (collectionId: string) => {
      const name = renameValue.trim()
      if (!token || !name || busy) return
      setBusy(`collection:rename:${collectionId}`)
      try {
        const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name }),
        })
        const payload = (await response.json()) as SaveEnvelope<{ collection: { name: string } }>
        if (payload.status === 'ok') {
          toast({ title: `Renamed to “${name}”`, description: 'Audited (user.collection.update).' })
          setRenameValue('')
          setRenamingId(null)
        } else {
          toast({ title: 'Could not rename', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/collections.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
      }
    },
    [token, renameValue, busy, toast, fetchList]
  )

  const deleteDemoCollection = useCallback(
    async (collectionId: string, name: string) => {
      if (!token || busy) return
      setBusy(`collection:delete:${collectionId}`)
      try {
        const response = await fetch(`/api/collections/${encodeURIComponent(collectionId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as SaveEnvelope<{ removed: boolean; movedItems: number }>
        if (payload.status === 'ok') {
          toast({
            title: `Deleted “${name}”`,
            description:
              payload.data && payload.data.movedItems > 0
                ? `${payload.data.movedItems} item(s) moved back to “Saved” — saves are never destroyed (§31).`
                : 'It was empty. Audited (user.collection.remove).',
          })
        } else {
          toast({ title: 'Could not delete', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Could not reach /api/collections.', variant: 'destructive' })
      } finally {
        setBusy(null)
        void fetchList()
        void refreshDemoStates()
      }
    },
    [token, busy, toast, fetchList, refreshDemoStates]
  )

  const authenticated = status === 'authenticated' && !!token
  const customCollections = (data?.collections ?? []).filter((entry) => !entry.isDefault)
  const moveTarget = demoUnitState?.save?.collectionId

  return (
    <section aria-labelledby="saves-heading" className="mt-10 space-y-4">
      <div className="flex items-center gap-2">
        <Bookmark className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="saves-heading" className="text-xl font-semibold tracking-tight">
          Saves &amp; collections — the §10 retrieval half
        </h2>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Save = explicit retrieval into personal collections (default “Saved”, custom buckets for
        “Revision” / “Important Polity” / …). Deliberately separate from follows (§10): a save never
        feeds feed, notifications or recommendations. Rows keep the canonical object reference —
        content updates never duplicate them; withdrawn content stays as honest tombstones (§36).
      </p>

      {/* ---------- API contract ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">The save API (§37 — Bearer-authenticated)</CardTitle>
          <CardDescription>
            The same versioned endpoints a native app will call (§39). Idempotent save, scoped
            unsave, move-between-collections, truthful state, §31-safe collection deletes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {API_ROWS.map((row) => (
              <li key={`${row.method}:${row.path}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={`w-16 justify-center font-mono text-[10px] ${
                    row.method === 'GET'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : row.method === 'POST'
                        ? 'border-zinc-300 bg-zinc-100 text-zinc-700'
                        : row.method === 'DELETE'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-teal-200 bg-teal-50 text-teal-700'
                  }`}
                >
                  {row.method}
                </Badge>
                <code className="break-all font-mono text-xs text-zinc-800">{row.path}</code>
                <span className="text-xs text-zinc-500">— {row.note}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ---------- Live exercise (auth-gated) ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Exercise the endpoints live</CardTitle>
          <CardDescription>
            {authenticated
              ? `Signed in as ${user?.email ?? 'you'} — every action below hits the real APIs.`
              : 'Sign in above (any account, any role — saves are per-user data, not role-gated).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authenticated ? (
            <p className="flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
              <ShieldAlert className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              Unauthenticated calls to /api/saves and /api/collections return 401 — saves are
              private per-user data (§30/§31).
            </p>
          ) : (
            <>
              {/* Demo toggles */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    {DEMO_UNIT_NAME}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-zinc-400">
                    KNOWLEDGE_UNIT:{DEMO_UNIT_REF} · state{' '}
                    {demoUnitState ? (demoUnitState.saved ? 'saved' : 'not saved') : '…'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      disabled={busy !== null}
                      onClick={() => void saveDemo('KNOWLEDGE_UNIT', DEMO_UNIT_REF, DEMO_UNIT_NAME)}
                    >
                      {busy === `save:${DEMO_UNIT_REF}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                      disabled={busy !== null || !demoUnitState?.saved}
                      onClick={() => void unsaveDemo(demoUnitState)}
                    >
                      {busy === `unsave:${DEMO_UNIT_REF}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      Unsave
                    </Button>
                  </div>
                  {/* Move demo — visible when the demo unit is saved and a second collection exists */}
                  {demoUnitState?.saved && (data?.collections.length ?? 0) > 1 && (
                    <div className="mt-3 flex items-center gap-2">
                      <FolderInput className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                      <span className="text-xs text-zinc-500">Move to</span>
                      <Select value={moveTarget ?? undefined} onValueChange={(value) => void moveDemo(value)} disabled={busy !== null}>
                        <SelectTrigger className="h-8 w-[150px] border-zinc-200 bg-white text-xs font-medium" aria-label="Move the demo save to another collection">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(data?.collections ?? []).map((entry) => (
                            <SelectItem key={entry.id} value={entry.id} className="text-xs">
                              {entry.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <Bookmark className="h-4 w-4" aria-hidden="true" />
                    {DEMO_ITEM_NAME}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-zinc-400">
                    {demoItemRef ? `CONTENT_ITEM:${demoItemRef.slice(0, 18)}… · state ${demoItemState ? (demoItemState.saved ? 'saved' : 'not saved') : '…'}` : 'resolving the representation id from /api/knowledge/page/…'}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      disabled={busy !== null || !demoItemRef}
                      onClick={() => demoItemRef && void saveDemo('CONTENT_ITEM', demoItemRef, DEMO_ITEM_NAME)}
                    >
                      {busy === `save:${demoItemRef}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
                      )}
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:border-red-200 hover:text-red-700"
                      disabled={busy !== null || !demoItemState?.saved}
                      onClick={() => void unsaveDemo(demoItemState)}
                    >
                      {busy === `unsave:${demoItemRef}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      Unsave
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Collections management demo */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-zinc-800">
                    <FolderPlus className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    Collections
                    <span className="font-normal text-zinc-500">
                      {data ? `${data.collections.length} (default “Saved” + ${customCollections.length} custom)` : 'loading…'}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <label htmlFor="console-new-collection" className="sr-only">
                      New collection name
                    </label>
                    <Input
                      id="console-new-collection"
                      value={newName}
                      onChange={(event) => setNewName(event.target.value)}
                      placeholder="e.g. Revision"
                      className="h-8 w-44 border-zinc-200 bg-white text-sm"
                      maxLength={60}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void createDemoCollection()
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={() => void createDemoCollection()}
                      disabled={busy !== null || newName.trim().length === 0}
                    >
                      {busy === 'collection:create' ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      )}
                      Create
                    </Button>
                  </div>
                </div>
                {data && customCollections.length > 0 && (
                  <ul className="space-y-1.5">
                    {customCollections.map((collection) => (
                      <li
                        key={collection.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-zinc-800">{collection.name}</span>
                        <span className="text-zinc-400">{collection.itemCount} items</span>
                        {renamingId === collection.id ? (
                          <span className="ml-auto flex items-center gap-2">
                            <label htmlFor={`rename-${collection.id}`} className="sr-only">
                              Rename {collection.name}
                            </label>
                            <Input
                              id={`rename-${collection.id}`}
                              value={renameValue}
                              onChange={(event) => setRenameValue(event.target.value)}
                              className="h-7 w-36 border-zinc-200 text-xs"
                              maxLength={60}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void renameDemoCollection(collection.id)
                              }}
                            />
                            <Button size="sm" className="h-7 gap-1 bg-emerald-600 px-2 text-white hover:bg-emerald-700" onClick={() => void renameDemoCollection(collection.id)} disabled={busy !== null}>
                              OK
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-zinc-500"
                              onClick={() => {
                                setRenamingId(null)
                                setRenameValue('')
                              }}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </span>
                        ) : (
                          <span className="ml-auto flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-zinc-500 hover:text-zinc-900"
                              onClick={() => {
                                setRenamingId(collection.id)
                                setRenameValue(collection.name)
                              }}
                              aria-label={`Rename ${collection.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 gap-1 px-2 text-zinc-500 hover:text-red-700"
                              onClick={() => void deleteDemoCollection(collection.id, collection.name)}
                              disabled={busy !== null}
                              aria-label={`Delete ${collection.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Separator />

              {/* Live list */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-800">
                    GET /api/saves —{' '}
                    {data ? (
                      <span className="font-normal text-zinc-500">
                        {data.counts.total} saved · {data.counts.KNOWLEDGE_UNIT} units · {data.counts.CONTENT_ITEM} representations
                      </span>
                    ) : (
                      <span className="font-normal text-zinc-400">loading…</span>
                    )}
                  </p>
                  <Button variant="ghost" size="sm" className="h-8 gap-2" onClick={() => void fetchList()} disabled={loading}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Refresh
                  </Button>
                </div>
                {loading && !data ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : data && data.items.length > 0 ? (
                  <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                    {data.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs"
                      >
                        <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
                          {item.object.kind === 'KNOWLEDGE_UNIT' ? 'UNIT' : item.object.format}
                        </Badge>
                        <span className="font-medium text-zinc-800">
                          {item.object.kind === 'KNOWLEDGE_UNIT' ? item.object.canonicalName : item.object.title}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-400">{item.object.canonicalPath}</span>
                        <span className="ml-auto text-zinc-400">
                          saved {new Date(item.savedAt).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-md border border-dashed border-zinc-200 bg-white p-3 text-xs text-zinc-500">
                    No saves yet — use the toggles above or the Save button on any knowledge page,
                    then manage them at <code className="font-mono">#/saved</code>.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
