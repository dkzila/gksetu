'use client'

/**
 * GKSetu — the managed site page view (CONSOLE-S1).
 *
 * Renders a PUBLISHED SitePage (About, Contact, Privacy Policy, terms, or
 * any custom page under /p/{slug}) with the public site chrome — the
 * header/footer wrap it like every other public surface. The body is the
 * publish snapshot (never the working copy), authored by staff in
 * Console → Pages (trusted-admin HTML, the WordPress model).
 */
import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { navigateToPath } from '@/components/home/app-router'
import { useSeoHead } from '@/components/home/seo-head'

interface PublicSitePage {
  slug: string
  title: string
  body: string
  seoTitle: string | null
  seoDescription: string | null
  publishedAt: string
  updatedAt: string
}

export function SitePageView({ slug }: { slug: string }) {
  const [page, setPage] = useState<PublicSitePage | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setState('loading')
      try {
        const response = await fetch(`/api/pages/${encodeURIComponent(slug)}`, { cache: 'no-store' })
        if (!response.ok) {
          if (!cancelled) setState('missing')
          return
        }
        const payload = (await response.json()) as { status: 'ok'; data: { page: PublicSitePage } } | { status: 'error' }
        if (cancelled) return
        if (payload.status === 'ok') {
          setPage(payload.data.page)
          setState('ready')
        } else {
          setState('missing')
        }
      } catch {
        if (!cancelled) setState('missing')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  useSeoHead({
    title: page ? (page.seoTitle ?? `${page.title}`) : 'Page',
    description: page?.seoDescription ?? undefined,
    noindex: false,
  })

  if (state === 'loading') {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-10">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  if (state === 'missing' || !page) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-24 text-center">
        <FileText className="h-10 w-10 text-zinc-300" aria-hidden="true" />
        <h1 className="text-xl font-semibold tracking-tight">This page isn&apos;t available</h1>
        <p className="text-sm text-zinc-500">
          The page may have been unpublished or the link is wrong.
        </p>
        <Button onClick={() => navigateToPath('/')} className="bg-emerald-600 text-white hover:bg-emerald-700">
          Back to the homepage
        </Button>
      </div>
    )
  }

  return (
    <article className="mx-auto max-w-3xl py-8 sm:py-12">
      <header className="mb-8 border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-xs text-zinc-400">
          Last updated{' '}
          {new Date(page.publishedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </header>
      {/*
        Staff-authored HTML (Console → Pages — trusted-admin content, the
        WordPress model). Rendered inside a scoped prose-like container.
      */}
      <div
        className="site-page-body"
        dangerouslySetInnerHTML={{ __html: page.body }}
      />
    </article>
  )
}
