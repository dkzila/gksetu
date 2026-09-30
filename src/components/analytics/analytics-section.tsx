'use client'

/**
 * GlobIQ — Product analytics section (P8-S4)
 *
 * The console's §32 surface: the six product families (Discovery, Relevance,
 * Learning, Retention, Content, Sharing) as one aggregate read over the
 * stores the producing modules write (§28 ownership stated on the card).
 * Every metric carries its derivation (§9 explainability) and every family
 * states its honest gaps — what is deliberately not measured and when it
 * lands (P8-S5 for editorial/SEO/growth-referral, stated on every response).
 *
 * §32's rule shapes the card: "Measure whether the product solves relevance,
 * not merely pageviews" — there is no pageview counter anywhere; every metric
 * is an intent-bearing action. ADMIN-only platform surface (§38): the
 * per-country workspace split applies to editorial surfaces like the
 * feedback queue; search/learning/retention are cross-market by nature.
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
import type { ProductAnalytics, AnalyticsWindowDays } from '@/modules/analytics'

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
}

function formatValue(analytics: ProductAnalytics, familyKey: string, metricKey: string): string {
  const family = analytics.families.find((family) => family.key === familyKey)
  const metric = family?.metrics.find((metric) => metric.key === metricKey)
  if (!metric) return '—'
  if (metric.unit === 'percent') return `${metric.value}%`
  if (metric.unit === 'minutes') {
    return typeof metric.value === 'number' ? `${metric.value} min` : String(metric.value)
  }
  return String(metric.value)
}

export function AnalyticsSection() {
  const { token, user, permissions } = useAuth()
  const { toast } = useToast()

  const canRead = permissions.includes('analytics:read') && user?.status === 'ACTIVE'

  const [analytics, setAnalytics] = useState<ProductAnalytics | null>(null)
  const [days, setDays] = useState<AnalyticsWindowDays>(30)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (window: AnalyticsWindowDays) => {
      if (!token || loading) return
      setLoading(true)
      try {
        const response = await fetch(`/api/analytics/product?days=${window}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<ProductAnalytics>
        if (payload.status === 'ok' && payload.data) {
          setAnalytics(payload.data)
        } else {
          toast({
            title: 'Could not load the product analytics',
            description: payload.error?.message ?? 'Please retry.',
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
    if (canRead && token && !analytics) void load(days)
  }, [canRead, token, analytics, days, load])

  if (!canRead) {
    return (
      <section aria-labelledby="analytics-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="analytics-heading" className="text-xl font-semibold tracking-tight">
            Product analytics — §32
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            P8-S4
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-zinc-600">
          The six §32 product families — discovery, relevance, learning, retention, content,
          sharing — measured as intent-bearing actions, never raw pageviews. A platform surface
          (analytics:read, ADMIN): the §38 workspace split applies to editorial surfaces like the
          feedback queue; search, learning and retention are cross-market by nature. This account
          does not hold it.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="analytics-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="analytics-heading" className="text-xl font-semibold tracking-tight">
          Product analytics — §32
        </h2>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          P8-S4
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Measure whether the product solves{' '}
        <strong className="text-zinc-900">relevance</strong>, not merely pageviews — the six
        product families over the stores the producing modules write (§28). Every metric carries
        its derivation; every family states its honest gaps.
      </p>

      {/* ---------- Window controls ---------- */}
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
        {analytics && (
          <span className="text-xs text-zinc-500">
            Window: {analytics.window.label}
            {analytics.window.since ? ` (since ${analytics.window.since.slice(0, 10)})` : ''}
          </span>
        )}
      </div>

      {/* ---------- The §32 pageview warning ---------- */}
      {analytics && (
        <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-900">{analytics.principle}</p>
            <p className="text-xs leading-relaxed text-amber-800">{analytics.pageviewWarning}</p>
          </div>
        </div>
      )}

      {/* ---------- The six family cards ---------- */}
      {analytics && (
        <div className="grid gap-4 lg:grid-cols-2">
          {analytics.families.map((family) => (
            <Card key={family.key} className="border-zinc-200">
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
                          {formatValue(analytics, family.key, metric.key)}
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
          ))}
        </div>
      )}

      {/* ---------- P8-S5 upcoming + §28 ownership + the API contract ---------- */}
      {analytics && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-zinc-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lands in P8-S5</CardTitle>
              <CardDescription className="text-xs">
                Stated on every response — never silently omitted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-xs leading-relaxed text-zinc-600">
                <li>
                  <strong className="text-zinc-900">Editorial</strong> — {analytics.upcoming.editorial}
                </li>
                <li>
                  <strong className="text-zinc-900">SEO</strong> — {analytics.upcoming.seo}
                </li>
                <li>
                  <strong className="text-zinc-900">Growth / referral</strong> —{' '}
                  {analytics.upcoming.growthReferral}
                </li>
              </ul>
            </CardContent>
          </Card>
          <Card className="border-zinc-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Ownership &amp; contract
              </CardTitle>
              <CardDescription className="text-xs">
                §28: this module owns no data — it only reads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-1.5">
                {analytics.sources.map((source) => (
                  <li key={source} className="font-mono text-[11px] leading-relaxed text-zinc-500">
                    {source}
                  </li>
                ))}
              </ul>
              <p className="border-t border-zinc-100 pt-3 font-mono text-[11px] leading-relaxed text-zinc-500">
                GET /api/analytics/product?days=7|30|90|all — ADMIN (analytics:read, §37 typed
                errors, aggregate-only reads: §31 — never a per-user row)
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </section>
  )
}
