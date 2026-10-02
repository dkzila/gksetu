'use client'

/**
 * GKSetu Console — Settings (CONSOLE-S1-F): the no-redeploy integration
 * registry + the market configuration center, wired to /api/settings,
 * /api/countries* and /api/languages*.
 *
 * Tabs: Integrations (the known keys as structured form cards), Custom keys
 * (the rest of the registry), Countries & languages (markets, the launch
 * lifecycle, the language registry).
 */
import { useCallback, useEffect, useState } from 'react'
import { Globe2, KeyRound, RefreshCw, Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { useConsoleApi } from '@/components/console/ui/console-api'
import { ConsolePageHeader, ErrorNotice } from '@/components/console/ui/primitives'

import { CustomKeysTab, IntegrationsTab, KNOWN_SETTING_KEYS, type AdminSettingsView } from './settings-parts'
import { CountriesTab } from './settings-countries'

export function SettingsPage() {
  const api = useConsoleApi()

  const [view, setView] = useState<AdminSettingsView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Bumps after every successful write — remounts tab forms with fresh values. */
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error } = await api.get<AdminSettingsView>('/api/settings')
    if (error) {
      setError(error.message)
      setView(null)
    } else {
      setView(data)
    }
    setLoading(false)
  }, [api])

  useEffect(() => {
    // Deferred (set-state-in-effect guard — the loader sets state up front).
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [load])

  const onSaved = useCallback(() => {
    setReloadKey((key) => key + 1)
  }, [])

  const globalRows = view?.global ?? []
  const customKeyCount = globalRows.filter(
    (row) => !(KNOWN_SETTING_KEYS as readonly string[]).includes(row.key)
  ).length
  const overrideCount = view?.byCountry.reduce((total, entry) => total + entry.rows.length, 0) ?? 0

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Settings"
        description="The platform's no-redeploy configuration: analytics and verification integrations, ads.txt and robots, custom registry keys, and the market configuration — every value applies on save, never on deploy."
        icon={<Settings2 className="h-5 w-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {error && <ErrorNotice message={error} onRetry={() => void load()} />}

      <Tabs defaultValue="integrations" className="space-y-4">
        <TabsList className="h-9 bg-zinc-100 p-1">
          <TabsTrigger
            value="integrations"
            className="h-7 gap-1.5 px-3 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            Integrations
          </TabsTrigger>
          <TabsTrigger
            value="custom"
            className="h-7 gap-1.5 px-3 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700"
          >
            Custom keys
            {customKeyCount > 0 && (
              <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700">
                {customKeyCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="countries"
            className="h-7 gap-1.5 px-3 text-[13px] data-[state=active]:bg-white data-[state=active]:text-emerald-700"
          >
            <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
            Countries &amp; languages
          </TabsTrigger>
        </TabsList>

        <TabsContent value="integrations" className="space-y-4">
          {loading && !view ? (
            <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
              <div className="h-6 w-48 animate-pulse rounded bg-zinc-100" />
              <div className="h-8 w-full animate-pulse rounded bg-zinc-100" />
              <div className="h-8 w-full animate-pulse rounded bg-zinc-100" />
              <div className="h-8 w-2/3 animate-pulse rounded bg-zinc-100" />
            </div>
          ) : (
            <IntegrationsTab key={`integrations-${reloadKey}`} globalRows={globalRows} onSaved={onSaved} />
          )}
        </TabsContent>

        <TabsContent value="custom" className="space-y-4">
          {loading && !view ? (
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-4">
              <div className="h-8 w-full animate-pulse rounded bg-zinc-100" />
              <div className="h-8 w-full animate-pulse rounded bg-zinc-100" />
              <div className="h-8 w-3/4 animate-pulse rounded bg-zinc-100" />
            </div>
          ) : (
            <CustomKeysTab key={`custom-${reloadKey}`} globalRows={globalRows} onSaved={onSaved} />
          )}
        </TabsContent>

        <TabsContent value="countries" className="space-y-4">
          <CountriesTab />
        </TabsContent>
      </Tabs>

      {view && overrideCount > 0 && (
        <p className="text-[11px] leading-relaxed text-zinc-400">
          {overrideCount} per-market setting override{overrideCount === 1 ? ' is' : 's are'} live (
          {view.byCountry.map((entry) => `${entry.countryIso} (${entry.rows.length})`).join(', ')}) —
          country rows override the global value for that market only.
        </p>
      )}
    </div>
  )
}
