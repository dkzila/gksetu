'use client'

/**
 * GKSetu Console — Translations page (CONSOLE-S1-C).
 *
 * The §18 localisation pipeline: every translation link with its two resolved
 * ends, the §36 drift derivation (synced source revision vs the source's live
 * revision), the §26 AI-draft action (provenance recorded, §19-gated), the
 * §35 coverage stats, and the create action — one active link per
 * source + language, target languages from the anchor market's configuration.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Bot,
  Eye,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { fieldErrorMap, useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { Field, SelectInput, TextArea, TextInput } from '@/components/console/ui/form-fields'
import { ConsolePageHeader, ErrorNotice, formatWhen, MetaRow, StatusBadge } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'

// ---------- DTOs (mirror /api/translations payloads) ----------

interface TranslationEndpoint {
  type: 'CONTENT_ITEM' | 'QNA'
  id: string
  label: string
  languageCode: string
  title: string | null
  status: string
  countryId: string | null
}

interface TranslationDto {
  id: string
  status: 'DRAFT' | 'PUBLISHED' | 'OUTDATED' | 'RETIRED'
  aiAssisted: boolean
  notes: string | null
  createdAt: string
  updatedAt: string
  source: TranslationEndpoint
  target: TranslationEndpoint
  language: { code: string; name: string; nativeName: string | null }
  sourceRevisionNumber: number
  sourceLiveRevisionNumber: number | null
  stale: boolean
}

interface TranslationStats {
  total: number
  byStatus: Record<string, number>
  aiAssisted: number
  outdated: number
  publishedCrossLanguagePairs: number
  trackedPublished: number
  note: string
}

const STATUS_OPTIONS = ['DRAFT', 'PUBLISHED', 'OUTDATED', 'RETIRED'] as const

// ---------- picker feeds (published representations + market languages) ----------

interface PickerItem {
  id: string
  type: 'CONTENT_ITEM' | 'QNA'
  title: string
  label: string
  languageCode: string
}

interface LanguageOption {
  code: string
  name: string
  nativeName: string | null
}

export function TranslationsPage() {
  const api = useConsoleApi()
  const { toast } = useToast()
  const canManage = useHasPermission('translations:manage')

  // ----- list + filters -----
  const [translations, setTranslations] = useState<TranslationDto[]>([])
  const [stats, setStats] = useState<TranslationStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [languageFilter, setLanguageFilter] = useState('')
  const [search, setSearch] = useState('') // client-side — the API has no q

  // Picker feeds.
  const [pickerItems, setPickerItems] = useState<PickerItem[]>([])
  const [languages, setLanguages] = useState<LanguageOption[]>([])

  // Dialogs + busy state.
  const [createOpen, setCreateOpen] = useState(false)
  const [viewItem, setViewItem] = useState<TranslationDto | null>(null)
  const [retireItem, setRetireItem] = useState<TranslationDto | null>(null)
  const [retireNote, setRetireNote] = useState('')
  const [aiBusyId, setAiBusyId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (languageFilter) params.set('languageCode', languageFilter)
    const query = params.toString()
    const response = await api.get<{ translations: TranslationDto[]; stats: TranslationStats }>(`/api/translations${query ? `?${query}` : ''}`)
    setLoading(false)
    if (response.data) {
      setTranslations(response.data.translations)
      setStats(response.data.stats)
    } else {
      setTranslations([])
      setStats(null)
      setError(response.error?.message ?? 'Could not load the translation workspace.')
    }
  }, [api, statusFilter, languageFilter])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // Feeds load once alongside the list (§35: target languages come from the
  // markets' configured languages — never a global language list).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [contentRes, qnaRes, countriesRes] = await Promise.all([
        api.get<{ items: Array<{ id: string; title: string; format: string; language: { code: string }; unit: { slug: string } | null; event: { slug: string } | null }> }>(
          '/api/content/admin/items?status=PUBLISHED&pageSize=50'
        ),
        api.get<{ items: Array<{ id: string; questionText: string; language: { code: string }; unit: { slug: string } }> }>('/api/qna/admin?status=PUBLISHED'),
        api.get<{ countries: Array<{ languages: LanguageOption[] }> }>('/api/countries'),
      ])
      if (cancelled) return
      const content = (contentRes.data?.items ?? []).map((item) => ({
        id: item.id,
        type: 'CONTENT_ITEM' as const,
        title: item.title,
        label: `${item.unit?.slug ?? item.event?.slug ?? 'unknown'}/${item.language.code}/${item.format}`,
        languageCode: item.language.code,
      }))
      const qna = (qnaRes.data?.items ?? []).map((item) => ({
        id: item.id,
        type: 'QNA' as const,
        title: item.questionText,
        label: `${item.unit.slug}/${item.language.code}/QnA`,
        languageCode: item.language.code,
      }))
      setPickerItems([...content, ...qna])
      const seen = new Set<string>()
      const flat: LanguageOption[] = []
      for (const country of countriesRes.data?.countries ?? []) {
        for (const language of country.languages) {
          if (seen.has(language.code)) continue
          seen.add(language.code)
          flat.push(language)
        }
      }
      setLanguages(flat)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [api])

  // ----- actions -----

  async function handleAiDraft(item: TranslationDto) {
    setAiBusyId(item.id)
    try {
      const response = await api.post<{ translation: TranslationDto; contract: string }>(`/api/translations/${item.id}/ai-draft`)
      if (response.data) {
        toast({ title: '§26 machine draft written', description: response.data.contract })
        await fetchList()
      } else {
        toast({ title: 'The machine draft did not land', description: response.error?.message, variant: 'destructive' })
      }
    } finally {
      setAiBusyId(null)
    }
  }

  async function handleRetire() {
    if (!retireItem) return
    setBusy(true)
    try {
      const response = await api.post<{ translation: TranslationDto }>(`/api/translations/${retireItem.id}/retire`, {
        ...(retireNote.trim() ? { note: retireNote.trim() } : {}),
      })
      if (response.data) {
        toast({ title: 'Link retired', description: 'Both content rows stand untouched with their own §19 lifecycle (§36).' })
        setRetireItem(null)
        setRetireNote('')
        await fetchList()
      } else {
        toast({ title: 'Could not retire the link', description: response.error?.message, variant: 'destructive' })
      }
    } finally {
      setBusy(false)
    }
  }

  // Client-side search over the loaded rows (title/label/language).
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return translations
    return translations.filter((item) =>
      [
        item.source.title,
        item.source.label,
        item.target.title,
        item.target.label,
        item.language.name,
        item.language.code,
      ].some((value) => (value ?? '').toLowerCase().includes(needle))
    )
  }, [translations, search])

  const columns: Array<ResourceColumn<TranslationDto>> = useMemo(
    () => [
      {
        key: 'source',
        header: 'Source',
        className: 'min-w-[220px]',
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{item.source.title ?? item.source.label}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{item.source.label}</p>
          </div>
        ),
      },
      {
        key: 'target',
        header: 'Target',
        className: 'min-w-[220px]',
        render: (item) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{item.target.title ?? item.target.label}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{item.target.label}</p>
          </div>
        ),
      },
      {
        key: 'language',
        header: 'Language',
        render: (item) => (
          <span className="whitespace-nowrap">
            <span className="font-medium text-zinc-700">{item.language.code}</span>
            <span className="ml-1.5 text-[11px] text-zinc-400">{item.language.nativeName ?? item.language.name}</span>
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (item) => <StatusBadge status={item.status} />,
      },
      {
        key: 'sync',
        header: 'Sync',
        render: (item) => (
          <span
            className={cn('whitespace-nowrap font-mono text-[11px]', item.stale ? 'font-semibold text-orange-600' : 'text-zinc-500')}
            title={item.stale ? 'The source moved past the sync point (§36 drift)' : 'The target is synced to the recorded source revision'}
          >
            r{item.sourceRevisionNumber}
            {item.sourceLiveRevisionNumber !== null && (
              <>
                {' → '}
                <span className={item.stale ? 'text-orange-600' : undefined}>r{item.sourceLiveRevisionNumber}</span>
              </>
            )}
          </span>
        ),
      },
      {
        key: 'aiAssisted',
        header: 'AI',
        render: (item) =>
          item.aiAssisted ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700" title="§26 AI-provenance — human-gated before anything goes live">
              <Bot className="h-3.5 w-3.5" aria-hidden="true" /> assisted
            </span>
          ) : (
            <span className="text-xs text-zinc-300">—</span>
          ),
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (item) => <span className="whitespace-nowrap text-zinc-500">{formatWhen(item.updatedAt)}</span>,
      },
    ],
    []
  )

  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Translations"
        description="The localisation pipeline (§35) — targets are full representations of the same canonical record, drift is derived from revision data (§36), and §26 AI drafts always land in the DRAFT working copy behind the §19 review gates."
        icon={<Languages className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              Refresh
            </Button>
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New translation
              </Button>
            )}
          </>
        }
      />

      {/* §35 coverage stats — tracked links vs cross-language pairs in fact */}
      {stats && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">In fact (§35)</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{stats.publishedCrossLanguagePairs}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">published cross-language pairs</p>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">Tracked</p>
              <p className="mt-1 text-xl font-semibold text-emerald-800">{stats.trackedPublished}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-emerald-700">published links the framework follows</p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-orange-700">Drifted</p>
              <p className="mt-1 text-xl font-semibold text-orange-800">{stats.outdated}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-orange-700">source moved past the sync point</p>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
              <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">AI-assisted</p>
              <p className="mt-1 text-xl font-semibold text-zinc-900">{stats.aiAssisted}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">§26 provenance — every one human-gated</p>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-400">{stats.note}</p>
        </div>
      )}

      {error && rows.length === 0 && !loading && <ErrorNotice message={error} onRetry={() => void fetchList()} />}

      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(item) => item.id}
        loading={loading}
        search={{ value: search, onChange: setSearch, placeholder: 'Filter source, target or language…' }}
        toolbar={
          <>
            <div className="w-40">
              <SelectInput
                value={statusFilter}
                onChange={setStatusFilter}
                placeholder="All statuses"
                options={STATUS_OPTIONS.map((option) => ({ value: option, label: option.charAt(0) + option.slice(1).toLowerCase() }))}
              />
            </div>
            <div className="w-44">
              <SelectInput
                value={languageFilter}
                onChange={setLanguageFilter}
                placeholder="All languages"
                options={languages.map((language) => ({
                  value: language.code,
                  label: `${language.code} — ${language.nativeName ?? language.name}`,
                }))}
              />
            </div>
          </>
        }
        emptyTitle="No translation links"
        emptyHint="Open a translation project from a published representation — the DRAFT target is seeded with the source text."
        actions={(item) =>
          canManage ? (
            <>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setViewItem(item)} aria-label="View details">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2 text-[11px]"
                onClick={() => void handleAiDraft(item)}
                disabled={aiBusyId !== null || item.status === 'RETIRED' || item.target.status !== 'DRAFT'}
                title={
                  item.target.status !== 'DRAFT'
                    ? 'The AI only writes the DRAFT working copy (§26) — this target has moved past draft'
                    : 'Generate a §26 machine draft into the target DRAFT working copy'
                }
              >
                {aiBusyId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                AI draft
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-400 hover:text-red-600"
                onClick={() => {
                  setRetireItem(item)
                  setRetireNote('')
                }}
                disabled={item.status === 'RETIRED'}
                aria-label="Retire link"
                title="Retire the tracking link — both content rows stand untouched (§36)"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </>
          ) : null
        }
      />

      {/* ----- view details ----- */}
      <Dialog open={viewItem !== null} onOpenChange={(open) => !open && setViewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Translation link
            </DialogTitle>
            <DialogDescription>
              The provenance record (§6/§35) — which source, which revision, which language. Editing the target content
              happens in the content workflow (§19), never here.
            </DialogDescription>
          </DialogHeader>
          {viewItem && (
            <div className="divide-y divide-zinc-100">
              <MetaRow label="Source" value={viewItem.source.title ?? '—'} />
              <MetaRow label="Source ref" value={<span className="font-mono text-[11px]">{viewItem.source.label}</span>} />
              <MetaRow label="Target" value={viewItem.target.title ?? '—'} />
              <MetaRow label="Target ref" value={<span className="font-mono text-[11px]">{viewItem.target.label}</span>} />
              <MetaRow
                label="Target workflow status"
                value={<StatusBadge status={viewItem.target.status} />}
              />
              <MetaRow label="Language" value={`${viewItem.language.name}${viewItem.language.nativeName ? ` (${viewItem.language.nativeName})` : ''}`} />
              <MetaRow label="Synced source revision" value={`r${viewItem.sourceRevisionNumber}`} />
              <MetaRow
                label="Source live revision"
                value={
                  <span className={viewItem.stale ? 'text-orange-600' : undefined}>
                    {viewItem.sourceLiveRevisionNumber === null ? '—' : `r${viewItem.sourceLiveRevisionNumber}`}
                    {viewItem.stale ? ' · drifted' : ''}
                  </span>
                }
              />
              <MetaRow label="AI-assisted (§26)" value={viewItem.aiAssisted ? 'Yes — human-gated' : 'No'} />
              {viewItem.notes && <MetaRow label="Notes" value={<span className="font-normal italic text-zinc-500">{viewItem.notes}</span>} />}
              <MetaRow label="Updated" value={formatWhen(viewItem.updatedAt)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setViewItem(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----- retire confirm (§36 soft-delete of the link only) ----- */}
      <AlertDialog open={retireItem !== null} onOpenChange={(open) => !open && setRetireItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-600" aria-hidden="true" />
              Retire this translation link?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Retiring ends the tracking relationship only — both content rows stand untouched with their own §19
              lifecycle, and a fresh pairing for the same source and language may be opened later (§36).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field label="Note (optional, audited)">
            <TextInput value={retireNote} onChange={setRetireNote} placeholder="e.g. wrong pairing" />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void handleRetire()} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Retire link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ----- open a translation project ----- */}
      <CreateTranslationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        pickerItems={pickerItems}
        languages={languages}
        onCreated={() => void fetchList()}
      />
    </div>
  )
}

function CreateTranslationDialog({
  open,
  onOpenChange,
  pickerItems,
  languages,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pickerItems: PickerItem[]
  languages: LanguageOption[]
  onCreated: () => void
}) {
  const api = useConsoleApi()
  const { toast } = useToast()

  const [sourceType, setSourceType] = useState<'CONTENT_ITEM' | 'QNA'>('CONTENT_ITEM')
  const [sourceId, setSourceId] = useState('')
  const [languageCode, setLanguageCode] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setSourceId('')
    setLanguageCode('')
    setNotes('')
  }, [open])

  const activeItems = useMemo(() => pickerItems.filter((item) => item.type === sourceType), [pickerItems, sourceType])
  const selectedSource = activeItems.find((item) => item.id === sourceId)
  const targetLanguages = languages.filter((language) => !selectedSource || language.code !== selectedSource.languageCode)

  async function handleCreate() {
    setSaving(true)
    setErrors({})
    try {
      const response = await api.post<{ translation: TranslationDto; contract: string }>('/api/translations', {
        sourceType,
        sourceId,
        languageCode,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      })
      if (response.data) {
        toast({ title: 'Translation project opened', description: response.data.contract })
        onOpenChange(false)
        onCreated()
      } else if (response.error) {
        setErrors(fieldErrorMap(response.error.details))
        toast({ title: 'Could not open the translation project', description: response.error.message, variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open a translation project</DialogTitle>
          <DialogDescription>
            One active link per source + language (§7). The source must be published; the target language must be
            configured on the anchor&apos;s market (§35) — the server re-validates. The DRAFT target is seeded with the
            source text.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Source type">
            <SelectInput
              id="tr-type"
              value={sourceType}
              onChange={(value) => {
                setSourceType(value as 'CONTENT_ITEM' | 'QNA')
                setSourceId('')
                setLanguageCode('')
              }}
              options={[
                { value: 'CONTENT_ITEM', label: 'Content item (post/card)' },
                { value: 'QNA', label: 'Q&A entry' },
              ]}
            />
          </Field>
          <Field label="Published source" required error={errors.sourceId} hint={selectedSource ? selectedSource.label : undefined}>
            <SelectInput
              id="tr-source"
              value={sourceId}
              onChange={setSourceId}
              options={activeItems.map((item) => ({ value: item.id, label: `${item.title} — ${item.label}` }))}
              placeholder={activeItems.length ? 'Choose…' : 'Loading…'}
              invalid={!!errors.sourceId}
            />
          </Field>
          <Field
            label="Target language"
            required
            error={errors.languageCode}
            hint={selectedSource ? `Different from the source language (${selectedSource.languageCode}).` : undefined}
          >
            <SelectInput
              id="tr-language"
              value={languageCode}
              onChange={setLanguageCode}
              options={targetLanguages.map((language) => ({
                value: language.code,
                label: `${language.code} — ${language.nativeName ?? language.name}`,
              }))}
              placeholder={targetLanguages.length ? 'Choose…' : 'Loading…'}
              invalid={!!errors.languageCode}
            />
          </Field>
          <Field label="Notes (optional)">
            <TextArea id="tr-notes" value={notes} onChange={setNotes} rows={2} placeholder="Context for the translator…" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleCreate()} disabled={saving || !sourceId || !languageCode}>
            {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Open project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
