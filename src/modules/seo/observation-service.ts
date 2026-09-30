/**
 * GlobIQ — SEO module: the engine-side observation import (P8-S5)
 *
 * Master Plan §32 (the SEO family's impressions/clicks inputs), §16 (the
 * sitemap census guards every pagePath — observations only ever land for
 * paths the platform declares indexable: never a dead link, never a
 * private surface), §17's vendor rule applied to SEO data (the domain model
 * stays vendor-neutral — the ingestion API accepts any feed speaking the
 * Search Console shape: page × query × day with impressions/clicks/
 * position; P9-S4 wires the country-specific operations), §37 (typed
 * validation errors; a click without an impression is rejected — the row
 * could never be true), §38 (ADMIN-only platform ingestion — the whole
 * public surface's census, the search:manage precedent).
 *
 * Re-imports are honest: the (day, market, page, query) unique key upserts,
 * mirroring Search Console's own revision semantics — re-pulling a day
 * replaces that day's row, it never double-counts.
 */
import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'

import { SeoError } from './errors'
import { loadSitemapInventory } from './sitemap-service'
import type { SeoObservationInput } from './validation'

export interface SeoObservationIngestResult {
  ingested: number
  /** The distinct §16 canonical paths the batch covered (census-verified). */
  pages: number
  /** The observed days the batch covered. */
  days: number
}

/** The configured-market guard: only real §35 markets carry observations. */
async function assertKnownCountry(isoCode: string): Promise<void> {
  const country = await db.country.findFirst({
    where: { isoCode },
    select: { isoCode: true },
  })
  if (!country) {
    throw new SeoError(
      'SEO_OBSERVATION_UNKNOWN_MARKET',
      `Observations can only land for configured markets — "${isoCode}" is not one (§35).`
    )
  }
}

/**
 * POST /api/seo/observations — ingests a batch of daily performance rows.
 * ADMIN only (§38): the platform-wide SEO census, ingested by the operators
 * (today the §45 dev fixture + the E2E; P9-S4 wires the real feed).
 */
export async function ingestSeoObservations(
  actor: Actor,
  input: { rows: SeoObservationInput[] }
): Promise<SeoObservationIngestResult> {
  if (actor.role !== 'ADMIN') {
    throw new SeoError(
      'SEO_INGEST_ADMIN_ONLY',
      'The SEO observation import is a platform surface (§16/§38) — it ingests the whole public surface\'s engine-side census'
    )
  }

  const inventory = await loadSitemapInventory()
  const censusPaths = new Set<string>()
  for (const entries of inventory.entriesBySegment.values()) {
    for (const entry of entries) censusPaths.add(entry.path)
  }

  const now = Date.now()
  const pages = new Set<string>()
  const days = new Set<string>()

  for (const row of input.rows) {
    await assertKnownCountry(row.countryIso)

    if (!censusPaths.has(row.pagePath)) {
      throw new SeoError(
        'SEO_OBSERVATION_UNKNOWN_PATH',
        `"${row.pagePath}" is not in the live §16 sitemap census — observations only land for paths the platform declares indexable.`
      )
    }

    // Normalize the day: Search Console rows are dates; the time component
    // is meaningless and must not fragment the unique key.
    const observedAt = new Date(row.observedAt)
    const day = new Date(
      Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), observedAt.getUTCDate())
    )
    if (observedAt.getTime() > now + 24 * 60 * 60 * 1000) {
      throw new SeoError(
        'SEO_OBSERVATION_FUTURE_DATE',
        'Observations cannot be dated in the future — the engine has not seen tomorrow (§9 honesty).'
      )
    }

    await db.seoObservation.upsert({
      where: {
        observedAt_countryIso_pagePath_queryText: {
          observedAt: day,
          countryIso: row.countryIso,
          pagePath: row.pagePath,
          queryText: row.queryText,
        },
      },
      create: {
        observedAt: day,
        countryIso: row.countryIso,
        pagePath: row.pagePath,
        queryText: row.queryText,
        impressions: row.impressions,
        clicks: row.clicks,
        avgPosition: row.avgPosition ?? null,
      },
      update: {
        impressions: row.impressions,
        clicks: row.clicks,
        avgPosition: row.avgPosition ?? null,
      },
    })
    pages.add(row.pagePath)
    days.add(day.toISOString().slice(0, 10))
  }

  return { ingested: input.rows.length, pages: pages.size, days: days.size }
}
