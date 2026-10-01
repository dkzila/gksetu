'use client'

/**
 * GKSetu — the §21 collection share control (P8-S1)
 * Master Plan §21: "Do not expose private saved collections unless explicitly
 * made shareable by the owner" — THIS is the explicit opt-in. PRIVATE → LINK
 * (PATCH /api/collections/{id} { visibility }, one audited operation per
 * request, §30), then the ShareDialog serves the stable unlisted link
 * (#/collections/{id}/). Revoking is one click and never touches the items
 * (§31 reversibility). Available for the default "Saved" collection too:
 * sharing is the owner's choice over their own bucket (§10 immutability
 * protects name/deletion, not visibility). The control states exactly what
 * sharing means — public content only, no owner identity (§21/§31).
 */
import { useCallback, useState } from 'react'
import { Link2, Link2Off, Loader2, ShieldCheck } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ShareButton } from '@/components/shares/share-button'

import type { ApiCollection, SaveEnvelope } from './types'

export interface CollectionShareControlProps {
  collection: ApiCollection
  /** Refresh the collection list after the visibility changes (live truth). */
  onUpdated: () => void | Promise<void>
}

export function CollectionShareControl({ collection, onUpdated }: CollectionShareControlProps) {
  const { token } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState(false)

  const patchVisibility = useCallback(
    async (visibility: 'LINK' | 'PRIVATE') => {
      if (!token || busy) return
      setBusy(true)
      try {
        const response = await fetch(`/api/collections/${encodeURIComponent(collection.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ visibility }),
        })
        const payload = (await response.json()) as SaveEnvelope<{ collection: ApiCollection }>
        if (payload.status === 'ok') {
          if (visibility === 'LINK') {
            toast({
              title: `“${collection.name}” is now shareable via link`,
              description:
                'Anyone with the link sees this collection’s public content — never your identity. Stop sharing anytime.',
            })
          } else {
            toast({
              title: `Stopped sharing “${collection.name}”`,
              description: 'The link no longer opens — your saved items are untouched.',
            })
          }
          setConfirmRevoke(false)
          await onUpdated()
        } else {
          toast({
            title: 'Could not change sharing',
            description: payload.error?.message ?? 'Please try again.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({
          title: 'Network error',
          description: 'Could not reach the collections service. Please retry.',
          variant: 'destructive',
        })
      } finally {
        setBusy(false)
      }
    },
    [token, busy, collection.id, collection.name, toast, onUpdated]
  )

  const shared = collection.visibility === 'LINK'

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <p className="mr-auto flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        {shared ? (
          <>
            <strong className="text-zinc-900">“{collection.name}”</strong> is shareable via link
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Shared
            </Badge>
          </>
        ) : (
          <>
            <strong className="text-zinc-900">“{collection.name}”</strong> stays private until you
            explicitly make it shareable
          </>
        )}
      </p>

      {shared ? (
        <span className="flex flex-wrap items-center gap-2">
          <ShareButton path={`/collections/${collection.id}/`} title={collection.name} />
          {confirmRevoke ? (
            <>
              <Button
                size="sm"
                className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                disabled={busy}
                onClick={() => void patchVisibility('PRIVATE')}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2Off className="h-4 w-4" aria-hidden="true" />}
                Stop sharing
              </Button>
              <Button variant="ghost" size="sm" className="text-zinc-500" onClick={() => setConfirmRevoke(false)}>
                Keep sharing
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-zinc-200 bg-white text-zinc-600 hover:text-zinc-900"
              disabled={busy}
              onClick={() => setConfirmRevoke(true)}
            >
              <Link2Off className="h-4 w-4" aria-hidden="true" />
              Stop sharing
            </Button>
          )}
        </span>
      ) : (
        <Button
          size="sm"
          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={busy}
          onClick={() => void patchVisibility('LINK')}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
          Share via link
        </Button>
      )}
    </div>
  )
}
