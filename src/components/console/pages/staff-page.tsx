'use client'

/**
 * GKSetu Console — Staff (CONSOLE-S1-F): the workspace provisioning surface,
 * wired to /api/workspaces + /api/workspaces/[iso] + /api/workspaces/[iso]/
 * staff* following the P9-S3 workspace-section demo's exact patterns.
 *
 * §20 invite semantics: the operator NEVER chooses a password — the server
 * generates a one-time credential, reveals it ONCE in the response, and stores
 * only its scrypt hash. Suspension (not deletion) is the removal path: §36
 * spirit — sessions are revoked immediately, the account row and its history
 * stand, and reactivation is reversible. There is no member-delete API by
 * design.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

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
import {
  ConsolePageHeader,
  ErrorNotice,
  formatWhen,
  StatusBadge,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { Field, SelectInput, TextInput } from '@/components/console/ui/form-fields'

// ---------- Contracts (mirror src/modules/workspaces/types.ts) ----------

type CountryStatus = 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'

interface WorkspaceCountryRef {
  isoCode: string
  slug: string
  name: string
  status: CountryStatus
  isDefault: boolean
  launchedAt: string | null
  timezone: string | null
  defaultLanguage: { code: string; name: string } | null
  languages: Array<{ code: string; name: string }>
}

interface WorkspaceSummary {
  country: WorkspaceCountryRef
  stats: {
    staffByRole: { writer: number; countryAdmin: number; platformAdmin: number }
    suspended: number
    unstaffedLanguages: string[]
  }
  board: { open: number; inProgress: number; resolved: number; cancelled: number }
}

interface StaffMember {
  id: string
  email: string
  name: string | null
  role: 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  languageScope: { code: string; name: string } | null
  preferredLanguage: { code: string; name: string } | null
  lastLoginAt: string | null
  createdAt: string
  isSelf: boolean
}

interface WorkspaceDetail extends WorkspaceSummary {
  staff: StaffMember[]
  coverage: Array<{ code: string; name: string; isDefault: boolean; staffCount: number; publishedPages: number }>
  canManage: boolean
  contract: string
}

const ALL_LANGUAGES = '__all__'

function roleBadgeClass(role: StaffMember['role']): string {
  if (role === 'ADMIN') return 'border-zinc-200 bg-zinc-50 text-zinc-500'
  if (role === 'COUNTRY_ADMIN') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

// ==================================================================

export function StaffPage() {
  const api = useConsoleApi()
  const { toast } = useToast()
  const user = useAuth((state) => state.user)

  const [summaries, setSummaries] = useState<WorkspaceSummary[]>([])
  const [selectedIso, setSelectedIso] = useState<string | null>(null)
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  // Invite dialog.
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'WRITER' as 'WRITER' | 'COUNTRY_ADMIN',
    languageScopeCode: ALL_LANGUAGES,
  })
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({})
  const [inviting, setInviting] = useState(false)

  // The reveal-once credential dialog (invite + reset share it).
  const [revealed, setRevealed] = useState<{ email: string; credential: string; note: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Edit member dialog.
  const [editMember, setEditMember] = useState<StaffMember | null>(null)
  const [editForm, setEditForm] = useState({ name: '', role: 'WRITER' as 'WRITER' | 'COUNTRY_ADMIN', languageScopeCode: ALL_LANGUAGES })
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [editingBusy, setEditingBusy] = useState(false)

  // Suspend / reset confirms.
  const [suspendTarget, setSuspendTarget] = useState<StaffMember | null>(null)
  const [resetTarget, setResetTarget] = useState<StaffMember | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // ---------- Loads ----------

  const loadWorkspaces = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    const { data, error } = await api.get<{ workspaces: WorkspaceSummary[] }>('/api/workspaces')
    if (error) {
      setListError(error.message)
      setSummaries([])
    } else {
      const workspaces = data?.workspaces ?? []
      setSummaries(workspaces)
      setSelectedIso((current) => {
        if (current && workspaces.some((entry) => entry.country.isoCode === current)) return current
        return (
          user?.homeCountry?.isoCode ??
          workspaces.find((entry) => entry.country.isDefault)?.country.isoCode ??
          workspaces[0]?.country.isoCode ??
          null
        )
      })
    }
    setListLoading(false)
  }, [api, user?.homeCountry?.isoCode])

  const loadDetail = useCallback(
    async (iso: string) => {
      setDetailLoading(true)
      const { data, error } = await api.get<WorkspaceDetail>(`/api/workspaces/${encodeURIComponent(iso)}`)
      if (error) {
        toast({ title: 'Could not load the workspace', description: error.message, variant: 'destructive' })
        setDetail(null)
      } else {
        setDetail(data ?? null)
      }
      setDetailLoading(false)
    },
    [api, toast]
  )

  useEffect(() => {
    // Deferred (set-state-in-effect guard — the loaders set state up front).
    const timer = setTimeout(() => {
      void loadWorkspaces()
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [loadWorkspaces])

  useEffect(() => {
    if (!selectedIso) return
    const timer = setTimeout(() => {
      void loadDetail(selectedIso)
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [selectedIso, loadDetail])

  const scopeOptions = detail?.country.languages ?? []
  const canManage = detail?.canManage === true

  // ---------- Invite ----------

  const submitInvite = async () => {
    if (!selectedIso || inviting) return
    setInviting(true)
    setInviteErrors({})
    const body: Record<string, unknown> = {
      email: inviteForm.email.trim(),
      role: inviteForm.role,
    }
    if (inviteForm.name.trim()) body.name = inviteForm.name.trim()
    if (inviteForm.role === 'WRITER' && inviteForm.languageScopeCode !== ALL_LANGUAGES) {
      body.languageScopeCode = inviteForm.languageScopeCode
    }
    const { data, error } = await api.post<{
      member: StaffMember
      oneTimePassword: string
      revealNotice: string
    }>(`/api/workspaces/${encodeURIComponent(selectedIso)}/staff`, body)
    setInviting(false)
    if (error) {
      setInviteErrors(fieldErrorMap(error.details))
      toast({ title: 'Could not invite', description: error.message, variant: 'destructive' })
      return
    }
    setInviteOpen(false)
    setInviteForm({ email: '', name: '', role: 'WRITER', languageScopeCode: ALL_LANGUAGES })
    setRevealed({
      email: data!.member.email,
      credential: data!.oneTimePassword,
      note: data!.revealNotice,
    })
    setCopied(false)
    toast({
      title: 'Staff invited',
      description: `${data!.member.email} joined the ${detail?.country.name} workspace — hand over the one-time credential once.`,
    })
    await loadDetail(selectedIso)
  }

  // ---------- Patch helper (edit / suspend / reset / scope) ----------

  const patchMember = async (
    member: StaffMember,
    body: Record<string, unknown>,
    successTitle: string,
    successDescription: string
  ): Promise<boolean> => {
    if (!selectedIso || busyId) return false
    setBusyId(member.id)
    const { data, error } = await api.patch<{
      member: StaffMember
      oneTimePassword: string | null
      revealNotice: string | null
    }>(`/api/workspaces/${encodeURIComponent(selectedIso)}/staff/${member.id}`, body)
    setBusyId(null)
    if (error) {
      toast({ title: 'Could not update', description: error.message, variant: 'destructive' })
      return false
    }
    if (data?.oneTimePassword) {
      setRevealed({
        email: data.member.email,
        credential: data.oneTimePassword,
        note: data.revealNotice ?? 'Fresh one-time credential — revealed once, then only its scrypt hash exists.',
      })
      setCopied(false)
    }
    toast({ title: successTitle, description: successDescription })
    await loadDetail(selectedIso)
    return true
  }

  // ---------- Table ----------

  const columns: Array<ResourceColumn<StaffMember>> = useMemo(
    () => [
      {
        key: 'member',
        header: 'Member',
        className: 'min-w-[220px]',
        render: (member) => (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-zinc-800">{member.name ?? '—'}</span>
              {member.isSelf && (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700">
                  you
                </Badge>
              )}
            </div>
            <span className="text-[11px] text-zinc-400">{member.email}</span>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        render: (member) => (
          <Badge variant="outline" className={`px-2 py-0 text-[11px] font-medium ${roleBadgeClass(member.role)}`}>
            {member.role.replace(/_/g, ' ').toLowerCase()}
          </Badge>
        ),
      },
      {
        key: 'scope',
        header: 'Language scope',
        render: (member) => {
          if (member.role === 'ADMIN') return <span className="text-[11px] text-zinc-400">platform class</span>
          if (member.role === 'COUNTRY_ADMIN')
            return <span className="text-[11px] text-zinc-500">whole workspace</span>
          return member.languageScope ? (
            <code className="font-mono text-[11px] text-zinc-600">
              {member.languageScope.code} · {member.languageScope.name}
            </code>
          ) : (
            <span className="text-[11px] text-zinc-400">all languages</span>
          )
        },
      },
      {
        key: 'status',
        header: 'Status',
        render: (member) => <StatusBadge status={member.status === 'DELETED' ? 'SUSPENDED' : member.status} />,
      },
      {
        key: 'lastLoginAt',
        header: 'Last login',
        render: (member) => <span className="text-[12px] text-zinc-500">{member.lastLoginAt ? formatWhen(member.lastLoginAt) : 'never'}</span>,
      },
    ],
    []
  )

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Staff"
        description="Workspace members per market — invite with server-generated one-time credentials, adjust roles and language scopes, suspend or reactivate. Every mutation is audited; the credential never is."
        icon={<Users className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void loadWorkspaces()} disabled={listLoading}>
              <RefreshCw className={`h-3.5 w-3.5 ${listLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => {
                  setInviteForm({ email: '', name: '', role: 'WRITER', languageScopeCode: ALL_LANGUAGES })
                  setInviteErrors({})
                  setInviteOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Invite staff
              </Button>
            )}
          </>
        }
      />

      {listError && <ErrorNotice message={listError} onRetry={() => void loadWorkspaces()} />}

      {/* Market picker */}
      {summaries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {summaries.map((summary) => {
            const active = selectedIso === summary.country.isoCode
            return (
              <button
                key={summary.country.isoCode}
                type="button"
                onClick={() => setSelectedIso(summary.country.isoCode)}
                className={`rounded-lg border px-3 py-1.5 text-left transition-colors ${
                  active
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'
                }`}
                aria-pressed={active}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  {summary.country.name}
                  <StatusBadge status={summary.country.status} />
                  {summary.country.isDefault && (
                    <span className="text-[10px] font-normal text-emerald-600">default</span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">
                  {summary.stats.staffByRole.writer} writers · {summary.stats.staffByRole.countryAdmin} admin
                  {summary.stats.suspended > 0 ? ` · ${summary.stats.suspended} suspended` : ''}
                  {' · '}
                  {summary.country.languages.length} lang
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Stats + roster */}
      {detail ? (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal">
              {detail.stats.staffByRole.writer} WRITER
            </Badge>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
              {detail.stats.staffByRole.countryAdmin} COUNTRY_ADMIN
            </Badge>
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal text-zinc-500">
              {detail.stats.staffByRole.platformAdmin} platform ADMIN (§38 — never managed here)
            </Badge>
            {detail.stats.suspended > 0 && (
              <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-600">
                {detail.stats.suspended} suspended
              </Badge>
            )}
            {detail.stats.unstaffedLanguages.length > 0 && (
              <span className="text-amber-600">
                unstaffed: {detail.stats.unstaffedLanguages.join(', ')}
              </span>
            )}
          </div>

          {!canManage && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-[13px] text-zinc-500">
              Your workspace context (§38) — provisioning is operator work: it requires{' '}
              <code className="rounded bg-white px-1 font-mono text-[11px] ring-1 ring-zinc-200">staff:manage</code>.
            </div>
          )}

          <ResourceTable
            columns={columns}
            rows={detail.staff}
            rowKey={(member) => member.id}
            loading={detailLoading}
            emptyTitle="No staff in this workspace yet"
            emptyHint="Invite writers (optionally language-scoped) or a country admin — the server mints a one-time credential shown once."
            actions={(member) =>
              !canManage || member.isSelf || member.role === 'ADMIN' ? (
                <span className="text-[11px] text-zinc-300">{member.role === 'ADMIN' ? '§38' : member.isSelf ? 'self' : ''}</span>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-1"
                    title="Edit name / role / scope"
                    aria-label="Edit member"
                    onClick={() => {
                      setEditMember(member)
                      setEditForm({
                        name: member.name ?? '',
                        role: member.role === 'COUNTRY_ADMIN' ? 'COUNTRY_ADMIN' : 'WRITER',
                        languageScopeCode: member.languageScope?.code ?? ALL_LANGUAGES,
                      })
                      setEditErrors({})
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  {member.status === 'ACTIVE' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-1 text-red-600 hover:bg-red-50"
                      title="Suspend — revoke sessions immediately (reversible)"
                      aria-label="Suspend member"
                      disabled={busyId === member.id}
                      onClick={() => setSuspendTarget(member)}
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-1 text-emerald-700 hover:bg-emerald-50"
                      title="Reactivate — the account signs in again"
                      aria-label="Reactivate member"
                      disabled={busyId === member.id}
                      onClick={() =>
                        void patchMember(
                          member,
                          { status: 'ACTIVE' },
                          'Staff reactivated',
                          `${member.email} can sign in again — the account stood untouched through the suspension.`
                        )
                      }
                    >
                      <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-1 text-amber-700 hover:bg-amber-50"
                    title="Reset credential — a fresh one-time password"
                    aria-label="Reset credential"
                    disabled={busyId === member.id}
                    onClick={() => setResetTarget(member)}
                  >
                    <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </>
              )
            }
          />

          {/* Language coverage */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {detail.coverage.map((language) => (
              <div
                key={language.code}
                className={`rounded-lg border px-3 py-2 ${
                  language.staffCount === 0 ? 'border-amber-200 bg-amber-50/60' : 'border-zinc-200 bg-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs font-semibold text-zinc-700">{language.code}</code>
                  <span className="text-[12px] text-zinc-500">{language.name}</span>
                  {language.isDefault && (
                    <span className="text-[10px] font-medium text-emerald-600">default</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {language.staffCount} staff able to work it · {language.publishedPages} published pages
                  {language.staffCount === 0 ? ' — unstaffed' : ''}
                </p>
              </div>
            ))}
          </div>

          <p className="text-[11px] leading-relaxed text-zinc-400">{detail.contract}</p>
        </>
      ) : (
        listLoading && (
          <div className="space-y-2">
            <div className="h-10 w-full animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-10 w-full animate-pulse rounded-lg bg-zinc-100" />
          </div>
        )
      )}

      {/* ---------- Invite dialog ---------- */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite staff into {detail?.country.name ?? 'the workspace'}</DialogTitle>
            <DialogDescription>
              You never choose a password: the server generates a one-time credential, shows it to you
              ONCE, and stores only its scrypt hash. Hand it to the staff member over a secure channel.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="invite-email" required error={inviteErrors.email}>
                <TextInput
                  id="invite-email"
                  type="email"
                  value={inviteForm.email}
                  onChange={(value) => setInviteForm((state) => ({ ...state, email: value }))}
                  placeholder="who@example.org"
                  invalid={Boolean(inviteErrors.email)}
                />
              </Field>
              <Field label="Name (optional)" htmlFor="invite-name" error={inviteErrors.name}>
                <TextInput
                  id="invite-name"
                  value={inviteForm.name}
                  onChange={(value) => setInviteForm((state) => ({ ...state, name: value }))}
                  placeholder="Full name"
                />
              </Field>
            </div>
            <Field label="Role" htmlFor="invite-role" error={inviteErrors.role} hint="Writers never publish (§18) — publishing is a separate permission. A country admin owns the whole workspace.">
              <SelectInput
                id="invite-role"
                value={inviteForm.role}
                onChange={(value) =>
                  setInviteForm((state) => ({
                    ...state,
                    role: value as 'WRITER' | 'COUNTRY_ADMIN',
                    ...(value === 'COUNTRY_ADMIN' ? { languageScopeCode: ALL_LANGUAGES } : {}),
                  }))
                }
                options={[
                  { value: 'WRITER', label: 'WRITER — creates, never publishes' },
                  { value: 'COUNTRY_ADMIN', label: 'COUNTRY_ADMIN — owns the workspace' },
                ]}
              />
            </Field>
            {inviteForm.role === 'WRITER' && (
              <Field
                label="Language scope"
                htmlFor="invite-scope"
                error={inviteErrors.languageScopeCode}
                hint="A scoped writer can only work that language of this market (§20/§35, enforced server-side). All-languages is the default."
              >
                <SelectInput
                  id="invite-scope"
                  value={inviteForm.languageScopeCode}
                  onChange={(value) => setInviteForm((state) => ({ ...state, languageScopeCode: value }))}
                  options={[
                    { value: ALL_LANGUAGES, label: "All the market's languages" },
                    ...scopeOptions.map((language) => ({ value: language.code, label: `${language.code} · ${language.name}` })),
                  ]}
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void submitInvite()}
              disabled={inviting || !inviteForm.email.includes('@')}
            >
              {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
              Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Reveal-once credential ---------- */}
      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent className="max-w-lg border-amber-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-900">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              One-time credential for {revealed?.email}
            </DialogTitle>
            <DialogDescription className="text-amber-800">
              Store it now — it is shown ONCE. From now on it exists only as its scrypt hash; the next
              reveal requires a reset.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-3">
            <code className="select-all rounded-md bg-amber-100 px-3 py-2 font-mono text-sm font-semibold text-amber-900">
              {revealed?.credential}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                void navigator.clipboard?.writeText(revealed?.credential ?? '')
                setCopied(true)
                toast({ title: 'Copied', description: 'The one-time credential is on your clipboard.' })
              }}
            >
              {copied ? <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> : null}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {revealed?.note && <p className="text-[11px] leading-relaxed text-amber-700">{revealed.note}</p>}
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setRevealed(null)}>
              I&apos;ve stored it — dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Edit member ---------- */}
      <Dialog open={editMember !== null} onOpenChange={(open) => !open && setEditMember(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editMember?.name ?? editMember?.email}</DialogTitle>
            <DialogDescription>
              Role and scope changes are re-validated server-side (§20/§35) — cross-market effects are
              refused. Platform ADMIN rows are never managed through a workspace (§38).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Name" htmlFor="edit-name" error={editErrors.name}>
              <TextInput
                id="edit-name"
                value={editForm.name}
                onChange={(value) => setEditForm((state) => ({ ...state, name: value }))}
                placeholder="Full name"
              />
            </Field>
            <Field label="Role" htmlFor="edit-role" error={editErrors.role}>
              <SelectInput
                id="edit-role"
                value={editForm.role}
                onChange={(value) =>
                  setEditForm((state) => ({
                    ...state,
                    role: value as 'WRITER' | 'COUNTRY_ADMIN',
                    ...(value === 'COUNTRY_ADMIN' ? { languageScopeCode: ALL_LANGUAGES } : {}),
                  }))
                }
                options={[
                  { value: 'WRITER', label: 'WRITER — creates, never publishes' },
                  { value: 'COUNTRY_ADMIN', label: 'COUNTRY_ADMIN — owns the workspace' },
                ]}
              />
            </Field>
            {editForm.role === 'WRITER' && (
              <Field label="Language scope" htmlFor="edit-scope" error={editErrors.languageScopeCode} hint="Explicit null = all the market's configured languages.">
                <SelectInput
                  id="edit-scope"
                  value={editForm.languageScopeCode}
                  onChange={(value) => setEditForm((state) => ({ ...state, languageScopeCode: value }))}
                  options={[
                    { value: ALL_LANGUAGES, label: "All the market's languages" },
                    ...scopeOptions.map((language) => ({ value: language.code, label: `${language.code} · ${language.name}` })),
                  ]}
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditMember(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={async () => {
                if (!editMember || editingBusy) return
                setEditingBusy(true)
                setEditErrors({})
                const body: Record<string, unknown> = {
                  name: editForm.name.trim() === '' ? null : editForm.name.trim(),
                  role: editForm.role,
                }
                if (editForm.role === 'WRITER') {
                  body.languageScopeCode = editForm.languageScopeCode === ALL_LANGUAGES ? null : editForm.languageScopeCode
                }
                const ok = await patchMember(
                  editMember,
                  body,
                  'Member updated',
                  `${editMember.email} — role/scope adjusted (§20; re-validated server-side).`
                )
                setEditingBusy(false)
                if (ok) setEditMember(null)
              }}
              disabled={editingBusy}
            >
              {editingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              Save member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Suspend confirm ---------- */}
      <AlertDialog open={suspendTarget !== null} onOpenChange={(open) => !open && setSuspendTarget(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend {suspendTarget?.name ?? suspendTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every active session is revoked immediately. Nothing is deleted — the account row and its
              history stand, and reactivation is one click (§36 spirit). Suspension is GKSetu&apos;s
              removal path: there is deliberately no member-delete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8">Keep active</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 bg-red-600 text-white hover:bg-red-700"
              disabled={busyId !== null}
              onClick={(event) => {
                event.preventDefault()
                if (suspendTarget) {
                  void patchMember(
                    suspendTarget,
                    { status: 'SUSPENDED' },
                    'Staff suspended',
                    `${suspendTarget.email} — sessions revoked immediately; reactivation is reversible.`
                  ).then(() => setSuspendTarget(null))
                }
              }}
            >
              {busyId ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- Reset credential confirm ---------- */}
      <AlertDialog open={resetTarget !== null} onOpenChange={(open) => !open && setResetTarget(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the credential for {resetTarget?.name ?? resetTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              The old credential dies immediately. A fresh one-time password is revealed ONCE in the
              next dialog — store it before dismissing. The operator never chooses the value (§20).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8">Keep current</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              disabled={busyId !== null}
              onClick={(event) => {
                event.preventDefault()
                if (resetTarget) {
                  void patchMember(
                    resetTarget,
                    { resetCredential: true },
                    'Credential reset',
                    'A fresh one-time credential was minted — reveal it once and hand it over.'
                  ).then(() => setResetTarget(null))
                }
              }}
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Reset credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
