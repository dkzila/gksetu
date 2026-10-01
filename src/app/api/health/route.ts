/**
 * GET /api/health — Platform & database health (P1-S1 foundation check).
 * Returns service identity, database connectivity, seed snapshot and latency.
 *
 * DEPLOY-S1: on failure the response names the CAUSE (missing variable,
 * quoted/placeholder value, IPv6-only direct host, auth failure, the
 * connection-pool ceiling, unreachable database) — the first Vercel
 * deployment showed a bare "Database connection failed" answers several
 * completely different dashboard fixes. See
 * src/lib/api/database-diagnostics.ts; the connection string itself never
 * leaves the server.
 */
import { db } from '@/lib/db'
import { adaptDatabaseUrl } from '@/lib/db-url'
import { ok, fail } from '@/lib/api/response'
import { diagnoseDatabaseUrl } from '@/lib/api/database-diagnostics'
import { PLATFORM } from '@/config/platform'

export const dynamic = 'force-dynamic'

/**
 * Server-side-only host label derived from the RUNTIME connection (the
 * adapter reports what the Prisma client actually connects to — DEPLOY-S2:
 * the Supabase transaction pooler — not the raw environment value).
 */
function databaseHost(): string {
  return adaptDatabaseUrl(process.env.GKSETU_DATABASE_URL).hostLabel
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
  } catch (error) {
    const diagnosis = diagnoseDatabaseUrl(process.env.GKSETU_DATABASE_URL, error)
    return fail(diagnosis.message, diagnosis.code, 503, diagnosis.details)
  }
}
