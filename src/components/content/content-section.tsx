'use client'

/**
 * GlobIQ — Content Section (P2-S2, extended P6-S2)
 *
 * Section shell for the ContentItem layer on the foundation page: the anchor
 * dimension (P6-S2: a representation renders a KnowledgeUnit §7 OR a
 * CurrentEvent §12 step 4 — exactly one), the locale bar (§35), the pickers
 * for each mode (topic → unit / the event directory), and the Explorer/Admin
 * tabs. The Admin tab appears only for holders of `content:manage` (§38) —
 * writers author event representations here; the server remains the sole
 * authority on every operation (§20).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileStack, Newspaper, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label as UILabel } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/stores/auth'
import { ContentAdmin, type AdminEventRef } from './content-admin'
import { ContentExplorer } from './content-explorer'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
}

interface ApiCountry {
  isoCode: string
  name: string
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

interface TreeTopic {
  slug: string
  label: string
  type: string
  children: TreeTopic[]
}

export interface PublicUnitRef {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  scope: string
  countryIso: string | null
}

/** Flattens the public tree into picker options (BRANCH/TOPIC nodes hold units). */
function flattenTopics(
  nodes: TreeTopic[],
  depth = 0,
  prefix = ''
): Array<{ slug: string; label: string; depth: number; prefix: string }> {
  const out: Array<{ slug: string; label: string; depth: number; prefix: string }> = []
  for (const node of nodes) {
    if (node.type !== 'DOMAIN') {
      out.push({ slug: node.slug, label: node.label, depth, prefix })
    }
    out.push(...flattenTopics(node.children, depth + 1, node.label))
  }
  return out
}

export function ContentSection() {
  const privileged = useAuth((state) => state.permissions.includes('content:manage'))
  const token = useAuth((state) => state.token)

  // P6-S2: the anchor mode — unit representations (§7) or event
  // representations (§12 step 4). Event mode is staff-only (the event
  // directory is an admin surface); Explorer stays unit-only.
  const [anchorMode, setAnchorMode] = useState<'unit' | 'event'>('unit')

  const [countries, setCountries] = useState<ApiCountry[] | null>(null)
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')
  const [topicSlug, setTopicSlug] = useState('fundamental-rights')
  const [unitSlug, setUnitSlug] = useState('fundamental-rights-articles-12-35')
  const [eventSlug, setEventSlug] = useState<string | null>(null)
  const [tab, setTab] = useState<'explore' | 'admin'>('explore')

  // Query-keyed option lists (loading = key mismatch — no sync setState in effect).
  const [topicState, setTopicState] = useState<{
    key: string
    topics: Array<{ slug: string; label: string; depth: number; prefix: string }>
  } | null>(null)
  const [unitState, setUnitState] = useState<{
    key: string
    units: PublicUnitRef[]
  } | null>(null)
  // The event directory (P6-S2 — readable by content:manage holders; the
  // route + service enforce the scope).
  const [eventState, setEventState] = useState<{
    key: string
    events: AdminEventRef[]
  } | null>(null)

  const topicKey = `${countryIso}:${language}`
  const topics = topicState?.key === topicKey ? topicState.topics : null
  const unitKey = `${countryIso}:${language}:${topicSlug}`
  const units = unitState?.key === unitKey ? unitState.units : null
  const eventKey = `events:${token ? 'auth' : 'anon'}`
  const events = eventState?.key === eventKey ? eventState.events : null

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        setCountries(payload.status === 'ok' && payload.data ? payload.data.countries : [])
      })
      .catch(() => setCountries([]))
  }, [])

  const country = useMemo(
    () => countries?.find((entry) => entry.isoCode === countryIso) ?? null,
    [countries, countryIso]
  )

  // Topic options for the resolved locale — async boundary (setState after await).
  useEffect(() => {
    let cancelled = false
    async function run() {
      const response = await fetch(
        `/api/taxonomy/tree?country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ tree: TreeTopic[] }>
      if (cancelled) return
      setTopicState({
        key: `${countryIso}:${language}`,
        topics: payload.status === 'ok' && payload.data ? flattenTopics(payload.data.tree) : [],
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [countryIso, language])

  // VERIFIED units under the selected topic (§5 chain Topic → KnowledgeUnit).
  useEffect(() => {
    let cancelled = false
    async function run() {
      const response = await fetch(
        `/api/knowledge/units?topic=${topicSlug}&country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ units: PublicUnitRef[] }>
      if (cancelled) return
      setUnitState({
        key: `${countryIso}:${language}:${topicSlug}`,
        units: payload.status === 'ok' && payload.data ? payload.data.units : [],
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [countryIso, language, topicSlug])

  // P6-S2: the event directory (staff read — writers pick representation
  // anchors; §14 visibility is enforced server-side).
  useEffect(() => {
    if (!privileged || !token) return
    let cancelled = false
    async function run() {
      const response = await fetch('/api/current-affairs/admin/events?pageSize=100', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{
        events: Array<{
          id: string
          slug: string
          title: string
          lifecycleState: string
          scope: 'GLOBAL' | 'COUNTRY'
          countryIso: string | null
        }>
      }>
      if (cancelled) return
      setEventState({
        key: `events:auth`,
        events:
          payload.status === 'ok' && payload.data
            ? payload.data.events.map((event) => ({
                id: event.id,
                slug: event.slug,
                title: event.title,
                lifecycleState: event.lifecycleState,
                scope: event.scope,
                countryIso: event.countryIso,
              }))
            : [],
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [privileged, token])

  const onCountryChange = useCallback(
    (iso: string) => {
      setCountryIso(iso)
      const next = countries?.find((entry) => entry.isoCode === iso)
      setLanguage(next?.defaultLanguage?.code ?? 'en')
    },
    [countries]
  )

  // Keep the unit selection valid for the loaded list — derived, no sync
  // setState in effect: the first VERIFIED unit is the fallback (React 19).
  const effectiveUnitSlug = useMemo(() => {
    if (!units || units.length === 0) return unitSlug
    return units.some((unit) => unit.slug === unitSlug) ? unitSlug : units[0]!.slug
  }, [units, unitSlug])
  const selectedUnit = useMemo(
    () => units?.find((unit) => unit.slug === effectiveUnitSlug) ?? null,
    [units, effectiveUnitSlug]
  )
  const selectedEvent = useMemo(
    () => events?.find((event) => event.slug === eventSlug) ?? events?.[0] ?? null,
    [events, eventSlug]
  )

  return (
    <section aria-labelledby="content-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="content-heading" className="text-xl font-semibold tracking-tight">
            Content items — representations of the record
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §7 · one record, many renderings · revisions §36
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        A ContentItem renders one canonical record in <span className="font-medium text-zinc-800">one
        language × one format</span> (§7) — the fact is never re-entered. Since P6-S2 a record is a
        <span className="font-medium text-zinc-800"> knowledge unit OR a current event</span> (§12
        step 4): event representations ride the same review workflow and immutable revisions (§19/§36).
        Public reads always serve the <span className="font-medium text-zinc-800">live revision
        snapshot</span>; corrections stage in the working copy and publish a{' '}
        <span className="font-medium text-zinc-800">new immutable revision</span> with a change
        summary (§36 — previous versions preserved forever).
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Browse context</CardTitle>
          <CardDescription>
            Anchor → country → language → record (§5/§12). Content language exposure follows the
            country configuration (§35); scoping is server-side (§14/§15).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Anchor mode (P6-S2) + locale bar (cells min-w-0 + w-full triggers so
              long labels truncate instead of stretching the grid on mobile) */}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-anchor">Anchor</UILabel>
              <Select
                value={anchorMode}
                onValueChange={(value) => {
                  setAnchorMode(value as 'unit' | 'event')
                  if (value === 'event') setTab('admin')
                }}
                disabled={!privileged}
              >
                <SelectTrigger id="content-anchor" className="w-full" aria-label="Select anchor type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unit">Knowledge unit (§7)</SelectItem>
                  <SelectItem value="event">Current event (§12)</SelectItem>
                </SelectContent>
              </Select>
              {!privileged && (
                <p className="text-[10px] text-zinc-400">
                  Event representations are authored by content staff (§38).
                </p>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-country">Country</UILabel>
              <Select value={countryIso} onValueChange={onCountryChange}>
                <SelectTrigger id="content-country" className="w-full" aria-label="Select country">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(countries ?? []).map((entry) => (
                    <SelectItem key={entry.isoCode} value={entry.isoCode}>
                      {entry.name} ({entry.isoCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-language">Language</UILabel>
              <Select value={language} onValueChange={setLanguage} disabled={!country}>
                <SelectTrigger id="content-language" className="w-full" aria-label="Select language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(country?.languages ?? []).map((entry) => (
                    <SelectItem key={entry.code} value={entry.code}>
                      {entry.nativeName ?? entry.name} ({entry.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {anchorMode === 'unit' ? (
              <div className="min-w-0 space-y-1.5">
                <UILabel htmlFor="content-topic">Topic</UILabel>
                <Select value={topicSlug} onValueChange={setTopicSlug} disabled={!topics}>
                  <SelectTrigger id="content-topic" className="w-full" aria-label="Select topic">
                    <SelectValue placeholder={topics ? 'Choose a topic' : 'Loading…'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(topics ?? []).map((entry) => (
                      <SelectItem key={entry.slug} value={entry.slug}>
                        {entry.prefix ? `${entry.prefix} › ` : ''}
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="min-w-0 space-y-1.5">
                <UILabel htmlFor="content-event">Current event</UILabel>
                <Select
                  value={selectedEvent?.slug ?? ''}
                  onValueChange={setEventSlug}
                  disabled={!events}
                >
                  <SelectTrigger id="content-event" className="w-full" aria-label="Select current event">
                    <SelectValue
                      placeholder={events ? 'Choose an event' : events === null ? 'Loading…' : 'No events visible'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(events ?? []).map((entry) => (
                      <SelectItem key={entry.slug} value={entry.slug}>
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* The unit picker (unit mode only — the fourth cell is the event picker in event mode) */}
          {anchorMode === 'unit' && (
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-unit">Knowledge unit</UILabel>
              <Select value={effectiveUnitSlug} onValueChange={setUnitSlug} disabled={!units}>
                <SelectTrigger id="content-unit" className="w-full" aria-label="Select knowledge unit">
                  <SelectValue
                    placeholder={units ? 'Choose a unit' : units === null ? 'Loading…' : 'No units here'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(units ?? []).map((entry) => (
                    <SelectItem key={entry.slug} value={entry.slug}>
                      {entry.canonicalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="Content views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'explore'}
              onClick={() => setTab('explore')}
              className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                tab === 'explore' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <FileStack className="h-4 w-4" aria-hidden="true" />
              Explorer
            </button>
            {privileged && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'admin'}
                onClick={() => setTab('admin')}
                className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                  tab === 'admin' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Admin console
              </button>
            )}
          </div>

          {/* Tab content */}
          {!countries ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : anchorMode === 'event' ? (
            <div className="space-y-3">
              <p className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50/60 px-3 py-2 text-xs text-orange-800">
                <Newspaper className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Event representations (§12 step 4): the same §19 review workflow, immutable
                revisions (§36) and §24 provenance as unit content — one rendering per language ×
                format per event. Writers author here; publishing needs an editor (§18). The public
                surface is the §16 event page: <span className="font-mono">#/current-affairs/{selectedEvent?.slug ?? '{slug}'}/</span>
              </p>
              <ContentAdmin
                country={countryIso}
                unit={null}
                event={selectedEvent}
                countryLanguages={country?.languages ?? []}
              />
            </div>
          ) : tab === 'explore' ? (
            <ContentExplorer country={countryIso} language={language} unit={selectedUnit} />
          ) : (
            <ContentAdmin
              country={countryIso}
              unit={selectedUnit}
              event={null}
              countryLanguages={country?.languages ?? []}
            />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
