'use client'

/**
 * GlobIQ — header auth area (P1-S2, extended P5-S1…P5-S4, P8-S2)
 * Shows the signed-in user chip, the §27 notifications bell (P8-S2 — the
 * unread-count badge over the pure stats read, linking to #/notifications),
 * the #/dashboard personalised feed link (P5-S4), the #/following
 * personalisation link (P5-S1), the #/saved collections link (P5-S2), the
 * #/profile link with a "finish setup" pill while onboarding is pending
 * (P5-S3) and the sign-out control — or a "Sign in" anchor to #account.
 */
import { useEffect } from 'react'
import { Bell, Bookmark, ListChecks, LogIn, LogOut, Rss, UserRound } from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { useNotificationCount } from '@/stores/notifications'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

export function HeaderAuth() {
  const { status, user, signOut } = useAuth()
  const unreadCount = useNotificationCount((state) => state.unreadCount)
  const refreshCount = useNotificationCount((state) => state.refresh)
  const clearCount = useNotificationCount((state) => state.clear)

  // The badge follows identity: refresh on auth changes + window focus
  // (a PURE stats read — it never triggers delivery, §27).
  useEffect(() => {
    if (status === 'authenticated' && user) {
      void refreshCount()
    } else {
      clearCount()
    }
  }, [status, user, refreshCount, clearCount])

  useEffect(() => {
    if (status !== 'authenticated') return
    const onFocus = () => void refreshCount()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [status, refreshCount])

  if (status === 'authenticated' && user) {
    const initial = (user.name?.trim() ?? user.email).slice(0, 1).toUpperCase()
    // §6 onboarding state (P5-S3): a gentle nudge until completed/skipped.
    const setupPending =
      user.onboardingStatus === 'PENDING' || user.onboardingStatus === 'IN_PROGRESS'
    return (
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 xl:flex">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[110px] truncate text-sm font-medium">{user.name ?? user.email}</span>
        </span>
        {setupPending && (
          <a
            href="#/onboarding"
            className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 xl:inline-flex"
            aria-label="Finish setting up your learning profile"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
            Finish setup
          </a>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 gap-2 px-1.5 text-zinc-500 hover:text-emerald-700 sm:px-2"
          asChild
        >
          <a href="#/notifications" aria-label={`Your notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}>
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-none text-white"
                aria-hidden="true"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
            <span className="hidden lg:inline">Notifications</span>
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-1.5 text-zinc-500 hover:text-emerald-700 sm:px-2"
          asChild
        >
          <a href="#/dashboard" aria-label="Your personalised dashboard and combined-exam queue">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Dashboard</span>
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-1.5 text-zinc-500 hover:text-emerald-700 sm:px-2"
          asChild
        >
          <a href="#/following" aria-label="Your followed exams and topics">
            <Rss className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Following</span>
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-1.5 text-zinc-500 hover:text-emerald-700 sm:px-2"
          asChild
        >
          <a href="#/saved" aria-label="Your saved items and collections">
            <Bookmark className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Saved</span>
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-1.5 text-zinc-500 hover:text-emerald-700 sm:px-2"
          asChild
        >
          <a href="#/profile" aria-label="Your profile and learning goal">
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="hidden lg:inline">Profile</span>
          </a>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-1.5 text-zinc-500 hover:text-zinc-900 sm:px-2"
          onClick={() => void signOut()}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden lg:inline">Sign out</span>
        </Button>
      </div>
    )
  }

  return (
    <Button
      asChild
      size="sm"
      className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
    >
      <a href="#account">
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Sign in
      </a>
    </Button>
  )
}
