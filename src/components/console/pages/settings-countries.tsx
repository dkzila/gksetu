'use client'

/**
 * GKSetu Console — Settings → Countries & languages (CONSOLE-S1-F): the
 * market configuration center. Countries (with the announce/launch/pause
 * lifecycle), the per-market language sets, and the platform language
 * registry — wired to /api/countries*, /api/languages* following the
 * P9-S2 launch-panel + P1-S3 locale-section API patterns exactly.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Globe2,
  Languages,
  Loader2,
  Megaphone,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  XCircle,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { fieldErrorMap, useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { ErrorNotice, StatusBadge, formatDate } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { Field, SelectInput, TextInput } from '@/components/console/ui/form-fields'

// ---------- Contracts (mirror /api/countries + /api/languages) ----------

type CountryStatus = 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'

interface AdminCountry {
  isoCode: string
  slug: string
  name: string
  timezone: string | null
  status: CountryStatus
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null; direction: 'LTR' | 'RTL'; url: string }>
}

interface AdminLanguage {
  code: string
  name: string
  nativeName: string | null
  direction: 'LTR' | 'RTL'
  status: 'ACTIVE' | 'INACTIVE'
  configuredInCountries: number
}

interface LaunchCheck {
  key: string
  label: string
  state: 'ok' | 'warn' | 'block'
  detail: string
}

interface Readiness {
  country: {
    isoCode: string
    name: string
    status: CountryStatus
    isDefault: boolean
    launchedAt: string | null
    timezone: string | null
    defaultLanguage: { code: string; name: string } | null
    languages: Array<{ code: string; name: string }>
  }
  checks: LaunchCheck[]
  blocks: number
  warnings: number
  availableActions: Array<'announce' | 'launch' | 'pause'>
  derivation: string
}

type LifecycleAction = 'announce' | 'launch' | 'pause'

const ACTION_META: Record<LifecycleAction, { label: string; icon: typeof Rocket; hint: string }> = {
  announce: {
    label: 'Announce',
    icon: Megaphone,
    hint: 'INACTIVE → COMING_SOON. The market is publicly acknowledged as announced — homepage hero, switcher “soon” tag, sitemap quiet state. No content requirement: announcing is a marketing state.',
  },
  launch: {
    label: 'Launch',
    icon: Rocket,
    hint: '→ ACTIVE. The controlled go-live: hard invariants enforced, launchedAt stamped (never rewritten), the search index rebuilt. Advisory warnings do not block — they are recorded with the launch.',
  },
  pause: {
    label: 'Pause',
    icon: PauseCircle,
    hint: '→ INACTIVE. Hidden from every public surface (switcher, homepage, sitemap, search index); all content and configuration preserved. Reversible via announce/launch.',
  },
}

const COUNTRY_STATUS_LABEL: Record<CountryStatus, string> = {
  ACTIVE: 'Live',
  COMING_SOON: 'Coming soon',
  INACTIVE: 'Paused / staged',
}

// ==================================================================

export function CountriesTab() {
  const api = useConsoleApi()
  const { toast } = useToast()
  const canManageCountries = useHasPermission('country-config:manage')
  const canManageLanguages = useHasPermission('language:manage')

  const [countries, setCountries] = useState<AdminCountry[]>([])
  const [countriesLoading, setCountriesLoading] = useState(true)
  const [countriesError, setCountriesError] = useState<string | null>(null)

  const [languages, setLanguages] = useState<AdminLanguage[]>([])
  const [languagesLoading, setLanguagesLoading] = useState(true)
  const [languagesError, setLanguagesError] = useState<string | null>(null)

  // Lifecycle dialog state.
  const [lifecycleCountry, setLifecycleCountry] = useState<AdminCountry | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)
  const [confirming, setConfirming] = useState<LifecycleAction | null>(null)
  const [note, setNote] = useState('')
  const [busyAction, setBusyAction] = useState<LifecycleAction | null>(null)

  // Create-country dialog.
  const [countryDialogOpen, setCountryDialogOpen] = useState(false)
  const [countryForm, setCountryForm] = useState({
    isoCode: '',
    slug: '',
    name: '',
    timezone: '',
    defaultLanguageCode: 'en',
  })
  const [countryErrors, setCountryErrors] = useState<Record<string, string>>({})
  const [countrySaving, setCountrySaving] = useState(false)

  // Configure-languages dialog.
  const [langConfigCountry, setLangConfigCountry] = useState<AdminCountry | null>(null)
  const [langConfigCodes, setLangConfigCodes] = useState<string[]>([])
  const [langConfigSaving, setLangConfigSaving] = useState(false)
  const [langConfigError, setLangConfigError] = useState<string | null>(null)

  // Create/edit language dialogs.
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false)
  const [editingLanguage, setEditingLanguage] = useState<AdminLanguage | null>(null)
  const [languageForm, setLanguageForm] = useState({ code: '', name: '', nativeName: '', direction: 'LTR' })
  const [languageErrors, setLanguageErrors] = useState<Record<string, string>>({})
  const [languageSaving, setLanguageSaving] = useState(false)

  // ---------- Loads ----------

  const loadCountries = useCallback(async () => {
    if (!canManageCountries) {
      setCountriesLoading(false)
      return
    }
    setCountriesLoading(true)
    setCountriesError(null)
    const { data, error } = await api.get<{ countries: AdminCountry[] }>('/api/countries?include=inactive')
    if (error) {
      setCountriesError(error.message)
      setCountries([])
    } else {
      setCountries(data?.countries ?? [])
    }
    setCountriesLoading(false)
  }, [api, canManageCountries])

  const loadLanguages = useCallback(async () => {
    setLanguagesLoading(true)
    setLanguagesError(null)
    const { data, error } = await api.get<{ languages: AdminLanguage[] }>('/api/languages')
    if (error) {
      setLanguagesError(error.message)
      setLanguages([])
    } else {
      setLanguages(data?.languages ?? [])
    }
    setLanguagesLoading(false)
  }, [api])

  useEffect(() => {
    // Deferred (set-state-in-effect guard — the loaders set state up front).
    const timer = setTimeout(() => {
      void loadCountries()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [loadCountries])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLanguages()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [loadLanguages])

  // ---------- Launch lifecycle (the P9-S2 launch-panel pattern) ----------

  const openLifecycle = async (country: AdminCountry) => {
    setLifecycleCountry(country)
    setReadiness(null)
    setConfirming(null)
    setNote('')
    setReadinessLoading(true)
    const { data, error } = await api.get<{ readiness: Readiness }>(
      `/api/countries/${encodeURIComponent(country.isoCode)}/launch-readiness`
    )
    setReadinessLoading(false)
    if (error) {
      toast({ title: 'Could not load readiness', description: error.message, variant: 'destructive' })
      setLifecycleCountry(null)
      return
    }
    setReadiness(data?.readiness ?? null)
  }

  const runLifecycle = async (action: LifecycleAction) => {
    if (!lifecycleCountry || busyAction) return
    setBusyAction(action)
    const { data, error } = await api.post<{ readiness: Readiness }>(
      `/api/countries/${encodeURIComponent(lifecycleCountry.isoCode)}/${action}`,
      note.trim() ? { note: note.trim() } : {}
    )
    setBusyAction(null)
    if (error) {
      toast({ title: `${ACTION_META[action].label} refused`, description: error.message, variant: 'destructive' })
      return
    }
    const next = data?.readiness ?? null
    setReadiness(next)
    setConfirming(null)
    setNote('')
    toast({
      title: `${lifecycleCountry.name} → ${next ? COUNTRY_STATUS_LABEL[next.country.status] : 'updated'}`,
      description: ACTION_META[action].hint.split('.')[0] + '.',
    })
    // The app shell refetches its locale config on this event (header switcher).
    window.dispatchEvent(new CustomEvent('gksetu:locale-config-changed'))
    await loadCountries()
  }

  // ---------- Country create ----------

  const submitCountry = async () => {
    if (countrySaving) return
    setCountrySaving(true)
    setCountryErrors({})
    const payload: Record<string, unknown> = {
      isoCode: countryForm.isoCode.trim().toUpperCase(),
      slug: countryForm.slug.trim().toLowerCase(),
      name: countryForm.name.trim(),
      defaultLanguageCode: countryForm.defaultLanguageCode,
    }
    if (countryForm.timezone.trim()) payload.timezone = countryForm.timezone.trim()
    const { data, error } = await api.post<{ country: AdminCountry }>('/api/countries', payload)
    setCountrySaving(false)
    if (error) {
      setCountryErrors(fieldErrorMap(error.details))
      toast({ title: 'Could not create the market', description: error.message, variant: 'destructive' })
      return
    }
    setCountryDialogOpen(false)
    setCountryForm({ isoCode: '', slug: '', name: '', timezone: '', defaultLanguageCode: 'en' })
    toast({
      title: 'Market created',
      description: `${data!.country.name} is staged as ${COUNTRY_STATUS_LABEL[data!.country.status]} — configure its languages, then announce or launch it.`,
    })
    await loadCountries()
  }

  // ---------- Country language set ----------

  const openLangConfig = (country: AdminCountry) => {
    setLangConfigCountry(country)
    setLangConfigCodes(country.languages.map((language) => language.code))
    setLangConfigError(null)
  }

  const toggleLangCode = (code: string, isDefault: boolean) => {
    if (isDefault) return // the default language must stay in the set (§35)
    setLangConfigCodes((codes) => (codes.includes(code) ? codes.filter((entry) => entry !== code) : [...codes, code]))
  }

  const submitLangConfig = async () => {
    if (!langConfigCountry || langConfigSaving) return
    setLangConfigSaving(true)
    setLangConfigError(null)
    const { error } = await api.put(`/api/countries/${encodeURIComponent(langConfigCountry.isoCode)}/languages`, {
      languageCodes: langConfigCodes,
    })
    setLangConfigSaving(false)
    if (error) {
      setLangConfigError(error.message)
      return
    }
    toast({
      title: 'Language set saved',
      description: `${langConfigCountry.name} now exposes ${langConfigCodes.length} language${langConfigCodes.length === 1 ? '' : 's'}.`,
    })
    setLangConfigCountry(null)
    window.dispatchEvent(new CustomEvent('gksetu:locale-config-changed'))
    await loadCountries()
  }

  // ---------- Language create / edit ----------

  const submitLanguage = async () => {
    if (languageSaving) return
    setLanguageSaving(true)
    setLanguageErrors({})
    const isEdit = editingLanguage !== null
    const payload: Record<string, unknown> = isEdit
      ? {
          name: languageForm.name.trim(),
          nativeName: languageForm.nativeName.trim() === '' ? null : languageForm.nativeName.trim(),
          direction: languageForm.direction,
        }
      : {
          code: languageForm.code.trim().toLowerCase(),
          name: languageForm.name.trim(),
          ...(languageForm.nativeName.trim() ? { nativeName: languageForm.nativeName.trim() } : {}),
          direction: languageForm.direction,
        }
    const { error } = isEdit
      ? await api.patch(`/api/languages/${encodeURIComponent(editingLanguage!.code)}`, payload)
      : await api.post('/api/languages', payload)
    setLanguageSaving(false)
    if (error) {
      setLanguageErrors(fieldErrorMap(error.details))
      toast({
        title: isEdit ? 'Could not update the language' : 'Could not add the language',
        description: error.message,
        variant: 'destructive',
      })
      return
    }
    setLanguageDialogOpen(false)
    toast({
      title: isEdit ? 'Language updated' : 'Language added',
      description: isEdit
        ? `${editingLanguage!.code} updated — codes are immutable identifiers.`
        : `${languageForm.code.trim().toLowerCase()} joined the platform registry.`,
    })
    await loadLanguages()
    await loadCountries()
  }

  // ---------- Countries table ----------

  const countryColumns: Array<ResourceColumn<AdminCountry>> = [
    {
      key: 'name',
      header: 'Market',
      className: 'min-w-[200px]',
      render: (country) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-800">{country.name}</span>
            {country.isDefault && (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700">
                default root
              </Badge>
            )}
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            {country.isoCode.toLowerCase()} · /{country.slug}
            {country.timezone ? ` · ${country.timezone}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (country) => <StatusBadge status={country.status} />,
    },
    {
      key: 'defaultLanguage',
      header: 'Default language',
      render: (country) => (
        <span className="text-[13px]">
          <code className="font-mono text-xs text-zinc-600">{country.defaultLanguage.code}</code>{' '}
          <span className="text-zinc-400">{country.defaultLanguage.name}</span>
        </span>
      ),
    },
    {
      key: 'languages',
      header: 'Languages',
      render: (country) => (
        <span className="text-[12px] text-zinc-500" title={country.languages.map((l) => `${l.code} · ${l.name}`).join('\n')}>
          {country.languages.length} configured
        </span>
      ),
    },
    {
      key: 'actions-hint',
      header: 'Lifecycle',
      render: (country) =>
        country.isDefault ? (
          <span className="text-[11px] text-zinc-400">live by definition (§14)</span>
        ) : (
          <span className="text-[11px] text-zinc-400">{COUNTRY_STATUS_LABEL[country.status]}</span>
        ),
    },
  ]

  const languageColumns: Array<ResourceColumn<AdminLanguage>> = [
    {
      key: 'code',
      header: 'Code',
      render: (language) => <code className="font-mono text-xs font-medium text-zinc-700">{language.code}</code>,
    },
    {
      key: 'name',
      header: 'Name',
      render: (language) => (
        <div>
          <span className="font-medium text-zinc-800">{language.name}</span>
          {language.nativeName && <span className="ml-1.5 text-[12px] text-zinc-400">{language.nativeName}</span>}
        </div>
      ),
    },
    {
      key: 'direction',
      header: 'Direction',
      render: (language) => <span className="font-mono text-[11px] text-zinc-500">{language.direction}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (language) => <StatusBadge status={language.status} />,
    },
    {
      key: 'configuredInCountries',
      header: 'Markets',
      render: (language) => (
        <span className="text-[12px] text-zinc-500">{language.configuredInCountries} market(s)</span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* ---------- Countries ---------- */}
      <section className="space-y-3" aria-labelledby="settings-countries-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="settings-countries-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <Globe2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Markets ({countries.length})
            </h3>
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-500">
              INACTIVE (staged/paused) → COMING_SOON (announced, not routable) → ACTIVE (live). Status
              changes only through the lifecycle transitions — raw edits are refused server-side.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void loadCountries()} disabled={countriesLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${countriesLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManageCountries && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  setCountryForm({ isoCode: '', slug: '', name: '', timezone: '', defaultLanguageCode: 'en' })
                  setCountryErrors({})
                  setCountryDialogOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New market
              </Button>
            )}
          </div>
        </div>

        {!canManageCountries ? (
          <ErrorNotice message="The market configuration requires country-config:manage — this account does not hold it." />
        ) : countriesError ? (
          <ErrorNotice message={countriesError} onRetry={() => void loadCountries()} />
        ) : (
          <ResourceTable
            columns={countryColumns}
            rows={countries}
            rowKey={(country) => country.isoCode}
            loading={countriesLoading}
            emptyTitle="No markets configured"
            emptyHint="Create the first market — it arrives staged as COMING_SOON and never touches the public surface until launched."
            actions={(country) => (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => void openLifecycle(country)}
                  disabled={country.isDefault}
                  title={country.isDefault ? 'The default root market is live by definition — its lifecycle is frozen.' : 'Readiness + announce / launch / pause'}
                >
                  <Rocket className="h-3 w-3" aria-hidden="true" />
                  Lifecycle
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => openLangConfig(country)}
                  title="Configure which languages this market exposes"
                >
                  <Languages className="h-3 w-3" aria-hidden="true" />
                  Languages
                </Button>
              </>
            )}
          />
        )}
      </section>

      {/* ---------- Language registry ---------- */}
      <section className="space-y-3" aria-labelledby="settings-languages-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="settings-languages-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
              <Languages className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Language registry ({languages.length})
            </h3>
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-zinc-500">
              The platform language table — codes are immutable identifiers; each market exposes only
              its own configured subset (§35).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void loadLanguages()} disabled={languagesLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${languagesLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManageLanguages && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  setEditingLanguage(null)
                  setLanguageForm({ code: '', name: '', nativeName: '', direction: 'LTR' })
                  setLanguageErrors({})
                  setLanguageDialogOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New language
              </Button>
            )}
          </div>
        </div>

        {languagesError ? (
          <ErrorNotice message={languagesError} onRetry={() => void loadLanguages()} />
        ) : (
          <ResourceTable
            columns={languageColumns}
            rows={languages}
            rowKey={(language) => language.code}
            loading={languagesLoading}
            emptyTitle="No languages"
            emptyHint="Add the languages the platform will serve — markets configure their own subset from this registry."
            actions={(language) =>
              canManageLanguages ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-1"
                  title="Edit name / native name / direction"
                  aria-label="Edit language"
                  onClick={() => {
                    setEditingLanguage(language)
                    setLanguageForm({
                      code: language.code,
                      name: language.name,
                      nativeName: language.nativeName ?? '',
                      direction: language.direction,
                    })
                    setLanguageErrors({})
                    setLanguageDialogOpen(true)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : null
            }
          />
        )}
      </section>

      {/* ---------- Lifecycle dialog ---------- */}
      <Dialog open={lifecycleCountry !== null} onOpenChange={(open) => !open && setLifecycleCountry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              {lifecycleCountry?.name} — launch lifecycle
            </DialogTitle>
            <DialogDescription>
              Readiness is derived from the live data the market&apos;s homepage would serve (§34) —
              never a stored checklist. Blocking checks must clear before launch.
            </DialogDescription>
          </DialogHeader>

          {readinessLoading || !readiness ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={readiness.country.status} />
                <span className="text-xs text-zinc-500">
                  {readiness.country.launchedAt
                    ? `first launched ${formatDate(readiness.country.launchedAt)} — the stamp never rewrites`
                    : 'never launched'}
                </span>
                <span className="text-xs text-zinc-400">
                  {readiness.blocks} blocking · {readiness.warnings} advisory
                </span>
              </div>

              <ul className="space-y-1.5" aria-label="Launch readiness checks">
                {readiness.checks.map((check) => (
                  <li key={check.key} className="flex items-start gap-2.5 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2">
                    {check.state === 'ok' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    ) : check.state === 'warn' ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-zinc-800">{check.label}</p>
                      <p className="text-xs leading-relaxed text-zinc-500">{check.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap gap-2">
                  {(['announce', 'launch', 'pause'] as const).map((action) => {
                    const meta = ACTION_META[action]
                    const Icon = meta.icon
                    const available = readiness.availableActions.includes(action)
                    return (
                      <Button
                        key={action}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!available || busyAction !== null}
                        title={meta.hint}
                        className={`h-8 gap-1.5 text-xs ${
                          action === 'launch'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                            : action === 'announce'
                              ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : ''
                        }`}
                        onClick={() => setConfirming(confirming === action ? null : action)}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {meta.label}
                        {!available && <span className="sr-only">(not available from this state)</span>}
                      </Button>
                    )
                  })}
                </div>

                {confirming && (
                  <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                    <p className="text-xs leading-relaxed text-zinc-600">{ACTION_META[confirming].hint}</p>
                    <Field label="Operator note (optional — kept in the audit trail)" htmlFor="lifecycle-note" hint="≤500 characters.">
                      <TextInput
                        id="lifecycle-note"
                        value={note}
                        onChange={(value) => setNote(value.slice(0, 500))}
                        placeholder={`Why ${readiness.country.name} is being ${confirming === 'launch' ? 'launched' : confirming === 'pause' ? 'paused' : 'announced'}…`}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                        disabled={busyAction !== null}
                        onClick={() => void runLifecycle(confirming)}
                      >
                        {busyAction === confirming ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Confirm {ACTION_META[confirming].label}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        disabled={busyAction !== null}
                        onClick={() => {
                          setConfirming(null)
                          setNote('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-400">{readiness.derivation}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- Configure market languages ---------- */}
      <Dialog open={langConfigCountry !== null} onOpenChange={(open) => !open && setLangConfigCountry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{langConfigCountry?.name} — language set</DialogTitle>
            <DialogDescription>
              Each market exposes only its own configured languages (§35). The default language always
              stays in the set; at least one language is required.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
            {languages.map((language) => {
              const isDefault = langConfigCountry?.defaultLanguage.code === language.code
              const checked = langConfigCodes.includes(language.code)
              return (
                <button
                  key={language.code}
                  type="button"
                  onClick={() => toggleLangCode(language.code, isDefault)}
                  disabled={language.status === 'INACTIVE' && !checked}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    checked ? 'border-emerald-300 bg-emerald-50' : 'border-zinc-200 bg-white hover:border-zinc-300'
                  } ${isDefault ? 'cursor-default' : ''} ${language.status === 'INACTIVE' && !checked ? 'opacity-40' : ''}`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300 bg-white'
                      }`}
                      aria-hidden="true"
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <code className="font-mono text-xs font-medium text-zinc-700">{language.code}</code>
                    <span className="text-[13px] text-zinc-600">{language.name}</span>
                    {language.nativeName && <span className="text-xs text-zinc-400">{language.nativeName}</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {isDefault && (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] text-emerald-700">
                        default — locked
                      </Badge>
                    )}
                    {language.direction === 'RTL' && <Badge variant="outline" className="px-1.5 py-0 text-[10px]">RTL</Badge>}
                  </span>
                </button>
              )
            })}
          </div>

          {langConfigError && <p className="text-xs text-red-600" role="alert">{langConfigError}</p>}

          <DialogFooter>
            <span className="mr-auto text-xs text-zinc-400">{langConfigCodes.length} language(s) selected</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setLangConfigCountry(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitLangConfig()}
              disabled={langConfigSaving || langConfigCodes.length === 0}
            >
              {langConfigSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              Save set
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Create market ---------- */}
      <Dialog open={countryDialogOpen} onOpenChange={setCountryDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New market</DialogTitle>
            <DialogDescription>
              Adds a country to the platform. New markets arrive as COMING_SOON — announced but not
              routable — and only the lifecycle transitions change that.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ISO code" htmlFor="country-iso" required error={countryErrors.isoCode} hint="ISO 3166-1 alpha-2, e.g. AE">
                <TextInput
                  id="country-iso"
                  value={countryForm.isoCode}
                  onChange={(value) => setCountryForm((state) => ({ ...state, isoCode: value.toUpperCase().slice(0, 2) }))}
                  placeholder="AE"
                  invalid={Boolean(countryErrors.isoCode)}
                />
              </Field>
              <Field label="Slug" htmlFor="country-slug" required error={countryErrors.slug} hint="URL segment — /{slug}/… (never /in, the default market)">
                <TextInput
                  id="country-slug"
                  value={countryForm.slug}
                  onChange={(value) => setCountryForm((state) => ({ ...state, slug: value.toLowerCase() }))}
                  placeholder="uae"
                  invalid={Boolean(countryErrors.slug)}
                />
              </Field>
            </div>
            <Field label="Name" htmlFor="country-name" required error={countryErrors.name}>
              <TextInput
                id="country-name"
                value={countryForm.name}
                onChange={(value) => setCountryForm((state) => ({ ...state, name: value }))}
                placeholder="United Arab Emirates"
                invalid={Boolean(countryErrors.name)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Timezone" htmlFor="country-tz" error={countryErrors.timezone} hint="IANA, e.g. Asia/Dubai">
                <TextInput
                  id="country-tz"
                  value={countryForm.timezone}
                  onChange={(value) => setCountryForm((state) => ({ ...state, timezone: value }))}
                  placeholder="Asia/Dubai"
                  invalid={Boolean(countryErrors.timezone)}
                />
              </Field>
              <Field label="Default language" htmlFor="country-default-lang" required error={countryErrors.defaultLanguageCode}>
                <SelectInput
                  id="country-default-lang"
                  value={countryForm.defaultLanguageCode}
                  onChange={(value) => setCountryForm((state) => ({ ...state, defaultLanguageCode: value }))}
                  options={languages
                    .filter((language) => language.status === 'ACTIVE')
                    .map((language) => ({ value: language.code, label: `${language.code} · ${language.name}` }))}
                  invalid={Boolean(countryErrors.defaultLanguageCode)}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setCountryDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitCountry()}
              disabled={countrySaving || countryForm.isoCode.length !== 2 || countryForm.slug === '' || countryForm.name === ''}
            >
              {countrySaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Create market
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Create / edit language ---------- */}
      <Dialog open={languageDialogOpen} onOpenChange={setLanguageDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLanguage ? `Edit language — ${editingLanguage.code}` : 'New language'}</DialogTitle>
            <DialogDescription>
              {editingLanguage
                ? 'Codes are stable identifiers and cannot change. Deactivation is blocked while a market still configures the language.'
                : 'Adds a language to the platform registry — markets then configure it into their own sets.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingLanguage && (
              <Field label="Code" htmlFor="language-code" required error={languageErrors.code} hint='BCP-47 style, e.g. "en", "hi", "pt-br"'>
                <TextInput
                  id="language-code"
                  value={languageForm.code}
                  onChange={(value) => setLanguageForm((state) => ({ ...state, code: value.toLowerCase() }))}
                  placeholder="ta"
                  invalid={Boolean(languageErrors.code)}
                />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="language-name" required error={languageErrors.name}>
                <TextInput
                  id="language-name"
                  value={languageForm.name}
                  onChange={(value) => setLanguageForm((state) => ({ ...state, name: value }))}
                  placeholder="Tamil"
                  invalid={Boolean(languageErrors.name)}
                />
              </Field>
              <Field label="Native name" htmlFor="language-native" error={languageErrors.nativeName} hint="As written in the language itself.">
                <TextInput
                  id="language-native"
                  value={languageForm.nativeName}
                  onChange={(value) => setLanguageForm((state) => ({ ...state, nativeName: value }))}
                  placeholder="தமிழ்"
                  invalid={Boolean(languageErrors.nativeName)}
                />
              </Field>
            </div>
            <Field label="Text direction" htmlFor="language-direction" error={languageErrors.direction}>
              <SelectInput
                id="language-direction"
                value={languageForm.direction}
                onChange={(value) => setLanguageForm((state) => ({ ...state, direction: value }))}
                options={[
                  { value: 'LTR', label: 'LTR — left to right' },
                  { value: 'RTL', label: 'RTL — right to left' },
                ]}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setLanguageDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitLanguage()}
              disabled={languageSaving || languageForm.name.trim().length < 2 || (!editingLanguage && languageForm.code.trim().length < 2)}
            >
              {languageSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {editingLanguage ? 'Save language' : 'Add language'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
