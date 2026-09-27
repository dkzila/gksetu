'use client'

/**
 * GlobIQ — document head management (P4-S4, extended P4-S5)
 * Master Plan §16: canonical tags prevent duplicate parameter pages;
 * `hreflang` between equivalent language pages; search/console/private
 * surfaces are noindex. The hook mirrors the ACTIVE view's server-built §16
 * SEO block (canonical + alternates + robots from the payload — never
 * client-side URL construction) into <link>/<meta> tags, resolving the
 * origin-agnostic §16 paths against window.location.origin.
 *
 * P4-S5 adds the metadata layer on the same choke-point: Open Graph +
 * Twitter card metas (og:url from the canonical, og:locale from the rendered
 * language + market, the site-wide brand image), the JSON-LD graph injected
 * as one application/ld+json script (§16 paths resolved against the origin —
 * the same contract as the hreflang links), and <html lang> tracking the
 * rendered language.
 *
 * Managed elements are marked data-globiq-seo so nothing outside this module
 * is ever touched (Next.js's own metadata stays untouched — SSR-rendered
 * metas are adopted, never duplicated, and restored on view switch).
 */
import { useEffect } from 'react'

import type { ApiJsonLdNode } from './types'

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
  /** P4-S5 — the rendered language: sets <html lang> and og:locale. */
  language?: string | null
  /** P4-S5 — the market ISO (og:locale territory, e.g. 'IN' → en_IN). */
  countryIso?: string | null
  /** P4-S5 — og:type ('article' on knowledge pages; default 'website'). */
  ogType?: 'website' | 'article'
  /** P4-S5 — the server-built §16 JSON-LD graph (paths resolved at injection). */
  jsonLd?: ApiJsonLdNode[] | null
}

const MANAGED = 'data-globiq-seo'

/** The site-wide social card (§16 metadata asset; og:image fallback everywhere). */
const OG_IMAGE = { path: '/og.png', width: 1216, height: 640, alt: 'GlobIQ — one canonical knowledge system' }

/** JSON-LD keys whose string values are §16 paths → resolved against the origin. */
const PATH_KEYS = new Set(['url', '@id', 'item', 'image'])

/** Original attributes of adopted (SSR-rendered) elements — restored on
 * clear. Created elements never enter this map (they are removed instead). */
const originals = new WeakMap<Element, { content: string | null; href: string | null }>()

/** The SSR <html lang> — restored when the last managed view clears. */
let originalHtmlLang: string | null = null

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

function upsertMeta(kind: 'name' | 'property', key: string, content: string) {
  // Adopt an existing (e.g. Next.js SSR) meta of this key first — never
  // leave two competing description/robots/og tags in the head.
  const existing = [...document.querySelectorAll<HTMLMetaElement>(`meta[${kind}="${key}"]`)]
  let element = existing.find((candidate) => candidate.hasAttribute(MANAGED)) ?? existing[0]
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(kind, key)
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

/** A multi-valued meta (og:locale:alternate) — one element per value.
 * Create-only by design: the SSR head never renders this key, so managed
 * elements are rebuilt per render and removed on clear (never adopted —
 * an adopted element must never be removed out from under React). */
function upsertMetaMulti(kind: 'name' | 'property', key: string, values: string[]) {
  document
    .querySelectorAll<HTMLMetaElement>(`meta[${kind}="${key}"][${MANAGED}]`)
    .forEach((element) => element.remove())
  for (const value of values) {
    const element = document.createElement('meta')
    element.setAttribute(kind, key)
    markManaged(element)
    element.setAttribute('content', value)
    document.head.appendChild(element)
  }
}

/** Resolves every §16 path inside a JSON-LD node against the origin (§37:
 * the graph ships origin-agnostic paths; only the injecting client knows the origin). */
function resolveJsonLdPaths(value: unknown, origin: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => resolveJsonLdPaths(entry, origin))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        PATH_KEYS.has(key) && typeof entry === 'string' && entry.startsWith('/')
          ? `${origin}${entry}`
          : resolveJsonLdPaths(entry, origin)
    }
    return out
  }
  return value
}

/** Injects the page's JSON-LD graph as one managed script (created once,
 * updated in place; removed on clear — Next never renders ld+json here). */
function upsertJsonLd(graph: ApiJsonLdNode[], origin: string) {
  let script = document.querySelector<HTMLScriptElement>(
    `script[type="application/ld+json"][${MANAGED}]`
  )
  if (!script) {
    script = document.createElement('script')
    script.setAttribute('type', 'application/ld+json')
    script.setAttribute(MANAGED, '')
    document.head.appendChild(script)
  }
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': graph.map((node) => resolveJsonLdPaths(node, origin)),
  })
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
  if (originalHtmlLang !== null) {
    document.documentElement.lang = originalHtmlLang
    originalHtmlLang = null
  }
}

/** og:locale shape — ll_CC when the market is known, else the bare language. */
function ogLocale(language: string, countryIso?: string | null): string {
  return countryIso ? `${language}_${countryIso.toUpperCase()}` : language
}

export function useSeoHead(input: SeoHeadInput | null) {
  useEffect(() => {
    if (!input) return

    document.title = input.title

    if (input.description) {
      upsertMeta('name', 'description', input.description)
    }

    const seo = input.seo
    const noindex = input.noindex || (seo ? !seo.robots.index : false)
    upsertMeta('name', 'robots', noindex ? 'noindex, follow' : 'index, follow')

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

      // ---------- P4-S5: Open Graph + Twitter card (§16 metadata) ----------
      if (input.language) {
        const territory = input.countryIso ?? null
        upsertMeta('property', 'og:title', input.title)
        if (input.description) upsertMeta('property', 'og:description', input.description)
        upsertMeta('property', 'og:type', input.ogType ?? 'website')
        upsertMeta('property', 'og:url', `${origin}${seo.canonicalPath}`)
        upsertMeta('property', 'og:site_name', 'GlobIQ')
        upsertMeta('property', 'og:locale', ogLocale(input.language, territory))
        upsertMetaMulti(
          'property',
          'og:locale:alternate',
          seo.alternates
            .filter((alternate) => alternate.hreflang !== input.language)
            .map((alternate) => ogLocale(alternate.hreflang, territory))
        )
        upsertMeta('property', 'og:image', `${origin}${OG_IMAGE.path}`)
        upsertMeta('property', 'og:image:width', String(OG_IMAGE.width))
        upsertMeta('property', 'og:image:height', String(OG_IMAGE.height))
        upsertMeta('property', 'og:image:alt', OG_IMAGE.alt)

        upsertMeta('name', 'twitter:card', 'summary_large_image')
        upsertMeta('name', 'twitter:title', input.title)
        if (input.description) upsertMeta('name', 'twitter:description', input.description)
        upsertMeta('name', 'twitter:image', `${origin}${OG_IMAGE.path}`)

        // <html lang> tracks the rendered language (restored on clear).
        if (originalHtmlLang === null) originalHtmlLang = document.documentElement.lang
        document.documentElement.lang = input.language
      }

      // ---------- P4-S5: the §16 structured-data graph (JSON-LD) ----------
      if (input.jsonLd && input.jsonLd.length > 0) {
        upsertJsonLd(input.jsonLd, origin)
      }
    }

    return clearManaged
  }, [input])
}
