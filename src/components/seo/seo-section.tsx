'use client'

/**
 * GlobIQ — SEO infrastructure section (P4-S4)
 *
 * The §16 verification surface for the canonical-URL/hreflang/sitemap/robots
 * layer: the live robots.txt + sitemap index (fetched from their standard
 * crawler locations — the next.config rewrites), the segment census with URL
 * counts + lastmods (country × language × content type), a segment XML
 * preview, and the origin the absolute URLs resolve against. Every number on
 * this card is computed by the same services the public endpoints use — no
 * parallel truth.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bot,
  FileCode2,
  Globe,
  Loader2,
  Map,
  RefreshCw,
  Search,
  ShieldCheck,
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

interface SeoStatusDto {
  origin: string
  robots: { disallow: string[]; sitemapLine: string }
  sitemap: { indexUrl: string; urlTotal: number; segments: SegmentInfo[] }
}

// ---------- Component ----------

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

  return (
    <Card id="seo" className="scroll-mt-24 border-zinc-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          SEO infrastructure — canonical URLs, hreflang, sitemap &amp; robots
          <Badge
            variant="outline"
            className="ml-1 border-emerald-200 bg-emerald-50 font-mono text-[10px] font-normal text-emerald-700"
          >
            P4-S4
          </Badge>
        </CardTitle>
        <CardDescription>
          The §16 layer: the segmented XML sitemap (country × language × content type), the
          robots rules (admin/editor/private namespaces disallowed), the hreflang clusters on
          every public composition, and the per-view document head. Served at{' '}
          <span className="font-mono text-[11px]">/sitemap.xml</span> and{' '}
          <span className="font-mono text-[11px]">/robots.txt</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading SEO status">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
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
                constraint) — the per-view head wiring ships canonical + hreflang regardless.
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
