/**
 * GKSetu — database failure diagnostics (DEPLOY-S1; DEPLOY-S2 added the
 * real-error classification).
 *
 * Born from the first live Vercel deployment: the site loaded but every API
 * answered 503 "Database connection failed" and the homepage showed "Could
 * not load the country configuration". The health route's catch-all could
 * not say WHY — and the real causes (variable never reaching the runtime, a
 * quoted/placeholder value, the IPv6-only direct host, a wrong password,
 * and — found live in DEPLOY-S2 — the Supabase free-tier connection ceiling
 * exhausted by serverless bursts) have completely different fixes.
 *
 * This classifier names the cause from the connection string's SHAPE and
 * the caught error's class. It never returns the URL, the password, or any
 * fragment of the value — the hints below are matched patterns, not echoed
 * content.
 */

export type DatabaseFailureCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_MISCONFIGURED'
  | 'DATABASE_AUTH_FAILED'
  | 'DATABASE_POOL_EXHAUSTED'
  | 'DATABASE_UNREACHABLE'

export interface DatabaseDiagnostics {
  code: DatabaseFailureCode
  message: string
  /** Machine-readable cause — stable for dashboards and future tooling. */
  details: { hint: string }
}

/** Supabase dashboard placeholders people paste with the URL. */
const PLACEHOLDER_PATTERN = /\[(your-)?(db-)?password\]|<[^>]*password[^>]*>/i

/** Supabase direct hosts are IPv6-only: db.<project-ref>.supabase.co */
const SUPABASE_DIRECT_HOST = /^db\.[a-z0-9-]+\.supabase\.co$/i

/** Postgres's exhaustion messages (and Supavisor's variants). */
const POOL_EXHAUSTED_PATTERN =
  /too many clients|too many connections|connection limit|remaining connection slots|at connection limit|all server connections|cannot get a connection/i

function parseHostPort(raw: string): { host: string; port: string } | null {
  try {
    // WHATWG URL parses non-special schemes loosely; normalising to http://
    // keeps authority parsing (user/host/port) on the well-tested path.
    const parsed = new URL(raw.replace(/^postgres(ql)?:\/\//i, 'http://'))
    if (!parsed.hostname) return null
    return { host: parsed.hostname, port: parsed.port }
  } catch {
    return null
  }
}

/**
 * Classify a GKSETU_DATABASE_URL value (the raw env var) and, when the
 * caller passes the caught error, the failure class itself, into the
 * failure it produced. Pure function — safe to call anywhere.
 */
export function diagnoseDatabaseUrl(rawUrl: string | undefined, error?: unknown): DatabaseDiagnostics {
  const url = rawUrl?.trim() ?? ''

  if (!url) {
    return {
      code: 'DATABASE_NOT_CONFIGURED',
      message:
        'Database is not configured: GKSETU_DATABASE_URL is missing or empty on this deployment. ' +
        'Add it in Vercel → Settings → Environment Variables for the Production environment, ' +
        'then Redeploy — environment variables only apply to deployments created after the change.',
      details: { hint: 'missing-env-var' },
    }
  }

  if (/^["']|["']$/.test(url)) {
    return {
      code: 'DATABASE_MISCONFIGURED',
      message:
        'GKSETU_DATABASE_URL has stray quotes around the value. ' +
        'Paste the raw connection string with no surrounding quotes — Vercel stores the value literally.',
      details: { hint: 'quoted-value' },
    }
  }

  if (PLACEHOLDER_PATTERN.test(url)) {
    return {
      code: 'DATABASE_MISCONFIGURED',
      message:
        'GKSETU_DATABASE_URL still contains the [YOUR-PASSWORD] placeholder from the Supabase dashboard. ' +
        'Replace it with the actual database password, save, and redeploy.',
      details: { hint: 'password-placeholder' },
    }
  }

  const parsed = parseHostPort(url)
  if (!parsed) {
    return {
      code: 'DATABASE_MISCONFIGURED',
      message:
        'GKSETU_DATABASE_URL is not a parseable PostgreSQL connection string. ' +
        'Expected format: postgresql://user:password@host:5432/postgres',
      details: { hint: 'unparseable-url' },
    }
  }

  if (SUPABASE_DIRECT_HOST.test(parsed.host)) {
    return {
      code: 'DATABASE_MISCONFIGURED',
      message:
        'GKSETU_DATABASE_URL points at the Supabase direct host (db.<project-ref>.supabase.co), ' +
        'which is IPv6-only — serverless runtimes like Vercel connect over IPv4. ' +
        'Use the session pooler instead: host aws-0-ap-south-1.pooler.supabase.com, port 5432, ' +
        'username postgres.<project-ref>.',
      details: { hint: 'supabase-direct-ipv6' },
    }
  }

  if (parsed.host.endsWith('.pooler.supabase.com')) {
    if (parsed.port === '6543') {
      return {
        code: 'DATABASE_MISCONFIGURED',
        message:
          'GKSETU_DATABASE_URL uses the transaction pooler (port 6543). ' +
          'The platform requires the session pooler (port 5432) — the revision pipeline holds ' +
          'advisory locks that must stay on one connection.',
        details: { hint: 'supabase-transaction-pooler' },
      }
    }

    // The URL shape is right — classify by the actual failure.
    const err = error as { code?: unknown; message?: unknown } | undefined
    const prismaCode = typeof err?.code === 'string' ? err.code : ''
    const message = typeof err?.message === 'string' ? err.message : ''

    if (prismaCode === 'P1000' || /authentication failed/i.test(message)) {
      return {
        code: 'DATABASE_AUTH_FAILED',
        message:
          'The database rejected the credentials: authentication failed. ' +
          'The username must be postgres.<project-ref> (session pooler form) and the password must be ' +
          'the database password from Supabase → Settings → Database.',
        details: { hint: 'auth-failed' },
      }
    }

    if (POOL_EXHAUSTED_PATTERN.test(message) || prismaCode === 'P2024') {
      return {
        code: 'DATABASE_POOL_EXHAUSTED',
        message:
          'The database refused new connections — the Supabase free tier allows 60 concurrent ' +
          'connections and they were exhausted (serverless bursts or idle clients holding slots). ' +
          'GKSetu pins its Vercel region to Mumbai (bom1, next to the database) and caps each ' +
          "function's connection pool — redeploy from the latest main if this deployment predates that. " +
          'Also check that no long-running dev servers are holding idle connections.',
        details: { hint: 'pool-exhausted' },
      }
    }

    return {
      code: 'DATABASE_UNREACHABLE',
      message:
        'GKSETU_DATABASE_URL looks correct (Supabase session pooler) but the connection failed. ' +
        'Verify the Supabase project is running — free-tier projects pause after a week of ' +
        'inactivity (restore from the Supabase dashboard) — and that the network path to ' +
        'aws-0-ap-south-1.pooler.supabase.com:5432 is open.',
      details: { hint: 'supabase-pooler-unreachable' },
    }
  }

  return {
    code: 'DATABASE_UNREACHABLE',
    message:
      'GKSETU_DATABASE_URL is set and parseable, but the database could not be reached. ' +
      'Verify the host, port and password for the PostgreSQL server.',
    details: { hint: 'connection-failed' },
  }
}
