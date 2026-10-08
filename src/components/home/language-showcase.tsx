'use client'

/**
 * SITE-S25: Multi-language content showcase strip.
 *
 * Renders a horizontal strip of language chips, each showing the language's
 * native name + question count, fetched from GET /api/content-stats.
 *
 * Clicking a chip switches the app's preferred language (via the same
 * onSwitchLanguage callback the header's language switcher uses).
 */
import { useEffect, useState } from 'react'
import { Globe2, Loader2 } from 'lucide-react'

interface LanguageStat {
  code: string
  name: string
  nativeName: string | null
  direction: string
  questionCount: number
}

interface ContentStatsResponse {
  totalQuestions: number
  languagesWithContent: number
  languages: LanguageStat[]
}

export function LanguageShowcase({
  currentLanguage,
  onSwitchLanguage,
}: {
  currentLanguage?: string
  onSwitchLanguage?: (code: string) => void
}) {
  const [stats, setStats] = useState<ContentStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/content-stats?country=IN')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data?.data) {
          setStats(data.data as ContentStatsResponse)
        }
      })
      .catch(() => {
        // silent — the strip is non-critical
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        <span>Loading languages…</span>
      </div>
    )
  }

  if (!stats || stats.languagesWithContent === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
        <Globe2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        <span>{stats.totalQuestions.toLocaleString('en-IN')} questions in {stats.languagesWithContent} languages</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {stats.languages
          .filter((l) => l.questionCount > 0)
          .map((l) => {
            const isActive = currentLanguage === l.code
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => onSwitchLanguage?.(l.code)}
                className={`group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
                  isActive
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700'
                }`}
                aria-pressed={isActive}
                aria-label={`Switch to ${l.name}`}
              >
                <span className={isActive ? 'text-emerald-700' : 'text-zinc-700'}>
                  {l.nativeName ?? l.name}
                </span>
                <span className={`text-[10px] tabular-nums ${isActive ? 'text-emerald-500' : 'text-zinc-400'}`}>
                  {l.questionCount >= 1000 ? `${(l.questionCount / 1000).toFixed(1)}k` : l.questionCount}
                </span>
              </button>
            )
          })}
      </div>
    </div>
  )
}
