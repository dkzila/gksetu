'use client'

/**
 * GKSetu Console — Analytics (CONSOLE-S1-A).
 *
 * The §32 surface in two reads over one shared window: the six product
 * families (GET /api/analytics/product) and the editorial · SEO · growth
 * families (GET /api/analytics/insights). Summary cards surface the headline
 * metrics; every family renders as a compact table with its derivation (§9
 * explainability) and its honest gaps. Window params: days=7|30|90|all.
 */
import { useEffect, useState } from 'react'
import {
  BookOpen,
  ChartColumn,
  Eye,
  Info,
  Loader2,
  PenLine,
  RefreshCw,
  Repeat,
  Search,
  Share2,
  ShieldCheck,
  Sprout,
  Target,
  TrendingUp,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { ConsolePageHeader, ErrorNotice } from '@/components/console/ui/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type {
  AnalyticsFamily,
  AnalyticsMetric,
  AnalyticsWindowDays,
  InsightsAnalytics,
  ProductAnalytics,
} from '@/modules/analytics'

// ---------- Local contracts (fresh, self-contained — the demo section's logic adapted) ----------

type WindowOption = { days: AnalyticsWindowDays; label: string }

const WINDOW_OPTIONS: WindowOption[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 'all', label: 'All time' },
]

const FAMILY_ICONS: Record<string, LucideIcon> = {
  discovery: Search,
  relevance: Target,
  learning: BookOpen,
  retention: Repeat,
  content: ShieldCheck,
  sharing: Share2,
  editorial: PenLine,
  seo: TrendingUp,
  growth: Sprout,
}

function formatMetricValue(metric: AnalyticsMetric): string {
  if (metric.unit === 'percent') return `${metric.value}%`
  if (metric.unit === 'minutes') {
    return typeof metric.value === 'number' ? `${metric.value.toLocaleString()} min` : String(metric.value)
  }
  if (metric.unit === 'count' && typeof metric.value === 'number') return metric.value.toLocaleString()
  return String(metric.value)
}

function findMetric(families: AnalyticsFamily[] | undefined, key: string): AnalyticsMetric | undefined {
  return families?.flatMap((family) => family.metrics).find((metric) => metric.key === key)
}

/** The headline cards — the six §32 numbers worth seeing first. */
function buildSummaryCards(
  product: ProductAnalytics | null,
  insights: InsightsAnalytics | null
): Array<{ label: string; metric: AnalyticsMetric | undefined }> {
  return [
    { label: 'Search queries', metric: findMetric(product?.families, 'searchQueries') },
    { label: 'Search success rate', metric: findMetric(product?.families, 'searchSuccessRate') },
    { label: 'Attempt completion', metric: findMetric(product?.families, 'completionRate') },
    { label: 'Share actions', metric: findMetric(product?.families, 'shareActions') },
    { label: 'Landing arrivals', metric: findMetric(insights?.families, 'arrivals') },
    { label: 'Indexed pages', metric: findMetric(insights?.families, 'indexedPages') },
  ]
}

// ---------- One family: header + compact metric table + honest gaps ----------

function FamilySection({ family }: { family: AnalyticsFamily }) {
  const Icon = FAMILY_ICONS[family.key] ?? ChartColumn
  return (
    <section
      aria-labelledby={`family-${family.key}`}
      className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 rounded-md bg-emerald-600/10 p-1.5 text-emerald-700">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 id={`family-${family.key}`} className="text-sm font-semibold text-zinc-900">
              {family.label}
            </h3>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-zinc-400">
              {family.specExamples.join(' · ')}
            </p>
          </div>
        </div>
        <Badge variant="outline" className="border-zinc-200 px-2 py-0 font-mono text-[10px] text-zinc-400">
          {family.key}
        </Badge>
      </div>

      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{family.label} metrics</caption>
        <thead>
          <tr className="border-b border-zinc-100">
            <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Metric
            </th>
            <th scope="col" className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Value
            </th>
            <th scope="col" className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Derivation
            </th>
          </tr>
        </thead>
        <tbody>
          {family.metrics.map((metric) => (
            <tr key={metric.key} className="border-b border-zinc-50 last:border-0 hover:bg-emerald-50/20">
              <th scope="row" className="px-4 py-2.5 text-[13px] font-medium text-zinc-700">
                {metric.label}
              </th>
              <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[13px] font-semibold text-emerald-700">
                {formatMetricValue(metric)}
              </td>
              <td className="px-4 py-2.5 text-xs leading-relaxed text-zinc-400">{metric.derivation}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {family.pending.length > 0 && (
        <div className="border-t border-dashed border-zinc-200 bg-zinc-50/50 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Honest gaps</p>
          <ul className="mt-1.5 space-y-1">
            {family.pending.map((item) => (
              <li key={item.key} className="flex gap-2 text-xs leading-relaxed text-zinc-500">
                <Eye className="mt-0.5 h-3 w-3 shrink-0 text-zinc-300" aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ---------- The page ----------

export function AnalyticsPage() {
  const canRead = useHasPermission('analytics:read')
  const api = useConsoleApi()
  const [days, setDays] = useState<AnalyticsWindowDays>(30)
  const [product, setProduct] = useState<ProductAnalytics | null>(null)
  const [insights, setInsights] = useState<InsightsAnalytics | null>(null)
  const [productError, setProductError] = useState<string | null>(null)
  const [insightsError, setInsightsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      const query = `days=${days}`
      const [productResult, insightsResult] = await Promise.all([
        api.get<ProductAnalytics>(`/api/analytics/product?${query}`),
        api.get<InsightsAnalytics>(`/api/analytics/insights?${query}`),
      ])
      if (cancelled) return
      setProduct(productResult.data)
      setProductError(productResult.data ? null : (productResult.error?.message ?? 'Could not load the product analytics'))
      setInsights(insightsResult.data)
      setInsightsError(insightsResult.data ? null : (insightsResult.error?.message ?? 'Could not load the editorial/SEO/growth analytics'))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [canRead, days, reloadKey])

  if (!canRead) {
    return (
      <div className="space-y-6">
        <ConsolePageHeader
          title="Analytics"
          description="The §32 product families — growth, engagement, study, assessment, share, search."
          icon={<ChartColumn className="h-4 w-4" />}
        />
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
          <Info className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          You may not have access to the analytics surface (requires analytics:read).
        </div>
      </div>
    )
  }

  const summaryCards = buildSummaryCards(product, insights)
  const windowLabel = product?.window.label ?? insights?.window.label
  const windowSince = (product ?? insights)?.window.since

  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Analytics"
        description="Measure whether the product solves relevance, not merely pageviews — every metric is an intent-bearing action with its derivation stated."
        icon={<ChartColumn className="h-4 w-4" />}
        actions={
          <>
            <div
              className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm"
              role="group"
              aria-label="Analytics window"
            >
              {WINDOW_OPTIONS.map((option) => (
                <button
                  key={String(option.days)}
                  type="button"
                  onClick={() => setDays(option.days)}
                  aria-pressed={days === option.days}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    days === option.days
                      ? 'bg-emerald-600 text-white'
                      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
              onClick={() => setReloadKey((key) => key + 1)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Refresh
            </Button>
          </>
        }
      />

      {/* Summary stat cards — the headline metrics of both reads */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {summaryCards.map(({ label, metric }) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-[13px] font-medium text-zinc-500">{label}</p>
            {loading && !metric ? (
              <div className="mt-2 space-y-2">
                <Skeleton className="h-7 w-16" />
                <Skeleton className="h-3 w-full" />
              </div>
            ) : metric ? (
              <>
                <p className="mt-1 font-mono text-xl font-semibold tabular-nums tracking-tight text-zinc-900">
                  {formatMetricValue(metric)}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400" title={metric.derivation}>
                  {metric.derivation}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-zinc-400">—</p>
            )}
          </div>
        ))}
      </div>

      {/* §32 principle callout + window stamp */}
      {product && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-amber-900">{product.principle}</p>
              <p className="max-w-3xl text-xs leading-relaxed text-amber-800">{product.pageviewWarning}</p>
            </div>
          </div>
          <p className="shrink-0 text-xs text-amber-700">
            Window: {windowLabel}
            {windowSince ? ` · since ${windowSince.slice(0, 10)}` : ''}
          </p>
        </div>
      )}

      {/* Errors — each half fails independently */}
      {productError && !loading && <ErrorNotice message={productError} onRetry={() => setReloadKey((key) => key + 1)} />}
      {insightsError && !loading && <ErrorNotice message={insightsError} onRetry={() => setReloadKey((key) => key + 1)} />}

      {/* Loading skeletons for the family sections */}
      {loading && !product && !insights && (
        <div className="space-y-4" role="status" aria-label="Loading analytics">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-56 w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* The six product families */}
      {product && product.families.length > 0 && (
        <section aria-labelledby="product-families-heading" className="space-y-4">
          <h2 id="product-families-heading" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-900">
            Product families
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2 py-0 text-[10px] text-emerald-700">
              §32 · six families
            </Badge>
          </h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {product.families.map((family) => (
              <FamilySection key={family.key} family={family} />
            ))}
          </div>
        </section>
      )}

      {/* The P8-S5 families — editorial · SEO · growth */}
      {insights && insights.families.length > 0 && (
        <section aria-labelledby="insights-families-heading" className="space-y-4">
          <h2 id="insights-families-heading" className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-900">
            Editorial · SEO · Growth
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2 py-0 text-[10px] text-emerald-700">
              §32 · completing the table
            </Badge>
          </h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {insights.families.map((family) => (
              <FamilySection key={family.key} family={family} />
            ))}
          </div>
        </section>
      )}

      {/* Ownership + API contracts — the honest footer */}
      {product && insights && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-labelledby="ownership-heading" className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 id="ownership-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              <ShieldCheck className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              Ownership (§28)
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              This module owns no data — it only reads the stores the producing modules write.
            </p>
            <ul className="mt-2 space-y-1">
              {[...product.sources, ...insights.sources].map((source) => (
                <li key={source} className="font-mono text-[11px] leading-relaxed text-zinc-500">
                  {source}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="contracts-heading" className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 id="contracts-heading" className="text-sm font-semibold text-zinc-900">
              The API contracts (§37)
            </h2>
            <p className="mt-1 text-xs text-zinc-400">Typed errors · aggregate-only reads · ADMIN (analytics:read).</p>
            <div className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-zinc-500">
              <p>GET /api/analytics/product?days=7|30|90|all — the six product families</p>
              <p>GET /api/analytics/insights?days=7|30|90|all — editorial · SEO · growth/referral</p>
              <p className="border-t border-zinc-100 pt-2 text-zinc-400">
                §31: never a per-user row across any analytics boundary.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
