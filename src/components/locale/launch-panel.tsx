'use client'

/**
 * GKSetu — Market launch lifecycle panel (P9-S2, Master Plan §43 Phase 9
 * Session 2 — "country launch configuration").
 *
 * The admin console's launch surface (§38 — platform config management):
 *  - the DERIVED readiness checklist (§34 — every check derived from the
 *    live data the market's homepage would serve, never a stored list that
 *    can go stale);
 *  - the lifecycle transitions announce / launch / pause (§14/§15/§16):
 *    INACTIVE (staged/paused, hidden) → COMING_SOON (announced, not
 *    routable as a market) → ACTIVE (live) — with the readiness gate, the
 *    launchedAt stamp (§36 spirit — the first go-live moment never rewrites)
 *    and the audit trail (§30);
 *  - raw status edits are refused by PATCH /api/countries/[iso] — this panel
 *    is the ONLY way status changes;
 *  - §38 honesty: the workspace is platform admin (country-config:manage);
 *    accounts without it see the honest scope note, not a broken form.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Megaphone,
  PauseCircle,
  Rocket,
  RotateCcw,
  XCircle,
} from 'lucide-react'

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
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

// ---------- Contracts (mirror the P9-S2 API) ----------

type CountryStatus = 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'

interface AdminCountryRef {
  isoCode: string
  name: string
  status: CountryStatus
  isDefault: boolean
}

interface LaunchCheckDto {
  key: string
  label: string
  state: 'ok' | 'warn' | 'block'
  detail: string
}

interface ReadinessDto {
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
  checks: LaunchCheckDto[]
  blocks: number
  warnings: number
  availableActions: Array<'announce' | 'launch' | 'pause'>
  derivation: string
}

interface LifecycleResponse {
  readiness: ReadinessDto
  contract?: string
  reindex?: { ok: boolean; documentsWritten?: number; documentsRemoved?: number; error?: string } | null
}

const STATUS_LABELS: Record<CountryStatus, string> = {
  ACTIVE: 'Live',
  COMING_SOON: 'Coming soon',
  INACTIVE: 'Paused / staged',
}

const STATUS_STYLES: Record<CountryStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  COMING_SOON: 'border-amber-200 bg-amber-50 text-amber-700',
  INACTIVE: 'border-zinc-300 bg-zinc-100 text-zinc-600',
}

const ACTION_META = {
  announce: {
    label: 'Announce',
    icon: Megaphone,
    hint: 'INACTIVE → COMING_SOON. The market is publicly acknowledged as announced — homepage hero, switcher "soon" tag, sitemap quiet state. No content requirement: announcing is a marketing state.',
    className: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100',
  },
  launch: {
    label: 'Launch',
    icon: Rocket,
    hint: '→ ACTIVE. The controlled go-live: hard invariants enforced, launchedAt stamped, the search index rebuilt. Advisory warnings do not block — they are recorded with the launch.',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  },
  pause: {
    label: 'Pause',
    icon: PauseCircle,
    hint: '→ INACTIVE. Hidden from every public surface (switcher, homepage, sitemap, search index); all content and configuration preserved. Reversible via announce/launch.',
    className: 'border-zinc-300 bg-zinc-50 text-zinc-700 hover:bg-zinc-100',
  },
} as const

// ---------- Panel ----------

export function LaunchPanel() {
  const { token, user, permissions } = useAuth()
  const { toast } = useToast()
  const canManage = permissions.includes('country-config:manage') && user?.status === 'ACTIVE'

  const [markets, setMarkets] = useState<AdminCountryRef[] | null>(null)
  const [selectedIso, setSelectedIso] = useState<string>('')
  const [readiness, setReadiness] = useState<ReadinessDto | null>(null)
  const [loadingReadiness, setLoadingReadiness] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busyAction, setBusyAction] = useState<'announce' | 'launch' | 'pause' | null>(null)
  const [confirming, setConfirming] = useState<'announce' | 'launch' | 'pause' | null>(null)
  const [lastResult, setLastResult] = useState<LifecycleResponse | null>(null)

  // The admin list sees INACTIVE markets too (a pause must not hide the
  // market from the very console that manages its relaunch).
  useEffect(() => {
    if (!canManage || !token) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/countries?include=inactive', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as
          | { status: 'ok'; data: { countries: AdminCountryRef[] } }
          | { status: 'error'; error: { message: string } }
        if (cancelled) return
        if (payload.status === 'ok') {
          setMarkets(payload.data.countries)
          const firstNonDefault = payload.data.countries.find((market) => !market.isDefault)
          setSelectedIso((current) => current || firstNonDefault?.isoCode || payload.data.countries[0]?.isoCode || '')
        } else {
          setLoadError(payload.error.message)
        }
      } catch {
        if (!cancelled) setLoadError('Could not reach /api/countries')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManage, token])

  const loadReadiness = useCallback(
    async (iso: string) => {
      if (!token || !iso) return
      setLoadingReadiness(true)
      setLoadError(null)
      try {
        const response = await fetch(`/api/countries/${encodeURIComponent(iso)}/launch-readiness`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as
          | { status: 'ok'; data: { readiness: ReadinessDto } }
          | { status: 'error'; error: { message: string; code: string } }
        if (payload.status === 'ok') {
          setReadiness(payload.data.readiness)
        } else {
          setReadiness(null)
          setLoadError(payload.error.message)
        }
      } catch {
        setReadiness(null)
        setLoadError('Could not reach the launch-readiness endpoint')
      } finally {
        setLoadingReadiness(false)
      }
    },
    [token]
  )

  useEffect(() => {
    if (canManage && selectedIso) void loadReadiness(selectedIso)
  }, [canManage, selectedIso, loadReadiness])

  const runAction = useCallback(
    async (action: 'announce' | 'launch' | 'pause') => {
      if (!token || !selectedIso) return
      setBusyAction(action)
      try {
        const response = await fetch(`/api/countries/${encodeURIComponent(selectedIso)}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
        })
        const payload = (await response.json()) as
          | { status: 'ok'; data: LifecycleResponse }
          | { status: 'error'; error: { message: string; code: string } }
        if (payload.status === 'ok') {
          setLastResult(payload.data)
          setReadiness(payload.data.readiness)
          setNote('')
          toast({
            title: `${ACTION_META[action].label} completed`,
            description: `${payload.data.readiness.country.name} is now ${STATUS_LABELS[payload.data.readiness.country.status]}.`,
          })
          // B3: tell the app shell to refetch its /api/countries config —
          // the header switcher must reflect the new market state without a
          // full page reload (the shell listens for this event).
          window.dispatchEvent(new CustomEvent('gksetu:locale-config-changed'))
          // Refresh the market list (statuses changed).
          const listResponse = await fetch('/api/countries?include=inactive', {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          })
          const listPayload = (await listResponse.json()) as
            | { status: 'ok'; data: { countries: AdminCountryRef[] } }
            | { status: 'error' }
          if (listPayload.status === 'ok') setMarkets(listPayload.data.countries)
        } else {
          toast({
            title: `${ACTION_META[action].label} refused`,
            description: payload.error.message,
            variant: 'destructive',
          })
        }
      } catch {
        toast({
          title: 'Network error',
          description: `Could not reach the ${action} endpoint.`,
          variant: 'destructive',
        })
      } finally {
        setBusyAction(null)
        setConfirming(null)
      }
    },
    [token, selectedIso, note, toast]
  )

  if (!canManage) {
    return (
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Market launch lifecycle</CardTitle>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              P9-S2
            </Badge>
          </div>
          <CardDescription>
            The country launch configuration: derived readiness, the announce/launch/pause state
            machine and the §15 geo routing signal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-600">
            The launch lifecycle is a platform configuration workspace (country-config:manage,
            §38) — this account does not hold it. The public country switcher and every launched
            market&apos;s pages remain fully available.
          </p>
        </CardContent>
      </Card>
    )
  }

  const selectedMarket = markets?.find((market) => market.isoCode === selectedIso) ?? null

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Rocket className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <CardTitle className="text-base">Market launch lifecycle</CardTitle>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            P9-S2
          </Badge>
        </div>
        <CardDescription>
          INACTIVE (staged/paused) → COMING_SOON (announced, not routable) → ACTIVE (live). Status
          changes only through these transitions — raw PATCH edits are refused. Readiness is
          derived from live data (§34), never a stored checklist.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Market selector — admins see paused/staged markets too */}
        <div className="max-w-sm space-y-1.5">
          <Label htmlFor="launch-market-select" className="text-sm font-medium text-zinc-700">
            Market
          </Label>
          <Select value={selectedIso} onValueChange={setSelectedIso} disabled={!markets}>
            <SelectTrigger id="launch-market-select" className="h-11 w-full" aria-label="Market">
              <SelectValue placeholder={markets ? 'Select a market' : 'Loading…'} />
            </SelectTrigger>
            <SelectContent>
              {(markets ?? []).map((market) => (
                <SelectItem key={market.isoCode} value={market.isoCode} className="text-sm">
                  {market.name}
                  {market.isDefault ? ' · default root' : ''}
                  {' · '}
                  {STATUS_LABELS[market.status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loadError ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
        ) : loadingReadiness || (!readiness && selectedIso) ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : readiness ? (
          <>
            {/* State summary */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`font-medium ${STATUS_STYLES[readiness.country.status]}`}>
                {STATUS_LABELS[readiness.country.status]}
              </Badge>
              {readiness.country.isDefault ? (
                <span className="text-xs text-zinc-500">
                  Default root market — live by definition (§14); its lifecycle is frozen.
                </span>
              ) : (
                <span className="text-xs text-zinc-500">
                  {readiness.country.launchedAt
                    ? `First launched ${new Date(readiness.country.launchedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} — the stamp never rewrites (§36 spirit).`
                    : 'Never launched.'}
                </span>
              )}
              <span className="text-xs text-zinc-500">
                {readiness.blocks} blocking · {readiness.warnings} advisory
              </span>
            </div>

            {/* The derived checklist */}
            <motion.ul
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="space-y-1.5"
              aria-label="Launch readiness checklist"
            >
              {readiness.checks.map((check) => (
                <li
                  key={check.key}
                  className="flex items-start gap-2.5 rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2"
                >
                  {check.state === 'ok' ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : check.state === 'warn' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-800">{check.label}</p>
                    <p className="text-xs leading-relaxed text-zinc-600">{check.detail}</p>
                  </div>
                </li>
              ))}
            </motion.ul>

            {/* Actions */}
            {!readiness.country.isDefault ? (
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap gap-2">
                  {(['announce', 'launch', 'pause'] as const).map((action) => {
                    const available = readiness.availableActions.includes(action)
                    const meta = ACTION_META[action]
                    const Icon = meta.icon
                    return (
                      <Button
                        key={action}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!available || busyAction !== null}
                        title={meta.hint}
                        aria-label={`${meta.label} ${readiness.country.name} — ${meta.hint}`}
                        className={`h-9 gap-1.5 text-xs ${meta.className}`}
                        onClick={() => {
                          setLastResult(null)
                          setConfirming(confirming === action ? null : action)
                        }}
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
                    <div className="space-y-1">
                      <Label htmlFor="launch-note" className="text-xs font-medium text-zinc-600">
                        Operator note (optional — kept in the audit trail, §30)
                      </Label>
                      <Input
                        id="launch-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        placeholder={`Why ${readiness.country.name} is being ${confirming === 'launch' ? 'launched' : confirming === 'pause' ? 'paused' : 'announced'}…`}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                        disabled={busyAction !== null}
                        onClick={() => void runAction(confirming)}
                      >
                        {busyAction === confirming ? (
                          <RotateCcw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Confirm {ACTION_META[confirming].label}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 text-xs"
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
            ) : (
              <p className="text-xs text-zinc-500">
                The default root market (India at &quot;/&quot;) is live by definition — announce,
                launch and pause do not apply to it (§14/§16).
              </p>
            )}

            {/* Last transition result — the honest contract string */}
            {lastResult && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                role="status"
                aria-live="polite"
              >
                <p className="text-xs font-medium text-emerald-800">
                  {lastResult.readiness.country.name} → {STATUS_LABELS[lastResult.readiness.country.status]}
                </p>
                {lastResult.contract && (
                  <p className="text-xs leading-relaxed text-emerald-700">{lastResult.contract}</p>
                )}
                {lastResult.reindex && (
                  <p className="text-xs leading-relaxed text-emerald-700">
                    {lastResult.reindex.ok
                      ? `Search index rebuilt: ${lastResult.reindex.documentsWritten ?? 0} document(s) written, ${lastResult.reindex.documentsRemoved ?? 0} removed (§17).`
                      : `Index rebuild issue: ${lastResult.reindex.error ?? 'unknown'} — the transition itself is committed.`}
                  </p>
                )}
              </motion.div>
            )}

            <p className="text-xs leading-relaxed text-zinc-500">{readiness.derivation}</p>
          </>
        ) : selectedMarket ? (
          <p className="text-sm text-zinc-600">Select a market to derive its launch readiness.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
