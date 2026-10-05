'use client'

/**
 * GKSetu — Exam Directory View (India exam corpus)
 *
 * The public /exams/ directory (§16 …/exams/ grammar, §38 public app): every
 * ACTIVE exam of the resolved market in one browsable surface — search, level
 * filters (National / State / Regional), and the full list at once. With the
 * India exam corpus published (135+ exams across UPSC, SSC, banking,
 * railways, defence, police, state PSCs, subordinate services, teaching,
 * law, insurance, regulators and management entrances — every one carrying a
 * real GK / Current Affairs syllabus), the homepage's eight-card section
 * needed a complete directory behind it.
 *
 * SITE-S4-C — the compact-hero standard the Current Affairs page set: tight
 * breadcrumb (text-xs, py-1), emerald hero band (icon tile + H1 + one-line
 * description, framer-motion fade on the hero only), the tightened search /
 * level-chip row, and cleaned cards — name, a subtle plain level chip, the
 * organiser line (the exam code folded in, no mono badge), and the current
 * syllabus line.
 *
 * SITE-S12 — jurisdiction-aware groups: when the resolved country has seeded
 * STATE jurisdictions AND the signed-in learner has a declared home state,
 * the directory shows "Your state ({Maharashtra})" + central + international
 * first as the primary bucket, and "Other states" as a collapsed secondary
 * section. Without a known state: the existing neutral National/State/Regional
 * level groups stay (the legacy `Exam.level` field, used as the honest
 * fallback when jurisdiction is null). Exam cards carry a subtle jurisdiction
 * chip ("Central" / "Maharashtra" / "International" / "Pune District") in
 * addition to the level chip.
 *
 * Country-scoped by design (§14): the list is the resolved market's own
 * exams; data comes from GET /api/exams (server-side scope enforcement — the
 * UI only renders server truth). The `?state=` query triggers the server's
 * relevance ordering; the client only renders the resulting primary/secondary
 * sections (no per-page bespoke logic — the bucket helper is the ONE primitive).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpenCheck,
  ChevronDown,
  GraduationCap,
  ListFilter,
  MapPin,
  RefreshCw,
  Rocket,
  Search,
} from 'lucide-react'

import { useSeoHead } from '@/components/home/seo-head'
import {
  bucketByJurisdiction,
  jurisdictionChipLabel,
  type ApiJurisdiction,
} from '@/components/home/jurisdiction'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/stores/auth'

// ---------- API envelope + DTO mirrors (§37 client-agnostic contract) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface DirectoryExam {
  id: string
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  description: string | null
  /** SITE-S12: the exam's jurisdiction projection (null when not backfilled). */
  jurisdiction: ApiJurisdiction | null
  currentVersion: { id: string; label: string } | null
  versionCount: number
  canonicalPath: string
}

interface DirectoryResult {
  exams: DirectoryExam[]
  pagination: { total: number }
  country: { isoCode: string; name: string }
}

// ---------- Presentation helpers ----------

const LEVEL_LABEL: Record<DirectoryExam['level'], string> = {
  NATIONAL: 'National',
  STATE: 'State',
  REGIONAL: 'Regional',
}

type LevelFilter = 'ALL' | 'NATIONAL' | 'STATE' | 'REGIONAL'

const PAGE_SIZE = 300 // the corpus fits in one request (API cap raised to 300)

// ---------- Section ----------

export interface ExamDirectoryViewProps {
  countryIso: string
  language: string
  onOpenExam: (slug: string) => void
  onGoHome: () => void
}

export function ExamDirectoryView({ countryIso, language, onOpenExam, onGoHome }: ExamDirectoryViewProps) {
  const [result, setResult] = useState<DirectoryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<LevelFilter>('ALL')

  // SITE-S12: the signed-in learner's declared home state — fetched once on
  // mount from /api/goal (anonymous users see the neutral level groups).
  const { token } = useAuth()
  const [ownStateCode, setOwnStateCode] = useState<string | null>(null)
  const [ownStateLabel, setOwnStateLabel] = useState<string | null>(null)

  useSeoHead({
    // SITE-S1 — the directory is real, indexable content (the user's SEO
    // ask): a meaningful, keyword-bearing title and description.
    title: 'Exams — Syllabus, GK & Current Affairs Coverage | GKSetu',
    description:
      'Browse every exam with a real General Knowledge & Current Affairs syllabus — UPSC, SSC, banking, railways, defence, police, state PSCs, teaching, law and more. See what to study for each exam.',
    language,
    countryIso,
  })

  // ---------- The learner's declared home state (one fetch, anonymous-safe) ----------

  useEffect(() => {
    if (!token) {
      setOwnStateCode(null)
      setOwnStateLabel(null)
      return
    }
    let cancelled = false
    void fetch('/api/goal', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ goal: { stateCode: string | null } | null }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data?.goal?.stateCode) {
          setOwnStateCode(payload.data.goal.stateCode)
        } else {
          setOwnStateCode(null)
        }
      })
      .catch(() => {
        if (!cancelled) setOwnStateCode(null)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // ---------- Directory load (market-scoped, once per country/language + state) ----------

  const fetchDirectory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ country: countryIso, language, pageSize: String(PAGE_SIZE) })
      // SITE-S12: when the learner has a declared state, the server-side `state=`
      // query applies the same bucket ordering (own state first, then central +
      // international, then other states). The state is the goal's stateCode —
      // never anything the URL leaks.
      if (ownStateCode) params.set('state', ownStateCode)
      const response = await fetch(`/api/exams?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<DirectoryResult>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
      } else {
        setResult(null)
        setError(payload.error?.message ?? 'Could not load the exam directory.')
      }
    } catch {
      setResult(null)
      setError('Network error — could not load the exam directory.')
    } finally {
      setLoading(false)
    }
  }, [countryIso, language, ownStateCode])

  useEffect(() => {
    void fetchDirectory()
  }, [fetchDirectory, reloadKey])

  // ---------- Client-side search + level filter ----------

  const exams = result?.exams ?? []

  const counts = useMemo(() => {
    const byLevel: Record<LevelFilter, number> = { ALL: exams.length, NATIONAL: 0, STATE: 0, REGIONAL: 0 }
    for (const exam of exams) byLevel[exam.level] += 1
    return byLevel
  }, [exams])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return exams.filter((exam) => {
      if (level !== 'ALL' && exam.level !== level) return false
      if (!needle) return true
      return (
        exam.name.toLowerCase().includes(needle) ||
        exam.code.toLowerCase().includes(needle) ||
        exam.organiser.toLowerCase().includes(needle)
      )
    })
  }, [exams, query, level])

  // SITE-S12: when the learner has a declared home state AND there is at least
  // one exam with a non-null jurisdiction in the visible set, render the
  // jurisdiction-aware primary/secondary bucket layout. The server already
  // pre-ordered by `state=`; the client helper just splits primary from
  // secondary (one truth — same logic as the server's bucketExamsByJurisdiction).
  const showJurisdictionGroups =
    query.trim() === '' && level === 'ALL' && Boolean(ownStateCode) && visible.some((e) => e.jurisdiction)

  const buckets = useMemo(() => {
    if (!showJurisdictionGroups) return null
    return bucketByJurisdiction(visible, ownStateCode)
  }, [showJurisdictionGroups, visible, ownStateCode])

  // Resolve the user's own state label from the first matching exam in the
  // primary bucket (its jurisdiction.stateCode === ownStateCode) — saves a
  // separate fetch.
  useEffect(() => {
    if (!ownStateCode || !buckets) {
      setOwnStateLabel(null)
      return
    }
    const match = buckets.primary.find(
      (e) => e.jurisdiction?.level === 'STATE' && e.jurisdiction?.stateCode === ownStateCode
    )
    setOwnStateLabel(match?.jurisdiction?.name ?? null)
  }, [ownStateCode, buckets])

  // Grouped presentation when unfiltered; flat when searching/filtering.
  // When jurisdiction groups are shown, the legacy level groups are NOT.
  const grouped = query.trim() === '' && level === 'ALL' && !showJurisdictionGroups
  const groups = useMemo(() => {
    if (!grouped) return []
    return (
      [
        { key: 'NATIONAL' as const, title: 'National examinations', items: visible.filter((e) => e.level === 'NATIONAL') },
        { key: 'STATE' as const, title: 'State examinations', items: visible.filter((e) => e.level === 'STATE') },
        { key: 'REGIONAL' as const, title: 'Regional examinations', items: visible.filter((e) => e.level === 'REGIONAL') },
      ].filter((group) => group.items.length > 0)
    )
  }, [grouped, visible])

  // SITE-S12: the collapsed-secondary-section state.
  const [showSecondary, setShowSecondary] = useState(false)

  // ---------- Loading (first paint — mirrors the layout, CA pattern) ----------

  if (loading && !result) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading the exam directory">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex items-center gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- Error ----------

  if (error && !result) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Exam directory unavailable</CardTitle>
          <CardDescription className="text-red-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={onGoHome}>
              Back to the homepage
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ---------- Render ----------

  const countryName = result?.country.name ?? 'your country'

  return (
    <div className="space-y-5">
      {/* ---------- Breadcrumb — tight (text-xs, py-1, gap-1.5 only) ---------- */}
      <nav aria-label="Breadcrumb" className="py-1 text-xs">
        <ol className="flex items-center gap-1.5">
          <li>
            <button
              type="button"
              onClick={onGoHome}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              Home
            </button>
          </li>
          <li className="text-zinc-300" aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-zinc-900">
            Exams
          </li>
        </ol>
      </nav>

      {/* ---------- Compact hero — icon tile, H1, one-liner (CA pattern) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="exams-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
            aria-hidden="true"
          >
            <GraduationCap className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 id="exams-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Exams
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
              Every exam in {countryName} with a real General Knowledge &amp; Current Affairs syllabus
              {exams.length > 0 && (
                <>
                  {' '}— <span className="font-semibold text-zinc-700">{exams.length} exams</span>, from
                  UPSC to your state PSC.
                </>
              )}
            </p>
          </div>
        </div>
      </motion.section>

      {/* ---------- Search + level filters ---------- */}
      {exams.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search exams — try “UPSC”, “police”, “bank”…"
              className="pl-9"
              aria-label="Search the exam directory"
            />
          </div>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Filter exams by level"
          >
            <ListFilter className="mr-0.5 h-4 w-4 text-zinc-400" aria-hidden="true" />
            {(['ALL', 'NATIONAL', 'STATE', 'REGIONAL'] as LevelFilter[]).map((option) => {
              const count = counts[option]
              if (option !== 'ALL' && count === 0) return null
              const active = level === option
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setLevel(option)}
                  aria-pressed={active}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  {option === 'ALL' ? 'All' : LEVEL_LABEL[option]}
                  <span className={`ml-1.5 ${active ? 'text-emerald-100' : 'text-zinc-400'}`}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ---------- Empty market ---------- */}
      {!loading && !error && exams.length === 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">
                {countryName} exams arrive at launch
              </p>
              <p className="text-sm text-amber-800">
                Exam pages and full syllabi for this country publish when GKSetu launches here. The
                global knowledge library is open to browse today.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- No search matches ---------- */}
      {!loading && !error && exams.length > 0 && visible.length === 0 && (
        <Card className="border-zinc-200 bg-white">
          <CardContent className="flex items-start gap-3 p-5">
            <Search className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-900">No exams match “{query.trim()}”</p>
              <p className="text-sm text-zinc-600">
                Try a shorter search — exam name, code or conducting body all work.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- The directory ---------- */}
      {!loading && !error && visible.length > 0 && (
        <>
          {showJurisdictionGroups && buckets ? (
            <div className="space-y-6">
              {/* Primary bucket: own state + central + international */}
              {buckets.primary.length > 0 && (
                <section aria-labelledby="group-jurisdiction-primary" className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="group-jurisdiction-primary" className="text-lg font-semibold tracking-tight">
                      {ownStateLabel ? `Your state (${ownStateLabel}) · Central · International` : 'Central · International · Your state'}
                    </h2>
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      {buckets.primary.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {buckets.primary.map((exam) => (
                      <ExamCard key={exam.slug} exam={exam} onOpenExam={onOpenExam} />
                    ))}
                  </div>
                </section>
              )}

              {/* Secondary bucket: other states (collapsed) */}
              {buckets.secondary.length > 0 && (
                <section aria-labelledby="group-jurisdiction-secondary" className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowSecondary((current) => !current)}
                    aria-expanded={showSecondary}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-zinc-700 transition-colors hover:border-emerald-200 hover:text-zinc-900"
                  >
                    <span className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                      Other states
                      <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-500">
                        {buckets.secondary.length}
                      </Badge>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${
                        showSecondary ? 'rotate-180' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  {showSecondary && (
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                      {buckets.secondary.map((exam) => (
                        <ExamCard key={exam.slug} exam={exam} onOpenExam={onOpenExam} />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : grouped ? (
            <div className="space-y-6">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`group-${group.key}`} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h2 id={`group-${group.key}`} className="text-lg font-semibold tracking-tight">
                      {group.title}
                    </h2>
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-500">
                      {group.items.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((exam) => (
                      <ExamCard key={exam.slug} exam={exam} onOpenExam={onOpenExam} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500" aria-live="polite">
                {visible.length} of {exams.length} exams
              </p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {visible.map((exam) => (
                  <ExamCard key={exam.slug} exam={exam} onOpenExam={onOpenExam} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ---------- Footnote ---------- */}
      {!loading && exams.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-zinc-400">
          <BookOpenCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Every exam carries its General Knowledge &amp; Current Affairs syllabus, mapped to the
          knowledge you can learn — open any exam to see what to study, topic by topic.
        </p>
      )}
    </div>
  )
}

// ---------- One exam card (compact — name, subtle level chip, organiser, syllabus) ----------

function ExamCard({ exam, onOpenExam }: { exam: DirectoryExam; onOpenExam: (slug: string) => void }) {
  // SITE-S12: prefer the jurisdiction chip over the legacy level chip when
  // available (more specific: "Maharashtra" vs. "State"). When jurisdiction is
  // null, fall back to the level chip (the honest "this exam isn't tagged yet"
  // state — surfaced in the Console's "missing jurisdiction" filter).
  const jurisdictionChip = jurisdictionChipLabel(exam.jurisdiction)
  return (
    <Card className="group cursor-pointer border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenExam(exam.slug)}
        className="h-full w-full text-left"
        aria-label={`Open the ${exam.name} page`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
              {exam.name}
            </CardTitle>
            {/* A subtle plain chip — the level in plain words, not a shouty badge. */}
            <Badge
              variant="outline"
              className="shrink-0 border-zinc-200 bg-zinc-50 text-[11px] font-normal text-zinc-500"
            >
              {jurisdictionChip ?? LEVEL_LABEL[exam.level]}
            </Badge>
          </div>
          <CardDescription className="line-clamp-1 text-xs">
            {exam.organiser} ({exam.code})
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exam.currentVersion ? (
            <p className="text-xs text-zinc-500">
              Syllabus: <span className="font-medium text-zinc-600">{exam.currentVersion.label}</span>
            </p>
          ) : (
            <p className="text-xs text-zinc-400">Syllabus coming soon.</p>
          )}
        </CardContent>
      </button>
    </Card>
  )
}
