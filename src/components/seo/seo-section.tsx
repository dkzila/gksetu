'use client'

/**
 * GlobIQ — SEO infrastructure section (P4-S4, extended P4-S5)
 *
 * The §16 verification surface: the live robots.txt + sitemap index (fetched
 * from their standard crawler locations — the next.config rewrites), the
 * segment census with URL counts + lastmods (country × language × content
 * type), a segment XML preview, the origin the absolute URLs resolve against
 * — and since P4-S5, the SEO validation report (sitemap grammar/uniqueness/
 * parity/determinism, robots artifact, hreflang clusters, the §36 historical
 * window, the structured-data graphs and the JSON-LD path contract) plus the
 * sampled structured-data surfaces. Every number on this card is computed by
 * the same services the public endpoints use — no parallel truth.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  FileCode2,
  Globe,
  Loader2,
  Map,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

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

interface SegmentInfo {
  country: string
  language: string
  type: 'home' | 'topics' | 'units' | 'exams' | 'syllabus'
  urlCount: number
  lastModified: string | null
}

interface ValidationCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  checked: number
  failures: string[]
}

interface ValidationSurface {
  surface: 'home' | 'topic' | 'exam' | 'syllabus' | 'knowledge'
  country: string
  language: string
  path: string
  nodeTypes: string[]
}

interface ValidationReport {
  passed: number
  failed: number
  warnings: number
  checks: ValidationCheck[]
  surfaces: ValidationSurface[]
}

interface SeoStatusDto {
  origin: string
  robots: { disallow: string[]; sitemapLine: string }
  sitemap: { indexUrl: string; urlTotal: number; segments: SegmentInfo[] }
  validation: ValidationReport
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

export function SeoSection() {
  const [status, setStatus] = useState<SeoStatusDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [robotsPreview, setRobotsPreview] = useState<string | null>(null)
  const [indexPreview, setIndexPreview] = useState<string | null>(null)
  const [segmentKey, setSegmentKey] = useState<string>('')
  const [segmentPreview, setSegmentPreview] = useState<string | null>(null)
  const [segmentLoading, setSegmentLoading] = useState(false)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/seo/status', { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<SeoStatusDto>
      if (payload.status === 'ok' && payload.data) {
        setStatus(payload.data)
        // The standard crawler locations (next.config rewrites → the seo API).
        const [robots, index] = await Promise.all([
          fetch('/robots.txt', { cache: 'no-store' }).then((r) => r.text()),
          fetch('/sitemap.xml', { cache: 'no-store' }).then((r) => r.text()),
        ])
        setRobotsPreview(robots)
        setIndexPreview(index)
      } else {
        setError(payload.error?.message ?? 'Could not load the SEO status')
      }
    } catch {
      setError('Could not reach the SEO service')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  // The selected segment's XML preview.
  const fetchSegment = useCallback(async (key: string) => {
    if (!key) {
      setSegmentPreview(null)
      return
    }
    const [country, language, type] = key.split(':')
    setSegmentLoading(true)
    try {
      const response = await fetch(
        `/api/seo/sitemap?country=${country}&language=${language}&type=${type}`,
        { cache: 'no-store' }
      )
      setSegmentPreview(response.ok ? await response.text() : `HTTP ${response.status}`)
    } catch {
      setSegmentPreview('Could not reach the sitemap segment')
    } finally {
      setSegmentLoading(false)
    }
  }, [])

  const validation = status?.validation

  return (
    <Card id="seo" className="scroll-mt-24 border-zinc-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          SEO infrastructure — canonical URLs, structured data &amp; validation
          <Badge
            variant="outline"
            className="ml-1 border-emerald-200 bg-emerald-50 font-mono text-[10px] font-normal text-emerald-700"
          >
            P4-S4 · P4-S5
          </Badge>
        </CardTitle>
        <CardDescription>
          The §16 layer: the segmented XML sitemap (country × language × content type), the
          robots rules (admin/editor/private namespaces disallowed), the hreflang clusters and
          per-view document head, the schema.org structured data on every public composition,
          and the validation report that polices all of it. Served at{' '}
          <span className="font-mono text-[11px]">/sitemap.xml</span> and{' '}
          <span className="font-mono text-[11px]">/robots.txt</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading SEO status">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <p className="text-[11px] text-zinc-400">
              Composing the validation samples (7 live surfaces + the sitemap inventory)…
            </p>
          </div>
        ) : error || !status ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error ?? 'SEO status unavailable'}
          </div>
        ) : (
          <>
            {/* ---------- Validation summary ---------- */}
            {validation && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Validation passed
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-800">
                    {validation.passed}
                  </p>
                  <p className="text-[11px] text-emerald-700/80">
                    of {validation.checks.length} checks
                  </p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    validation.failed > 0
                      ? 'border-red-200 bg-red-50/60'
                      : 'border-zinc-200 bg-white'
                  }`}
                >
                  <p
                    className={`flex items-center gap-1.5 text-xs font-medium ${
                      validation.failed > 0 ? 'text-red-700' : 'text-zinc-500'
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Failures
                  </p>
                  <p
                    className={`mt-1 text-2xl font-semibold tabular-nums ${
                      validation.failed > 0 ? 'text-red-700' : 'text-zinc-900'
                    }`}
                  >
                    {validation.failed}
                  </p>
                  <p className="text-[11px] text-zinc-500">any failure is a ship blocker</p>
                </div>
                <div
                  className={`rounded-lg border p-3 ${
                    validation.warnings > 0
                      ? 'border-amber-200 bg-amber-50/60'
                      : 'border-zinc-200 bg-white'
                  }`}
                >
                  <p
                    className={`flex items-center gap-1.5 text-xs font-medium ${
                      validation.warnings > 0 ? 'text-amber-700' : 'text-zinc-500'
                    }`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    Warnings
                  </p>
                  <p
                    className={`mt-1 text-2xl font-semibold tabular-nums ${
                      validation.warnings > 0 ? 'text-amber-700' : 'text-zinc-900'
                    }`}
                  >
                    {validation.warnings}
                  </p>
                  <p className="text-[11px] text-zinc-500">checks that couldn&apos;t sample</p>
                </div>
              </div>
            )}

            {/* ---------- Validation checks table ---------- */}
            {validation && (
              <div className="overflow-hidden rounded-lg border border-zinc-200">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Check</th>
                        <th scope="col" className="px-3 py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 bg-white">
                      {validation.checks.map((check) => {
                        const Icon = CHECK_ICON[check.status]
                        return (
                          <tr key={check.id} className="align-top hover:bg-zinc-50">
                            <td className="px-3 py-2">
                              <p className="font-mono text-[11px] font-medium text-zinc-800">
                                {check.id}
                              </p>
                              <p className="mt-0.5 text-zinc-600">{check.label}</p>
                              {check.failures.length > 0 && (
                                <ul className="mt-1 list-inside list-disc text-[10px] text-red-600">
                                  {check.failures.map((failure) => (
                                    <li key={failure} className="font-mono">
                                      {failure.length > 90 ? `${failure.slice(0, 90)}…` : failure}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            <td className="w-24 px-3 py-2">
                              <span
                                className={`flex items-center gap-1.5 font-medium ${CHECK_STYLE[check.status]}`}
                              >
                                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                {check.status}
                              </span>
                              <p className="mt-0.5 text-[10px] tabular-nums text-zinc-500">
                                {check.checked} checked
                              </p>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ---------- Structured-data surfaces (the sampled §16 graphs) ---------- */}
            {validation && validation.surfaces.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <Braces className="h-3.5 w-3.5" aria-hidden="true" />
                  Structured data — the live composition samples (JSON-LD per view)
                </p>
                <div className="overflow-hidden rounded-lg border border-zinc-200">
                  <div className="max-h-56 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">Surface</th>
                          <th scope="col" className="px-3 py-2 font-medium">Locale</th>
                          <th scope="col" className="px-3 py-2 font-medium">§16 path</th>
                          <th scope="col" className="px-3 py-2 font-medium">Graph nodes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 bg-white">
                        {validation.surfaces.map((surface) => (
                          <tr key={`${surface.surface}:${surface.country}:${surface.language}`} className="hover:bg-zinc-50">
                            <td className="px-3 py-1.5 font-medium capitalize text-zinc-800">
                              {surface.surface}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-zinc-600">
                              {surface.country}/{surface.language}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[10px] text-zinc-600">
                              {surface.path}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className="font-mono text-[10px] text-emerald-700">
                                {surface.nodeTypes.join(' + ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ---------- Census ---------- */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <Map className="h-3.5 w-3.5" aria-hidden="true" />
                  Sitemap URLs
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">
                  {status.sitemap.urlTotal}
                </p>
                <p className="text-[11px] text-zinc-500">
                  across {status.sitemap.segments.length} segments
                </p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Robots disallow
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">
                  {status.robots.disallow.length}
                </p>
                <p className="text-[11px] text-zinc-500">private namespaces, §16</p>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  Origin
                </p>
                <p
                  className="mt-1 truncate font-mono text-xs font-medium text-zinc-900"
                  title={status.origin}
                >
                  {status.origin}
                </p>
                <p className="text-[11px] text-zinc-500">
                  request-derived (or GLOBIQ_PUBLIC_BASE_URL)
                </p>
              </div>
            </div>

            {/* ---------- Segment table ---------- */}
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Country</th>
                      <th scope="col" className="px-3 py-2 font-medium">Language</th>
                      <th scope="col" className="px-3 py-2 font-medium">Type</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">URLs</th>
                      <th scope="col" className="px-3 py-2 font-medium">Lastmod</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 bg-white">
                    {status.sitemap.segments.map((segment) => (
                      <tr
                        key={`${segment.country}:${segment.language}:${segment.type}`}
                        className="hover:bg-zinc-50"
                      >
                        <td className="px-3 py-1.5 font-mono font-medium text-zinc-800">
                          {segment.country}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-zinc-600">{segment.language}</td>
                        <td className="px-3 py-1.5 text-zinc-700">{segment.type}</td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums text-zinc-900">
                          {segment.urlCount}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-zinc-500">
                          {segment.lastModified ? segment.lastModified.slice(0, 10) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ---------- Segment XML preview ---------- */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <FileCode2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                <Select
                  value={segmentKey}
                  onValueChange={(key) => {
                    setSegmentKey(key)
                    void fetchSegment(key)
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-[280px] border-zinc-200 bg-white font-mono text-xs"
                    aria-label="Pick a sitemap segment to preview"
                  >
                    <SelectValue placeholder="Pick a segment to preview its XML" />
                  </SelectTrigger>
                  <SelectContent>
                    {status.sitemap.segments.map((segment) => (
                      <SelectItem
                        key={`${segment.country}:${segment.language}:${segment.type}`}
                        value={`${segment.country}:${segment.language}:${segment.type}`}
                        className="font-mono text-xs"
                      >
                        {segment.country} · {segment.language} · {segment.type} ({segment.urlCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {segmentLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" aria-hidden="true" />
                )}
              </div>
              {segmentPreview && (
                <pre className="max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-emerald-300">
                  {segmentPreview.split('\n').slice(0, 40).join('\n')}
                </pre>
              )}
            </div>

            {/* ---------- robots.txt preview ---------- */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                /robots.txt (live)
              </p>
              <pre className="max-h-44 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-emerald-300">
                {robotsPreview ?? '—'}
              </pre>
            </div>

            {/* ---------- sitemap index head preview ---------- */}
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Map className="h-3.5 w-3.5" aria-hidden="true" />
                /sitemap.xml — index head (live)
              </p>
              <pre className="max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-3 font-mono text-[10px] leading-relaxed text-emerald-300">
                {(indexPreview ?? '—').split('\n').slice(0, 16).join('\n')}
              </pre>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="max-w-xl text-[11px] leading-relaxed text-zinc-500">
                The §16 entries are the production path routes; this dev shell serves the SPA at{' '}
                <span className="font-mono">/</span> with the hash mirror (the documented P4-S2
                constraint) — the per-view head ships canonical, hreflang, Open Graph and JSON-LD
                regardless. The validation samples live compositions on every refresh (slow on the
                cloud DB — the census is worth it).
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-2 border-zinc-200 bg-white"
                onClick={() => void fetchStatus()}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Refresh
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
