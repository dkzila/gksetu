'use client'

/**
 * GlobIQ — Translations section (P9-S1)
 *
 * The console's §18 Translator/Localiser working surface: the translation
 * links with their two resolved ends and the §36 drift derivation (synced
 * source revision vs the source's live revision — never a guess), the §26
 * AI-draft action (provenance recorded, §19-gated — the contract stated on
 * every response), the §35 coverage stats (tracked links vs the
 * cross-language pairs that exist in fact), and the create action (one
 * active link per source+language; the target language must be configured
 * on the anchor's market — never a global language list). §38 workspace
 * scoping rides the service (the anchor's country decides the workspace);
 * publishing stays a separate editorial decision, never implied here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowRightLeft,
  Bot,
  CheckCircle2,
  Languages,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  TranslationDto,
  TranslationSourceTypePublic,
  TranslationStats,
  TranslationStatusPublic,
} from '@/modules/translations'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

// ---------- local types (the picker feeds — existing admin surfaces) ----------

interface PickerItem {
  id: string
  label: string
  title: string
  languageCode: string
}

const STATUS_STYLES: Record<TranslationStatusPublic, string> = {
  DRAFT: 'border-amber-200 bg-amber-50 text-amber-800',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  OUTDATED: 'border-orange-200 bg-orange-50 text-orange-700',
  RETIRED: 'border-zinc-200 bg-zinc-100 text-zinc-500',
}

const STATUS_HINTS: Record<TranslationStatusPublic, string> = {
  DRAFT: 'Work in progress — the target has not published yet (§19 workflow ahead).',
  PUBLISHED: 'The target published, synced to the recorded source revision.',
  OUTDATED: 'The source moved past the sync point (§36) — the target is still published and public; refresh rides the normal correction cycle.',
  RETIRED: 'The link was retired — both content rows stand untouched (§36).',
}

export function TranslationsSection() {
  const { token, user, permissions } = useAuth()
  const { toast } = useToast()
  const canManage = permissions.includes('translations:manage') && user?.status === 'ACTIVE'

  const [loading, setLoading] = useState(false)
  const [translations, setTranslations] = useState<TranslationDto[]>([])
  const [stats, setStats] = useState<TranslationStats | null>(null)
  const [statusFilter, setStatusFilter] = useState<'ALL' | TranslationStatusPublic>('ALL')
  const [loaded, setLoaded] = useState(false)

  // The create form.
  const [sourceType, setSourceType] = useState<TranslationSourceTypePublic>('CONTENT_ITEM')
  const [sourceId, setSourceId] = useState('')
  const [languageCode, setLanguageCode] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  // The picker feeds (published sources + the default market's languages).
  const [pickerItems, setPickerItems] = useState<PickerItem[]>([])
  const [languageOptions, setLanguageOptions] = useState<Array<{ code: string; name: string; nativeName: string | null }>>([])

  const [aiBusyId, setAiBusyId] = useState<string | null>(null)
  const [retireBusyId, setRetireBusyId] = useState<string | null>(null)

  const load = useCallback(
    async (filters?: { status?: TranslationStatusPublic }) => {
      if (!token || loading) return
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (filters?.status) params.set('status', filters.status)
        const query = params.toString()
        const response = await fetch(`/api/translations${query ? `?${query}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ translations: TranslationDto[]; stats: TranslationStats }>
        if (payload.status === 'ok' && payload.data) {
          setTranslations(payload.data.translations)
          setStats(payload.data.stats)
          setLoaded(true)
        } else {
          toast({
            title: 'Could not load the translation workspace',
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
    if (canManage && token && !loaded) void load()
  }, [canManage, token, loaded, load])

  // The picker feeds load once alongside the list (§35: the target-language
  // options come from the DEFAULT market's configured languages — never a
  // global language list; the create API re-validates on the server).
  useEffect(() => {
    if (!canManage || !token) return
    let cancelled = false

    async function loadPickerFeeds() {
      try {
        const [contentRes, qnaRes, countriesRes] = await Promise.all([
          fetch('/api/content/admin/items?status=PUBLISHED&pageSize=50', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch('/api/qna/admin?status=PUBLISHED', {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
          }),
          fetch('/api/countries', { cache: 'no-store' }),
        ])
        const content = (await contentRes.json()) as Envelope<{
          items: Array<{
            id: string
            title: string
            format: string
            language: { code: string }
            unit: { slug: string } | null
            event: { slug: string } | null
          }>
        }>
        const qna = (await qnaRes.json()) as Envelope<{
          items: Array<{
            id: string
            questionText: string
            language: { code: string }
            unit: { slug: string }
          }>
        }>
        const countries = (await countriesRes.json()) as Envelope<{
          countries: Array<{
            isDefault: boolean
            languages: Array<{ code: string; name: string; nativeName: string | null }>
          }>
        }>
        if (cancelled) return
        const contentItems: PickerItem[] = (content.data?.items ?? []).map((item) => ({
          id: item.id,
          label: `${item.unit?.slug ?? item.event?.slug ?? 'unknown'}/${item.language.code}/${item.format}`,
          title: item.title,
          languageCode: item.language.code,
        }))
        const qnaItems: PickerItem[] = (qna.data?.items ?? []).map((item) => ({
          id: item.id,
          label: `${item.unit.slug}/${item.language.code}/QnA`,
          title: item.questionText,
          languageCode: item.language.code,
        }))
        setPickerItems([...contentItems, ...qnaItems])
        const defaultCountry = countries.data?.countries.find((country) => country.isDefault)
        setLanguageOptions(defaultCountry?.languages ?? [])
      } catch {
        // The picker feeds are a convenience — a failed feed never blocks the
        // raw-id create path or the list itself.
      }
    }
    void loadPickerFeeds()
    return () => {
      cancelled = true
    }
  }, [canManage, token])

  const activePicker = useMemo(
    () => pickerItems.filter((item) => (sourceType === 'CONTENT_ITEM' ? !item.label.endsWith('/QnA') : item.label.endsWith('/QnA'))),
    [pickerItems, sourceType]
  )
  const selectedSource = activePicker.find((item) => item.id === sourceId)
  const targetLanguageOptions = languageOptions.filter(
    (option) => !selectedSource || option.code !== selectedSource.languageCode
  )

  const handleCreate = useCallback(async () => {
    if (!token || creating) return
    if (!sourceId || !languageCode) {
      toast({
        title: 'Pick a source and a target language',
        description: 'The source must be a published representation; the target language must be configured on the anchor market (§35).',
        variant: 'destructive',
      })
      return
    }
    setCreating(true)
    try {
      const response = await fetch('/api/translations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceType, sourceId, languageCode, notes: notes.trim() || undefined }),
      })
      const payload = (await response.json()) as Envelope<{ translation: TranslationDto }>
      if (payload.status === 'ok') {
        toast({
          title: 'Translation project opened',
          description: 'The DRAFT target is seeded with the source text — translate in place; publishing is a separate §19 decision.',
        })
        setSourceId('')
        setLanguageCode('')
        setNotes('')
        await load(statusFilter === 'ALL' ? undefined : { status: statusFilter })
      } else {
        toast({
          title: 'Could not open the translation project',
          description: payload.error?.message ?? 'Please retry.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }, [token, creating, sourceType, sourceId, languageCode, notes, statusFilter, load, toast])

  const handleAiDraft = useCallback(
    async (id: string) => {
      if (!token || aiBusyId) return
      setAiBusyId(id)
      try {
        const response = await fetch(`/api/translations/${id}/ai-draft`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as Envelope<{ translation: TranslationDto; contract: string }>
        if (payload.status === 'ok') {
          toast({ title: '§26 machine draft written', description: payload.data?.contract })
          await load(statusFilter === 'ALL' ? undefined : { status: statusFilter })
        } else {
          toast({
            title: 'The machine draft did not land',
            description: payload.error?.message ?? 'Please retry.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setAiBusyId(null)
      }
    },
    [token, aiBusyId, statusFilter, load, toast]
  )

  const handleRetire = useCallback(
    async (id: string) => {
      if (!token || retireBusyId) return
      setRetireBusyId(id)
      try {
        const response = await fetch(`/api/translations/${id}/retire`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: 'Retired from the translations console' }),
        })
        const payload = (await response.json()) as Envelope<{ translation: TranslationDto }>
        if (payload.status === 'ok') {
          toast({
            title: 'Link retired',
            description: 'Both content rows stand untouched with their own §19 lifecycle (§36).',
          })
          await load(statusFilter === 'ALL' ? undefined : { status: statusFilter })
        } else {
          toast({
            title: 'Could not retire the link',
            description: payload.error?.message ?? 'Please retry.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setRetireBusyId(null)
      }
    },
    [token, retireBusyId, statusFilter, load, toast]
  )

  if (!canManage) {
    return (
      <section aria-labelledby="translations-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <Languages className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="translations-heading" className="text-xl font-semibold tracking-tight">
            Translations — §6/§35
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            P9-S1
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-zinc-600">
          The translation/localisation framework: provenance links between representations (source →
          target → language → status), §36 drift tracking, §26 AI-assisted drafts with human review
          gates. The workspace is editorial (translations:manage) — this account does not hold it.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="translations-heading" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="translations-heading" className="text-xl font-semibold tracking-tight">
          Translations — §6/§35
        </h2>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          P9-S1
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => {
              const next = value as 'ALL' | TranslationStatusPublic
              setStatusFilter(next)
              void load(next === 'ALL' ? undefined : { status: next })
            }}
          >
            <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="OUTDATED">Outdated</SelectItem>
              <SelectItem value="RETIRED">Retired</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(statusFilter === 'ALL' ? undefined : { status: statusFilter })}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Refresh
          </Button>
        </div>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Translations reference canonical content (§35): the target is a full representation of the
        same KnowledgeUnit or event — never duplicated business identity. The links carry the
        provenance (which source, which revision, which language), the §36 drift state, and the §26
        AI-provenance flag; publishing a translation always rides the §19 workflow including the
        step-5 localisation review.
      </p>

      {/* ---------- §35 coverage stats ---------- */}
      {stats && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowRightLeft className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Coverage — tracked links vs cross-language pairs in fact
            </CardTitle>
            <CardDescription className="leading-relaxed">{stats.note}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">In fact (§35)</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{stats.publishedCrossLanguagePairs}</p>
              <p className="mt-1 text-[11px] leading-snug text-zinc-500">published cross-language pairs (same anchor + format)</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">Tracked</p>
              <p className="mt-1 text-xl font-semibold text-emerald-800">{stats.trackedPublished}</p>
              <p className="mt-1 text-[11px] leading-snug text-emerald-700">published links the framework follows</p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-orange-700">Drifted</p>
              <p className="mt-1 text-xl font-semibold text-orange-800">{stats.outdated}</p>
              <p className="mt-1 text-[11px] leading-snug text-orange-700">source moved past the sync point (§36)</p>
            </div>
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-sky-700">AI-assisted</p>
              <p className="mt-1 text-xl font-semibold text-sky-800">{stats.aiAssisted}</p>
              <p className="mt-1 text-[11px] leading-snug text-sky-700">§26 provenance — every one human-gated</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- Open a translation project ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Open a translation project</CardTitle>
          <CardDescription>
            One active link per source + language (§7). The source must be published; the target
            language must be configured on the anchor market (§35). The DRAFT target is seeded with
            the source text — translate in place.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="translation-source-type">Source type</Label>
              <Select
                value={sourceType}
                onValueChange={(value) => {
                  setSourceType(value as TranslationSourceTypePublic)
                  setSourceId('')
                }}
              >
                <SelectTrigger id="translation-source-type" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTENT_ITEM">Representation (ContentItem)</SelectItem>
                  <SelectItem value="QNA">QnA entry</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="translation-source">Published source</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="translation-source" className="h-9">
                  <SelectValue placeholder={activePicker.length > 0 ? 'Pick a published source' : 'Loading sources…'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {activePicker.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      <span className="font-mono text-[11px] text-zinc-500">{item.label}</span>
                      <span className="ml-2 truncate text-xs">{item.title.slice(0, 60)}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="translation-language">Target language (§35)</Label>
              <Select value={languageCode} onValueChange={setLanguageCode}>
                <SelectTrigger id="translation-language" className="h-9">
                  <SelectValue placeholder={targetLanguageOptions.length > 0 ? 'Pick the target language' : 'No other configured language'} />
                </SelectTrigger>
                <SelectContent>
                  {targetLanguageOptions.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.nativeName ?? option.name} ({option.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="translation-notes">Notes (optional)</Label>
              <Input
                id="translation-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. terminology reference, deadline"
                className="h-9"
                maxLength={1000}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Creating the project never publishes anything — the target enters DRAFT and rides the
              full §19 workflow (§18: writers never publish).
            </p>
            <Button size="sm" onClick={() => void handleCreate()} disabled={creating || !sourceId || !languageCode}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Languages className="h-4 w-4" aria-hidden="true" />}
              Open project
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- The links ---------- */}
      <div className="space-y-3">
        {translations.length === 0 && !loading && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-zinc-500">
              No translation links {statusFilter !== 'ALL' ? 'in this status ' : ''}in your workspace yet — open a project above or reseed the §45 fixtures.
            </CardContent>
          </Card>
        )}
        {translations.map((translation) => (
          <Card key={translation.id} className="overflow-hidden">
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`font-medium ${STATUS_STYLES[translation.status]}`}>
                  {translation.status}
                </Badge>
                <span className="font-mono text-[11px] text-zinc-500">
                  {translation.source.label}
                </span>
                <span aria-hidden="true" className="text-zinc-400">→</span>
                <span className="font-mono text-[11px] font-medium text-emerald-700">
                  {translation.target.label}
                </span>
                {translation.aiAssisted && (
                  <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">
                    <Bot className="mr-1 h-3 w-3" aria-hidden="true" />
                    §26 AI-assisted
                  </Badge>
                )}
                {translation.stale && translation.status !== 'OUTDATED' && (
                  <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-700">
                    <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
                    drifted
                  </Badge>
                )}
                <span className="ml-auto text-[11px] text-zinc-400">
                  {new Date(translation.updatedAt).toLocaleDateString()}
                </span>
              </div>

              <div className="grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
                <p className="min-w-0">
                  <span className="font-medium text-zinc-700">Source ({translation.source.languageCode}):</span>{' '}
                  {translation.source.title ?? '—'}
                </p>
                <p className="min-w-0">
                  <span className="font-medium text-zinc-700">Target ({translation.target.languageCode} · {translation.language.nativeName ?? translation.language.name}):</span>{' '}
                  {translation.target.title ?? '—'}
                </p>
              </div>

              <p className="text-xs text-zinc-500">
                {translation.status === 'OUTDATED' || translation.stale ? (
                  <span className="inline-flex items-start gap-1.5 rounded-md border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    Synced at source revision {translation.sourceRevisionNumber} · the source is now at{' '}
                    {translation.sourceLiveRevisionNumber ?? '?'} — the original has been updated since this translation (§36). The target stays published and public (§35); refresh rides the normal correction cycle.
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                    Synced at source revision {translation.sourceRevisionNumber}
                    {translation.sourceLiveRevisionNumber != null && ` · the source is at ${translation.sourceLiveRevisionNumber}`}
                  </span>
                )}
              </p>

              {translation.notes && (
                <p className="rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-600">{translation.notes}</p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleAiDraft(translation.id)}
                  disabled={aiBusyId === translation.id || translation.status !== 'DRAFT' || translation.target.status !== 'DRAFT'}
                  title={
                    translation.status === 'DRAFT' && translation.target.status === 'DRAFT'
                      ? '§26: machine-translate the source\'s live revision into the DRAFT working copy (provenance recorded; §19 gates ahead)'
                      : STATUS_HINTS[translation.status]
                  }
                >
                  {aiBusyId === translation.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  AI draft (§26)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRetire(translation.id)}
                  disabled={retireBusyId === translation.id || translation.status === 'RETIRED'}
                  title="Retire the LINK only — both content rows stand untouched (§36)"
                >
                  {retireBusyId === translation.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  Retire link
                </Button>
                <span className="text-[11px] text-zinc-400">{STATUS_HINTS[translation.status]}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
