'use client'

/**
 * GlobIQ — the follow toggle button (P5-S1)
 * Master Plan §9 (explicit, reversible personalisation signal), §10 (follow
 * semantics — feed/notifications/recommendations context, not a bookmark),
 * §14 (country rules enforced by the server — the button shows the server's
 * honest explanation on a rejected follow), §38 (one auth surface: signed-out
 * clicks route to #account).
 *
 * The button state is fetched per view via GET /api/follows/state (truthful
 * per object, never client-guessed) and toggled via POST /api/follows and
 * DELETE /api/follows/{id} — the same versioned APIs a mobile app calls (§39).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, BellRing, Loader2 } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'

import type {
  ApiFollowState,
  FollowEnvelope,
} from './types'

export interface FollowButtonProps {
  objectType: 'EXAM' | 'TOPIC'
  /** Canonical slug (or id) of the object this button follows. */
  objectRef: string
  /** Display name used in toasts (the object's honest label). */
  objectName: string
  size?: 'sm' | 'default'
  className?: string
}

export function FollowButton({
  objectType,
  objectRef,
  objectName,
  size = 'sm',
  className,
}: FollowButtonProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const [state, setState] = useState<ApiFollowState | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const fetchState = useCallback(async () => {
    if (status !== 'authenticated' || !token) {
      setState(null)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ objectType, objectRef })
      const response = await fetch(`/api/follows/state?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as FollowEnvelope<ApiFollowState>
      if (mounted.current && payload.status === 'ok' && payload.data) {
        setState(payload.data)
      } else if (mounted.current) {
        setState(null)
      }
    } catch {
      if (mounted.current) setState(null)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [status, token, objectType, objectRef])

  useEffect(() => {
    void fetchState()
  }, [fetchState])

  const signInPrompt = useCallback(() => {
    toast({
      title: 'Sign in to follow',
      description: `Create a free account to follow ${objectName} — follows shape your personal GlobIQ feed.`,
    })
    window.location.hash = '#account'
  }, [objectName, toast])

  const onFollow = useCallback(async () => {
    if (!token) {
      signInPrompt()
      return
    }
    setPending(true)
    try {
      const response = await fetch('/api/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ objectType, objectRef }),
      })
      const payload = (await response.json()) as FollowEnvelope<{ follow: ApiFollowState['follow'] }>
      if (payload.status === 'ok' && payload.data) {
        if (mounted.current) {
          setState((current) => ({
            objectType,
            objectRef,
            objectSlug: current?.objectSlug ?? objectRef,
            objectFound: true,
            following: true,
            follow: payload.data!.follow ?? null,
          }))
        }
        toast({
          title: `Following ${objectName}`,
          description: 'It will shape your feed and dashboard (personalisation, §9).',
        })
      } else {
        // The server's honest §14/§36 explanation (country scope, status…).
        toast({
          title: 'Could not follow',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
        void fetchState()
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the follow service. Please retry.',
        variant: 'destructive',
      })
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [token, objectType, objectRef, objectName, signInPrompt, toast, fetchState])

  const onUnfollow = useCallback(async () => {
    const followId = state?.follow?.id
    if (!token || !followId) {
      void fetchState()
      return
    }
    setPending(true)
    try {
      const response = await fetch(`/api/follows/${encodeURIComponent(followId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as FollowEnvelope<{ removed: boolean }>
      if (payload.status === 'ok') {
        if (mounted.current) {
          setState((current) =>
            current
              ? { ...current, following: false, follow: null }
              : current
          )
        }
        toast({ title: `Unfollowed ${objectName}`, description: 'Personalisation updated (§9 — reversible anytime).' })
      } else {
        toast({
          title: 'Could not unfollow',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
        void fetchState()
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the follow service. Please retry.',
        variant: 'destructive',
      })
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [token, state, objectName, toast, fetchState])

  const following = state?.following === true
  const busy = pending || (status === 'authenticated' && loading && state === null)

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      aria-pressed={following}
      disabled={busy}
      onClick={() => (following ? void onUnfollow() : void onFollow())}
      className={
        following
          ? `gap-2 border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-900 ${className ?? ''}`
          : `gap-2 border-zinc-300 bg-white text-zinc-800 hover:border-emerald-400 hover:text-emerald-800 ${className ?? ''}`
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : following ? (
        <BellRing className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Bell className="h-4 w-4" aria-hidden="true" />
      )}
      {following ? 'Following' : 'Follow'}
      <span className="sr-only">
        {following ? ` — stop following ${objectName}` : ` — follow ${objectName}`}
      </span>
    </Button>
  )
}
