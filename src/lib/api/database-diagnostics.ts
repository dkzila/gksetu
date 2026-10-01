/**
 * GKSetu — database failure diagnostics (DEPLOY-S1).
 *
 * Born from the first live Vercel deployment: the site loaded but every API
 * answered 503 "Database connection failed" and the homepage showed "Could
 * not load the country configuration". The health route's catch-all could
 * not say WHY — and the four real causes (variable never reaching the
 * runtime, a quoted/placeholder value, the IPv6-only direct host, a wrong
 * password) have completely different fixes on the Vercel dashboard.
 *
 * This classifier names the cause from the connection string's SHAPE only.
 * It never returns the URL, the password, or any fragment of the value —
 * the hints below are matched patterns, not echoed content.
 */

export type DatabaseFailureCode =
  | 'DATABASE_NOT_CONFIGURED'
  | 'DATABASE_MISCONFIGURED'
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
 * Classify a GKSETU_DATABASE_URL value (the raw env var) into the failure
 * it would produce. Pure function — safe to call anywhere, trivially tested.
 */
export function diagnoseDatabaseUrl(rawUrl: string | undefined): DatabaseDiagnostics {
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
    return {
      code: 'DATABASE_UNREACHABLE',
      message:
        'GKSETU_DATABASE_URL looks correct (Supabase session pooler) but the connection failed. ' +
        'Verify the database password is right and the Supabase project is running ' +
        '(free-tier projects pause after a week of inactivity).',
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
