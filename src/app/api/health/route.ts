/**
 * GET /api/health — Platform & database health (P1-S1 foundation check).
 * Returns service identity, database connectivity, seed snapshot and latency.
 *
 * DEPLOY-S1: on failure the response names the CAUSE (missing variable,
 * quoted/placeholder value, IPv6-only direct host, unreachable database) —
 * the first Vercel deployment showed a bare "Database connection failed"
 * answers four completely different dashboard fixes. See
 * src/lib/api/database-diagnostics.ts; the connection string itself never
 * leaves the server.
 */
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api/response'
import { diagnoseDatabaseUrl } from '@/lib/api/database-diagnostics'
import { PLATFORM } from '@/config/platform'

export const dynamic = 'force-dynamic'

/**
 * Server-side-only host label derived from the connection string (the label
 * follows the environment — Supabase pooler or the local sandbox Postgres).
 */
function databaseHost(): string {
  const url = process.env.GKSETU_DATABASE_URL ?? ''
  if (url.includes('pooler.supabase.com')) return 'Supabase (session pooler)'
  if (url.includes('supabase')) return 'Supabase'
  if (/^postgres(ql)?:\/\//.test(url)) return 'PostgreSQL (local)'
  return 'PostgreSQL'
}

export async function GET() {
  const startedAt = Date.now()
  try {
    await db.$queryRaw`SELECT 1`

    const [countries, languages] = await Promise.all([
      db.country.findMany({
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: {
          isoCode: true,
          name: true,
          slug: true,
          status: true,
          isDefault: true,
          timezone: true,
          defaultLanguage: { select: { code: true } },
          supported: { select: { language: { select: { code: true } } } },
        },
      }),
      db.language.findMany({
        orderBy: { code: 'asc' },
        select: { code: true, name: true, nativeName: true, status: true },
      }),
    ])

    return ok({
      service: {
        name: PLATFORM.name,
        version: PLATFORM.version,
        spec: `${PLATFORM.spec.document} v${PLATFORM.spec.version}`,
      },
      database: {
        connected: true,
        provider: PLATFORM.database.provider,
        host: databaseHost(),
        region: PLATFORM.database.region,
      },
      seed: {
        countries: countries.map((country) => ({
          isoCode: country.isoCode,
          name: country.name,
          slug: country.slug,
          status: country.status,
          isDefault: country.isDefault,
          timezone: country.timezone,
          defaultLanguage: country.defaultLanguage?.code ?? null,
          languages: country.supported.map((link) => link.language.code),
        })),
        languages: languages.map((language) => ({
          code: language.code,
          name: language.name,
          nativeName: language.nativeName,
          status: language.status,
        })),
      },
      latencyMs: Date.now() - startedAt,
    })
  } catch {
    const diagnosis = diagnoseDatabaseUrl(process.env.GKSETU_DATABASE_URL)
    return fail(diagnosis.message, diagnosis.code, 503, diagnosis.details)
  }
}
