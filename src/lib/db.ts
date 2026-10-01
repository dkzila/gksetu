import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * DEPLOY-S2 (found live on the first Vercel deployment): the Supabase free
 * tier caps the database at 60 connections, and a serverless platform runs
 * EVERY API route as its own function instance — each with its own Prisma
 * client and pool. With the default pool size (CPUs × 2 + 1) and functions
 * far from the database (US region against a Mumbai DB, ~200ms per query),
 * a single market switch exhausted the pool and every API call failed.
 *
 * On Vercel (the VERCEL env var is set by the platform), each instance's
 * pool is capped at 2 connections with a patient queue: burst traffic
 * waits in line instead of taking the shared database down. The pooler
 * region fix (vercel.json → bom1) does the rest — connections are held
 * for milliseconds, not seconds.
 */
function datasourceUrl(): string {
  const url = process.env.GKSETU_DATABASE_URL ?? ''
  if (!url) return url
  const isServerless = process.env.VERCEL === '1' || process.env.VERCEL === 'true'
  if (isServerless && !/[?&]connection_limit=/.test(url)) {
    const join = url.includes('?') ? '&' : '?'
    return `${url}${join}connection_limit=2&pool_timeout=30&connect_timeout=15`
  }
  return url
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
    datasources: {
      db: { url: datasourceUrl() },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
