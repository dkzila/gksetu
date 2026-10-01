'use client'

/**
 * GKSetu — app sidebar.
 *
 * The persistent product navigation: one rail on desktop (lg+) and a
 * drawer on mobile (opened from the header's menu button). Sections map
 * to how people actually use the platform — discover (GK, current
 * affairs, exams, mock tests) and personal library (dashboard, saves,
 * follows, notifications) — with the account group below. Technical
 * surfaces stay out of this navigation by design.
 */

import {
  Bell,
  Bookmark,
  ClipboardList,
  Compass,
  FileQuestion,
  GraduationCap,
  Home,
  LineChart,
  Newspaper,
  Rss,
  Settings,
  Timer,
  UserRound,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { useNotificationCount } from '@/stores/notifications'

import type { ApiCountry } from './types'
import type { AppRoute } from './hash-router'

// ---------- Props ----------

export interface AppSidebarProps {
  route: AppRoute | null
  config: ApiCountry[] | null
  /** Mobile drawer state (the desktop rail is always rendered on lg+). */
  open: boolean
  onOpenChange: (open: boolean) => void
  onGoHome: () => void
  onOpenCurrentAffairs: () => void
  onGoExams: () => void
  onGoQuickMock: () => void
  onSwitchCountry: (iso: string) => void
  onSwitchLanguage: (code: string) => void
}

// ---------- Nav model ----------

interface NavItem {
  key: string
  label: string
  icon: typeof Home
  active: boolean
  onClick?: () => void
  href?: string
  badge?: number
}

// ---------- Component ----------

export function AppSidebar({
  route,
  config,
  open,
  onOpenChange,
  onGoHome,
  onOpenCurrentAffairs,
  onGoExams,
  onGoQuickMock,
  onSwitchCountry,
  onSwitchLanguage,
}: AppSidebarProps) {
  const unreadCount = useNotificationCount((state) => state.unreadCount)

  const currentCountry = config && route ? config.find((entry) => entry.isoCode === route.countryIso) ?? null : null

  const run = (action: () => void) => () => {
    onOpenChange(false)
    action()
  }

  const discoverItems: NavItem[] = [
    { key: 'home', label: 'Home', icon: Home, active: route?.view === 'home', onClick: run(onGoHome) },
    {
      key: 'current-affairs',
      label: 'Current Affairs',
      icon: Newspaper,
      active: route?.view === 'event' || (route?.view === 'topic' && route.topicSlug === 'current-affairs'),
      onClick: run(onOpenCurrentAffairs),
    },
    {
      key: 'exams',
      label: 'Exams',
      icon: GraduationCap,
      active: route?.view === 'exam' || route?.view === 'syllabus',
      onClick: run(onGoExams),
    },
    {
      key: 'mock-tests',
      label: 'Mock Tests',
      icon: Timer,
      active: route?.view === 'quick-mock' || route?.view === 'test',
      onClick: run(onGoQuickMock),
    },
  ]

  const libraryItems: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', icon: LineChart, active: route?.view === 'dashboard', href: '#/dashboard' },
    { key: 'saved', label: 'Saved', icon: Bookmark, active: route?.view === 'saved', href: '#/saved' },
    { key: 'following', label: 'Following', icon: Rss, active: route?.view === 'following', href: '#/following' },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: Bell,
      active: route?.view === 'notifications',
      href: '#/notifications',
      badge: unreadCount,
    },
  ]

  const accountItems: NavItem[] = [
    { key: 'profile', label: 'Profile', icon: UserRound, active: route?.view === 'profile', href: '#/profile' },
    { key: 'settings', label: 'Settings', icon: Settings, active: route?.view === 'personalisation', href: '#/personalisation' },
    { key: 'feedback', label: 'Feedback', icon: FileQuestion, active: route?.view === 'feedback', href: '#/feedback' },
  ]

  const sections: Array<{ key: string; label: string; items: NavItem[] }> = [
    { key: 'discover', label: 'Discover', items: discoverItems },
    { key: 'library', label: 'My Library', items: libraryItems },
    { key: 'account', label: 'Account', items: accountItems },
  ]

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-5 p-3">
      {sections.map((section, sectionIndex) => (
        <div key={section.key} className="space-y-1">
          {sectionIndex > 0 && <Separator className="mx-1 mb-3" />}
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon
              const content = (
                <>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                  {!!item.badge && item.badge > 0 && (
                    <Badge className="ml-auto h-5 min-w-5 rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold leading-none text-white hover:bg-emerald-600">
                      {item.badge > 9 ? '9+' : item.badge}
                    </Badge>
                  )}
                </>
              )
              const baseClass = `flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors ${
                item.active
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`
              return (
                <li key={item.key}>
                  {item.href ? (
                    <a href={item.href} aria-current={item.active ? 'page' : undefined} className={baseClass} onClick={() => onOpenChange(false)}>
                      {content}
                    </a>
                  ) : (
                    <button type="button" onClick={item.onClick} aria-current={item.active ? 'page' : undefined} className={`${baseClass} text-left`}>
                      {content}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {/* Market switchers (mobile drawer only — the header keeps its own on sm+) */}
      <div className="space-y-2 border-t border-zinc-100 p-3 pt-4 sm:hidden">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Market</p>
        <Select value={route?.countryIso ?? ''} onValueChange={(iso) => { onSwitchCountry(iso) }} disabled={!config}>
          <SelectTrigger className="h-10 border-zinc-200 bg-white text-sm font-medium" aria-label="Switch country">
            <SelectValue placeholder={config ? 'Country' : 'Loading…'} />
          </SelectTrigger>
          <SelectContent>
            {(config ?? []).map((entry) => (
              <SelectItem key={entry.isoCode} value={entry.isoCode} className="text-sm">
                {entry.name}
                {entry.status === 'COMING_SOON' && (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600">soon</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={route?.language ?? ''} onValueChange={(code) => { onSwitchLanguage(code) }} disabled={!currentCountry}>
          <SelectTrigger className="h-10 border-zinc-200 bg-white text-sm font-medium" aria-label="Switch language">
            <SelectValue placeholder={currentCountry ? 'Language' : '—'} />
          </SelectTrigger>
          <SelectContent>
            {(currentCountry?.languages ?? []).map((entry) => (
              <SelectItem key={entry.code} value={entry.code} className="text-sm">
                {entry.nativeName ?? entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </nav>
  )

  return (
    <>
      {/* Desktop rail — sticky, never taller than the viewport, and never
          inflating short pages (self-start keeps the footer at the bottom) */}
      <aside className="sticky top-16 hidden max-h-[calc(100dvh-4rem)] w-60 shrink-0 self-start overflow-y-auto border-r border-zinc-200 bg-white lg:block">
        {nav}
      </aside>

      {/* Mobile drawer */}
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" className="w-80 overflow-y-auto p-0">
          <SheetHeader className="border-b border-zinc-100 p-4">
            <SheetTitle className="flex items-center gap-2 text-left">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500" aria-hidden="true">
                <Compass className="h-4 w-4 text-white" />
              </span>
              GKSetu
            </SheetTitle>
            <SheetDescription className="text-left">
              GK, current affairs and exam preparation
            </SheetDescription>
          </SheetHeader>
          {nav}
        </SheetContent>
      </Sheet>
    </>
  )
}
