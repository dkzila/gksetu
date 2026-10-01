/**
 * GKSetu — public payload cache (§29 "repeated expensive reads").
 *
 * The same precedent as the sitemap census cache (P10-S1): public,
 * non-personalised payloads whose DB walk is expensive get a short in-memory
 * TTL. This matters in two very different places:
 *
 *  - PRODUCTION (Vercel, Mumbai): queries are 2–5ms but every serverless
 *    instance still benefits from not re-walking the homepage/directory for
 *    every hit — 60s per instance, exactly the census precedent.
 *  - HIGH-LATENCY ENVIRONMENTS (the dev sandbox reaches the database through
 *    the transaction pooler at ~0.7s per query): a homepage walk of 10+
 *    sequential queries costs ~10s uncached — the TTL makes the public
 *    surface usable there too.
 *
 * Scope discipline: ONLY public, user-independent payloads are cached
 * (homepage, exam directory, exam pages). Anything auth-dependent, staff
 * (console) surfaces, or per-user state NEVER goes through here — a 60s
 * staleness is acceptable for public discovery surfaces, never for a staff
 * member who just edited something.
 *
 * globalThis store = the P9-S2 per-route-bundle isolation pattern. Errors
 * are never cached. No in-flight dedup (bursts may double-walk once; the
 * rate limiter governs abuse, not this cache).
 */

interface CacheEntry {
  value: unknown
  at: number
}

const globalForCache = globalThis as unknown as {
  __gksetuPayloadCache?: Map<string, CacheEntry>
}

const store: Map<string, CacheEntry> =
  globalForCache.__gksetuPayloadCache ?? new Map<string, CacheEntry>()
globalForCache.__gksetuPayloadCache = store

/** The census-cache precedent TTL. */
export const PAYLOAD_CACHE_TTL_MS = 60_000

/**
 * Returns the cached value for `key` while fresh, otherwise runs `loader`
 * and caches the result for the TTL. Never caches rejections.
 */
export async function cachedPayload<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const entry = store.get(key)
  if (entry && Date.now() - entry.at <= PAYLOAD_CACHE_TTL_MS) {
    return entry.value as T
  }
  const value = await loader()
  store.set(key, { value, at: Date.now() })
  return value
}
