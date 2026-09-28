'use client'

/**
 * GlobIQ — Event Page View (P6-S2)
 *
 * The §22-style reading experience for the §16 current-affairs event page:
 * the event record (what happened, when, where, why it matters) → the
 * published language-specific representations (live revisions only, §36 —
 * corrections carry their change summaries) → the §24 evidence layer (the
 * §12 step 2 aggregated sources + the representations' own citations, one
 * shared registry, verification states intact) → the §12 step 3 canonical
 * KnowledgeUnits (the §7 one-truth links) → the §35 translation surface.
 * P6-S4: the "In the syllabus of" block (§12 step 5) — which exam syllabi
 * this event feeds, anchored via §13 topic links or §8 unit mappings
 * (absence is honest: no block when nothing anchors).
 * This is the READER surface (§38): consumes GET /api/current-affairs/page/
 * {ref} — the same client-agnostic payload a future mobile app uses (§39).
 */
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  BookOpenCheck,
  CalendarClock,
  CalendarRange,
  Clock3,
  GraduationCap,
  Hourglass,
  Lightbulb,
  Link2,
  MapPin,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Star,
  Tag,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useSeoHead } from '@/components/home/seo-head'
import { SaveButton } from '@/components/saves/save-button'

// ---------- Types (mirror /api/current-affairs/page/{ref}) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

type Lifecycle = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'

interface EventRepresentation {
  id: string
  format: string
  title: string
  body: string
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  aiAssisted: boolean
  sourceCount: number
}

interface EventSource {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: 'VERIFIED' | 'UNVERIFIED' | 'UNRELIABLE'
  publishedAt: string | null
  eventNote: string | null
  isPrimary: boolean
  citedBy: Array<{ representationId: string; title: string; format: string }>
  claim: string | null
}

interface EventUnit {
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  canonicalPath: string
  topicSlug: string
}

/** P6-S3 §12 step 3 — who/what the event is about. */
interface EventEntity {
  slug: string
  canonicalName: string
  description: string | null
  type: 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
  status: 'ACTIVE' | 'RETIRED'
  countryIso: string | null
  note: string | null
}

/** P6-S3 §12 step 3 — an additional-topic cross-filing. */
interface EventTopicRef {
  slug: string
  canonicalName: string
  label: string
  canonicalPath: string
}

/** P6-S4 §12 step 5 — which exam syllabi this event feeds (≤6 exams,
 * name-sorted; anchors deduped and node-sorted, all server-side). */
interface EventExamRelevance {
  exams: Array<{
    slug: string
    name: string
    code: string
    anchors: Array<{
      nodeName: string
      matchVia: 'TOPIC' | 'KNOWLEDGE_UNIT'
      /** The mapped canonical unit's slug (KNOWLEDGE_UNIT matches only). */
      unitSlug: string | null
    }>
  }>
}

export interface EventPageData {
  event: {
    slug: string
    title: string
    eventDate: string
    eventEndDate: string | null
    location: string | null
    summary: string
    significance: string | null
    lifecycleState: Lifecycle
    /** P6-S5 §17 — the server-computed freshness verdict (tier + age + label). */
    freshness: { tier: 'FRESH' | 'RECENT' | 'SETTLED' | 'HISTORICAL'; ageDays: number; label: string }
    scope: 'GLOBAL' | 'COUNTRY'
    topic: { slug: string; canonicalName: string; label: string }
    topicPath: Array<{ slug: string; label: string }>
  }
  representations: EventRepresentation[]
  presentedFrom: 'reader_language' | 'canonical_fallback'
  translations: Array<{ code: string; name: string; nativeName: string | null; canonicalPath: string }>
  sources: EventSource[]
  knowledgeUnits: EventUnit[]
  entities: EventEntity[]
  additionalTopics: EventTopicRef[]
  /** P6-S4 §12 step 5 — the exam syllabi this event feeds. */
  examRelevance: EventExamRelevance
  language: { code: string; name: string; nativeName: string | null }
  canonicalPath: string
  seo: {
    canonicalPath: string
    alternates: Array<{ hreflang: string; path: string }>
    xDefaultPath: string | null
    robots: { index: boolean; follow: boolean; reason: string | null }
    lastModified: string | null
  }
  structuredData: { graph: Array<{ '@type': string | string[] } & Record<string, unknown>> }
  scheduledCount: number
}

// ---------- Presentation helpers ----------

const LIFECYCLE_META: Record<Lifecycle, { label: string; tone: string; note: string }> = {
  EMERGING: {
    label: 'Emerging',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    note: 'Breaking coverage — facts may still develop (§12).',
  },
  DEVELOPING: {
    label: 'Developing',
    tone: 'border-sky-200 bg-sky-50 text-sky-800',
    note: 'More sources and context are accumulating — corrections expected (§12).',
  },
  STABLE: {
    label: 'Stable',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    note: 'The established canonical understanding of this event (§12).',
  },
  ARCHIVED: {
    label: 'Archived',
    tone: 'border-zinc-300 bg-zinc-100 text-zinc-600',
    note: 'End-of-life for updates — kept as permanent historical reference (§36).',
  },
}

const FORMAT_LABEL: Record<string, string> = {
  CURRENT_EVENT_UPDATE: 'Update',
  EXPLAINER: 'Explainer',
  TIMELINE: 'Timeline',
  REVISION_NOTE: 'Revision note',
  FACT_CARD: 'Fact card',
  PROFILE: 'Profile',
  COMPARISON: 'Comparison',
}

const ENTITY_TYPE_META: Record<EventEntity['type'], { label: string; tone: string }> = {
  PERSON: { label: 'Person', tone: 'border-violet-200 bg-violet-50 text-violet-700' },
  PLACE: { label: 'Place', tone: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  ORGANISATION: { label: 'Organisation', tone: 'border-orange-200 bg-orange-50 text-orange-700' },
  CONCEPT: { label: 'Concept', tone: 'border-teal-200 bg-teal-50 text-teal-700' },
}

/** P6-S5 §17 — the freshness verdict chip (the same tiers the feeds render). */
const FRESHNESS_META: Record<EventPageData['event']['freshness']['tier'], { tone: string }> = {
  FRESH: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  RECENT: { tone: 'border-teal-200 bg-teal-50 text-teal-700' },
  SETTLED: { tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  HISTORICAL: { tone: 'border-zinc-300 bg-zinc-100 text-zinc-600' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function verificationBadge(verification: EventSource['verification']) {
  if (verification === 'VERIFIED') {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified
      </Badge>
    )
  }
  if (verification === 'UNRELIABLE') {
    return (
      <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700">
        <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Flagged unreliable
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
      <ShieldQuestion className="h-3 w-3" aria-hidden="true" /> Unverified
    </Badge>
  )
}

/** Prose renderer — paragraphs split on blank lines. */
function ProseBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-zinc-700">
      {(paragraphs.length ? paragraphs : [body]).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

// ---------- The assembled event page ----------

export interface EventPageViewProps {
  eventRef: string
  country: string
  language: string
  /** Opens a linked unit's §16 knowledge page in-app (§7 links). */
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  /** P6-S3: opens an additional topic's §13/§16 hub in-app (cross-filings). */
  onOpenTopic: (topicSlug: string) => void
  onSwitchLanguage: (code: string) => void
}

export function EventPageView({ eventRef, country, language, onOpenUnit, onOpenTopic, onSwitchLanguage }: EventPageViewProps) {
  const [page, setPage] = useState<EventPageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ country, language })
        const response = await fetch(
          `/api/current-affairs/page/${encodeURIComponent(eventRef)}?${params}`,
          { cache: 'no-store' }
        )
        const payload = (await response.json()) as Envelope<{ page: EventPageData }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setPage(payload.data.page)
        } else {
          setError(payload.error?.message ?? 'Could not load this event page')
        }
      } catch {
        if (!cancelled) setError('Could not load this event page')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [eventRef, country, language, reloadKey])

  // §16 SEO block + the NewsArticle structured-data graph into the head.
  useSeoHead(
    page
      ? {
          title: `${page.event.title} — GlobIQ Current Affairs`,
          description: page.event.summary,
          seo: page.seo,
          language: page.language.code,
          countryIso: country,
          ogType: 'article',
          jsonLd: page.structuredData.graph,
        }
      : null
  )

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading the event page">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (error || !page) {
    return (
      <Card className="border-zinc-200 shadow-sm">
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <AlertCircle className="h-6 w-6 text-zinc-400" aria-hidden="true" />
          <div>
            <p className="font-medium text-zinc-900">This event page is not available</p>
            <p className="mt-1 text-sm text-zinc-500">{error ?? 'Unknown error'}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const lifecycle = LIFECYCLE_META[page.event.lifecycleState]

  return (
    <article className="space-y-5" aria-labelledby="event-title">
      {/* ---------- The event record (§12) ---------- */}
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={`gap-1 ${lifecycle.tone}`} title={lifecycle.note}>
            <Newspaper className="h-3 w-3" aria-hidden="true" />
            {lifecycle.label}
          </Badge>
          <Badge variant="outline" className="gap-1 border-zinc-200 bg-white text-zinc-600">
            <Tag className="h-3 w-3" aria-hidden="true" />
            {page.event.topic.label}
          </Badge>
          {/* P6-S3 §12 step 3 — additional-topic cross-filings under the primary. */}
          {page.additionalTopics.map((topic) => (
            <button
              key={topic.slug}
              type="button"
              onClick={() => onOpenTopic(topic.slug)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700"
              title={`Cross-filed under ${topic.canonicalName} — open the topic hub`}
            >
              <Tag className="h-3 w-3" aria-hidden="true" />
              {topic.label}
            </button>
          ))}
          {page.scheduledCount > 0 && (
            <Badge variant="outline" className="gap-1 border-sky-200 bg-sky-50 text-sky-700">
              <Clock3 className="h-3 w-3" aria-hidden="true" />
              {page.scheduledCount} scheduled {page.scheduledCount === 1 ? 'update' : 'updates'} pending
            </Badge>
          )}
        </div>
        <h1 id="event-title" className="text-2xl font-semibold leading-snug tracking-tight text-zinc-900 sm:text-3xl">
          {page.event.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            {formatDate(page.event.eventDate)}
            {page.event.eventEndDate && (
              <>
                {' '}
                <CalendarRange className="h-4 w-4" aria-hidden="true" />
                → {formatDate(page.event.eventEndDate)}
              </>
            )}
          </span>
          {page.event.location && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {page.event.location}
            </span>
          )}
          <Badge
            variant="outline"
            className={`gap-1 ${FRESHNESS_META[page.event.freshness.tier].tone}`}
            title="The §17 freshness verdict — computed from the event date (P6-S5 rules)"
          >
            <Hourglass className="h-3 w-3" aria-hidden="true" />
            {page.event.freshness.label}
          </Badge>
        </div>
        <p className="text-[13px] text-zinc-400">{lifecycle.note}</p>
      </header>

      <Separator />

      {/* ---------- What happened / why it matters (§6 record fields) ---------- */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="border-zinc-200 shadow-sm lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What happened</CardTitle>
          </CardHeader>
          <CardContent>
            <ProseBody body={page.event.summary} />
          </CardContent>
        </Card>
        {page.event.significance && (
          <Card className="border-amber-200 bg-amber-50/40 shadow-sm lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base text-amber-900">
                <Lightbulb className="h-4 w-4" aria-hidden="true" /> Why it matters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProseBody body={page.event.significance} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ---------- The published representations (§12 step 4, §36) ---------- */}
      <section aria-labelledby="event-representations" className="space-y-3">
        <h2 id="event-representations" className="text-lg font-semibold tracking-tight text-zinc-900">
          Published coverage
        </h2>
        {page.presentedFrom === 'canonical_fallback' ? (
          <Card className="border-zinc-200 bg-zinc-50/60 shadow-sm">
            <CardContent className="py-6">
              <p className="text-sm leading-relaxed text-zinc-600">
                No published coverage in <span className="font-medium">{page.language.name}</span> yet
                — the canonical record above is the reference. This page becomes a full read the
                moment an update publishes in this language (§35 — never a machine-translated
                placeholder).
              </p>
              {page.translations.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-500">Read it in:</span>
                  {page.translations.map((translation) => (
                    <Button
                      key={translation.code}
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => onSwitchLanguage(translation.code)}
                    >
                      {translation.nativeName ?? translation.name}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          page.representations.map((item) => (
            <Card key={item.id} className="border-zinc-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="gap-1 border-orange-200 bg-orange-50 text-orange-800">
                        <CalendarClock className="h-3 w-3" aria-hidden="true" />
                        {FORMAT_LABEL[item.format] ?? item.format}
                      </Badge>
                      {item.aiAssisted && (
                        <Badge variant="outline" className="gap-1 border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700">
                          <Bot className="h-3 w-3" aria-hidden="true" />
                          AI-assisted · editorially reviewed
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="mt-2 text-lg leading-snug">{item.title}</CardTitle>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">
                    Rev {item.revision.number} · {formatDate(item.revision.publishedAt)}
                  </span>
                </div>
                {item.revision.changeSummary && (
                  <p className="text-xs italic text-zinc-500">“{item.revision.changeSummary}”</p>
                )}
              </CardHeader>
              <CardContent>
                {item.format === 'CURRENT_EVENT_UPDATE' ? (
                  <div className="rounded-lg border border-orange-100 bg-orange-50/40 p-4">
                    <ProseBody body={item.body} />
                  </div>
                ) : (
                  <ProseBody body={item.body} />
                )}
                {item.sourceCount > 0 && (
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {item.sourceCount} linked {item.sourceCount === 1 ? 'source' : 'sources'} — see the evidence layer below
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {/* ---------- §24 evidence layer (§12 step 2 aggregation + citations) ---------- */}
      {page.sources.length > 0 && (
        <section aria-labelledby="event-sources" className="space-y-3">
          <h2 id="event-sources" className="text-lg font-semibold tracking-tight text-zinc-900">
            Evidence
          </h2>
          <p className="text-sm text-zinc-500">
            Aggregated from the shared evidence registry (§24) — the same record whatever the number
            of publishers covering this event (§12).
          </p>
          <ul className="space-y-2.5">
            {page.sources.map((source) => (
              <li key={source.id}>
                <Card className="border-zinc-200 shadow-sm">
                  <CardContent className="flex flex-col gap-2 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {source.isPrimary && (
                          <Badge variant="outline" className="gap-1 border-orange-200 bg-orange-50 text-orange-800">
                            <Star className="h-3 w-3 fill-orange-400 text-orange-500" aria-hidden="true" />
                            Primary
                          </Badge>
                        )}
                        {verificationBadge(source.verification)}
                        <span className="text-xs text-zinc-400">{source.type}</span>
                      </div>
                      <span className="text-xs text-zinc-400">{source.publisher}</span>
                    </div>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 break-words text-sm font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950"
                    >
                      {source.title}
                      <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
                    </a>
                    {source.eventNote && <p className="text-xs italic text-zinc-500">{source.eventNote}</p>}
                    {source.claim && <p className="text-xs text-zinc-500">Backing: {source.claim}</p>}
                    {source.citedBy.length > 0 && (
                      <p className="text-xs text-zinc-500">
                        Cited by{' '}
                        {source.citedBy.map((citation) => citation.title).join(' · ')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- §12 step 3: the canonical knowledge this event touches (§7) ---------- */}
      {page.knowledgeUnits.length > 0 && (
        <section aria-labelledby="event-units" className="space-y-3">
          <h2 id="event-units" className="text-lg font-semibold tracking-tight text-zinc-900">
            Canonical knowledge
          </h2>
          <p className="text-sm text-zinc-500">
            This event points at the established knowledge it touches — the facts live once, in the
            linked units (§7), and every exam syllabus flows through them (§8).
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {page.knowledgeUnits.map((unit) => (
              <li key={unit.slug}>
                <Card className="h-full border-zinc-200 shadow-sm transition-colors hover:border-zinc-300">
                  <CardContent className="flex h-full flex-col gap-1.5 py-4">
                    <Badge variant="outline" className="w-fit gap-1 border-teal-200 bg-teal-50 text-teal-700">
                      <GraduationCap className="h-3 w-3" aria-hidden="true" />
                      {unit.type}
                    </Badge>
                    <button
                      type="button"
                      className="text-left text-sm font-semibold text-zinc-900 hover:underline"
                      onClick={() => onOpenUnit(unit.topicSlug, unit.slug)}
                    >
                      {unit.canonicalName}
                    </button>
                    {unit.canonicalSummary && (
                      <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">
                        {unit.canonicalSummary}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- P6-S3 §12 step 3: who/what this event is about (entities) ---------- */}
      {page.entities.length > 0 && (
        <section aria-labelledby="event-entities" className="space-y-3">
          <h2 id="event-entities" className="text-lg font-semibold tracking-tight text-zinc-900">
            People, places &amp; organisations
          </h2>
          <p className="text-sm text-zinc-500">
            The canonical reference records this event involves (§12) — one registry entry whatever the
            number of stories that mention them.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {page.entities.map((entity) => {
              const meta = ENTITY_TYPE_META[entity.type]
              return (
                <li key={entity.slug}>
                  <Card className="h-full border-zinc-200 shadow-sm">
                    <CardContent className="flex h-full flex-col gap-1.5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={`gap-1 ${meta.tone}`}>
                          <Users className="h-3 w-3" aria-hidden="true" />
                          {meta.label}
                        </Badge>
                        {entity.status === 'RETIRED' && (
                          <Badge variant="outline" className="border-zinc-300 bg-zinc-100 font-normal text-zinc-500">
                            Retired — kept as history (§36)
                          </Badge>
                        )}
                        {entity.countryIso && (
                          <span className="font-mono text-[10px] uppercase text-zinc-400">{entity.countryIso}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-zinc-900">{entity.canonicalName}</p>
                      {entity.description && (
                        <p className="text-xs leading-relaxed text-zinc-500">{entity.description}</p>
                      )}
                      {entity.note && (
                        <p className="text-xs italic text-zinc-400">{entity.note}</p>
                      )}
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* ---------- P6-S4 §12 step 5: the exam syllabi this event feeds ---------- */}
      {/* Absence is honest: no exams → no block. */}
      {page.examRelevance.exams.length > 0 && (
        <section aria-labelledby="event-exams" className="space-y-3">
          <h2
            id="event-exams"
            className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900"
          >
            <BookOpenCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            In the syllabus of
          </h2>
          <p className="text-sm text-zinc-500">
            This event feeds the live syllabi below — each exam anchors it through a linked
            syllabus topic (§13) or a mapped canonical unit (§8).
          </p>
          <ul className="space-y-2.5" aria-label="Exams whose syllabi this event feeds">
            {page.examRelevance.exams.map((exam) => (
              <li key={exam.slug} className="rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm">
                <p className="text-sm font-semibold text-zinc-900">
                  {exam.name}{' '}
                  <span className="font-mono text-xs font-normal text-zinc-400">{exam.code}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {exam.anchors.map((anchor, anchorIndex) => (
                    <Badge
                      key={`${exam.slug}-${anchor.nodeName}-${anchor.matchVia}-${anchorIndex}`}
                      variant="outline"
                      className="max-w-full border-zinc-200 bg-zinc-50 text-[11px] font-normal text-zinc-600"
                      title={`${anchor.nodeName} — anchored via ${
                        anchor.matchVia === 'TOPIC'
                          ? 'a syllabus-topic link (§13)'
                          : 'a mapped canonical unit (§8)'
                      }`}
                    >
                      {anchor.nodeName}
                      {anchor.unitSlug && (
                        <span className="font-mono text-[10px] text-zinc-400">
                          {' '}
                          · via {anchor.unitSlug}
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- §35 translation surface ---------- */}
      {page.translations.length > 1 && (
        <section aria-labelledby="event-translations" className="space-y-2">
          <h2 id="event-translations" className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Read this event in
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {page.translations.map((translation) => (
              <Button
                key={translation.code}
                variant={translation.code === page.language.code ? 'default' : 'outline'}
                size="sm"
                className="h-8"
                onClick={() => onSwitchLanguage(translation.code)}
              >
                {translation.nativeName ?? translation.name}
              </Button>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
