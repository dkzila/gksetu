'use client'

/**
 * GKSetu — the Console shell (CONSOLE-S1).
 *
 * The company's internal operating system: a fixed dark sidebar with the
 * grouped, permission-aware navigation; its own compact header (page title,
 * view-site link, account menu) and its own compact footer — deliberately
 * NOT the public site's chrome (the user's brief: the root site is for
 * users; an internal system sharing its header/footer is neither right nor
 * professional).
 *
 * Auth gate: token-based identity (the same Bearer contract as the public
 * site and future apps — §4/§37/§39). Anonymous visitors get the console
 * sign-in panel; READER accounts see only Account + Dev Track; writers and
 * admins see their granted surfaces. The server re-checks every operation.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ChevronsUpDown,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useSeoHead } from '@/components/home/seo-head'
import { navigateToPath } from '@/components/home/app-router'
import { useAuth } from '@/stores/auth'
import { cn } from '@/lib/utils'

import { CONSOLE_NAV, findNavMatch } from './console-nav'
import { AccountPage } from './pages/account-page'
import { AnalyticsPage } from './pages/analytics-page'
import { AuditPage } from './pages/audit-page'
import { ConsolePageHeader } from './ui/primitives'
import { CurrentAffairsPage } from './pages/current-affairs-page'
import { DashboardPage } from './pages/dashboard-page'
import { EditorialPage } from './pages/editorial-page'
import { EntitiesPage } from './pages/entities-page'
import { ExamDetailPage } from './pages/exam-detail-page'
import { ExamsPage } from './pages/exams-page'
import { KnowledgePage } from './pages/knowledge-page'
import { MockTestsPage } from './pages/mock-tests-page'
import { BooksPage } from './pages/books-page'
import { PagesPage } from './pages/pages-page'
import { PostsPage } from './pages/posts-page'
import { PremiumPage } from './pages/premium-page'
import { PyqPage } from './pages/pyq-page'
import { QnaPage } from './pages/qna-page'
import { QuestionsPage } from './pages/questions-page'
import { ExamNotesPage } from './pages/exam-notes-page'
import { ExamNoteDetailPage } from './pages/exam-note-detail-page'
import { SettingsPage } from './pages/settings-page'
import { SourcesPage } from './pages/sources-page'
import { StaffPage } from './pages/staff-page'
import { TaxonomyPage } from './pages/taxonomy-page'
import { TranslationsPage } from './pages/translations-page'
import { TutorialsConsolePage } from './pages/tutorials-console-page'

// ---------- The page router (console sub-path → component) ----------

function renderConsolePage(consolePath: string | null) {
  const path = consolePath ?? ''
  switch (true) {
    case path === '':
      return <DashboardPage />
    case path === 'analytics':
      return <AnalyticsPage />
    case path === 'audit':
      return <AuditPage />
    case path === 'account':
      return <AccountPage />
    case path === 'posts':
      return <PostsPage />
    case path === 'current-affairs':
      return <CurrentAffairsPage />
    case path === 'knowledge':
      return <KnowledgePage />
    case path === 'sources':
      return <SourcesPage />
    case path === 'entities':
      return <EntitiesPage />
    case path === 'translations':
      return <TranslationsPage />
    case path === 'questions':
      return <QuestionsPage />
    case path === 'qna':
      return <QnaPage />
    case path === 'pyq':
      return <PyqPage />
    case path === 'mock-tests':
      return <MockTestsPage />
    case path === 'exam-notes':
      return <ExamNotesPage />
    case path.startsWith('exam-notes/'):
      return <ExamNoteDetailPage noteId={path.slice('exam-notes/'.length)} />
    case path === 'exams':
      return <ExamsPage />
    case path === 'tutorials':
      return <TutorialsConsolePage />
    case path.startsWith('exams/'):
      return <ExamDetailPage examRef={path.slice('exams/'.length)} />
    case path === 'taxonomy':
      return <TaxonomyPage />
    case path === 'pages':
      return <PagesPage />
    case path === 'books':
      return <BooksPage />
    case path === 'premium':
      return <PremiumPage />
    case path === 'settings':
      return <SettingsPage />
    case path === 'staff':
      return <StaffPage />
    case path === 'editorial':
      return <EditorialPage />
    case path === 'dev-track':
      return <DevTrackRedirect />
    default:
      return <ConsoleNotFound path={path} />
  }
}

function DevTrackRedirect() {
  useEffect(() => {
    // The preserved Foundation Console is its own surface (/dev-track).
    navigateToPath('/dev-track')
  }, [])
  return (
    <div className="py-16 text-center text-sm text-zinc-500">Opening the Dev Track…</div>
  )
}

function ConsoleNotFound({ path }: { path: string }) {
  return (
    <div className="space-y-6">
      <ConsolePageHeader title="Page not found" description={`No console page at /console/${path}`} />
      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-16 text-center">
        <p className="text-sm text-zinc-500">Pick a destination from the sidebar.</p>
      </div>
    </div>
  )
}

// ---------- Sidebar ----------

function SidebarContent({
  consolePath,
  permissions,
  onNavigate,
}: {
  consolePath: string | null
  permissions: string[]
  onNavigate?: () => void
}) {
  const activeRoot = (consolePath ?? '').split('/')[0] ?? ''
  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <button
        type="button"
        onClick={() => {
          navigateToPath('/console')
          onNavigate?.()
        }}
        className="flex items-center gap-2.5 border-b border-white/10 px-4 py-4 text-left transition-colors hover:bg-white/5"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-bold text-zinc-950 shadow-[0_0_18px_rgba(16,185,129,0.35)]">
          G
        </span>
        <span>
          <span className="block text-[13px] font-semibold tracking-tight text-white">GKSetu Console</span>
          <span className="block text-[10px] uppercase tracking-widest text-emerald-400/80">Internal system</span>
        </span>
      </button>

      {/* Nav */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Console navigation">
        {CONSOLE_NAV.map((group) => {
          const items = group.items.filter(
            (item) => !item.permission || item.id === 'dev-track' || permissions.includes(item.permission)
          )
          if (items.length === 0) return null
          return (
            <div key={group.id}>
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const isActive =
                    item.path === '' ? activeRoot === '' : activeRoot === item.path.split('/')[0] && item.path !== 'dev-track'
                  const Icon = item.icon
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          navigateToPath(item.path === 'dev-track' ? '/dev-track' : `/console${item.path ? `/${item.path}` : ''}`)
                          onNavigate?.()
                        }}
                        title={item.description}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? 'bg-emerald-500/15 font-medium text-emerald-300'
                            : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                        {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      {/* Footnote */}
      <div className="border-t border-white/10 px-4 py-3">
        <p className="text-[10px] leading-relaxed text-zinc-600">
          GKSetu internal console · staff only · every action audited
        </p>
      </div>
    </div>
  )
}

// ---------- Sign-in panel ----------

function ConsoleSignIn() {
  const { signIn, status, error, clearError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    await signIn(email.trim(), password)
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
      {/* Ambient glow — the energetic touch, kept professional */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-lg font-bold text-zinc-950 shadow-[0_0_28px_rgba(16,185,129,0.4)]">
            G
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-white">GKSetu Console</h1>
          <p className="text-[13px] text-zinc-500">The company&apos;s internal system — staff sign-in only.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-xl border border-white/10 bg-zinc-900/80 p-5 shadow-xl backdrop-blur"
        >
          <div className="space-y-1.5">
            <Label htmlFor="console-email" className="text-[13px] text-zinc-300">
              Work email
            </Label>
            <Input
              id="console-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                if (error) clearError()
              }}
              placeholder="you@gksetu.dev"
              className="h-9 border-white/10 bg-zinc-950 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="console-password" className="text-[13px] text-zinc-300">
              Password
            </Label>
            <div className="relative">
              <Input
                id="console-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  if (error) clearError()
                }}
                placeholder="••••••••"
                className="h-9 border-white/10 bg-zinc-950 pr-9 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting || status === 'loading'}
            className="h-9 w-full bg-emerald-500 font-medium text-zinc-950 hover:bg-emerald-400"
          >
            {submitting || status === 'loading' ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                <ShieldCheck className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                Sign in to the console
              </>
            )}
          </Button>

          <p className="text-center text-[11px] leading-relaxed text-zinc-600">
            The same token-based sign-in as the product — sessions are listed and revocable from Account.
          </p>
        </form>
      </div>
    </div>
  )
}

// ---------- Shell ----------

export interface ConsoleShellProps {
  consolePath: string | null
}

export function ConsoleShell({ consolePath }: ConsoleShellProps) {
  const { status, user, permissions, signOut } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // The console is a private internal surface — never indexed (§16).
  useSeoHead({
    title: 'Console | GKSetu',
    description: 'GKSetu internal console — staff only.',
    noindex: true,
  })

  const navMatch = useMemo(() => findNavMatch(consolePath), [consolePath])

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-3 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-500" aria-hidden="true" />
          <p className="text-xs tracking-wide">Restoring your console session…</p>
        </div>
      </div>
    )
  }

  if (status !== 'authenticated') {
    return <ConsoleSignIn />
  }

  const initials = (user?.name ?? user?.email ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return (
    <div className="flex min-h-screen bg-zinc-100">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 bg-zinc-950 lg:block" aria-label="Console sidebar">
        <SidebarContent consolePath={consolePath} permissions={permissions} />
      </aside>

      {/* Mobile sidebar (sheet) */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/95 px-3 backdrop-blur lg:hidden">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5" aria-label="Open navigation">
              <Menu className="h-4 w-4" aria-hidden="true" />
              <span className="text-xs font-medium">Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 border-zinc-800 bg-zinc-950 p-0">
            <SheetTitle className="sr-only">Console navigation</SheetTitle>
            <SidebarContent
              consolePath={consolePath}
              permissions={permissions}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </SheetContent>
        </Sheet>
        <span className="text-[13px] font-semibold tracking-tight text-zinc-900">GKSetu Console</span>
        <AccountMenu user={user} permissions={permissions} signOut={signOut} />
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Header (desktop) */}
        <header className="sticky top-0 z-30 hidden h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-6 backdrop-blur lg:flex">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-zinc-400">Console</p>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-zinc-900">
              {navMatch?.label ?? 'GKSetu Console'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 border-zinc-200 text-[13px] text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
              onClick={() => navigateToPath('/')}
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              View site
            </Button>
            <AccountMenu user={user} permissions={permissions} signOut={signOut} />
          </div>
        </header>

        {/* Page body */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <div className="[&>*:first-child]:mt-2 lg:[&>*:first-child]:mt-0">{renderConsolePage(consolePath)}</div>
        </main>

        {/* The console's own footer — sticky to the bottom of the viewport */}
        <footer className="mt-auto border-t border-zinc-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11px] text-zinc-400 sm:px-6 lg:px-8">
            <p>
              GKSetu Console — the internal operating system. Every privileged action is audited.
            </p>
            <p className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-emerald-500" aria-hidden="true" />
              Staff only · not for users
            </p>
          </div>
        </footer>
      </div>

      {/* Mobile bottom padding so content clears the top bar */}
      <div className="hidden" aria-hidden="true" />
    </div>
  )
}

function AccountMenu({
  user,
  permissions,
  signOut,
}: {
  user: { email: string; name: string | null; role: string } | null
  permissions: string[]
  signOut: () => void | Promise<void>
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white pl-1 pr-2 text-[13px] text-zinc-700 shadow-sm transition-colors hover:border-emerald-300"
          aria-label="Account menu"
        >
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-emerald-600/15 text-[10px] font-semibold text-emerald-700">
              {(user?.name ?? user?.email ?? '?')
                .split(/[\s@.]+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase())
                .join('') || '?'}
            </AvatarFallback>
          </Avatar>
          <ChevronsUpDown className="h-3 w-3 text-zinc-400" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate text-[13px] font-medium">{user?.name ?? 'Team member'}</p>
          <p className="truncate text-xs font-normal text-zinc-500">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-xs text-zinc-500">Role</span>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
            {user?.role ?? '—'}
          </Badge>
        </div>
        <div className="px-2 pb-1.5 pt-0.5">
          <p className="text-[10px] leading-relaxed text-zinc-400">
            {permissions.length} effective permissions — surfaces without one are hidden here and blocked server-side.
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigateToPath('/console/account')}
          className="text-[13px]"
        >
          Account & sessions
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void signOut()}
          className="text-[13px] text-red-600 focus:text-red-700"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
