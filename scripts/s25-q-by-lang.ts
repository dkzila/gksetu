/** Check question counts by language. Run: bun scripts/s25-q-by-lang.ts */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })
async function main() {
  const rows = await prisma.question.groupBy({ by: ['languageId'], _count: { _all: true } })
  const langs = await prisma.language.findMany()
  const map = new Map(langs.map((l) => [l.id, l.code]))
  for (const r of rows) console.log(`  ${map.get(r.languageId) ?? r.languageId}: ${r._count._all} questions`)
}
main().finally(() => prisma.$disconnect())
