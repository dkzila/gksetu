'use client'

/**
 * GKSetu — production site header.
 *
 * The public shell's top bar: the brand, the primary product navigation
 * (Home, Current Affairs, Exams, Mock Tests), the country/language
 * switchers and the compact account area. Technical surfaces (the staff
 * console) deliberately live ONLY in the footer — users came for GK,
 * current affairs and exam preparation, not for platform internals.
 */

import { Languages, MapPin, Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { HeaderAuth } from '@/components/auth/header-auth'
import type { ApiCountry } from './types'
import type { AppRoute } from './hash-router'

// ---------- Props ----------

export interface SiteHeaderProps {
  config: ApiCountry[] | null
  route: AppRoute | null
  onGoHome: () => void
  onOpenCurrentAffairs: () => void
  onGoExams: () => void
  onGoQuickMock: () => void
  onSwitchCountry: (iso: string) => void
  onSwitchLanguage: (code: string) => void
  onOpenNav: () => void
}

// ---------- Component ----------

export function SiteHeader({
  config,
  route,
  onGoHome,
  onOpenCurrentAffairs,
  onGoExams,
  onGoQuickMock,
  onSwitchCountry,
  onSwitchLanguage,
  onOpenNav,
}: SiteHeaderProps) {
  const currentCountry = config && route ? config.find((entry) => entry.isoCode === route.countryIso) ?? null : null

  const navItems = [
    {
      label: 'Home',
      active: route?.view === 'home',
      onClick: onGoHome,
    },
    {
      label: 'Current Affairs',
      active:
        route?.view === 'event' ||
        (route?.view === 'topic' && route.topicSlug === 'current-affairs'),
      onClick: onOpenCurrentAffairs,
    },
    {
      label: 'Exams',
      active: route?.view === 'exam' || route?.view === 'syllabus',
      onClick: onGoExams,
    },
    {
      label: 'Mock Tests',
      active: route?.view === 'quick-mock' || route?.view === 'test',
      onClick: onGoQuickMock,
    },
  ]

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        {/* Mobile: drawer trigger */}
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 shrink-0 p-0 text-zinc-600 sm:hidden"
          onClick={onOpenNav}
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>

        {/* Brand — GKSetu wordmark (REBRAND-S1): "GK" and "Setu" set together
            as one word in two tones; the badge carries a bridge mark (setu =
            bridge) over the platform's emerald. */}
        <button
          type="button"
          onClick={onGoHome}
          className="flex min-h-[44px] shrink-0 items-center gap-2.5 text-left"
          aria-label="GKSetu home"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 shadow-sm" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 15.5h16" />
              <path d="M6 15.5c1.6-7.4 10.4-7.4 12 0" />
              <path d="M7.5 15.5v3.5" />
              <path d="M16.5 15.5v3.5" />
              <path d="M12 10.5v8.5" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-lg font-extrabold tracking-tight">
              <span className="text-emerald-700">GK</span>
              <span className="text-zinc-900">Setu</span>
            </span>
            <span className="hidden text-[11px] font-medium text-zinc-500 sm:block">
              GK · Current Affairs · Exams
            </span>
          </span>
        </button>

        {/* Primary nav (desktop) */}
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              aria-current={item.active ? 'page' : undefined}
              className={`inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium transition-colors ${
                item.active
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Country switcher */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            <span className="sr-only">Country</span>
            <Select value={route?.countryIso ?? ''} onValueChange={onSwitchCountry} disabled={!config}>
              <SelectTrigger
                className="h-9 w-[120px] border-zinc-200 bg-white text-sm font-medium"
                aria-label="Switch country"
              >
                <SelectValue placeholder={config ? 'Country' : 'Loading…'} />
              </SelectTrigger>
              <SelectContent>
                {(config ?? []).map((entry) => (
                  <SelectItem key={entry.isoCode} value={entry.isoCode} className="text-sm">
                    {entry.name}
                    {entry.status === 'COMING_SOON' && (
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600">
                        soon
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Language switcher */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <Languages className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            <span className="sr-only">Language</span>
            <Select value={route?.language ?? ''} onValueChange={onSwitchLanguage} disabled={!currentCountry}>
              <SelectTrigger
                className="h-9 w-[110px] border-zinc-200 bg-white text-sm font-medium"
                aria-label="Switch language"
              >
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

          {/* Notifications bell + account */}
          <HeaderAuth />
        </div>
      </div>
    </header>
  )
}
