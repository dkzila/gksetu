import { PrismaClient } from '@prisma/client'

import { adaptDatabaseUrl } from './db-url'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * DEPLOY-S2: the datasource URL goes through adaptDatabaseUrl — on Supabase
 * pooler hosts it becomes the TRANSACTION pooler (6543) with pgbouncer
 * mode, because the session pooler's per-project client ceiling (15) was
 * exhausted live by serverless bursts. The full rationale, the
 * compatibility audit (the xact-scoped advisory lock, the single-statement
 * DDL) and the capacity math live in src/lib/db-url.ts. The Prisma CLI
 * (migrate/db:push) is unaffected — it reads the environment directly.
 */
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
    datasources: {
      db: { url: adaptDatabaseUrl(process.env.GKSETU_DATABASE_URL).url },
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
