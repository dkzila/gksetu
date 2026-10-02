'use client'

/**
 * GKSetu Console — Settings: shared contracts + the Integrations and Custom
 * keys tabs (CONSOLE-S1-F). Wired to /api/settings (settings:manage).
 *
 * The key vocabulary below MIRRORS src/modules/site-settings/service.ts
 * (PUBLIC_SETTING_KEYS / KNOWN_SETTING_KEYS / SETTING_KEY_LABELS) — copied,
 * never imported: that module pulls Prisma into its import graph and must
 * never reach a client bundle. Keep both lists in sync.
 */
import { useMemo, useState } from 'react'
import { Check, KeyRound, Loader2, Plus, Save, Trash2 } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { fieldErrorMap, useConsoleApi } from '@/components/console/ui/console-api'
import { formatWhen } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { Field, SwitchField, TextArea, TextInput } from '@/components/console/ui/form-fields'

// ---------- The key vocabulary (mirrors src/modules/site-settings/service.ts) ----------

/** The ONLY keys /api/settings/public serves — injected on the public site. */
export const PUBLIC_SETTING_KEYS = [
  'integration.ga.measurementId',
  'integration.gtm.containerId',
  'integration.gsc.verificationToken',
  'integration.bing.verificationToken',
  'integration.facebook.pixelId',
  'integration.headCode',
  'integration.bodyStartCode',
  'ads.txt',
  'robots.extraDirectives',
] as const

/** The known, structured keys this page renders as typed fields. */
export const KNOWN_SETTING_KEYS = [
  ...PUBLIC_SETTING_KEYS,
  'secrets.searchEngine.apiKey',
  'secrets.analytics.apiSecret',
] as const

export const SETTING_KEY_LABELS: Record<string, string> = {
  'integration.ga.measurementId': 'Google Analytics — Measurement ID (G-…)',
  'integration.gtm.containerId': 'Google Tag Manager — Container ID (GTM-…)',
  'integration.gsc.verificationToken': 'Google Search Console — Verification token (meta tag)',
  'integration.bing.verificationToken': 'Bing Webmaster — Verification token',
  'integration.facebook.pixelId': 'Facebook / Meta — Pixel ID',
  'integration.headCode': 'Custom code — injected into <head> (raw HTML)',
  'integration.bodyStartCode': 'Custom code — injected after <body> opens (raw HTML)',
  'ads.txt': 'ads.txt — served at /ads.txt (raw file content)',
  'robots.extraDirectives': 'robots.txt — extra directives (appended, one per line)',
  'secrets.searchEngine.apiKey': 'Search Engine — API key (private)',
  'secrets.analytics.apiSecret': 'Analytics — API secret (private)',
}

/** Keys rendered as mono textareas (multi-line raw payloads). */
const CODE_KEYS = new Set<string>([
  'integration.headCode',
  'integration.bodyStartCode',
  'ads.txt',
  'robots.extraDirectives',
])

export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/

// ---------- Contracts (mirror src/modules/site-settings/service.ts) ----------

export interface AdminSettingRow {
  id: string
  key: string
  value: string
  isActive: boolean
  countryIso: string | null
  updatedAt: string
  updatedBy: { email: string | null } | null
}

export interface AdminSettingsView {
  global: AdminSettingRow[]
  byCountry: Array<{ countryIso: string; countryName: string; rows: AdminSettingRow[] }>
  countries: Array<{ isoCode: string; name: string }>
}

export function isPublicKey(key: string): boolean {
  return (PUBLIC_SETTING_KEYS as readonly string[]).includes(key)
}

// ---------- Shared UI atoms ----------

export function ScopeBadge({ settingKey }: { settingKey: string }) {
  return isPublicKey(settingKey) ? (
    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700">
      public · injected on site
    </Badge>
  ) : (
    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 px-1.5 py-0 text-[10px] font-medium text-zinc-500">
      private · admin-only
    </Badge>
  )
}

// ==================================================================
// Integrations tab
// ==================================================================

interface FieldGroup {
  title: string
  description: string
  keys: string[]
}

const FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Analytics & tags',
    description: 'Injected on every public page load — leave a value empty to disable that integration.',
    keys: [
      'integration.ga.measurementId',
      'integration.gtm.containerId',
      'integration.facebook.pixelId',
      'integration.gsc.verificationToken',
      'integration.bing.verificationToken',
    ],
  },
  {
    title: 'Custom injection',
    description: 'Raw HTML (including <script> tags) injected into the document — served exactly as written, empty = nothing injected.',
    keys: ['integration.headCode', 'integration.bodyStartCode'],
  },
  {
    title: 'Monetisation & crawling',
    description: 'ads.txt is served verbatim at /ads.txt; the robots directives are appended to the generated /robots.txt.',
    keys: ['ads.txt', 'robots.extraDirectives'],
  },
  {
    title: 'Private API keys',
    description: 'Never served to browsers — admin-only registry values for backend integrations.',
    keys: ['secrets.searchEngine.apiKey', 'secrets.analytics.apiSecret'],
  },
]

export function IntegrationsTab({
  globalRows,
  onSaved,
}: {
  globalRows: AdminSettingRow[]
  onSaved: () => void
}) {
  const api = useConsoleApi()
  const { toast } = useToast()

  const initialValues = useMemo(() => {
    const map: Record<string, string> = {}
    for (const key of KNOWN_SETTING_KEYS) map[key] = ''
    for (const row of globalRows) map[row.key] = row.value
    return map
  }, [globalRows])

  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const [saving, setSaving] = useState(false)

  const dirtyKeys = useMemo(
    () => KNOWN_SETTING_KEYS.filter((key) => (values[key] ?? '') !== (initialValues[key] ?? '')),
    [values, initialValues]
  )

  const changed = dirtyKeys.length > 0

  const save = async () => {
    if (saving || dirtyKeys.length === 0) return
    setSaving(true)
    const entries = dirtyKeys.map((key) => ({ key, value: values[key] ?? '' }))
    const { error } = await api.put<{ applied: number }>('/api/settings', { entries })
    if (error) {
      setSaving(false)
      toast({ title: 'Could not save settings', description: error.message, variant: 'destructive' })
      return
    }
    toast({
      title: `Saved ${entries.length} setting${entries.length === 1 ? '' : 's'}`,
      description: 'Applied without a redeploy — the public site picks values up on its next page load.',
    })
    onSaved()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          The no-redeploy integration registry: values apply the moment they are saved — no rebuild, no
          restart. An <span className="font-medium text-zinc-700">empty value clears</span> the
          integration (the injector skips empties). Public keys are injected on the site; private keys
          never leave the admin surface.
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => void save()}
            disabled={saving || !changed}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Save changes{changed ? ` (${dirtyKeys.length})` : ''}
          </Button>
        </div>
      </div>

      {changed && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-800">
          <span>
            {dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? '' : 's'} — emptying a field clears
            that integration on save.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
            onClick={() => setValues(initialValues)}
            disabled={saving}
          >
            Discard
          </Button>
        </div>
      )}

      {FIELD_GROUPS.map((group) => (
        <div key={group.title} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-zinc-800">{group.title}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{group.description}</p>
          </div>
          <div className="space-y-4 px-4 py-4">
            {group.keys.map((key) => (
              <Field key={key} label={SETTING_KEY_LABELS[key] ?? key} htmlFor={`setting-${key}`}>
                {CODE_KEYS.has(key) ? (
                  <TextArea
                    id={`setting-${key}`}
                    value={values[key] ?? ''}
                    onChange={(value) => setValues((state) => ({ ...state, [key]: value }))}
                    rows={4}
                    mono
                    placeholder={
                      key === 'ads.txt'
                        ? 'google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0'
                        : key === 'robots.extraDirectives'
                          ? 'Disallow: /private/'
                          : '<script>…</script>'
                    }
                  />
                ) : (
                  <TextInput
                    id={`setting-${key}`}
                    value={values[key] ?? ''}
                    onChange={(value) => setValues((state) => ({ ...state, [key]: value }))}
                    placeholder={
                      key === 'integration.ga.measurementId'
                        ? 'G-XXXXXXXXXX'
                        : key === 'integration.gtm.containerId'
                          ? 'GTM-XXXXXXX'
                          : key === 'integration.gsc.verificationToken'
                            ? 'google-site-verification token'
                            : ''
                    }
                    className={key.startsWith('secrets.') ? 'font-mono' : undefined}
                  />
                )}
                <div className="flex items-center gap-2 pt-1">
                  <ScopeBadge settingKey={key} />
                  {(values[key] ?? '') === (initialValues[key] ?? '') ? null : (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600">unsaved</span>
                  )}
                  {(initialValues[key] ?? '') !== '' && (
                    <span className="text-[10px] text-zinc-300">set</span>
                  )}
                </div>
              </Field>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ==================================================================
// Custom keys tab
// ==================================================================

export function CustomKeysTab({
  globalRows,
  onSaved,
}: {
  globalRows: AdminSettingRow[]
  onSaved: () => void
}) {
  const api = useConsoleApi()
  const { toast } = useToast()

  const customRows = useMemo(
    () => globalRows.filter((row) => !(KNOWN_SETTING_KEYS as readonly string[]).includes(row.key)),
    [globalRows]
  )

  const [addOpen, setAddOpen] = useState(false)
  const [addKey, setAddKey] = useState('')
  const [addValue, setAddValue] = useState('')
  const [addActive, setAddActive] = useState(true)
  const [addFieldErrors, setAddFieldErrors] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState(false)

  const [editRow, setEditRow] = useState<AdminSettingRow | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editActive, setEditActive] = useState(true)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [editingBusy, setEditingBusy] = useState(false)

  const [deleteRow, setDeleteRow] = useState<AdminSettingRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const submitAdd = async () => {
    if (adding) return
    setAdding(true)
    setAddFieldErrors({})
    const key = addKey.trim().toLowerCase()
    if (!SETTING_KEY_PATTERN.test(key) || key.length > 120) {
      setAddFieldErrors({ key: 'Keys are dotted, lowercase, ≥2 segments (e.g. secrets.foo.bar)' })
      setAdding(false)
      return
    }
    const { error } = await api.put('/api/settings', {
      entries: [{ key, value: addValue, isActive: addActive }],
    })
    setAdding(false)
    if (error) {
      setAddFieldErrors(fieldErrorMap(error.details))
      toast({ title: 'Could not add the key', description: error.message, variant: 'destructive' })
      return
    }
    setAddOpen(false)
    setAddKey('')
    setAddValue('')
    setAddActive(true)
    toast({ title: 'Key added', description: `${key} is in the registry — global scope.` })
    onSaved()
  }

  const submitEdit = async () => {
    if (!editRow || editingBusy) return
    setEditingBusy(true)
    setEditErrors({})
    const { error } = await api.put('/api/settings', {
      entries: [{ key: editRow.key, value: editValue, isActive: editActive }],
    })
    setEditingBusy(false)
    if (error) {
      setEditErrors(fieldErrorMap(error.details))
      toast({ title: 'Could not save the key', description: error.message, variant: 'destructive' })
      return
    }
    setEditRow(null)
    toast({ title: 'Key saved', description: `${editRow.key} updated.` })
    onSaved()
  }

  const submitDelete = async () => {
    if (!deleteRow || deleting) return
    setDeleting(true)
    const { error } = await api.del(`/api/settings?key=${encodeURIComponent(deleteRow.key)}`)
    setDeleting(false)
    if (error) {
      toast({ title: 'Could not remove the key', description: error.message, variant: 'destructive' })
      return
    }
    toast({ title: 'Key removed', description: `${deleteRow.key} is out of the registry.` })
    setDeleteRow(null)
    onSaved()
  }

  const columns: Array<ResourceColumn<AdminSettingRow>> = [
    {
      key: 'key',
      header: 'Key',
      className: 'min-w-[240px]',
      render: (row) => (
        <div className="min-w-0">
          <code className="break-all font-mono text-xs font-medium text-zinc-700">{row.key}</code>
          <div className="mt-0.5">
            <ScopeBadge settingKey={row.key} />
          </div>
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      render: (row) => (
        <code className="block max-w-[280px] truncate font-mono text-xs text-zinc-500" title={row.value}>
          {row.value === '' ? <span className="text-zinc-300">(empty)</span> : row.value}
        </code>
      ),
    },
    {
      key: 'isActive',
      header: 'Active',
      render: (row) =>
        row.isActive ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-label="active" />
        ) : (
          <span className="text-zinc-300">—</span>
        ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (row) => <span className="text-[12px] text-zinc-500">{formatWhen(row.updatedAt)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-[13px] leading-relaxed text-zinc-500">
          Every registry key outside the known set — private integrations, feature flags, anything the
          team stashes. Keys are dotted and lowercase (≥2 segments, e.g.{' '}
          <code className="rounded bg-zinc-100 px-1 font-mono text-[11px]">secrets.foo.bar</code>);
          only keys on the public whitelist are ever served to browsers.
        </p>
        <Button
          size="sm"
          className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={() => {
            setAddKey('')
            setAddValue('')
            setAddActive(true)
            setAddFieldErrors({})
            setAddOpen(true)
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add key
        </Button>
      </div>

      <ResourceTable
        columns={columns}
        rows={customRows}
        rowKey={(row) => row.id}
        emptyTitle="No custom keys"
        emptyHint="Anything you add here lands in the global registry — useful for private API keys and operational flags."
        actions={(row) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-1"
              title="Edit value"
              aria-label="Edit value"
              onClick={() => {
                setEditRow(row)
                setEditValue(row.value)
                setEditActive(row.isActive)
                setEditErrors({})
              }}
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-1 text-red-600 hover:bg-red-50"
              title="Remove from the registry"
              aria-label="Remove from the registry"
              onClick={() => setDeleteRow(row)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </>
        )}
      />

      {/* Add key */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a custom key</DialogTitle>
            <DialogDescription>
              Creates (or updates) a global registry row. Unknown keys are private by default — they
              are never injected on the public site.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Key" htmlFor="custom-key" required error={addFieldErrors.key} hint="dotted, lowercase, ≥2 segments — e.g. secrets.searchengine.apiKey">
              <TextInput
                id="custom-key"
                value={addKey}
                onChange={(value) => setAddKey(value.toLowerCase())}
                placeholder="secrets.partner.apiKey"
                invalid={Boolean(addFieldErrors.key)}
              />
            </Field>
            <Field label="Value" htmlFor="custom-value" error={addFieldErrors.value}>
              <TextArea
                id="custom-value"
                value={addValue}
                onChange={setAddValue}
                rows={4}
                mono
                placeholder="The stored value…"
              />
            </Field>
            <SwitchField
              label="Active"
              checked={addActive}
              onChange={setAddActive}
              hint="Inactive rows are kept but skipped by readers."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitAdd()}
              disabled={adding || addKey.trim() === ''}
            >
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Add key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit key */}
      <Dialog open={editRow !== null} onOpenChange={(open) => !open && setEditRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="break-all font-mono text-base">{editRow?.key}</DialogTitle>
            <DialogDescription>
              The key is the registry identity — only the value and the active flag can change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Value" htmlFor="edit-value" error={editErrors.value}>
              <TextArea
                id="edit-value"
                value={editValue}
                onChange={setEditValue}
                rows={5}
                mono
                placeholder="The stored value…"
              />
            </Field>
            <SwitchField label="Active" checked={editActive} onChange={setEditActive} hint="Inactive rows are kept but skipped by readers." />
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditRow(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitEdit()}
              disabled={editingBusy}
            >
              {editingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete key */}
      <AlertDialog open={deleteRow !== null} onOpenChange={(open) => !open && setDeleteRow(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-all">Remove “{deleteRow?.key}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The registry row is deleted (global scope). Anything reading this key falls back to its
              default — the operation is immediate and audited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void submitDelete()
              }}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              Remove key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
