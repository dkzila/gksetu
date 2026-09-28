'use client'

/**
 * GlobIQ — the save toggle button (P5-S2)
 * Master Plan §10 (Save is an explicit retrieval/bookmark action — it NEVER
 * feeds recommendations; the mirror affordance to Follow on content objects),
 * §31 (reversible — unsave anytime), §38 (one auth surface: signed-out clicks
 * route to #account).
 *
 * The button state is fetched per view via GET /api/saves/state (truthful per
 * object, never client-guessed) and toggled via POST /api/saves and DELETE
 * /api/saves/{id} — the same versioned APIs a mobile app calls (§39). Saves
 * land in the default "Saved" collection; organising into custom collections
 * happens at #/saved (§10).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkCheck, Loader2 } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'

import type { ApiSaveState, SaveEnvelope } from './types'

export interface SaveButtonProps {
  /** P7-S1: QNA — the §22 practice layer's entries (objectRef = the QnA id);
   *  P7-S2: QUESTION — the §22 scored practice layer's questions (objectRef
   *  = the Question id). */
  objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION'
  /** Canonical slug (unit/event) or id (content item) of the object this button saves. */
  objectRef: string
  /** Display name used in toasts (the object's honest label). */
  objectName: string
  size?: 'sm' | 'default'
  className?: string
}

export function SaveButton({
  objectType,
  objectRef,
  objectName,
  size = 'sm',
  className,
}: SaveButtonProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const [state, setState] = useState<ApiSaveState | null>(null)
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
      const response = await fetch(`/api/saves/state?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as SaveEnvelope<ApiSaveState>
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
      title: 'Sign in to save',
      description: `Create a free account to keep ${objectName} in your collections — saves are your personal bookmarks (§10).`,
    })
    window.location.hash = '#account'
  }, [objectName, toast])

  const onSave = useCallback(async () => {
    if (!token) {
      signInPrompt()
      return
    }
    setPending(true)
    try {
      const response = await fetch('/api/saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ objectType, objectRef }),
      })
      const payload = (await response.json()) as SaveEnvelope<{ save: ApiSaveState['save'] }>
      if (payload.status === 'ok' && payload.data) {
        if (mounted.current) {
          setState((current) => ({
            objectType,
            objectRef,
            objectSlug: current?.objectSlug ?? objectRef,
            objectFound: true,
            saved: true,
            save: payload.data!.save ?? null,
          }))
        }
        toast({
          title: `Saved ${objectName}`,
          description: 'Kept in your “Saved” collection — organise it at #/saved (retrieval, §10).',
        })
      } else {
        // The server's honest §36 explanation (retired/scheduled/not public…).
        toast({
          title: 'Could not save',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
        void fetchState()
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the save service. Please retry.',
        variant: 'destructive',
      })
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [token, objectType, objectRef, objectName, signInPrompt, toast, fetchState])

  const onUnsave = useCallback(async () => {
    const saveId = state?.save?.id
    if (!token || !saveId) {
      void fetchState()
      return
    }
    setPending(true)
    try {
      const response = await fetch(`/api/saves/${encodeURIComponent(saveId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as SaveEnvelope<{ removed: boolean }>
      if (payload.status === 'ok') {
        if (mounted.current) {
          setState((current) =>
            current ? { ...current, saved: false, save: null } : current
          )
        }
        toast({
          title: `Removed ${objectName}`,
          description: 'Out of your collections (§31 — reversible anytime).',
        })
      } else {
        toast({
          title: 'Could not remove',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
        void fetchState()
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the save service. Please retry.',
        variant: 'destructive',
      })
    } finally {
      if (mounted.current) setPending(false)
    }
  }, [token, state, objectName, toast, fetchState])

  const saved = state?.saved === true
  const busy = pending || (status === 'authenticated' && loading && state === null)

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      aria-pressed={saved}
      disabled={busy}
      onClick={() => (saved ? void onUnsave() : void onSave())}
      className={
        saved
          ? `gap-2 border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-900 ${className ?? ''}`
          : `gap-2 border-zinc-300 bg-white text-zinc-800 hover:border-emerald-400 hover:text-emerald-800 ${className ?? ''}`
      }
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : saved ? (
        <BookmarkCheck className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Bookmark className="h-4 w-4" aria-hidden="true" />
      )}
      {saved ? 'Saved' : 'Save'}
      <span className="sr-only">
        {saved ? ` — remove ${objectName} from your collections` : ` — save ${objectName} for later`}
      </span>
    </Button>
  )
}
