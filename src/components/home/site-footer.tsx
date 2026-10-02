'use client'

/**
 * GKSetu — site footer.
 *
 * User-facing footer: brand, the product's discovery links, personal
 * library links, support links and — CONSOLE-S1 — the MANAGED PAGES column
 * (About, Contact, Privacy Policy + anything the team publishes with
 * "show in footer"), fetched live from GET /api/pages so publishing a page
 * in the console adds it here without a redeploy. The staff console stays
 * reachable only from a deliberately quiet link — it is an internal tool,
 * never a primary navigation item.
 */

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { navigateToPath } from '@/components/home/app-router'

// ---------- Props ----------

export interface SiteFooterProps {
  onGoHome: () => void
  onOpenCurrentAffairs: () => void
  onGoExams: () => void
  onGoQuickMock: () => void
  onGoConsole: () => void
}

// ---------- The managed-pages column ----------

interface ManagedPageLink {
  slug: string
  title: string
}

/** The fallback set — before the API responds or if it ever fails. */
const FALLBACK_PAGES: ManagedPageLink[] = [
  { slug: 'about', title: 'About' },
  { slug: 'contact', title: 'Contact' },
  { slug: 'privacy-policy', title: 'Privacy Policy' },
]

function pagePath(slug: string): string {
  const RESERVED = ['about', 'contact', 'privacy-policy', 'terms', 'disclaimer']
  return RESERVED.includes(slug) ? `/${slug}` : `/p/${slug}`
}

function useManagedPages(): ManagedPageLink[] {
  const [pages, setPages] = useState<ManagedPageLink[]>(FALLBACK_PAGES)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/pages', { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as
          | { status: 'ok'; data: { pages: ManagedPageLink[] } }
          | { status: 'error' }
        if (!cancelled && payload.status === 'ok' && payload.data.pages.length > 0) {
          setPages(payload.data.pages)
        }
      } catch {
        // The fallback set keeps the footer complete.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return pages
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
  const managedPages = useManagedPages()

  const exploreLinks: Array<{ label: string; onClick: () => void }> = [
    { label: 'Home', onClick: onGoHome },
    { label: 'Current Affairs', onClick: onOpenCurrentAffairs },
    { label: 'Exams', onClick: onGoExams },
    { label: 'Mock Tests', onClick: onGoQuickMock },
  ]

  const libraryLinks = [
    { label: 'Dashboard', href: '/dashboard' },
    { label: 'Saved items', href: '/saved' },
    { label: 'Following', href: '/following' },
    { label: 'Notifications', href: '/notifications' },
  ]

  const supportLinks = [
    { label: 'Send feedback', href: '/feedback' },
    { label: 'Settings', href: '/personalisation' },
    { label: 'Your profile', href: '/profile' },
    { label: 'Sign in', href: '/signin' },
  ]

  return (
    <footer className="mt-auto border-t border-zinc-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand — the GKSetu wordmark (REBRAND-S1): "GK" and "Setu"
              together, two tones; the badge carries the bridge (setu) mark. */}
          <div className="space-y-3 lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 15.5h16" />
                  <path d="M6 15.5c1.6-7.4 10.4-7.4 12 0" />
                  <path d="M7.5 15.5v3.5" />
                  <path d="M16.5 15.5v3.5" />
                  <path d="M12 10.5v8.5" />
                </svg>
              </span>
              <span className="text-lg font-extrabold tracking-tight">
                <span className="text-emerald-700">GK</span>
                <span className="text-zinc-900">Setu</span>
              </span>
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

          <div className="space-y-8">
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

            {/* Company — the managed pages (CONSOLE-S1, live from the console) */}
            <nav aria-label="Company">
              <h3 className="pb-3 text-sm font-semibold text-zinc-900">Company</h3>
              <ul className="space-y-2.5">
                {managedPages.map((page) => (
                  <li key={page.slug}>
                    <button
                      type="button"
                      onClick={() => navigateToPath(pagePath(page.slug))}
                      className="text-sm text-zinc-500 transition-colors hover:text-emerald-700"
                    >
                      {page.title}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-zinc-100 pt-6 pb-[max(0,env(safe-area-inset-bottom))] sm:flex-row sm:items-center">
          <p className="text-sm text-zinc-400">
            © {year} GKSetu. All rights reserved.
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
