'use client'

/**
 * GlobIQ — Analytics section (P8-S4 + P8-S5 — the complete §32 table)
 *
 * The console's §32 surface in two reads over one shared window:
 * the six product families (P8-S4 — Discovery, Relevance, Learning,
 * Retention, Content, Sharing) and the three P8-S5 families (Editorial,
 * SEO, Growth/referral) — completing the §32 metric-family table. Every
 * metric carries its derivation (§9 explainability) and every family
 * states its honest gaps — what is deliberately not measured and why.
 *
 * §32's rule shapes the card: "Measure whether the product solves relevance,
 * not merely pageviews" — there is no pageview counter anywhere; every
 * metric is an intent-bearing action or an engine-side observation.
 * ADMIN-only platform surface (§38): the per-country workspace split applies
 * to editorial working surfaces like the feedback queue; search, learning,
 * retention, the sitemap census and the arrival mix are cross-market by
 * nature.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BarChart3,
  Eye,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  InsightsAnalytics,
  ProductAnalytics,
  AnalyticsFamily,
  AnalyticsWindowDays,
} from '@/modules/analytics'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

const WINDOW_OPTIONS: Array<{ days: AnalyticsWindowDays; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 'all', label: 'All time' },
]

const FAMILY_ICONS: Record<string, string> = {
  discovery: '🔍',
  relevance: '🎯',
  learning: '📘',
  retention: '🔁',
  content: '🛡️',
  sharing: '🔗',
  editorial: '✏️',
  seo: '📈',
  growth: '🌱',
}

function formatValue(metric: AnalyticsFamily['metrics'][number]): string {
  if (metric.unit === 'percent') return `${metric.value}%`
  if (metric.unit === 'minutes') {
    return typeof metric.value === 'number' ? `${metric.value} min` : String(metric.value)
  }
  return String(metric.value)
}

/** One family card — shared verbatim by both reads (the generic renderer). */
function FamilyCard({ family }: { family: AnalyticsFamily }) {
  return (
    <Card className="border-zinc-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span aria-hidden="true">{FAMILY_ICONS[family.key] ?? '•'}</span>
          {family.label}
        </CardTitle>
        <CardDescription className="text-xs">
          §32 examples: {family.specExamples.join(' · ')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-3">
          {family.metrics.map((metric) => (
            <div key={metric.key} className="rounded-lg border border-zinc-100 bg-white p-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm font-medium text-zinc-900">{metric.label}</dt>
                <dd className="font-mono text-sm font-semibold text-emerald-700">
                  {formatValue(metric)}
                </dd>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                {metric.derivation}
              </p>
            </div>
          ))}
        </dl>
        {family.pending.length > 0 && (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Honest gaps
            </p>
            <ul className="mt-2 space-y-2">
              {family.pending.map((item) => (
                <li key={item.key} className="flex gap-2 text-xs leading-relaxed text-zinc-600">
                  <Eye className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400" aria-hidden="true" />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AnalyticsSection() {
  const { token, user, permissions } = useAuth()
  const { toast } = useToast()

  const canRead = permissions.includes('analytics:read') && user?.status === 'ACTIVE'

  const [product, setProduct] = useState<ProductAnalytics | null>(null)
  const [insights, setInsights] = useState<InsightsAnalytics | null>(null)
  const [days, setDays] = useState<AnalyticsWindowDays>(30)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (window: AnalyticsWindowDays) => {
      if (!token || loading) return
      setLoading(true)
      try {
        // Both §32 reads over the one window (product families + the
        // editorial/SEO/growth families).
        const [productResponse, insightsResponse] = await Promise.all([
          fetch(`/api/analytics/product?days=${window}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch(`/api/analytics/insights?days=${window}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
        ])
        const productPayload = (await productResponse.json()) as Envelope<ProductAnalytics>
        const insightsPayload = (await insightsResponse.json()) as Envelope<InsightsAnalytics>
        if (productPayload.status === 'ok' && productPayload.data) {
          setProduct(productPayload.data)
        } else {
          toast({
            title: 'Could not load the product analytics',
            description: productPayload.error?.message ?? 'Please retry.',
            variant: 'destructive',
          })
        }
        if (insightsPayload.status === 'ok' && insightsPayload.data) {
          setInsights(insightsPayload.data)
        } else {
          toast({
            title: 'Could not load the editorial/SEO/growth analytics',
            description: insightsPayload.error?.message ?? 'Please retry.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [token, loading, toast]
  )

  useEffect(() => {
    if (canRead && token && !product) void load(days)
  }, [canRead, token, product, days, load])

  if (!canRead) {
    return (
      <section aria-labelledby="analytics-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="analytics-heading" className="text-xl font-semibold tracking-tight">
            Analytics — §32
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            P8-S4/S5
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-zinc-600">
          The complete §32 table — six product families (discovery, relevance, learning, retention,
          content, sharing) plus the editorial, SEO and growth/referral families — measured as
          intent-bearing actions, never raw pageviews. A platform surface (analytics:read, ADMIN):
          the §38 workspace split applies to editorial working surfaces like the feedback queue.
          This account does not hold it.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="analytics-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="analytics-heading" className="text-xl font-semibold tracking-tight">
          Analytics — §32
        </h2>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          P8-S4 + P8-S5
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Measure whether the product solves{' '}
        <strong className="text-zinc-900">relevance</strong>, not merely pageviews — the complete
        §32 table: the six product families (P8-S4) and the editorial, SEO and growth/referral
        families (P8-S5) over the stores the producing modules write (§28). Every metric carries
        its derivation; every family states its honest gaps.
      </p>

      {/* ---------- Window controls (both reads share one window) ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap gap-1 rounded-lg border border-zinc-200 bg-white p-1"
          role="group"
          aria-label="Analytics window"
        >
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={String(option.days)}
              type="button"
              onClick={() => {
                setDays(option.days)
                void load(option.days)
              }}
              aria-pressed={days === option.days}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                days === option.days
                  ? 'bg-zinc-900 text-white'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
          onClick={() => void load(days)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
        {product && (
          <span className="text-xs text-zinc-500">
            Window: {product.window.label}
            {product.window.since ? ` (since ${product.window.since.slice(0, 10)})` : ''}
          </span>
        )}
      </div>

      {/* ---------- The §32 pageview warning ---------- */}
      {product && (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-900">{product.principle}</p>
            <p className="text-xs leading-relaxed text-amber-800">{product.pageviewWarning}</p>
          </div>
        </div>
      )}

      {/* ---------- The six product family cards (P8-S4) ---------- */}
      {product && (
        <div className="grid gap-4 lg:grid-cols-2">
          {product.families.map((family) => (
            <FamilyCard key={family.key} family={family} />
          ))}
        </div>
      )}

      {/* ---------- The three P8-S5 families — editorial · SEO · growth ---------- */}
      {insights && (
        <div className="space-y-4">
          <h3 className="flex items-center gap-2 pt-2 text-lg font-semibold tracking-tight">
            Editorial · SEO · Growth — the P8-S5 families
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              P8-S5
            </Badge>
          </h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {insights.families.map((family) => (
              <FamilyCard key={family.key} family={family} />
            ))}
            {/* §32's table is complete — the honest completion note */}
            <Card className="border-emerald-200 bg-emerald-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">§32&apos;s table is complete</CardTitle>
                <CardDescription className="text-xs">
                  Eight families in the spec · nine delivered (growth rides with Discovery&apos;s
                  &ldquo;organic landing engagement&rdquo;).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs leading-relaxed text-zinc-600">
                  The spec&apos;s own remaining notes, kept honest: the product half states that
                  its Editorial/SEO/growth reads now live here (P8-S5); the growth family states
                  that per-arrival engagement attribution is deliberately not built (§31) — the
                  intent-bearing actions of the product families measure engagement without it.
                </p>
                <p className="font-mono text-[11px] leading-relaxed text-zinc-500">
                  {insights.productApi}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ---------- §28 ownership + the API contracts ---------- */}
      {product && insights && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-zinc-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Ownership (§28)
              </CardTitle>
              <CardDescription className="text-xs">
                This module owns no data — it only reads.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {product.sources.map((source) => (
                  <li key={source} className="font-mono text-[11px] leading-relaxed text-zinc-500">
                    {source}
                  </li>
                ))}
                <li className="pt-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                    P8-S5 families
                  </span>
                </li>
                {insights.sources.map((source) => (
                  <li key={source} className="font-mono text-[11px] leading-relaxed text-zinc-500">
                    {source}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="border-zinc-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">The API contracts (§37)</CardTitle>
              <CardDescription className="text-xs">
                Typed errors · aggregate-only reads · ADMIN (analytics:read).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 font-mono text-[11px] leading-relaxed text-zinc-500">
              <p>GET /api/analytics/product?days=7|30|90|all — the six product families</p>
              <p>
                GET /api/analytics/insights?days=7|30|90|all — editorial · SEO · growth/referral
              </p>
              <p>POST /api/seo/landings — the public anonymous arrival beacon (no identity)</p>
              <p>
                POST /api/seo/observations — the engine-side import (seo:ingest, census-guarded)
              </p>
              <p className="border-t border-zinc-100 pt-2 text-zinc-400">
                §31: never a per-user row across any analytics boundary — SearchQueryLog and
                LandingEvent are anonymous-only by design.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  )
}
