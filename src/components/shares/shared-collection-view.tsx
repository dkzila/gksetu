'use client'

/**
 * GKSetu — the public shared-collection view (P8-S1 §21)
 * Master Plan §21: the unlisted landing surface a LINK-visibility collection
 * opens at (#/collections/{id}/) — "Do not expose private saved collections
 * unless explicitly made shareable by the owner": anything else answers the
 * server's typed not-shareable 404, rendered honestly here. §31: public
 * content only — the owner's identity never appears (the payload carries no
 * user data at all). §16: the surface is noindex (unlisted, reachable only
 * via the link); §36: item rows keep honest statuses (retired/archived items
 * stay listed as what they are). Items open in-app through the SAME §16 path
 * grammar the app already navigates by.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BookmarkCheck,
  CalendarClock,
  CheckCircle2,
  GraduationCap,
  HelpCircle,
  Landmark,
  Link2,
  ListChecks,
  Loader2,
  ShieldCheck,
} from 'lucide-react'

import { useSeoHead } from '@/components/home/seo-head'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API types (mirror GET /api/share/collections/{id} — §37/§39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface ApiSharedCollectionItem {
  kind: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION' | 'MOCK_TEST'
  title: string
  status: string
  canonicalPath: string | null
  detail: string | null
}

interface ApiSharedCollection {
  id: string
  name: string
  itemCount: number
  items: ApiSharedCollectionItem[]
  note: string
}

const KIND_META: Record<ApiSharedCollectionItem['kind'], { label: string; icon: typeof Landmark; tone: string }> = {
  KNOWLEDGE_UNIT: { label: 'Knowledge', icon: Landmark, tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  CONTENT_ITEM: { label: 'Article', icon: BookmarkCheck, tone: 'border-zinc-200 bg-white text-zinc-600' },
  CURRENT_EVENT: { label: 'Current affair', icon: CalendarClock, tone: 'border-orange-200 bg-orange-50 text-orange-700' },
  QNA: { label: 'Q&A', icon: HelpCircle, tone: 'border-teal-200 bg-teal-50 text-teal-700' },
  QUESTION: { label: 'Practice question', icon: ListChecks, tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  MOCK_TEST: { label: 'Mock test', icon: GraduationCap, tone: 'border-rose-200 bg-rose-50 text-rose-700' },
}

const HONEST_STATUS_TONE: Record<string, string> = {
  RETIRED: 'border-zinc-300 bg-zinc-100 text-zinc-500',
  ARCHIVED: 'border-zinc-300 bg-zinc-100 text-zinc-500',
  OUTDATED: 'border-amber-200 bg-amber-50 text-amber-700',
}

export interface SharedCollectionViewProps {
  collectionId: string
  /** Opens any §16 canonical path inside the app (the dashboard's openPath). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
}

export function SharedCollectionView({ collectionId, onOpenPath, onGoHome }: SharedCollectionViewProps) {
  const [collection, setCollection] = useState<ApiSharedCollection | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // §16: unlisted surface — never indexed, honestly declared.
  useSeoHead({
    title: collection ? `${collection.name} — a shared collection | GKSetu` : 'Shared collection | GKSetu',
    description: collection
      ? `A shared collection of ${collection.itemCount} saved items on GKSetu — public content only.`
      : 'A collection shared via its stable link on GKSetu.',
    noindex: true,
  })

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/share/collections/${encodeURIComponent(collectionId)}`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ collection: ApiSharedCollection }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setCollection(payload.data.collection)
        } else {
          setError(payload.error ?? { code: 'NOT_FOUND', message: 'This shared collection is not available.' })
        }
      } catch {
        if (!cancelled) setError({ code: 'NETWORK', message: 'Could not load this shared collection — please retry.' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [collectionId, reloadKey])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])

  return (
    <div className="space-y-6">
      {/* ---------- Header ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Shared collection
            </Badge>
          </div>
          {collection ? (
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">{collection.name}</h1>
          ) : (
            <Skeleton className="mt-2 h-9 w-72" aria-hidden="true" />
          )}
          {collection && (
            <p className="mt-1 text-sm text-zinc-600">
              {collection.itemCount} saved {collection.itemCount === 1 ? 'item' : 'items'} — public GKSetu content,
              opened by anyone with this link.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2 text-zinc-500 hover:text-zinc-900"
          onClick={onGoHome}
        >
          Back to the homepage
        </Button>
      </div>

      {/* ---------- Body ---------- */}
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the shared collection">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800" role="alert">
          <p className="font-medium">{error.message}</p>
          <p className="mt-1 text-[13px] leading-relaxed">
            Ask the person who shared this link with you — they may have stopped sharing the collection
            (their choice, reversible anytime).
          </p>
          <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={retry}>
            <Loader2 className="h-3.5 w-3.5" aria-hidden="true" />
            Try again
          </Button>
        </div>
      ) : collection && collection.items.length > 0 ? (
        <>
          <ul className="space-y-2" aria-label="Shared items">
            {collection.items.map((item, index) => {
              const meta = KIND_META[item.kind]
              const Icon = meta.icon
              const statusTone = HONEST_STATUS_TONE[item.status]
              return (
                <li key={`${item.kind}-${index}`} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => item.canonicalPath && onOpenPath(item.canonicalPath)}
                    disabled={!item.canonicalPath}
                    className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 disabled:cursor-default sm:p-4"
                  >
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${meta.tone}`} aria-hidden="true">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-zinc-800">{item.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] font-medium ${meta.tone}`}>
                          {meta.label}
                        </Badge>
                        {item.detail && <span className="text-xs text-zinc-500">{item.detail}</span>}
                        {statusTone && (
                          <Badge variant="outline" className={`text-[10px] font-normal ${statusTone}`}>
                            {item.status === 'RETIRED' ? 'Retired' : item.status === 'ARCHIVED' ? 'Archived' : 'Flagged for correction'}
                          </Badge>
                        )}
                      </span>
                    </span>
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-zinc-300" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            {collection.note}
          </p>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600" role="status">
          This shared collection is empty right now — the owner has not saved anything into it yet.
        </div>
      )}
    </div>
  )
}
