'use client'

/**
 * GlobIQ — site footer.
 *
 * User-facing footer: brand, the product's discovery links, personal
 * library links and support links. The staff console is reachable only
 * from a deliberately quiet link here — it is an internal tool, never a
 * primary navigation item.
 */

import { Globe } from 'lucide-react'

import { Button } from '@/components/ui/button'

// ---------- Props ----------

export interface SiteFooterProps {
  onGoHome: () => void
  onOpenCurrentAffairs: () => void
  onGoExams: () => void
  onGoQuickMock: () => void
  onGoConsole: () => void
}

// ---------- Component ----------

export function SiteFooter({
  onGoHome,
  onOpenCurrentAffairs,
  onGoExams,
  onGoQuickMock,
  onGoConsole,
}: SiteFooterProps) {
  const year = new Date().getFullYear()

  const exploreLinks: Array<{ label: string; onClick: () => void }> = [
    { label: 'Home', onClick: onGoHome },
    { label: 'Current Affairs', onClick: onOpenCurrentAffairs },
    { label: 'Exams', onClick: onGoExams },
    { label: 'Mock Tests', onClick: onGoQuickMock },
  ]

  const libraryLinks = [
    { label: 'Dashboard', href: '#/dashboard' },
    { label: 'Saved items', href: '#/saved' },
    { label: 'Following', href: '#/following' },
    { label: 'Notifications', href: '#/notifications' },
  ]

  const supportLinks = [
    { label: 'Send feedback', href: '#/feedback' },
    { label: 'Settings', href: '#/personalisation' },
    { label: 'Your profile', href: '#/profile' },
    { label: 'Sign in', href: '#/signin' },
  ]

  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500" aria-hidden="true">
                <Globe className="h-5 w-5 text-white" />
              </span>
              <span className="text-lg font-bold tracking-tight text-zinc-900">GlobIQ</span>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-zinc-500">
              Daily GK, current affairs with exam context, and complete exam
              syllabi — in your language, all in one place.
            </p>
          </div>

          {/* Explore */}
          <nav aria-label="Explore">
            <h3 className="pb-3 text-sm font-semibold text-zinc-900">Explore</h3>
            <ul className="space-y-2.5">
              {exploreLinks.map((link) => (
                <li key={link.label}>
                  <button
                    type="button"
                    onClick={link.onClick}
                    className="text-sm text-zinc-500 transition-colors hover:text-emerald-700"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* My Library */}
          <nav aria-label="My library">
            <h3 className="pb-3 text-sm font-semibold text-zinc-900">My Library</h3>
            <ul className="space-y-2.5">
              {libraryLinks.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-sm text-zinc-500 transition-colors hover:text-emerald-700">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Support */}
          <nav aria-label="Support">
            <h3 className="pb-3 text-sm font-semibold text-zinc-900">Support</h3>
            <ul className="space-y-2.5">
              {supportLinks.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="text-sm text-zinc-500 transition-colors hover:text-emerald-700">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-zinc-100 pt-6 pb-[max(0,env(safe-area-inset-bottom))] sm:flex-row sm:items-center">
          <p className="text-sm text-zinc-400">
            © {year} GlobIQ. All rights reserved.
          </p>
          <p className="text-sm text-zinc-400">
            Made for learners and aspirants everywhere.
          </p>
          {/* Internal tooling — deliberately quiet */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs font-normal text-zinc-300 hover:text-zinc-500"
            onClick={onGoConsole}
          >
            Staff console
          </Button>
        </div>
      </div>
    </footer>
  )
}
