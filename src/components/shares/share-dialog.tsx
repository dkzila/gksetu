'use client'

/**
 * GlobIQ — the §21 share dialog (P8-S1)
 * Master Plan §21: the share card preview identifies the content title, the
 * topic and the platform branding (never the sharer's identity — §31 private
 * user data never appears in share metadata); the STABLE SHARE URL is the §16
 * canonical path resolved against the current origin; the Web Share API is
 * used where available with a copy-link fallback; every completed action
 * records a §32 share event (anonymous-friendly — POST /api/share/events
 * attaches the account only when signed in). §36 honesty: the card ships the
 * server's honest statuses, and the note under the actions says exactly what
 * gets recorded — the dialog never posts to social networks on your behalf.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Globe,
  Link2,
  Loader2,
  Share2,
  ShieldCheck,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API types (mirror GET /api/share/metadata — §37/§39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface ApiShareCard {
  objectType: string
  objectRef: string
  title: string
  description: string
  topicLabel: string | null
  brand: { name: string; tagline: string }
  canonicalPath: string
  sharePath: string
  robots: { index: boolean; reason: string }
  status: string | null
}

export interface ShareDialogProps {
  /** The §16 path the button sits on (with the leading '#', as the app renders it). */
  path: string
  /** Fallback label while the card loads / when it fails (the honest degradation). */
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShareDialog({ path, title, open, onOpenChange }: ShareDialogProps) {
  const { token } = useAuth()
  const { toast } = useToast()

  const [card, setCard] = useState<ApiShareCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The card is server truth (§16 canonical path rebuilt, §36 honest status)
  // — never client-guessed from the current route.
  const fetchCard = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const params = new URLSearchParams({ path })
      const response = await fetch(`/api/share/metadata?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ card: ApiShareCard }>
      if (mounted.current) {
        if (payload.status === 'ok' && payload.data) {
          setCard(payload.data.card)
        } else {
          setCard(null)
          setError(payload.error?.message ?? 'This page cannot be shared right now.')
        }
      }
    } catch {
      if (mounted.current) {
        setCard(null)
        setError('Could not load the share card — please retry.')
      }
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    if (open) void fetchCard()
  }, [open, fetchCard])

  // §32: record the event AFTER the action completed — the receipt carries no
  // counts (§31); a failed record never blocks the share itself.
  const recordEvent = useCallback(
    async (channel: 'WEB_SHARE' | 'COPY_LINK') => {
      try {
        await fetch('/api/share/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ action: 'SHARE_CREATE', path, channel }),
        })
      } catch {
        // §36 honesty: a share that left the device is a share; the analytics
        // record is best-effort and never surfaces as a user-facing error.
      }
    },
    [path, token]
  )

  // §21: the Web Share API where available — the native sheet, no fallback UI.
  const webShareAvailable = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const onWebShare = useCallback(async () => {
    if (!card || sharing) return
    setSharing(true)
    try {
      await navigator.share({
        title: `${card.title} — ${card.brand.name}`,
        text: card.description,
        url: `${window.location.origin}/#${card.sharePath}`,
      })
      await recordEvent('WEB_SHARE')
      toast({
        title: 'Shared',
        description: 'The link left through your device’s share sheet.',
      })
      onOpenChange(false)
    } catch (shareError) {
      // AbortError = the user dismissed the sheet — never an error toast.
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      toast({
        title: 'Could not open the share sheet',
        description: 'Copy the link instead — the same stable URL.',
        variant: 'destructive',
      })
    } finally {
      if (mounted.current) setSharing(false)
    }
  }, [card, sharing, recordEvent, toast, onOpenChange])

  const onCopyLink = useCallback(async () => {
    if (!card) return
    const url = `${window.location.origin}/#${card.sharePath}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        // The copy-link fallback's own fallback: a detached textarea for
        // browsers without the async clipboard API (§21 “with a copy-link
        // fallback” — the link is ALWAYS copyable).
        const area = document.createElement('textarea')
        area.value = url
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        document.body.removeChild(area)
      }
      setCopied(true)
      await recordEvent('COPY_LINK')
      toast({ title: 'Link copied', description: 'A stable link — it opens this exact page.' })
    } catch {
      toast({
        title: 'Could not copy',
        description: `Select and copy it manually: ${url}`,
        variant: 'destructive',
      })
    }
  }, [card, recordEvent, toast])

  const shareUrl = card ? `${typeof window !== 'undefined' ? window.location.origin : ''}/#${card.sharePath}` : ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Share this page
          </DialogTitle>
          <DialogDescription>
            A stable link — it opens this exact page for anyone, signed in or not.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the share card">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error || !card ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
              {error ?? 'This page cannot be shared right now.'}
            </p>
            <Button variant="outline" size="sm" onClick={() => void fetchCard()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ---------- The §21 share card preview ---------- */}
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4" aria-label="Share card preview">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600" aria-hidden="true">
                  <Globe className="h-4 w-4 text-white" />
                </span>
                <span className="text-sm font-semibold text-zinc-900">{card.brand.name}</span>
                <span className="truncate text-xs text-zinc-500">{card.brand.tagline}</span>
              </div>
              <p className="mt-3 text-[15px] font-semibold leading-snug text-zinc-900">{card.title}</p>
              {card.topicLabel && (
                <Badge variant="outline" className="mt-2 border-emerald-200 bg-white font-normal text-emerald-700">
                  {card.topicLabel}
                </Badge>
              )}
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">{card.description}</p>
              <p className="mt-3 break-all rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-zinc-500">
                {shareUrl}
              </p>
              {!card.robots.index && (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                  Unlisted — reachable via this link, never listed or indexed.
                </p>
              )}
            </div>

            {/* ---------- §21 actions: Web Share API + copy-link fallback ---------- */}
            <div className="flex flex-col gap-2 sm:flex-row">
              {webShareAvailable && (
                <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-1" disabled={sharing} onClick={() => void onWebShare()}>
                  {sharing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                  Share…
                </Button>
              )}
              <Button
                variant={webShareAvailable ? 'outline' : 'default'}
                className={`gap-2 sm:flex-1 ${webShareAvailable ? '' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
                onClick={() => void onCopyLink()}
              >
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : webShareAvailable ? <Link2 className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>

            {/* ---------- §31/§36 honesty note ---------- */}
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-400">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Share actions are recorded as anonymous product analytics — never posted to
              social networks on your behalf, and never tied to your recommendations.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
