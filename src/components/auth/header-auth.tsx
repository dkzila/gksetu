'use client'

/**
 * GKSetu — header auth area.
 *
 * The compact account surface: the notifications bell with its unread
 * badge, and an avatar dropdown carrying the personal links (dashboard,
 * saved, following, profile, settings, feedback) plus sign-out — or a
 * clean "Sign in" button to #/signin. The unread count is a pure stats
 * read refreshed on identity changes and window focus.
 */
import { useEffect } from 'react'
import {
  Bell,
  Bookmark,
  ChevronDown,
  FileQuestion,
  LineChart,
  LogIn,
  LogOut,
  Rss,
  Settings,
  UserRound,
} from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { useNotificationCount } from '@/stores/notifications'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function HeaderAuth() {
  const { status, user, signOut } = useAuth()
  const unreadCount = useNotificationCount((state) => state.unreadCount)
  const refreshCount = useNotificationCount((state) => state.refresh)
  const clearCount = useNotificationCount((state) => state.clear)

  // The badge follows identity: refresh on auth changes + window focus
  // (a PURE stats read — it never triggers delivery).
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
    // A gentle nudge until onboarding is completed/skipped.
    const setupPending =
      user.onboardingStatus === 'PENDING' || user.onboardingStatus === 'IN_PROGRESS'

    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {/* Notifications bell */}
        <Button
          variant="ghost"
          size="sm"
          className="relative h-10 w-10 p-0 text-zinc-500 hover:text-emerald-700"
          asChild
        >
          <a
            href="/notifications"
            aria-label={`Your notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span
                className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-semibold leading-none text-white"
                aria-hidden="true"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </a>
        </Button>

        {/* Account dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-10 gap-1.5 px-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 sm:px-2"
              aria-label="Your account menu"
            >
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="hidden h-3.5 w-3.5 text-zinc-400 sm:inline" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="space-y-0.5">
              <p className="truncate text-sm font-semibold">{user.name ?? 'Learner'}</p>
              <p className="truncate text-xs font-normal text-zinc-500">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <a href="/dashboard" className="cursor-pointer">
                  <LineChart className="mr-2 h-4 w-4" aria-hidden="true" />
                  Dashboard
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/saved" className="cursor-pointer">
                  <Bookmark className="mr-2 h-4 w-4" aria-hidden="true" />
                  Saved items
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/following" className="cursor-pointer">
                  <Rss className="mr-2 h-4 w-4" aria-hidden="true" />
                  Following
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <a href="/profile" className="cursor-pointer">
                  <UserRound className="mr-2 h-4 w-4" aria-hidden="true" />
                  Profile
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/personalisation" className="cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" aria-hidden="true" />
                  Settings
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/feedback" className="cursor-pointer">
                  <FileQuestion className="mr-2 h-4 w-4" aria-hidden="true" />
                  Feedback
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {setupPending && (
              <DropdownMenuItem asChild>
                <a href="/onboarding" className="cursor-pointer text-emerald-700 focus:text-emerald-700">
                  <span className="mr-2 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                  Finish setting up your profile
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="cursor-pointer text-red-600 focus:text-red-600"
              onSelect={() => void signOut()}
            >
              <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <Button
      asChild
      size="sm"
      className="h-10 gap-2 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
    >
      <a href="/signin">
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Sign in
      </a>
    </Button>
  )
}
