/**
 * SITE-S25: Activate all 10 Indian languages for India (set CountryLanguage
 * contentStatus to LIVE). This makes the language switcher in the header
 * show all languages without the "soon" badge.
 *
 * Run: bun scripts/s25-activate-languages.ts
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

async function main() {
  const india = await prisma.country.findUnique({ where: { isoCode: 'IN' } })
  if (!india) throw new Error('India not found')
  const result = await prisma.countryLanguage.updateMany({
    where: { countryId: india.id },
    data: { contentStatus: 'LIVE' },
  })
  console.log(`Updated ${result.count} country-language links to LIVE`)
  const links = await prisma.countryLanguage.findMany({
    where: { countryId: india.id },
    include: { language: true },
  })
  for (const l of links) {
    console.log(`  ${l.language.code.padEnd(5)} ${l.language.name.padEnd(22)} [${l.contentStatus}]`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
