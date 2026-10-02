'use client'

/**
 * GKSetu Console — Current Affairs page (CONSOLE-S1-C).
 *
 * The §12 editorial workspace: the event-centric list (one CurrentEvent per
 * real-world event), server-side filters (q/lifecycle/scope/country/topic),
 * the create/edit editor, the lifecycle state machine (emerging → developing
 * → stable → archived, with honest reopens) and the per-event links manager —
 * sources, entities, topics and knowledge units.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowRight,
  BookOpen,
  Link2,
  Loader2,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { SelectInput } from '@/components/console/ui/form-fields'
import { ConsolePageHeader, ErrorNotice, formatDate, formatWhen } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import {
  CA_LIFECYCLES,
  EventEditorDialog,
  EventLinksDialog,
  LifecycleBadge,
  type CaEventRow,
  type CaListResult,
  type CountryOption,
  type TopicOption,
} from './current-affairs-parts'

/** The §12 step 6 state machine — mirrored from the module's single UI source. */
const CURRENT_EVENT_TRANSITIONS: Record<string, string[]> = {
  EMERGING: ['DEVELOPING', 'STABLE', 'ARCHIVED'],
  DEVELOPING: ['STABLE', 'EMERGING', 'ARCHIVED'],
  STABLE: ['ARCHIVED', 'DEVELOPING'],
  ARCHIVED: ['DEVELOPING', 'STABLE'],
}

const PAGE_SIZE = 20

export function CurrentAffairsPage() {
  const api = useConsoleApi()
  const { toast } = useToast()
  const canManage = useHasPermission('current-affairs:manage')

  // ----- list + filters (all server-side) -----
  const [result, setResult] = useState<CaListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [lifecycle, setLifecycle] = useState('')
  const [scope, setScope] = useState('')
  const [country, setCountry] = useState('')
  const [topic, setTopic] = useState('')
  const [page, setPage] = useState(1)

  // Picker feeds (filters + editor).
  const [topics, setTopics] = useState<TopicOption[]>([])
  const [countries, setCountries] = useState<CountryOption[]>([])

  // Dialogs.
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorEvent, setEditorEvent] = useState<CaEventRow | null>(null)
  const [linksEvent, setLinksEvent] = useState<{ id: string; title: string } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<CaEventRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Debounce the search box into the server query (page resets with it).
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
    if (lifecycle) params.set('lifecycle', lifecycle)
    if (scope) params.set('scope', scope)
    if (country) params.set('country', country)
    if (topic) params.set('topic', topic)
    const response = await api.get<CaListResult>(`/api/current-affairs/admin/events?${params.toString()}`)
    setLoading(false)
    if (response.data) {
      setResult(response.data)
    } else {
      setResult(null)
      setError(response.error?.message ?? 'Could not load the event workspace.')
    }
  }, [api, page, debouncedSearch, lifecycle, scope, country, topic])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // Feeds: the taxonomy tree (topic filter + editor) and countries.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [treeRes, countriesRes] = await Promise.all([
        api.get<{ tree: Array<{ slug: string; canonicalName: string; children: unknown[] }> }>('/api/taxonomy/admin/tree'),
        api.get<{ countries: Array<{ isoCode: string; name: string }> }>('/api/countries'),
      ])
      if (cancelled) return
      const flat: TopicOption[] = []
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

  // ----- lifecycle transitions (§12 step 6) -----
  async function handleTransition(event: CaEventRow, to: string) {
    setBusyId(event.id)
    try {
      const response = await api.post<{ event: CaEventRow }>(`/api/current-affairs/admin/events/${event.id}/transition`, { to })
      if (response.data) {
        toast({ title: `Lifecycle → ${to.toLowerCase()}`, description: 'Every move is audited (§36).' })
        await fetchList()
      } else {
        toast({ title: 'Transition rejected', description: response.error?.message, variant: 'destructive' })
      }
    } finally {
      setBusyId(null)
    }
  }

  // ----- table -----

  const summary = result?.summary
  const rows = result?.events ?? []

  const linkCount = (event: CaEventRow) =>
    [
      { key: 'S', value: event.sourceCount, title: 'Sources' },
      { key: 'E', value: event.entityCount, title: 'Entities' },
      { key: 'T', value: event.additionalTopicCount, title: 'Additional topics' },
      { key: 'U', value: event.unitCount, title: 'Knowledge units' },
    ].filter((entry) => entry.value > 0)

  const columns: Array<ResourceColumn<CaEventRow>> = useMemo(
    () => [
      {
        key: 'title',
        header: 'Event',
        className: 'min-w-[280px]',
        render: (event) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{event.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-zinc-400">
              <span>{event.topic.name}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{event.scope === 'COUNTRY' ? event.countryIso : 'GLOBAL'}</span>
              <span aria-hidden="true">·</span>
              <span>{event.freshness.label}</span>
            </p>
          </div>
        ),
      },
      {
        key: 'eventDate',
        header: 'Event date',
        render: (event) => <span className="whitespace-nowrap text-zinc-600">{formatDate(event.eventDate)}</span>,
      },
      {
        key: 'lifecycleState',
        header: 'Lifecycle',
        render: (event) => <LifecycleBadge state={event.lifecycleState} />,
      },
      {
        key: 'links',
        header: 'Links',
        render: (event) => {
          const counts = linkCount(event)
          if (counts.length === 0) return <span className="text-xs text-zinc-300">—</span>
          return (
            <div className="flex items-center gap-1">
              {counts.map((entry) => (
                <span
                  key={entry.key}
                  title={entry.title}
                  className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0 font-mono text-[10px] text-zinc-500"
                >
                  {entry.key}
                  {entry.value}
                </span>
              ))}
            </div>
          )
        },
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (event) => <span className="whitespace-nowrap text-zinc-500">{formatWhen(event.updatedAt)}</span>,
      },
    ],
    []
  )

  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Current Affairs"
        description="The canonical event records (§12) — one CurrentEvent per real-world event, evidence aggregated from the shared source registry, linked entities, topics and VERIFIED knowledge units."
        icon={<Newspaper className="h-5 w-5" aria-hidden="true" />}
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
                  setEditorEvent(null)
                  setEditorOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New event
              </Button>
            )}
          </>
        }
      />

      {/* Lifecycle summary — clickable to filter (the §12 editorial overview). */}
      {summary && (
        <div className="flex flex-wrap items-center gap-2">
          {CA_LIFECYCLES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setLifecycle(lifecycle === state ? '' : state)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                lifecycle === state
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
              )}
              aria-pressed={lifecycle === state}
            >
              {state.toLowerCase()} · {summary?.[state] ?? 0}
            </button>
          ))}
          {result && (
            <span className="text-[11px] text-zinc-400">
              {result.pagination.total} event{result.pagination.total === 1 ? '' : 's'} visible
            </span>
          )}
        </div>
      )}

      {error && rows.length === 0 && !loading && <ErrorNotice message={error} onRetry={() => void fetchList()} />}

      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(event) => event.id}
        loading={loading}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search title, summary, slug…',
        }}
        toolbar={
          <>
            <div className="w-36">
              <SelectInput
                value={lifecycle}
                onChange={(value) => {
                  setLifecycle(value)
                  setPage(1)
                }}
                placeholder="All lifecycles"
                options={CA_LIFECYCLES.map((state) => ({ value: state, label: state.charAt(0) + state.slice(1).toLowerCase() }))}
              />
            </div>
            <div className="w-32">
              <SelectInput
                value={scope}
                onChange={(value) => {
                  setScope(value)
                  if (value === 'GLOBAL') setCountry('')
                  setPage(1)
                }}
                placeholder="All scopes"
                options={[
                  { value: 'GLOBAL', label: 'GLOBAL' },
                  { value: 'COUNTRY', label: 'COUNTRY' },
                ]}
              />
            </div>
            <div className="w-32">
              <SelectInput
                value={country}
                onChange={(value) => {
                  setCountry(value)
                  setPage(1)
                }}
                placeholder="All countries"
                options={countries.map((entry) => ({ value: entry.isoCode, label: `${entry.isoCode} — ${entry.name}` }))}
              />
            </div>
            <div className="w-44">
              <SelectInput
                value={topic}
                onChange={(value) => {
                  setTopic(value)
                  setPage(1)
                }}
                placeholder="All topics"
                options={topics.map((entry) => ({ value: entry.slug, label: entry.name }))}
              />
            </div>
          </>
        }
        emptyTitle="No events match"
        emptyHint="Adjust the filters, or create the first event for this market."
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
        actions={(event) =>
          canManage ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => setLinksEvent({ id: event.id, title: event.title })}
                aria-label={`Manage links for ${event.title}`}
              >
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Links
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busyId === event.id} aria-label="Row actions">
                    {busyId === event.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditorEvent(event)
                      setEditorOpen(true)
                    }}
                    disabled={event.lifecycleState === 'ARCHIVED'}
                  >
                    <Pencil className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Edit event
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-400">
                    Lifecycle (§12 step 6)
                  </DropdownMenuLabel>
                  {(CURRENT_EVENT_TRANSITIONS[event.lifecycleState] ?? []).map((to) => (
                    <DropdownMenuItem
                      key={to}
                      className={cn(to === 'ARCHIVED' && 'text-red-600 focus:text-red-600')}
                      onClick={() => {
                        if (to === 'ARCHIVED') setArchiveTarget(event)
                        else void handleTransition(event, to)
                      }}
                    >
                      {to === 'ARCHIVED' ? (
                        <Archive className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ArrowRight className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Move to {to.toLowerCase()}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => setLinksEvent({ id: event.id, title: event.title })}
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" /> View links
            </Button>
          )
        }
      />

      {/* Create / edit */}
      <EventEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        event={editorEvent}
        topics={topics}
        countries={countries}
        onSaved={() => void fetchList()}
      />

      {/* Links manager */}
      <EventLinksDialog open={linksEvent !== null} onOpenChange={(open) => !open && setLinksEvent(null)} event={linksEvent} onChanged={() => void fetchList()} />

      {/* Archive confirm — the §36 end-of-life (no destructive delete on events) */}
      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-red-600" aria-hidden="true" />
              Archive this event?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveTarget?.title}” becomes read-only end-of-life (§36) — the page stays public as historical reference.
              A reopen is an explicit editorial transition, and nothing is ever hard-deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (archiveTarget) void handleTransition(archiveTarget, 'ARCHIVED')
                setArchiveTarget(null)
              }}
            >
              Archive event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
