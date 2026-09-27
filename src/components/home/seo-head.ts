'use client'

/**
 * GlobIQ — document head management (P4-S4)
 * Master Plan §16: canonical tags prevent duplicate parameter pages;
 * `hreflang` between equivalent language pages; search/console/private
 * surfaces are noindex. The hook mirrors the ACTIVE view's server-built §16
 * SEO block (canonical + alternates + robots from the payload — never
 * client-side URL construction) into <link>/<meta> tags, resolving the
 * origin-agnostic §16 paths against window.location.origin.
 *
 * Managed elements are marked data-globiq-seo so nothing outside this module
 * is ever touched (Next.js's own metadata stays untouched).
 */
import { useEffect } from 'react'

export interface SeoHeadInput {
  /** Document title for the active view. */
  title: string
  /** Meta description (the surface's honest one-line summary). */
  description?: string | null
  /** The payload's §16 SEO block (server-built canonical/alternates/robots). */
  seo?: {
    canonicalPath: string
    alternates: Array<{ hreflang: string; path: string }>
    xDefaultPath: string | null
    robots: { index: boolean; follow: boolean; reason?: string | null }
  } | null
  /** True for surfaces without a server SEO block (console, search) — §16. */
  noindex?: boolean
}

const MANAGED = 'data-globiq-seo'

/** Original attributes of adopted (SSR-rendered) elements — restored on
 * clear. Created elements never enter this map (they are removed instead). */
const originals = new WeakMap<Element, { content: string | null; href: string | null }>()

/** Marks a DOM element managed; pre-existing (SSR) elements get their
 * original attributes snapshotted for restore-on-clear. Elements already
 * managed are never re-snapshotted (our own values are not originals). */
function markManaged(element: Element) {
  const alreadyManaged = element.hasAttribute(MANAGED)
  if (
    !alreadyManaged &&
    (element.getAttribute('content') !== null || element.getAttribute('href') !== null)
  ) {
    originals.set(element, {
      content: element.getAttribute('content'),
      href: element.getAttribute('href'),
    })
  }
  element.setAttribute(MANAGED, '')
}

function upsertMeta(name: string, content: string) {
  // Adopt an existing (e.g. Next.js SSR) meta of this name first — never
  // leave two competing description/robots tags in the head.
  const existing = [...document.querySelectorAll<HTMLMetaElement>(`meta[name="${name}"]`)]
  let element = existing.find((candidate) => candidate.hasAttribute(MANAGED)) ?? existing[0]
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('name', name)
    document.head.appendChild(element)
  }
  markManaged(element)
  element.setAttribute('content', content)
}

function upsertLink(rel: string, href: string, hreflang?: string) {
  const candidates = [...document.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`)].filter(
    (candidate) => (hreflang ? candidate.getAttribute('hreflang') === hreflang : !candidate.hasAttribute('hreflang'))
  )
  let element = candidates.find((candidate) => candidate.hasAttribute(MANAGED)) ?? candidates[0]
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', rel)
    if (hreflang) element.setAttribute('hreflang', hreflang)
    document.head.appendChild(element)
  }
  markManaged(element)
  element.setAttribute('href', href)
}

/** Removes every GlobIQ-managed head element; adopted SSR elements are
 * restored to their original attributes (React keeps ownership of them). */
function clearManaged() {
  document.querySelectorAll(`[${MANAGED}]`).forEach((element) => {
    const original = originals.get(element)
    if (original) {
      if (original.content !== null) element.setAttribute('content', original.content)
      else element.removeAttribute('content')
      if (original.href !== null) element.setAttribute('href', original.href)
      else element.removeAttribute('href')
      element.removeAttribute(MANAGED)
    } else {
      element.remove()
    }
  })
}

export function useSeoHead(input: SeoHeadInput | null) {
  useEffect(() => {
    if (!input) return

    document.title = input.title

    if (input.description) {
      upsertMeta('description', input.description)
    }

    const seo = input.seo
    const noindex = input.noindex || (seo ? !seo.robots.index : false)
    upsertMeta(
      'robots',
      noindex ? 'noindex, follow' : 'index, follow'
    )

    if (seo) {
      const origin = window.location.origin
      upsertLink('canonical', `${origin}${seo.canonicalPath}`)
      // The hreflang cluster — self + every variant + x-default (§16/§35).
      for (const alternate of seo.alternates) {
        upsertLink('alternate', `${origin}${alternate.path}`, alternate.hreflang)
      }
      if (seo.xDefaultPath) {
        upsertLink('alternate', `${origin}${seo.xDefaultPath}`, 'x-default')
      }
    }

    return clearManaged
  }, [input])
}
