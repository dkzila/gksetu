/**
 * GET /api/seo/status — the verification surface (P4-S4 census + the P4-S5
 * validation report): the resolved site origin, the robots rule set, the
 * sitemap segmentation with URL counts + lastmods, and the SEO validation
 * checks (sitemap grammar/uniqueness/parity/determinism, robots artifact,
 * hreflang clusters on live composition samples, the §36 historical window
 * semantics, the §16 structured-data graphs and the JSON-LD path contract).
 *
 * The route is the composition layer: it picks the knowledge-page sample via
 * the knowledge module's public interface (the seo module never imports
 * knowledge — the §28 direction rule) and hands it to the validation service
 * as a structural object; it loads the sitemap inventory once and shares it
 * between the census and the validation.
 */
import { db } from '@/lib/db'
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getKnowledgePage } from '@/modules/knowledge'
import {
  getSeoStatus,
  getSeoValidation,
  loadSitemapInventory,
  resolveSiteOrigin,
  type KnowledgeSampleInput,
} from '@/modules/seo'

export const dynamic = 'force-dynamic'

/**
 * Picks the knowledge-page validation sample: a VERIFIED unit visible in IN
 * with published content — preferring one with representations in ≥2
 * languages (the richer hreflang cluster). Null when nothing qualifies
 * (the knowledge checks then report 'warn', never a silent pass).
 */
async function pickKnowledgeSample(): Promise<KnowledgeSampleInput | null> {
  const publishedFilter = {
    status: 'PUBLISHED' as const,
    publishedRevisionId: { not: null as string | null },
    knowledgeUnit: {
      status: 'VERIFIED' as const,
      OR: [{ scope: 'GLOBAL' as const }, { scope: 'COUNTRY' as const, country: { isoCode: 'IN' } }],
    },
  }
  try {
    const rows = await db.contentItem.groupBy({
      by: ['knowledgeUnitId', 'languageId'],
      where: publishedFilter,
    })
    const languageCount = new Map<string, number>()
    for (const row of rows) {
      languageCount.set(row.knowledgeUnitId, (languageCount.get(row.knowledgeUnitId) ?? 0) + 1)
    }
    const unitIds = [...languageCount.entries()]
      .sort((a, b) => b[1] - a[1]) // richest cluster first
      .map(([id]) => id)
    if (unitIds.length === 0) return null
    const units = await db.knowledgeUnit.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, slug: true, orderIndex: true },
      orderBy: [{ orderIndex: 'asc' }, { slug: 'asc' }],
    })
    const byOrder = new Map(units.map((unit) => [unit.id, unit]))
    // Richest cluster first, then the editorial order (deterministic §37).
    const candidates = unitIds
      .flatMap((id) => {
        const unit = byOrder.get(id)
        return unit ? [{ count: languageCount.get(id) ?? 0, unit }] : []
      })
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.unit.orderIndex - b.unit.orderIndex ||
          a.unit.slug.localeCompare(b.unit.slug)
      )
    const slug = candidates[0]?.unit.slug
    if (!slug) return null
    const page = await getKnowledgePage(slug, { country: 'IN', language: 'en' })
    return {
      country: 'IN',
      language: 'en',
      canonicalPath: page.canonicalPath,
      seo: page.seo,
      structuredData: page.structuredData,
    }
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const limit = checkRateLimit(`seo:status:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const origin = resolveSiteOrigin(request)
    // Independent heavy reads run together (the knowledge sample and the
    // sitemap inventory share nothing; the Mumbai pooler multiplexes both).
    const [knowledgeSample, inventory] = await Promise.all([
      pickKnowledgeSample(),
      loadSitemapInventory(),
    ])
    const [status, validation] = await Promise.all([
      getSeoStatus(origin, inventory.segments),
      getSeoValidation(origin, { inventory, knowledgeSample }),
    ])
    return ok({ ...status, validation })
  } catch (error) {
    console.error('[seo/status] unexpected error:', error)
    return fail('SEO status could not be composed', 'SEO_VALIDATION_FAILED', 500)
  }
}
