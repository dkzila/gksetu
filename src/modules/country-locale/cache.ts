/**
 * GKSetu — Country & Locale: snapshot cache
 * Master Plan §29 (infrastructure evolution): local memory caching now,
 * swappable for a shared store at scale.
 *
 * All reads go through one immutable "snapshot" (countries with their
 * configured languages + the full language table). Writes invalidate it.
 * Snapshot hits cost zero database round-trips.
 */
import type { Language } from '@prisma/client'

import { db } from '@/lib/db'

export interface CountrySnapshotRow {
  id: string
  isoCode: string
  slug: string
  name: string
  timezone: string | null
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
  isDefault: boolean
  defaultLanguageId: string | null
  defaultLanguage: Language | null
  /** P9-S2: the market's FIRST go-live moment (null = never launched). */
  launchedAt: Date | null
  /** All languages configured for this country (any status — filter at use
   * site), each tagged with the SITE-S2 per-market content readiness. */
  languages: Array<Language & { contentStatus: 'LIVE' | 'PLANNED' }>
}

export interface LocaleSnapshot {
  countries: CountrySnapshotRow[]
  languages: Language[]
  at: number
}

const SNAPSHOT_TTL_MS = 60_000

/**
 * P9-S2 fix: the snapshot lives on globalThis, NOT on the module instance.
 * In Turbopack dev every route bundle gets its OWN copy of this module — a
 * module-level `let snapshot` would give each route its private cache and
 * invalidateSnapshot() would only clear the writer's copy (observed live:
 * a launch flipped FR ACTIVE, the countries/geo-hint routes kept serving the
 * pre-launch snapshot for up to the TTL). globalThis is shared per server
 * process, so ONE snapshot + ONE invalidation serve every route — the
 * production behavior, in dev too. (The standard dev-safe singleton pattern,
 * like the Prisma client.)
 */
interface SnapshotStore {
  snapshot: LocaleSnapshot | null
  loading: Promise<LocaleSnapshot> | null
  /** Bumped by invalidateSnapshot — a load racing an invalidation must not stick. */
  epoch: number
}
const globalRef = globalThis as typeof globalThis & { __gksetuLocaleSnapshotStore?: SnapshotStore }
const store: SnapshotStore = (globalRef.__gksetuLocaleSnapshotStore ??= { snapshot: null, loading: null, epoch: 0 })

async function loadSnapshot(): Promise<LocaleSnapshot> {
  const [countries, links, languages] = await Promise.all([
    db.country.findMany({ include: { defaultLanguage: true } }),
    db.countryLanguage.findMany({ include: { language: true } }),
    db.language.findMany(),
  ])

  const byCountry = new Map<string, Array<Language & { contentStatus: 'LIVE' | 'PLANNED' }>>()
  for (const link of links) {
    const list = byCountry.get(link.countryId) ?? []
    // SITE-S2: the link's content readiness rides with the language row.
    list.push({ ...link.language, contentStatus: link.contentStatus as 'LIVE' | 'PLANNED' })
    byCountry.set(link.countryId, list)
  }

  const rows: CountrySnapshotRow[] = countries
    .map((country) => ({
      id: country.id,
      isoCode: country.isoCode,
      slug: country.slug,
      name: country.name,
      timezone: country.timezone,
      status: country.status,
      isDefault: country.isDefault,
      defaultLanguageId: country.defaultLanguageId,
      defaultLanguage: country.defaultLanguage,
      launchedAt: country.launchedAt,
      languages: byCountry.get(country.id) ?? [],
    }))
    .sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))

  return { countries: rows, languages: languages.sort((a, b) => a.code.localeCompare(b.code)), at: Date.now() }
}

/**
 * Returns a fresh-enough snapshot (cached up to SNAPSHOT_TTL_MS). One shared
 * load per expiry window even under concurrent first requests (the P8-S2
 * atomic-digest lesson: funnel concurrent readers through ONE load). A load
 * that races an invalidation (started before the write, finishing after)
 * never sticks — the epoch guard drops it and the next read reloads.
 */
export async function getSnapshot(): Promise<LocaleSnapshot> {
  if (store.snapshot === null || Date.now() - store.snapshot.at > SNAPSHOT_TTL_MS) {
    if (!store.loading) {
      const epoch = store.epoch
      store.loading = loadSnapshot()
        .then((loaded) => {
          if (store.epoch === epoch) store.snapshot = loaded
          return loaded
        })
        .finally(() => {
          if (store.epoch === epoch) store.loading = null
        })
    }
    return await store.loading
  }
  return store.snapshot
}

/** Call after any country/language configuration write. */
export function invalidateSnapshot(): void {
  store.epoch += 1
  store.snapshot = null
  store.loading = null
}
