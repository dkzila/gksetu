/**
 * GKSetu — the runtime database-URL adapter (DEPLOY-S2).
 *
 * The discovery, live on the first Vercel deployment: Supabase's SESSION
 * pooler (port 5432) allows only **15 client connections per project**
 * (`FATAL: (EMAXCONNSESSION) max clients reached in session mode - max
 * clients are limited to pool_size: 15` — hit live). With every API route
 * running as its own serverless function, each holding pool connections,
 * that ceiling is exhausted by a single market switch.
 *
 * The TRANSACTION pooler (port 6543) multiplexes ~200 clients over the same
 * server pool — the right mode for serverless. The platform's one
 * session-mode dependency was audited before switching:
 *
 *   - the ONLY advisory lock in the codebase is `pg_advisory_xact_lock`
 *     inside a Prisma interactive transaction (notification-service) —
 *     transaction-scoped by design, and transaction-mode pooling pins one
 *     server connection for the whole transaction, so the lock's
 *     check-then-create atomicity is preserved (verified live through the
 *     6543 port with the exact call).
 *   - the search engine's readiness DDL is single-statement
 *     `CREATE INDEX IF NOT EXISTS` (no CONCURRENTLY) — safe in transaction
 *     mode; and idempotent no-ops on the live database.
 *   - no LISTEN/NOTIFY, no session-level SQL state anywhere.
 *
 * The adapter therefore rewrites any *.pooler.supabase.com URL to the
 * transaction port with `pgbouncer=true` (Prisma's prepared-statement
 * handling for transaction pooling) and, on Vercel, a small per-function
 * pool cap so bursts queue instead of multiplying. The Prisma CLI
 * (migrate/db:push) reads `GKSETU_DATABASE_URL` straight from the
 * environment, untouched by this adapter — schema work keeps the session
 * URL exactly as documented.
 */

/** The shape the runtime actually connects with. */
export interface RuntimeDatabaseUrl {
  /** The URL the Prisma client should use (adapted, or the raw value). */
  url: string
  /** A stable label for /api/health. */
  hostLabel: string
  /** True when the URL was rewritten to the transaction pooler. */
  adapted: boolean
}

const POOLER_HOST_SUFFIX = '.pooler.supabase.com'

/**
 * postgresql://[user:password@]host[:port][/database][?params] — the
 * userinfo may contain ':' (user:password); passwords containing '@' or '/'
 * fall through untouched (the raw URL still works, just unadapted).
 */
const POSTGRES_URL_PATTERN =
  /^(postgresql?:\/\/)([^@/]+@)?([^:/?]+)(?::(\d+))?(\/[^?]*)?(\?.*)?$/i

export function adaptDatabaseUrl(raw: string | undefined): RuntimeDatabaseUrl {
  const url = raw?.trim() ?? ''
  if (!url) {
    return { url: '', hostLabel: 'PostgreSQL', adapted: false }
  }

  const match = url.match(POSTGRES_URL_PATTERN)
  const host = match?.[3] ?? ''
  const isPooler = host.endsWith(POOLER_HOST_SUFFIX)

  if (!match || !isPooler) {
    if (/^postgres(ql)?:\/\//i.test(url)) {
      return { url, hostLabel: 'PostgreSQL (direct)', adapted: false }
    }
    return { url, hostLabel: 'PostgreSQL', adapted: false }
  }

  // Merge params: keep any the operator set, add the required set.
  const params = new URLSearchParams(match[6] ? match[6].slice(1) : '')
  params.set('pgbouncer', 'true')
  const isServerless = process.env.VERCEL === '1' || process.env.VERCEL === 'true'
  if (isServerless) {
    if (!params.has('connection_limit')) params.set('connection_limit', '2')
    if (!params.has('pool_timeout')) params.set('pool_timeout', '30')
  }
  if (!params.has('connect_timeout')) params.set('connect_timeout', '15')

  // Session (5432 or absent) → transaction (6543); an explicit 6543 stays.
  const port = !match[4] || match[4] === '5432' ? '6543' : match[4]
  const path = match[5] ?? ''
  const adapted = `${match[1]}${match[2] ?? ''}${host}:${port}${path}?${params.toString()}`

  return {
    url: adapted,
    hostLabel: `Supabase (${port === '6543' ? 'transaction' : 'session'} pooler)`,
    adapted: port !== match[4],
  }
}
