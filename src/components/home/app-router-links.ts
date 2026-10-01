'use client'

/**
 * GKSetu — SPA link handling (DEPLOY-S2)
 *
 * With the URL space on real paths (no '#'), plain <a href="/…"> links in
 * the sidebar, footer, dashboard cards and profile surfaces would trigger
 * full document reloads. This ONE root-level click listener routes them
 * through the app router instead — pushState + the popstate re-parse —
 * keeping the single-page behaviour the hash router used to give for free.
 *
 * The browser default is preserved for everything that is NOT a plain
 * same-document navigation: modified clicks (open in new tab/window),
 * non-primary buttons, target != _self, download links, external origins,
 * and /api/* paths (never a page).
 */
import { useEffect } from 'react'

import { navigateToPath } from './app-router'

export function useAppRouteLinks(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      const href = anchor.getAttribute('href') ?? ''
      // Same-origin absolute or root-relative paths only — '#…' anchors,
      // mailto:, tel:, http(s):// to other origins and protocol-relative
      // links keep the browser default.
      if (!href.startsWith('/') || href.startsWith('//')) return
      const url = new URL(anchor.href, window.location.origin)
      if (url.origin !== window.location.origin) return
      if (url.pathname.startsWith('/api/')) return
      event.preventDefault()
      navigateToPath(url.pathname + url.search)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}
