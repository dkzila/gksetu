'use client'

/**
 * GlobIQ — Entities registry console section (P6-S3)
 *
 * The §38 console surface for the Entity reference registry (§6 Entity row:
 * person/place/organisation/concept — canonical records, never content).
 * List with type/status filters, create with aliases (§13 TopicAlias
 * precedent), detail with the events that reference the entity (§12 step 3)
 * and the §36 retire/reactivate lifecycle. ADMIN sees the global registry;
 * COUNTRY_ADMIN sees GLOBAL + own-market entities (server-scoped).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Building2,
  CircleDot,
  Loader2,
  MapPin,
  PlusCircle,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  User,
  Users,
  Zap,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API types (mirror /api/entities DTOs) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

type EntityType = 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
type EntityStatus = 'ACTIVE' | 'RETIRED'
type EntityScope = 'GLOBAL' | 'COUNTRY'

interface AdminEntity {
  id: string
  slug: string
  canonicalName: string
  description: string | null
  type: EntityType
  status: EntityStatus
  scope: EntityScope
  countryIso: string | null
  notes: string | null
  aliasCount: number
  eventCount: number
  createdAt: string
  updatedAt: string
}

interface AdminEntityDetail extends AdminEntity {
  aliases: Array<{ id: string; value: string; languageCode: string | null }>
  events: Array<{
    eventId: string
    eventSlug: string
    eventTitle: string
    lifecycleState: string
    note: string | null
    linkedAt: string
  }>
  editable: boolean
}

interface EntityListResult {
  entities: AdminEntity[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; ACTIVE: number; RETIRED: number }
}

const ENTITY_TYPE_OPTIONS: Array<{ value: EntityType; label: string }> = [
  { value: 'PERSON', label: 'Person' },
  { value: 'PLACE', label: 'Place' },
  { value: 'ORGANISATION', label: 'Organisation' },
  { value: 'CONCEPT', label: 'Concept' },
]

const TYPE_TONE: Record<EntityType, string> = {
  PERSON: 'border-violet-200 bg-violet-50 text-violet-700',
  PLACE: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  ORGANISATION: 'border-orange-200 bg-orange-50 text-orange-700',
  CONCEPT: 'border-teal-200 bg-teal-50 text-teal-700',
}

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/entities/admin?q=&type=&status=&scope=&country=', note: 'Registry list (§38 scoped: ADMIN global; COUNTRY_ADMIN global + own market) + summary' },
  { method: 'POST', path: '/api/entities/admin', note: 'Create a canonical record (§6 — one row per real-world entity, slug immutable §16)' },
  { method: 'GET', path: '/api/entities/admin/{id}', note: 'Detail: aliases + the events referencing it (§12 step 3)' },
  { method: 'PATCH', path: '/api/entities/admin/{id}', note: 'Audited edits + §36 retire/reactivate; aliases replaced wholesale' },
]

// ---------- Component ----------

export function EntitiesSection() {
  const canManage = useAuth((state) => state.permissions.includes('entities:manage'))
  const { token } = useAuth()
  const { toast } = useToast()

  const [list, setList] = useState<EntityListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<'ALL' | EntityType>('ALL')
  const [filterStatus, setFilterStatus] = useState<'ALL' | EntityStatus>('ALL')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminEntityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Create form (§6 Entity row + aliases)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    canonicalName: '',
    type: 'ORGANISATION' as EntityType,
    scope: 'GLOBAL' as EntityScope,
    country: 'IN',
    description: '',
    aliases: '',
  })

  const authHeaders = { Authorization: `Bearer ${token}` }

  const fetchList = useCallback(async () => {
    if (!token) {
      setList(null)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ pageSize: '50' })
      if (filterType !== 'ALL') params.set('type', filterType)
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      const response = await fetch(`/api/entities/admin?${params}`, {
        headers: authHeaders,
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<EntityListResult>
      if (payload.status === 'ok' && payload.data) setList(payload.data)
      else toast({ title: 'Could not load entities', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the entities API.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, filterType, filterStatus, toast])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  const fetchDetail = useCallback(
    async (id: string) => {
      if (!token) return
      setDetailLoading(true)
      try {
        const response = await fetch(`/api/entities/admin/${id}`, { headers: authHeaders, cache: 'no-store' })
        const payload = (await response.json()) as Envelope<{ entity: AdminEntityDetail }>
        if (payload.status === 'ok' && payload.data) setDetail(payload.data.entity)
        else toast({ title: 'Could not load the entity', description: payload.error?.message, variant: 'destructive' })
      } finally {
        setDetailLoading(false)
      }
    },
    [token, toast]
  )

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      setDetail(null)
    } else {
      setExpandedId(id)
      setDetail(null)
      void fetchDetail(id)
    }
  }

  async function call<T>(
    key: string,
    run: () => Promise<Response>,
    successTitle: string,
    successDescription?: string
  ) {
    if (!token) return
    setBusy(key)
    try {
      const response = await run()
      const payload = (await response.json()) as Envelope<T>
      if (payload.status === 'ok') {
        toast({ title: successTitle, description: successDescription })
        await fetchList()
        if (expandedId) await fetchDetail(expandedId)
        return payload
      }
      toast({ title: 'Operation failed', description: payload.error?.message, variant: 'destructive' })
      return undefined
    } catch {
      toast({ title: 'Network error', description: 'The entities API is unreachable.', variant: 'destructive' })
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function handleCreate() {
    if (!form.canonicalName.trim()) {
      toast({ title: 'Name required', description: 'The canonical name is the entity identity.', variant: 'destructive' })
      return
    }
    if (form.scope === 'COUNTRY' && !form.country.trim()) {
      toast({ title: 'Country required', description: 'A country-scoped entity must name its market (§14).', variant: 'destructive' })
      return
    }
    const aliases = form.aliases
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20)
    const payload = await call<{ entity: AdminEntityDetail }>(
      'create',
      () =>
        fetch('/api/entities/admin', {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            canonicalName: form.canonicalName.trim(),
            type: form.type,
            scope: form.scope,
            ...(form.scope === 'COUNTRY' ? { country: form.country.trim().toUpperCase() } : {}),
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
            ...(aliases.length ? { aliases: aliases.map((value) => ({ value })) } : {}),
          }),
        }),
      'Entity registered (§6)',
      'One canonical record whatever the number of stories that mention it.'
    )
    if (payload?.status === 'ok') {
      setForm({ ...form, canonicalName: '', description: '', aliases: '' })
      setShowCreate(false)
    }
  }

  async function handleFlipStatus(entity: AdminEntityDetail, status: EntityStatus) {
    await call(
      `flip-${entity.id}`,
      () =>
        fetch(`/api/entities/admin/${entity.id}`, {
          method: 'PATCH',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }),
      status === 'RETIRED' ? 'Entity retired (§36)' : 'Entity reactivated',
      status === 'RETIRED'
        ? 'Existing links and follows stay as honest history — no new links.'
        : 'The record accepts links and follows again.'
    )
  }

  if (!canManage) return null

  return (
    <section aria-labelledby="entities-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="entities-heading" className="text-xl font-semibold tracking-tight">
            Entities — the reference registry
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {list && (
            <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
              {list.summary.total} total · {list.summary.ACTIVE} active · {list.summary.RETIRED} retired
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate((open) => !open)} className="h-9 gap-1.5">
            <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {showCreate ? 'Close' : 'Register entity'}
          </Button>
        </div>
      </div>

      <p className="max-w-3xl text-sm text-zinc-600">
        Persons, places, organisations and concepts as{' '}
        <span className="font-medium text-zinc-800">canonical reference records</span> (§6) — the Topic/Source
        precedent: one row per real-world entity, aliases for search matching (§13/§17), §14 GLOBAL/COUNTRY
        scope, §36 soft delete. Events link them via §12 step 3; users follow them via §10.
      </p>

      {/* API contract (§37) */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            API contract (§37)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-500">
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Contract</th>
                </tr>
              </thead>
              <tbody>
                {API_ROWS.map((row) => (
                  <tr key={`${row.method}-${row.path}`} className="border-b border-zinc-50 last:border-0">
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-mono text-[10px] font-normal text-emerald-700">
                        {row.method}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-700">{row.path}</td>
                    <td className="hidden px-3 py-2 text-zinc-500 sm:table-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create form */}
      {showCreate && (
        <Card className="border-emerald-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Register a canonical entity (§6)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="entity-name" className="text-xs">Canonical name *</Label>
              <Input
                id="entity-name"
                value={form.canonicalName}
                onChange={(event) => setForm({ ...form, canonicalName: event.target.value })}
                placeholder="Indian Space Research Organisation"
                className="bg-white text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entity-type" className="text-xs">Type *</Label>
              <select
                id="entity-type"
                value={form.type}
                onChange={(event) => setForm({ ...form, type: event.target.value as EntityType })}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
              >
                {ENTITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entity-scope" className="text-xs">Scope (§14) *</Label>
              <select
                id="entity-scope"
                value={form.scope}
                onChange={(event) => setForm({ ...form, scope: event.target.value as EntityScope })}
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
              >
                <option value="GLOBAL">GLOBAL — world reference (ADMIN)</option>
                <option value="COUNTRY">COUNTRY — one market</option>
              </select>
            </div>
            {form.scope === 'COUNTRY' && (
              <div className="space-y-1.5">
                <Label htmlFor="entity-country" className="text-xs">Country ISO *</Label>
                <Input
                  id="entity-country"
                  value={form.country}
                  onChange={(event) => setForm({ ...form, country: event.target.value })}
                  placeholder="IN"
                  className="bg-white font-mono text-sm uppercase"
                />
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="entity-description" className="text-xs">Canonical one-liner</Label>
              <Input
                id="entity-description"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="India's national space agency (1969)."
                className="bg-white text-sm"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="entity-aliases" className="text-xs">Aliases (comma-separated — §13/§17 search terms)</Label>
              <Input
                id="entity-aliases"
                value={form.aliases}
                onChange={(event) => setForm({ ...form, aliases: event.target.value })}
                placeholder="ISRO, Indian Space Research Organisation"
                className="bg-white text-sm"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button size="sm" disabled={busy === 'create'} onClick={() => void handleCreate()} className="gap-1.5">
                {busy === 'create' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Register entity
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          Filters:
        </div>
        <select
          value={filterType}
          onChange={(event) => setFilterType(event.target.value as 'ALL' | EntityType)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
          aria-label="Filter by type"
        >
          <option value="ALL">All types</option>
          {ENTITY_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(event) => setFilterStatus(event.target.value as 'ALL' | EntityStatus)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
          aria-label="Filter by status"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="RETIRED">Retired</option>
        </select>
      </div>

      {/* Registry list */}
      <Card className="border-zinc-200 shadow-sm">
        <CardContent className="py-4">
          {loading && !list ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : list && list.entities.length > 0 ? (
            <ul className="space-y-2" aria-label="Entity registry">
              {list.entities.map((entity) => (
                <li key={entity.id} className="rounded-lg border border-zinc-100">
                  <button
                    type="button"
                    onClick={() => toggleExpand(entity.id)}
                    aria-expanded={expandedId === entity.id}
                    className="flex w-full flex-wrap items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-50"
                  >
                    <Badge variant="outline" className={`gap-1 ${TYPE_TONE[entity.type]}`}>
                      {entity.type === 'PERSON' && <User className="h-3 w-3" aria-hidden="true" />}
                      {entity.type === 'PLACE' && <MapPin className="h-3 w-3" aria-hidden="true" />}
                      {entity.type === 'ORGANISATION' && <Building2 className="h-3 w-3" aria-hidden="true" />}
                      {entity.type === 'CONCEPT' && <Tag className="h-3 w-3" aria-hidden="true" />}
                      {entity.type.charAt(0) + entity.type.slice(1).toLowerCase()}
                    </Badge>
                    <span className="text-sm font-medium text-zinc-800">{entity.canonicalName}</span>
                    <span className="font-mono text-[10px] text-zinc-400">{entity.slug}</span>
                    <span className="font-mono text-[10px] uppercase text-zinc-400">
                      {entity.scope === 'COUNTRY' ? entity.countryIso : 'GLOBAL'}
                    </span>
                    <Badge
                      variant="outline"
                      className={`font-normal ${
                        entity.status === 'ACTIVE'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-zinc-200 bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {entity.status.toLowerCase()}
                    </Badge>
                    <span className="ml-auto flex items-center gap-2 text-[10px] text-zinc-400">
                      {entity.aliasCount} alias{entity.aliasCount === 1 ? '' : 'es'} · {entity.eventCount} event{entity.eventCount === 1 ? '' : 's'}
                    </span>
                  </button>

                  {expandedId === entity.id && (
                    <div className="border-t border-zinc-100 px-3 py-3">
                      {detailLoading || !detail ? (
                        <div className="space-y-2">
                          <Skeleton className="h-6 w-2/3" />
                          <Skeleton className="h-16 w-full" />
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {detail.description && (
                            <p className="text-sm text-zinc-600">{detail.description}</p>
                          )}
                          {detail.notes && (
                            <p className="text-xs italic text-zinc-400">Editorial notes: {detail.notes}</p>
                          )}

                          {/* Aliases */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                              Aliases (§13) — {detail.aliases.length}
                            </p>
                            {detail.aliases.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {detail.aliases.map((alias) => (
                                  <Badge
                                    key={alias.id}
                                    variant="outline"
                                    className="border-zinc-200 bg-white font-normal text-zinc-600"
                                  >
                                    {alias.value}
                                    {alias.languageCode && (
                                      <span className="ml-1 font-mono text-[9px] text-zinc-400">{alias.languageCode}</span>
                                    )}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-zinc-400">No aliases — search matches the canonical name only.</p>
                            )}
                          </div>

                          {/* Referencing events */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                              Events referencing this entity (§12 step 3) — {detail.events.length}
                            </p>
                            {detail.events.length > 0 ? (
                              <ul className="max-h-40 space-y-1 overflow-y-auto pr-1" aria-label="Referencing events">
                                {detail.events.map((event) => (
                                  <li
                                    key={event.eventId}
                                    className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/50 px-3 py-1.5 text-xs"
                                  >
                                    <span className="font-medium text-zinc-800">{event.eventTitle}</span>
                                    <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
                                      {event.lifecycleState.toLowerCase()}
                                    </Badge>
                                    <span className="font-mono text-[10px] text-zinc-400">#{event.eventSlug}</span>
                                    {event.note && <span className="italic text-zinc-400">{event.note}</span>}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-xs text-zinc-400">
                                No events link this entity yet — links are made from the current-affairs workspace.
                              </p>
                            )}
                          </div>

                          {/* §36 lifecycle controls */}
                          <div className="flex flex-wrap items-center gap-2">
                            {detail.editable ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === `flip-${detail.id}`}
                                onClick={() => void handleFlipStatus(detail, 'RETIRED')}
                                className="h-8 gap-1.5 border-red-200 text-red-600 hover:text-red-700"
                              >
                                {busy === `flip-${detail.id}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                Retire (§36)
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === `flip-${detail.id}`}
                                onClick={() => void handleFlipStatus(detail, 'ACTIVE')}
                                className="h-8 gap-1.5 border-emerald-200 text-emerald-700"
                              >
                                {busy === `flip-${detail.id}` ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                Reactivate
                              </Button>
                            )}
                            <span className="text-[10px] text-zinc-400">
                              {detail.editable
                                ? 'Retiring stops new links/follows; existing ones stay as history.'
                                : 'Retired — read-only; reactivation restores linking.'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
              No entities match the filters — register the first canonical record above.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
