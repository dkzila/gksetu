/**
 * GKSetu — SEO module: per-page SEO block (P4-S4)
 * Master Plan §16: one canonical URL per indexable representation, generated
 * from country + language + object identity (never from user input);
 * `hreflang` between equivalent language pages; canonical tags prevent
 * duplicate parameter pages; search/user-filtered surfaces are noindex.
 * §35: the alternate set is per-surface honest — structural surfaces
 * (home/topic/exam/syllabus) exist in every country-configured language by
 * construction, knowledge pages only in languages that carry published
 * representations (the P2-S5 `translations` precedent).
 *
 * The block ships §16 PATHS (origin-agnostic, §37 client-agnostic DTOs) —
 * clients resolve them against their origin for <link> tags; the sitemap
 * builder resolves them against the site origin for absolute <loc> entries.
 */
import type { PageSeo } from './types'

/**
 * Builds the §16 SEO block for one public page representation.
 *
 * @param languages the honest alternate set for THIS surface (§35) — every
 *   entry becomes one hreflang cluster member, the rendered language itself
 *   included even when the caller's set omitted it (self-inclusion is the
 *   hreflang contract).
 * @param pathFor builds the §16 path of this surface in a given language
 *   (single source of URL truth — callers pass the composition-helpers
 *   builders, never string concatenation).
 * @param noindexReason present → the representation is served but not
 *   indexed (e.g. a §36 historical `?version=` read); canonical still points
 *   at the clean current representation (§16 duplicate-parameter rule).
 */
export function buildPageSeo(input: {
  country: { slug: string; isDefault: boolean }
  defaultLanguageCode: string
  languageCode: string
  /** SITE-S2 — entries may carry contentStatus; PLANNED ("Soon") languages
   * are dropped from the hreflang cluster (honest alternates only — the
   * page content is English-fallback there, and a cluster member must be a
   * real variant). The rendered language itself always stays. */
  languages: Array<{ code: string; contentStatus?: 'LIVE' | 'PLANNED' }>
  pathFor: (languageCode: string) => string
  noindexReason?: string
  lastModified?: Date | null
}): PageSeo {
  const { country, defaultLanguageCode, languageCode, pathFor } = input

  // The alternate set — deduped, deterministic (code order, §37), self always
  // present (a hreflang cluster names every variant including itself).
  const codes = new Set<string>([languageCode])
  for (const language of input.languages) {
    if (language.contentStatus === 'PLANNED') continue
    codes.add(language.code)
  }
  const alternates = [...codes]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({ hreflang: code, path: pathFor(code) }))

  // x-default → the country's default-language variant when it exists in the
  // set, else the first alternate (deterministic; documented §35 choice for
  // single-language knowledge pages whose default language has no published
  // representation).
  const xDefaultCode = codes.has(defaultLanguageCode)
    ? defaultLanguageCode
    : [...codes].sort((a, b) => a.localeCompare(b))[0]

  return {
    canonicalPath: pathFor(languageCode),
    alternates,
    xDefaultPath: xDefaultCode ? pathFor(xDefaultCode) : null,
    robots: input.noindexReason
      ? { index: false, follow: true, reason: input.noindexReason }
      : { index: true, follow: true, reason: null },
    // W3C date-time (the sitemap <lastmod> shape) or null when unknown.
    lastModified: input.lastModified ? input.lastModified.toISOString() : null,
  }
}

/** Resolves the public site origin for absolute sitemap/robots URLs. */
export function resolveSiteOrigin(request: Request): string {
  const configured = process.env.GKSETU_PUBLIC_BASE_URL
  if (configured) return configured.replace(/\/+$/, '')

  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const proto =
    forwardedProto ?? (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}
