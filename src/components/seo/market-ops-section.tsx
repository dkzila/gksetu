'use client'

/**
 * GlobIQ — Country-specific SEO operations section (P9-S4)
 *
 * The §16/§32 operations surface: per-market indexable inventory (the SAME
 * census the public sitemap serves — one truth), the hreflang cluster view,
 * the engine-side observation rollup with the per-page league (the P8-S5
 * pending note that landed here), the four market checks (census presence,
 * homepage canonical + hreflang, robots cleanliness, observation guarding)
 * and the submission affordance — the exact robots.txt / sitemap-index URLs
 * an operator registers with a search engine.
 *
 * §38 scoping follows the server: ADMIN selects any configured market
 * (paused included — the honest empty census); staff classes are locked to
 * their own; READER/signed-out see the honest note.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCopy,
  Globe,
  Languages,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------- API envelope + DTO mirrors (§37 client-agnostic contract) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface CountryRef {
  isoCode: string
  slug: string
  name: string
  status: string
  isDefault: boolean
  launchedAt: string | null
  defaultLanguage: { code: string; name: string } | null
  languages: Array<{ code: string; name: string }>
}

interface SummaryDto {
  country: CountryRef
  indexableUrls: number
  segmentCount: number
  byType: Array<{ text: string; count: number }>
  observedPages: number
  impressions: number
  clicks: number
  coveragePct: number | null
  topQuery: string | null
  honestNote: string
}

interface SummariesDto {
  summaries: SummaryDto[]
  visibleCount: number
  scopeNote: string
  contract: string
}

interface OverviewDto {
  country: CountryRef
  indexableUrls: number
  segments: Array<{ language: string; type: string; urlCount: number; lastModified: string | null; segmentUrl: string }>
  hreflang: {
    marketLanguages: string[]
    multiLanguagePathCount: number
    languagesInClusters: string[]
    samplePaths: Array<{ path: string; languages: string[] }>
  }
  observations: {
    rows: number
    distinctPages: number
    impressions: number
    clicks: number
    ctrPct: number | null
    avgPosition: number | null
    coveragePct: number | null
    firstObservedDay: string | null
    lastObservedDay: string | null
    perPage: Array<{ path: string; impressions: number; clicks: number; ctrPct: number | null; avgPosition: number | null }>
    perQuery: Array<{ query: string; impressions: number; clicks: number }>
    honestNote: string
  }
  checks: Array<{ id: string; label: string; status: 'pass' | 'fail' | 'warn'; detail: string; checked: number; failures: string[] }>
  submission: { robotsUrl: string; sitemapIndexUrl: string }
  derivation: string
}

// ---------- Component ----------

const CHECK_ICON = {
  pass: CheckCircle2,
  fail: XCircle,
  warn: AlertTriangle,
} as const

const CHECK_STYLE = {
  pass: 'text-emerald-600',
  fail: 'text-red-600',
  warn: 'text-amber-600',
} as const

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Live market', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  COMING_SOON: { label: 'Announced', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  INACTIVE: { label: 'Paused', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}

export function MarketOpsSection() {
  const { token, user } = useAuth()
  const { toast } = useToast()

  const isStaff = !!token && !!user && user.status === 'ACTIVE' && user.role !== 'READER'
  const [summaries, setSummaries] = useState<SummaryDto[]>([])
  const [scopeNote, setScopeNote] = useState<string | null>(null)
  const [contract, setContract] = useState<string | null>(null)
  const [detail, setDetail] = useState<OverviewDto | null>(null)
  const [selectedIso, setSelectedIso] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadOverview = useCallback(
    async (iso: string) => {
      if (!token) return
      setLoading(true)
      try {
        const response = await fetch(`/api/seo/market-ops/${iso}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<OverviewDto>
        if (payload.status === 'ok' && payload.data) {
          setDetail(payload.data)
          setSelectedIso(iso)
        } else {
          toast({ title: 'Could not load the market view', description: payload.error?.message ?? 'Please retry.', variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [token, toast]
  )

  const load = useCallback(async () => {
    if (!token || !isStaff) return
    setLoading(true)
    try {
      const response = await fetch('/api/seo/market-ops', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<SummariesDto>
      if (payload.status !== 'ok' || !payload.data) {
        toast({ title: 'Could not load market summaries', description: payload.error?.message ?? 'Please retry.', variant: 'destructive' })
        return
      }
      setSummaries(payload.data.summaries)
      setScopeNote(payload.data.scopeNote)
      setContract(payload.data.contract)
      setLoaded(true)
      // Auto-selection: the default market first (the workspaces precedent).
      const target = payload.data.summaries.find((s) => s.country.isDefault) ?? payload.data.summaries[0]
      if (target) await loadOverview(target.country.isoCode)
    } catch {
      toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, isStaff, loadOverview, toast])

  // The B2 pattern (P9-S3): drop every cached view on identity change.
  const actorKey = user?.id ?? 'anonymous'
  useEffect(() => {
    setSummaries([])
    setScopeNote(null)
    setContract(null)
    setDetail(null)
    setSelectedIso(null)
    setLoaded(false)
  }, [actorKey])

  useEffect(() => {
    if (isStaff && token && !loaded) void load()
  }, [isStaff, token, loaded, load, actorKey])

  const copy = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value)
        toast({ title: `Copied the ${label}`, description: value })
      } catch {
        toast({ title: 'Could not copy', description: 'Your browser blocked the clipboard.', variant: 'destructive' })
      }
    },
    [toast]
  )

  if (!isStaff) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4" aria-hidden />
            Country SEO operations — P9-S4
          </CardTitle>
          <CardDescription>The per-market indexing surface (§16/§32).</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-600">
            SEO operations are the editorial surface (§38) — sign in with a staff account (writer, country admin or
            platform admin) to read a market&apos;s indexable inventory, its engine-side observation coverage and the
            submission URLs.
          </p>
        </CardContent>
      </Card>
    )
  }

  const statusBadge = detail ? STATUS_BADGE[detail.country.status] ?? STATUS_BADGE.INACTIVE : null

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Search className="h-4 w-4" aria-hidden />
              Country SEO operations — P9-S4
              {statusBadge && (
                <Badge variant="outline" className={statusBadge.className}>
                  {statusBadge.label}
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Per-market indexing operations: the census inventory, hreflang clusters, engine-side coverage and the
              submission artifacts (§16). Windowless stock — every number is the all-time state.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Market selector (ADMIN: every configured market; staff: locked to own).
            B3-class fix: the scope note takes its own full-width line — a
            flex-1 sliver beside the selector cannot fit a word and bleeds
            past the viewport on mobile. */}
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="market-ops-market" className="text-sm font-medium text-zinc-700">
            Market
          </label>
          <div className="min-w-0">
            <Select
              value={selectedIso ?? undefined}
              onValueChange={(value) => void loadOverview(value)}
              disabled={loading || summaries.length === 0}
            >
              <SelectTrigger id="market-ops-market" className="w-64 max-w-full">
                <SelectValue placeholder={summaries.length === 0 ? 'No market in scope' : 'Select a market'} />
              </SelectTrigger>
              <SelectContent>
                {summaries.map((summary) => (
                  <SelectItem key={summary.country.isoCode} value={summary.country.isoCode}>
                    {summary.country.name} ({summary.country.isoCode}) · {summary.indexableUrls} URLs
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {scopeNote && <p className="text-xs text-zinc-500">{scopeNote}</p>}

        {loading && !detail && <Skeleton className="h-40 w-full" />}

        {detail && (
          <>
            {/* Summary line */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <Globe className="h-3.5 w-3.5" aria-hidden /> Indexable URLs
                </p>
                <p className="mt-1 text-xl font-bold text-zinc-900">{detail.indexableUrls}</p>
                <p className="text-xs text-zinc-500">{detail.segments.length} census segment(s)</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <BarChart3 className="h-3.5 w-3.5" aria-hidden /> Observed pages
                </p>
                <p className="mt-1 text-xl font-bold text-zinc-900">
                  {detail.observations.distinctPages}
                  {detail.observations.coveragePct != null && (
                    <span className="ml-1 text-sm font-medium text-zinc-500">({detail.observations.coveragePct}%)</span>
                  )}
                </p>
                <p className="text-xs text-zinc-500">
                  {detail.observations.impressions} impressions · {detail.observations.clicks} clicks
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <Languages className="h-3.5 w-3.5" aria-hidden /> hreflang clusters
                </p>
                <p className="mt-1 text-xl font-bold text-zinc-900">{detail.hreflang.multiLanguagePathCount}</p>
                <p className="text-xs text-zinc-500">
                  {detail.hreflang.marketLanguages.length === 1
                    ? 'single-language market'
                    : `${detail.hreflang.languagesInClusters.join(' ↔ ') || 'none yet'}`}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Checks
                </p>
                <p className="mt-1 text-xl font-bold text-zinc-900">
                  {detail.checks.filter((c) => c.status === 'pass').length}/{detail.checks.length} pass
                </p>
                <p className="text-xs text-zinc-500">
                  {detail.checks.filter((c) => c.status === 'warn').length} warn ·{' '}
                  {detail.checks.filter((c) => c.status === 'fail').length} fail
                </p>
              </div>
            </div>

            {/* Segment inventory + submission */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* B3-class fix: the census table can't wrap — scroll horizontally
                  inside the container instead of pushing the page wide. */}
              <div className="min-w-0 overflow-x-auto rounded-lg border border-zinc-200">
                <table className="w-full text-sm">
                  <caption className="sr-only">The market&apos;s sitemap census segments</caption>
                  <thead>
                    <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <th scope="col" className="px-3 py-2">Language</th>
                      <th scope="col" className="px-3 py-2">Type</th>
                      <th scope="col" className="px-3 py-2 text-right">URLs</th>
                      <th scope="col" className="px-3 py-2">Lastmod</th>
                      <th scope="col" className="px-3 py-2"><span className="sr-only">Copy the segment URL</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.segments.map((segment) => (
                      <tr key={`${segment.language}:${segment.type}`} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-2 font-medium text-zinc-800">{segment.language}</td>
                        <td className="px-3 py-2 text-zinc-600">{segment.type}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{segment.urlCount}</td>
                        <td className="px-3 py-2 text-xs text-zinc-500">{segment.lastModified?.slice(0, 10) ?? '—'}</td>
                        <td className="px-3 py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => void copy(segment.segmentUrl, `${segment.language}/${segment.type} segment URL`)}
                            aria-label={`Copy the ${segment.language} ${segment.type} sitemap segment URL`}
                          >
                            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {detail.segments.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500">
                          No census segments — {detail.country.status === 'INACTIVE' ? 'an INACTIVE market is not in the census until announced (§15).' : 'this is a defect, not an empty state.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
                    <Link2 className="h-4 w-4" aria-hidden /> Submission artifacts (§16)
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    The URLs an operator registers with a search engine — served from the same route model as every
                    public page.
                  </p>
                </div>
                {[
                  { label: 'robots.txt', value: detail.submission.robotsUrl },
                  { label: 'sitemap index', value: detail.submission.sitemapIndexUrl },
                ].map((item) => (
                  <div key={item.label} className="flex min-w-0 items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-500">{item.label}</p>
                      <p className="truncate font-mono text-xs text-zinc-800">{item.value}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 px-2"
                      onClick={() => void copy(item.value, item.label)}
                      aria-label={`Copy the ${item.label} URL`}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}
                {detail.hreflang.samplePaths.length > 0 && (
                  <div className="rounded border border-zinc-200 bg-white px-3 py-2">
                    <p className="text-xs font-medium text-zinc-500">hreflang cluster samples</p>
                    <ul className="mt-1 space-y-1">
                      {detail.hreflang.samplePaths.map((sample) => (
                        <li key={sample.path} className="truncate font-mono text-xs text-zinc-700">
                          {sample.path} <span className="text-zinc-400">({sample.languages.join(' ↔ ')})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Observations: the per-page league + top queries */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="min-w-0 overflow-x-auto rounded-lg border border-zinc-200">
                <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-sm font-semibold text-zinc-800">Per-page league (engine-side, all-time)</p>
                  <p className="text-xs text-zinc-500">
                    Top {detail.observations.perPage.length} by impressions — CTR and position per page (§32, the
                    P8-S5 pending note that landed here).
                  </p>
                </div>
                <table className="w-full text-sm">
                  <caption className="sr-only">Top observed pages by impressions</caption>
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <th scope="col" className="px-3 py-2">Path</th>
                      <th scope="col" className="px-3 py-2 text-right">Impr.</th>
                      <th scope="col" className="px-3 py-2 text-right">Clicks</th>
                      <th scope="col" className="px-3 py-2 text-right">CTR</th>
                      <th scope="col" className="px-3 py-2 text-right">Pos.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.observations.perPage.map((page) => (
                      <tr key={page.path} className="border-b border-zinc-100 last:border-0">
                        <td className="max-w-56 truncate px-3 py-2 font-mono text-xs text-zinc-700" title={page.path}>{page.path}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{page.impressions}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-800">{page.clicks}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{page.ctrPct != null ? `${page.ctrPct}%` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-zinc-600">{page.avgPosition ?? '—'}</td>
                      </tr>
                    ))}
                    {detail.observations.perPage.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500">
                          No engine-side observations yet — the census is the platform-side declaration only.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <p className="text-sm font-semibold text-zinc-800">Top engine-side queries</p>
                  {detail.observations.perQuery.length === 0 ? (
                    <p className="mt-1 text-xs text-zinc-500">No observations imported for this market yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {detail.observations.perQuery.map((query) => (
                        <li key={query.query} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-zinc-700">{query.query}</span>
                          <span className="shrink-0 tabular-nums text-xs text-zinc-500">
                            {query.impressions} impr. · {query.clicks} clicks
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {detail.observations.firstObservedDay && (
                    <p className="mt-2 text-xs text-zinc-500">
                      Window: {detail.observations.firstObservedDay} → {detail.observations.lastObservedDay} ·{' '}
                      {detail.observations.rows} row(s) · CTR{' '}
                      {detail.observations.ctrPct != null ? `${detail.observations.ctrPct}%` : '—'} · avg position{' '}
                      {detail.observations.avgPosition ?? '—'}
                    </p>
                  )}
                </div>
                <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                  {detail.observations.honestNote}
                </p>
              </div>
            </div>

            {/* The four market checks */}
            <div className="space-y-2">
              {detail.checks.map((check) => {
                const Icon = CHECK_ICON[check.status]
                return (
                  <div key={check.id} className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${CHECK_STYLE[check.status]}`} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800">
                        {check.label}{' '}
                        <span className="text-xs font-normal text-zinc-500">({check.checked} checked)</span>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-600">{check.detail}</p>
                      {check.failures.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {check.failures.map((failure) => (
                            <li key={failure} className="font-mono text-xs text-red-600">
                              {failure}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="text-xs text-zinc-500">{detail.derivation}</p>
            {contract && <p className="text-xs text-zinc-400">{contract}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
