'use client'

/**
 * GKSetu Console — Account (CONSOLE-S1-A).
 *
 * The signed-in operator's self-service surface: profile card with inline
 * name edit (PATCH /api/profile), active sessions (the auth store's
 * listSessions/revokeSession — listable and revocable, §30), the effective
 * permission grid with human labels, and the danger zone (sign out / sign out
 * everywhere).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BadgeCheck,
  CalendarClock,
  Check,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  MonitorSmartphone,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserCircle,
  X,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { useConsoleApi, fieldErrorMap } from '@/components/console/ui/console-api'
import { ConsolePageHeader, MetaRow, StatusBadge, formatDate, formatWhen } from '@/components/console/ui/primitives'
import { Field, TextInput } from '@/components/console/ui/form-fields'
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PERMISSION_LABELS, type Permission } from '@/lib/permissions'
import type { PublicSession } from '@/modules/identity-access/types'

// ---------- Helpers ----------

const ROLE_BADGE_STYLES: Record<string, string> = {
  ADMIN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COUNTRY_ADMIN: 'bg-amber-50 text-amber-700 border-amber-200',
  WRITER: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  READER: 'bg-zinc-100 text-zinc-500 border-zinc-200',
}

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge variant="outline" className={`px-2 py-0 text-[11px] font-medium ${ROLE_BADGE_STYLES[role] ?? ROLE_BADGE_STYLES.READER}`}>
      {role.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  )
}

function initials(name: string | null, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/).slice(0, 2)
    return parts.map((part) => part[0]!.toUpperCase()).join('')
  }
  return email.slice(0, 2).toUpperCase()
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

function sessionIcon(label: string) {
  const lower = label.toLowerCase()
  if (lower.includes('mobile') || lower.includes('iphone') || lower.includes('android')) {
    return <Smartphone className="h-4 w-4 text-zinc-400" aria-hidden="true" />
  }
  return <Laptop className="h-4 w-4 text-zinc-400" aria-hidden="true" />
}

// ---------- Profile card (with inline name edit) ----------

function ProfileCard() {
  const { user, refreshUser } = useAuth()
  const api = useConsoleApi()
  const { toast } = useToast()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  if (!user) return null

  async function handleSave() {
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 80) {
      setNameError('Name must be 1–80 characters')
      return
    }
    setSaving(true)
    setNameError(null)
    const { data, error } = await api.patch<{ user: unknown }>('/api/profile', { name: trimmed })
    setSaving(false)
    if (error) {
      setNameError(fieldErrorMap(error.details).name ?? error.message)
      return
    }
    await refreshUser()
    setEditing(false)
    toast({ title: 'Profile updated', description: 'Your display name was saved.' })
  }

  return (
    <section aria-labelledby="profile-heading" className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 id="profile-heading" className="text-sm font-semibold text-zinc-900">
        Your profile
      </h2>

      <div className="mt-3 flex items-center gap-3">
        <Avatar className="h-12 w-12 border border-zinc-200">
          <AvatarFallback className="bg-emerald-50 font-semibold text-emerald-700">
            {initials(user.name, user.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <Field label="Display name" htmlFor="profile-name" error={nameError} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <TextInput
                    id="profile-name"
                    value={name}
                    onChange={(value) => setName(value)}
                    placeholder="Your name"
                    disabled={saving}
                    invalid={Boolean(nameError)}
                    className="max-w-[220px]"
                  />
                  <Button
                    size="sm"
                    className="h-8 bg-emerald-600 px-2.5 hover:bg-emerald-700"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    aria-label="Save name"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-700"
                    onClick={() => {
                      setEditing(false)
                      setNameError(null)
                    }}
                    disabled={saving}
                    aria-label="Cancel name edit"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </Field>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[15px] font-semibold text-zinc-900">{user.name ?? 'Unnamed operator'}</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-zinc-400 hover:text-emerald-700"
                onClick={() => {
                  setName(user.name ?? '')
                  setEditing(true)
                }}
                aria-label="Edit display name"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
              </Button>
            </div>
          )}
          <p className="truncate text-[13px] text-zinc-500">{user.email}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <RoleBadge role={user.role} />
        <StatusBadge status={user.status} />
        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 px-2 py-0 text-[11px] font-normal text-zinc-500">
          <BadgeCheck className="mr-1 h-3 w-3 text-emerald-600" aria-hidden="true" />
          {user.emailVerified ? 'Email verified' : 'Email unverified'}
        </Badge>
      </div>

      <div className="mt-3 rounded-lg bg-zinc-50/60 px-3 py-1.5">
        <MetaRow
          label="Home country"
          value={user.homeCountry ? `${user.homeCountry.name} (${user.homeCountry.isoCode})` : 'Not set'}
        />
        <MetaRow
          label="Preferred language"
          value={user.preferredLanguage ? `${user.preferredLanguage.name} (${user.preferredLanguage.code})` : 'Not set'}
        />
        {user.languageScope && (
          <MetaRow label="Language scope" value={`${user.languageScope.name} (${user.languageScope.code})`} />
        )}
        <MetaRow label="Member since" value={formatDate(user.createdAt)} />
        <MetaRow label="Last sign-in" value={formatWhen(user.lastLoginAt)} />
      </div>
    </section>
  )
}

// ---------- Sessions card ----------

function SessionsCard() {
  const { listSessions, revokeSession, signOut } = useAuth()
  const { toast } = useToast()

  const [sessions, setSessions] = useState<PublicSession[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const result = await listSessions()
    setSessions(result)
    setFailed(result === null)
    setLoading(false)
  }, [listSessions])

  // Initial load — inline (the async boundary keeps state updates off the
  // synchronous effect path); the button reuses `refresh`.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await listSessions()
      if (cancelled) return
      setSessions(result)
      setFailed(result === null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [listSessions])

  const confirmSession = sessions?.find((session) => session.id === confirmId) ?? null

  async function handleRevoke(id: string) {
    setConfirmId(null)
    setRevokingId(id)
    const result = await revokeSession(id)
    setRevokingId(null)
    if (result === null) {
      toast({
        title: 'Could not revoke the session',
        description: 'Please retry — the session list was refreshed.',
        variant: 'destructive',
      })
      void refresh()
      return
    }
    if (result.signedOut) {
      // Revoking the current session signs this console out — clear local state.
      toast({ title: 'Signed out', description: 'That was the current session.' })
      await signOut()
      return
    }
    toast({ title: 'Session revoked', description: 'That device can no longer use its token.' })
    void refresh()
  }

  return (
    <section aria-labelledby="sessions-heading" className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="sessions-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <KeyRound className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Active sessions
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">Every issued Bearer token — revoke any device at any time (§30).</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-700"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh sessions"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        {loading && !sessions ? (
          <div className="space-y-2" role="status" aria-label="Loading sessions">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : failed ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <span>Could not load your sessions.</span>
            <Button variant="outline" size="sm" className="h-7 border-red-200 bg-white text-red-700 hover:bg-red-50" onClick={() => void refresh()}>
              Retry
            </Button>
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400">
            No active sessions.
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3',
                  session.isCurrent ? 'border-emerald-200 bg-emerald-50/40' : 'border-zinc-200 bg-white'
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {sessionIcon(session.label)}
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-zinc-800">
                      <span className="truncate">{session.label}</span>
                      {session.isCurrent && (
                        <Badge className="bg-zinc-900 px-1.5 py-0 text-[10px] font-normal text-white hover:bg-zinc-900">
                          This device
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                      Created {formatDate(session.createdAt)} · last used {formatRelative(session.lastUsedAt)} · expires{' '}
                      {formatDate(session.expiresAt)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setConfirmId(session.id)}
                  disabled={revokingId === session.id}
                  aria-label={`Revoke session ${session.label}`}
                >
                  {revokingId === session.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={confirmSession !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {confirmSession?.isCurrent ? 'this device (sign out)' : `"${confirmSession?.label}"`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSession?.isCurrent
                ? 'This is the current session — you will be signed out of the console immediately.'
                : 'That device will need to sign in again. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => confirmSession && void handleRevoke(confirmSession.id)}
            >
              Revoke session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ---------- Permissions card ----------

function PermissionsCard() {
  const permissions = useAuth((state) => state.permissions)
  return (
    <section aria-labelledby="permissions-heading" className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 id="permissions-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <ShieldCheck className="h-4 w-4 text-zinc-400" aria-hidden="true" />
        Effective permissions
      </h2>
      <p className="mt-0.5 text-xs text-zinc-400">
        What your role grants — the server re-checks every operation regardless (§20).
      </p>
      {permissions.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-sm text-zinc-400">
          No permissions held by this account.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {permissions.map((permission) => (
            <li
              key={permission}
              className="flex items-start gap-2 rounded-lg border border-zinc-100 bg-zinc-50/60 px-3 py-2"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[13px] leading-snug text-zinc-700">
                  {PERMISSION_LABELS[permission as Permission] ?? permission}
                </p>
                <p className="truncate font-mono text-[10px] text-zinc-400">{permission}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- Danger zone ----------

function DangerZone() {
  const { signOut, listSessions, revokeSession } = useAuth()
  const { toast } = useToast()
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [confirmEverywhere, setConfirmEverywhere] = useState(false)
  const [working, setWorking] = useState(false)

  async function handleSignOut() {
    setConfirmSignOut(false)
    await signOut()
    toast({ title: 'Signed out', description: 'Your session was revoked server-side.' })
  }

  async function handleSignOutEverywhere() {
    setConfirmEverywhere(false)
    setWorking(true)
    const sessions = await listSessions()
    let revoked = 0
    for (const session of sessions ?? []) {
      if (session.isCurrent) continue
      const result = await revokeSession(session.id)
      if (result) revoked += 1
    }
    toast({
      title: 'Signed out everywhere',
      description: `${revoked} other session${revoked === 1 ? '' : 's'} revoked — this one signed out.`,
    })
    await signOut()
    setWorking(false)
  }

  return (
    <section
      aria-labelledby="danger-heading"
      className="rounded-lg border border-red-200 bg-red-50/40 p-4"
    >
      <h2 id="danger-heading" className="text-sm font-semibold text-red-900">
        Danger zone
      </h2>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-zinc-800">Sign out</p>
          <p className="text-xs text-zinc-500">Revoke the current session — you will return to the sign-in panel.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-red-200 bg-white text-red-700 hover:bg-red-50"
          onClick={() => setConfirmSignOut(true)}
          disabled={working}
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-red-100 pt-3">
        <div>
          <p className="text-[13px] font-medium text-zinc-800">Sign out everywhere</p>
          <p className="text-xs text-zinc-500">Revoke every session on every device, including this one.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-red-200 bg-white text-red-700 hover:bg-red-50"
          onClick={() => setConfirmEverywhere(true)}
          disabled={working}
        >
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden="true" />}
          Sign out everywhere
        </Button>
      </div>

      <AlertDialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of the console?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current session will be revoked server-side. You can sign back in at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void handleSignOut()}>
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmEverywhere} onOpenChange={setConfirmEverywhere}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out on every device?</AlertDialogTitle>
            <AlertDialogDescription>
              Every active session will be revoked — all devices, including this one, will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => void handleSignOutEverywhere()}>
              Sign out everywhere
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ---------- The page ----------

export function AccountPage() {
  const status = useAuth((state) => state.status)
  const user = useAuth((state) => state.user)

  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Account"
        description="Your profile, active sessions, effective permissions and sign-out controls."
        icon={<UserCircle className="h-4 w-4" />}
      />

      {status !== 'authenticated' || !user ? (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
          <CalendarClock className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          Signed out — sign in from the console to manage your account.
        </div>
      ) : (
        <>
          <div className="grid items-start gap-4 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <ProfileCard />
            </div>
            <div className="lg:col-span-3">
              <SessionsCard />
            </div>
          </div>
          <PermissionsCard />
          <DangerZone />
        </>
      )}
    </div>
  )
}
