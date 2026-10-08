/**
 * GET /api/content-stats — returns content counts per language for the
 * SITE-S25 multi-language showcase. Used by the homepage to surface "N
 * questions available in M languages" and the language switcher's
 * per-language counts.
 *
 * Query: ?country=IN (optional — defaults to India).
 *
 * Returns:
 *   { languages: [{ code, name, nativeName, questionCount, direction }] }
 */
import { errors, ok } from '@/lib/api/response'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const countryIso = url.searchParams.get('country') ?? 'IN'

    // Group questions by language
    const rows = await db.question.groupBy({
      by: ['languageId', 'status'],
      _count: { _all: true },
      where: { status: 'PUBLISHED' },
    })

    // Load all languages
    const langs = await db.language.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { code: 'asc' },
    })

    // For country filtering: which languages are configured for this country?
    const country = await db.country.findUnique({
      where: { isoCode: countryIso },
      include: { supported: true },
    })
    const countryLangIds = new Set(country?.supported.map((cl) => cl.languageId) ?? [])

    // Aggregate per language
    const countsByLang = new Map<string, number>()
    for (const r of rows) {
      if (r.status !== 'PUBLISHED') continue
      countsByLang.set(r.languageId, (countsByLang.get(r.languageId) ?? 0) + r._count._all)
    }

    const languages = langs
      .filter((l) => countryLangIds.has(l.id))
      .map((l) => ({
        code: l.code,
        name: l.name,
        nativeName: l.nativeName,
        direction: l.direction,
        questionCount: countsByLang.get(l.id) ?? 0,
      }))
      .sort((a, b) => b.questionCount - a.questionCount)

    const totalQuestions = languages.reduce((a, l) => a + l.questionCount, 0)

    return ok({
      country: countryIso,
      totalQuestions,
      languagesWithContent: languages.filter((l) => l.questionCount > 0).length,
      languages,
    })
  } catch (error) {
    console.error('[content-stats] error:', error)
    return errors.serviceUnavailable('Content stats failed')
  }
}
