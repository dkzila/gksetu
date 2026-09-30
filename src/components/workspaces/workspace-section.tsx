'use client'

/**
 * GlobIQ — Workspace Section (P9-S3)
 *
 * The country-specific editorial workspaces on the console (§43 Phase 9
 * Session 3): one workspace per configured market — roster, §20 language
 * scopes, per-language coverage, the board summary — plus the §20
 * provisioning surface (invite with one-time credentials, scope/role
 * adjustments, suspend/reactivate, credential resets) for accounts holding
 * staff:manage. WRITER sees their own workspace context (the assignment
 * precedent); READER never enters (§38); every mutation is re-checked
 * server-side (§20/§37) — these affordances render from server truth.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CircleDot,
  KeyRound,
  Loader2,
  Lock,
  PauseCircle,
  PlayCircle,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label as UILabel } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: Record<string, string[]> }
}

interface CountryRef {
  isoCode: string
  slug: string
  name: string
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
  isDefault: boolean
  launchedAt: string | null
  defaultLanguage: { code: string; name: string } | null
  languages: Array<{ code: string; name: string }>
}

interface SummaryDto {
  country: CountryRef
  stats: {
    staffByRole: { writer: number; countryAdmin: number; platformAdmin: number }
    suspended: number
    unstaffedLanguages: string[]
  }
  board: { open: number; inProgress: number; resolved: number; cancelled: number }
}

interface MemberDto {
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

interface DetailDto {
  country: CountryRef
  stats: SummaryDto['stats']
  board: SummaryDto['board']
  staff: MemberDto[]
  coverage: Array<{
    code: string
    name: string
    isDefault: boolean
    staffCount: number
    publishedPages: number
  }>
  canManage: boolean
  contract: string
}

const STATUS_LABEL: Record<CountryRef['status'], string> = {
  ACTIVE: 'Live',
  COMING_SOON: 'Announced',
  INACTIVE: 'Paused',
}

export function WorkspaceSection() {
  const { token, user } = useAuth()
  const { toast } = useToast()

  const isStaff = !!token && !!user && user.status === 'ACTIVE' && user.role !== 'READER'
  const [summaries, setSummaries] = useState<SummaryDto[]>([])
  const [detail, setDetail] = useState<DetailDto | null>(null)
  const [selectedIso, setSelectedIso] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // The invite form.
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState<'WRITER' | 'COUNTRY_ADMIN'>('WRITER')
  const [inviteScope, setInviteScope] = useState<string>('__all__')
  const [inviting, setInviting] = useState(false)

  // Row actions.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmSuspendId, setConfirmSuspendId] = useState<string | null>(null)
  const [resetConfirmId, setResetConfirmId] = useState<string | null>(null)

  // The reveal-once credential card.
  const [revealed, setRevealed] = useState<{ email: string; credential: string; note: string } | null>(null)

  const canManage = detail?.canManage === true

  const load = useCallback(
    async (iso?: string) => {
      if (!token || !isStaff) return
      setLoading(true)
      try {
        const headers = { Authorization: `Bearer ${token}` }
        if (!loaded || summaries.length === 0) {
          const listRes = await fetch('/api/workspaces', { headers, cache: 'no-store' })
          const listPayload = (await listRes.json()) as Envelope<{ workspaces: SummaryDto[] }>
          if (listPayload.status !== 'ok' || !listPayload.data) {
            toast({ title: 'Could not load workspaces', description: listPayload.error?.message ?? 'Please retry.', variant: 'destructive' })
            return
          }
          setSummaries(listPayload.data.workspaces)
        }
        // Auto-selection: explicit iso → the actor's home market → the
        // default market → the first visible one.
        const fallbackIso = (summaries.find((s) => s.country.isDefault) ?? summaries[0])?.country.isoCode ?? null
        const target = iso ?? selectedIso ?? user?.homeCountry?.isoCode ?? fallbackIso
        if (!target) return
        const detailRes = await fetch(`/api/workspaces/${target}`, { headers, cache: 'no-store' })
        const detailPayload = (await detailRes.json()) as Envelope<DetailDto>
        if (detailPayload.status === 'ok' && detailPayload.data) {
          setDetail(detailPayload.data)
          setSelectedIso(target)
          setLoaded(true)
        } else {
          toast({ title: 'Could not load the workspace', description: detailPayload.error?.message ?? 'Please retry.', variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [token, isStaff, loaded, summaries, selectedIso, user?.homeCountry?.isoCode, toast]
  )

  // B2 fix (browser round 2): the section stays mounted while the account
  // changes (the #/account anchor is a scroll target inside ConsoleView) —
  // drop every cached view on identity change so the next actor reads fresh
  // server truth, never the previous user's state.
  const actorKey = user?.id ?? 'anonymous'
  useEffect(() => {
    setSummaries([])
    setDetail(null)
    setSelectedIso(null)
    setLoaded(false)
    setRevealed(null)
    setConfirmSuspendId(null)
    setResetConfirmId(null)
  }, [actorKey])

  useEffect(() => {
    if (isStaff && token && !loaded) void load()
  }, [isStaff, token, loaded, load, actorKey])

  // The language-scope options for the invite form: the market's configured
  // languages only (§35) — "All languages" clears the scope (§20 null).
  const scopeOptions = detail?.country.languages ?? []

  const invite = useCallback(async () => {
    if (!token || !selectedIso || inviting) return
    setInviting(true)
    try {
      const body: Record<string, unknown> = {
        email: inviteEmail,
        role: inviteRole,
      }
      if (inviteName.trim()) body.name = inviteName.trim()
      if (inviteRole === 'WRITER' && inviteScope !== '__all__') body.languageScopeCode = inviteScope
      const response = await fetch(`/api/workspaces/${selectedIso}/staff`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as Envelope<{
        member: MemberDto
        oneTimePassword: string
        revealNotice: string
      }>
      if (payload.status === 'ok' && payload.data) {
        setRevealed({ email: payload.data.member.email, credential: payload.data.oneTimePassword, note: payload.data.revealNotice })
        toast({ title: 'Staff invited', description: `${payload.data.member.email} joined the ${detail?.country.name} workspace — hand over the one-time credential once.` })
        setInviteEmail('')
        setInviteName('')
        setInviteScope('__all__')
        await load(selectedIso)
      } else {
        toast({ title: 'Could not invite', description: payload.error?.message ?? 'Please retry.', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
    } finally {
      setInviting(false)
    }
  }, [token, selectedIso, inviting, inviteEmail, inviteName, inviteRole, inviteScope, detail?.country.name, load, toast])

  const patchMember = useCallback(
    async (memberId: string, body: Record<string, unknown>, successTitle: string, successDescription: string) => {
      if (!token || !selectedIso || busyId) return false
      setBusyId(memberId)
      try {
        const response = await fetch(`/api/workspaces/${selectedIso}/staff/${memberId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = (await response.json()) as Envelope<{ member: MemberDto; oneTimePassword: string | null; revealNotice: string | null }>
        if (payload.status === 'ok' && payload.data) {
          if (payload.data.oneTimePassword) {
            setRevealed({ email: payload.data.member.email, credential: payload.data.oneTimePassword, note: payload.data.revealNotice ?? '' })
          }
          toast({ title: successTitle, description: successDescription })
          await load(selectedIso)
          return true
        }
        toast({ title: 'Could not update', description: payload.error?.message ?? 'Please retry.', variant: 'destructive' })
        return false
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
        return false
      } finally {
        setBusyId(null)
        setConfirmSuspendId(null)
        setResetConfirmId(null)
      }
    },
    [token, selectedIso, busyId, load, toast]
  )

  const suspendedCount = detail?.stats.suspended ?? 0

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Users className="h-5 w-5 text-emerald-600" aria-hidden="true" />
      <h2 id="workspaces-heading" className="text-xl font-semibold tracking-tight">
        Editorial workspaces — §14/§18/§20
      </h2>
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        P9-S3
      </Badge>
    </div>
  )

  if (!isStaff) {
    return (
      <section aria-labelledby="workspaces-heading" className="space-y-4">
        {header}
        <p className="max-w-3xl text-sm text-zinc-600">
          {token && user
            ? 'Workspaces are the editorial surface (§38) — reader accounts never enter them. Staff sign-in required.'
            : 'One workspace per configured market — the roster, §20 language scopes, per-language coverage and the §19 board, plus the §20 staff provisioning surface (invite/scope/suspend/reset with one-time credentials). Sign in as staff to inspect it.'}
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="workspaces-heading" className="space-y-4">
      {header}
      <p className="max-w-3xl text-sm text-zinc-600">
        One workspace per configured market, derived from its staff rows (§14/§34 — never a stored
        table): the roster with §20 language scopes, coverage per configured language, and the
        board summary. Cross-market reach is refused server-side on every operation (§20).
      </p>

      {/* Market selector + refresh */}
      <div className="flex flex-wrap items-center gap-2">
        {summaries.length > 1 ? (
          <Select
            value={selectedIso ?? undefined}
            onValueChange={(value) => {
              setConfirmSuspendId(null)
              setResetConfirmId(null)
              void load(value)
            }}
          >
            <SelectTrigger className="h-9 w-[240px]" aria-label="Pick a market workspace">
              <SelectValue placeholder="Pick a market workspace" />
            </SelectTrigger>
            <SelectContent>
              {summaries.map((summary) => (
                <SelectItem key={summary.country.isoCode} value={summary.country.isoCode}>
                  {summary.country.name} · {STATUS_LABEL[summary.country.status]} ·{' '}
                  {summary.country.languages.length} lang
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          detail && (
            <Badge variant="secondary" className="font-normal">
              {detail.country.name} — your market&apos;s workspace (§20)
            </Badge>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(selectedIso ?? undefined)}
          disabled={loading}
          className="h-9 gap-2"
          aria-label="Refresh the workspace"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
        {detail && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <Badge variant="outline" className="font-normal">
              {STATUS_LABEL[detail.country.status]}
            </Badge>
            {detail.country.launchedAt && (
              <span>live since {new Date(detail.country.launchedAt).toISOString().slice(0, 10)}</span>
            )}
            <span>· {detail.country.languages.map((l) => l.code).join(' / ')}</span>
            <span>
              · board {detail.board.open} open / {detail.board.inProgress} in progress /{' '}
              {detail.board.resolved} resolved
            </span>
          </div>
        )}
      </div>

      {loading && !detail ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : detail ? (
        <>
          {/* The reveal-once credential card */}
          {revealed && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-amber-900">
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  One-time credential for {revealed.email}
                </CardTitle>
                <CardDescription className="text-amber-800">
                  Revealed once — from now on it exists only as its scrypt hash. {revealed.note}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <code className="rounded-md bg-amber-100 px-3 py-2 font-mono text-sm text-amber-900 select-all">
                  {revealed.credential}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(revealed.credential)
                    toast({ title: 'Copied', description: 'The one-time credential is on your clipboard.' })
                  }}
                >
                  Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setRevealed(null)}>
                  Dismiss
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Staff roster */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                {detail.country.name} workspace — roster ({detail.staff.length})
              </CardTitle>
              <CardDescription>
                {detail.stats.staffByRole.countryAdmin} COUNTRY_ADMIN ·{' '}
                {detail.stats.staffByRole.writer} WRITER ·{' '}
                {detail.stats.staffByRole.platformAdmin} platform ADMIN (operates across workspaces
                — §38; never managed through one)
                {suspendedCount > 0 ? ` · ${suspendedCount} suspended (reversible — nothing deleted)` : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
                      <th scope="col" className="py-2 pr-3">Member</th>
                      <th scope="col" className="py-2 pr-3">Role</th>
                      <th scope="col" className="py-2 pr-3">Language scope (§20)</th>
                      <th scope="col" className="py-2 pr-3">Status</th>
                      <th scope="col" className="py-2 pr-3">Last login</th>
                      {canManage && <th scope="col" className="py-2">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.staff.map((member) => (
                      <tr key={member.id} className="border-b border-zinc-100 last:border-0">
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{member.name ?? '—'}</div>
                          <div className="text-xs text-zinc-500">
                            {member.email}
                            {member.isSelf && (
                              <Badge variant="outline" className="ml-2 font-normal text-emerald-700">
                                you
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge
                            variant={member.role === 'ADMIN' ? 'outline' : 'secondary'}
                            className="font-normal"
                          >
                            {member.role}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3">
                          {member.role === 'ADMIN' ? (
                            <span className="text-xs text-zinc-400">platform class (§38)</span>
                          ) : member.role === 'COUNTRY_ADMIN' ? (
                            <span className="text-xs text-zinc-500">whole workspace — scopes are the WRITER class (§18)</span>
                          ) : member.languageScope ? (
                            <Badge variant="outline" className="font-normal">
                              {member.languageScope.code} · {member.languageScope.name}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal text-zinc-500">
                              all languages
                            </Badge>
                          )}
                        </td>
                        <td className="py-2.5 pr-3">
                          <Badge
                            variant={member.status === 'ACTIVE' ? 'secondary' : 'destructive'}
                            className="font-normal"
                          >
                            {member.status}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-zinc-500">
                          {member.lastLoginAt ? new Date(member.lastLoginAt).toISOString().slice(0, 16).replace('T', ' ') : 'never'}
                        </td>
                        {canManage && (
                          <td className="py-2.5">
                            <div className="flex flex-wrap items-center gap-2">
                              {member.role === 'WRITER' && member.status === 'ACTIVE' && !member.isSelf && (
                                <Select
                                  value={member.languageScope ? member.languageScope.code : '__all__'}
                                  onValueChange={(value) =>
                                    void patchMember(
                                      member.id,
                                      value === '__all__' ? { languageScopeCode: null } : { languageScopeCode: value },
                                      'Scope adjusted',
                                      `${member.email} now ${value === '__all__' ? 'works all the market\u2019s languages' : `is scoped to ${value}`} (§20/§35 — re-validated server-side).`
                                    )
                                  }
                                  disabled={busyId === member.id}
                                >
                                  <SelectTrigger className="h-8 w-[150px]" aria-label={`Adjust scope for ${member.email}`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__all__">All languages</SelectItem>
                                    {scopeOptions.map((language) => (
                                      <SelectItem key={language.code} value={language.code}>
                                        {language.code} · {language.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                              {member.role !== 'ADMIN' && !member.isSelf && (
                                <>
                                  {member.status === 'ACTIVE' ? (
                                    confirmSuspendId === member.id ? (
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        className="h-8"
                                        disabled={busyId === member.id}
                                        onClick={() =>
                                          void patchMember(
                                            member.id,
                                            { status: 'SUSPENDED' },
                                            'Staff suspended',
                                            'Every active session was revoked immediately; reactivation is reversible (§36 spirit — nothing deleted).'
                                          )
                                        }
                                      >
                                        {busyId === member.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PauseCircle className="h-4 w-4" aria-hidden="true" />}
                                        Confirm suspend
                                      </Button>
                                    ) : (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-8 gap-2"
                                        disabled={busyId === member.id}
                                        onClick={() => setConfirmSuspendId(member.id)}
                                      >
                                        <PauseCircle className="h-4 w-4" aria-hidden="true" />
                                        Suspend
                                      </Button>
                                    )
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-2"
                                      disabled={busyId === member.id}
                                      onClick={() =>
                                        void patchMember(
                                          member.id,
                                          { status: 'ACTIVE' },
                                          'Staff reactivated',
                                          'The account signs in again — its history stood untouched through the suspension.'
                                        )
                                      }
                                    >
                                      {busyId === member.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="h-4 w-4" aria-hidden="true" />}
                                      Reactivate
                                    </Button>
                                  )}
                                  {resetConfirmId === member.id ? (
                                    <Button
                                      variant="destructive"
                                      size="sm"
                                      className="h-8"
                                      disabled={busyId === member.id}
                                      onClick={() =>
                                        void patchMember(
                                          member.id,
                                          { resetCredential: true },
                                          'Credential reset',
                                          'A fresh one-time credential is revealed once — the old one is dead.'
                                        )
                                      }
                                    >
                                      {busyId === member.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                                      Confirm reset
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 gap-2"
                                      disabled={busyId === member.id}
                                      onClick={() => setResetConfirmId(member.id)}
                                    >
                                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                                      Reset credential
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {detail.stats.unstaffedLanguages.length > 0 && (
                <p className="text-xs text-amber-700">
                  Unstaffed market-language(s): {detail.stats.unstaffedLanguages.join(', ')} — no
                  active WRITER/COUNTRY_ADMIN can work them yet (the §32 coverage gap, stated never
                  silently omitted).
                </p>
              )}
            </CardContent>
          </Card>

          {/* Language coverage */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CircleDot className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Language coverage (§35)
              </CardTitle>
              <CardDescription>
                Who can work each configured language, and what is published in it — the same
                derivations the launch checklist reads (§34/§35; an EN page never counts for FR/fr).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {detail.coverage.map((language) => (
                  <div key={language.code} className="rounded-lg border border-zinc-200 p-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{language.code}</span>
                      <span className="text-zinc-500">{language.name}</span>
                      {language.isDefault && (
                        <Badge variant="outline" className="font-normal text-emerald-700">
                          default
                        </Badge>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-zinc-600">
                      {language.staffCount} active staff able to work it
                      {language.staffCount === 0 && ' — unstaffed'}
                    </p>
                    <p className="text-sm text-zinc-600">{language.publishedPages} published pages</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* The §20 provisioning form */}
          {canManage ? (
            <Card className="border-zinc-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Invite staff — §20 provisioning
                </CardTitle>
                <CardDescription>
                  Country Admin creates or invites staff accounts with explicit country + language
                  scopes (§20). The operator never chooses a password: the server generates a
                  one-time credential, revealed once, stored only as its scrypt hash.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1.5">
                    <UILabel htmlFor="invite-email">Email</UILabel>
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="who@example.org"
                      autoComplete="off"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <UILabel htmlFor="invite-name">Name (optional)</UILabel>
                    <Input
                      id="invite-name"
                      value={inviteName}
                      onChange={(event) => setInviteName(event.target.value)}
                      placeholder="Full name"
                      autoComplete="off"
                    />
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <UILabel>Role (§18)</UILabel>
                    <Select
                      value={inviteRole}
                      onValueChange={(value) => {
                        setInviteRole(value as 'WRITER' | 'COUNTRY_ADMIN')
                        if (value === 'COUNTRY_ADMIN') setInviteScope('__all__')
                      }}
                    >
                      <SelectTrigger className="h-9 w-full" aria-label="Pick the staff role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WRITER">WRITER (creates, never publishes)</SelectItem>
                        <SelectItem value="COUNTRY_ADMIN">COUNTRY_ADMIN (owns the workspace)</SelectItem>
                      </SelectContent>
                      <p className="text-xs text-zinc-500">
                        §18: writers never publish — that gate is a separate permission (content:publish).
                        A language scope narrows a writer to one of the market&apos;s configured languages (§20/§35).
                      </p>
                    </Select>
                  </div>
                  {inviteRole === 'WRITER' && (
                    <div className="min-w-0 space-y-1.5">
                      <UILabel>Language scope (§20/§35)</UILabel>
                      <Select value={inviteScope} onValueChange={setInviteScope}>
                        <SelectTrigger className="h-9 w-full" aria-label="Pick the language scope">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All the market&apos;s languages</SelectItem>
                          {scopeOptions.map((language) => (
                            <SelectItem key={language.code} value={language.code}>
                              {language.code} · {language.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-zinc-500">
                        A scoped writer cannot touch representations in other languages (§20 —
                        enforced server-side on every operation).
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => void invite()}
                    disabled={inviting || !inviteEmail.includes('@')}
                    className="gap-2"
                  >
                    {inviting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                    Invite into {detail.country.name}
                  </Button>
                  <p className="text-xs text-zinc-500">
                    §18: writers never publish. Suspension revokes sessions immediately and is
                    reversible. Every mutation is audited (§30) — the credential never is.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-zinc-200 bg-zinc-50 shadow-sm">
              <CardContent className="flex items-start gap-3 pt-4">
                <Lock className="mt-0.5 h-4 w-4 text-zinc-400" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    Your workspace context (§38) — provisioning is operator work
                  </p>
                  <p className="text-xs text-zinc-600">
                    You see the roster, coverage and board of your own market&apos;s workspace. The
                    §20 provisioning surface (invite/scope/suspend/reset) requires{' '}
                    <code className="rounded bg-zinc-100 px-1">staff:manage</code> — held by the
                    workspace&apos;s COUNTRY_ADMIN and the platform ADMIN, never by writers.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-zinc-500">
            <BadgeCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />
            {detail.contract}
          </p>
        </>
      ) : (
        <Card className="border-zinc-200 shadow-sm">
          <CardContent className="pt-4 text-sm text-zinc-600">
            No workspace is visible for this account (§20 — fail-closed when an account carries no
            home market).
          </CardContent>
        </Card>
      )}
    </section>
  )
}
