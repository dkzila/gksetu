/**
 * SITE-S2 seed — India's language roadmap.
 *
 * The user's ask: add Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada,
 * Odia and Malayalam to India with a "Soon" marker — content is live in
 * English and Hindi today, the other languages ship as translations land.
 * Each new language becomes a Language row + a CountryLanguage link with
 * contentStatus = PLANNED ("Soon" chips in the UI; §35 honest English
 * fallback when browsed; excluded from hreflang alternates — SITE-S2).
 *
 * Idempotent — safe to re-run. Existing links are never downgraded: a link
 * already marked LIVE (content shipped) stays LIVE.
 * Run: bun scripts/site-s2-languages-seed.ts
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

// code, English name, native endonym
const NEW_LANGUAGES: Array<{ code: string; name: string; nativeName: string }> = [
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'or', name: 'Odia', nativeName: 'ଓଡ଼ିଆ' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
]

async function main() {
  const india = await prisma.country.findUnique({ where: { isoCode: 'IN' } })
  if (!india) throw new Error('India (IN) not found — run the base seed first')

  for (const entry of NEW_LANGUAGES) {
    const language = await prisma.language.upsert({
      where: { code: entry.code },
      create: { code: entry.code, name: entry.name, nativeName: entry.nativeName, direction: 'LTR', status: 'ACTIVE' },
      update: { name: entry.name, nativeName: entry.nativeName, status: 'ACTIVE' },
    })

    const existing = await prisma.countryLanguage.findFirst({
      where: { countryId: india.id, languageId: language.id },
    })
    if (!existing) {
      await prisma.countryLanguage.create({
        data: { countryId: india.id, languageId: language.id, contentStatus: 'PLANNED' },
      })
      console.log(`+ ${entry.code} (${entry.name}) — configured for India as PLANNED`)
    } else if (existing.contentStatus === 'PLANNED') {
      console.log(`= ${entry.code} — already PLANNED (kept)`)
    } else {
      console.log(`= ${entry.code} — already ${existing.contentStatus} (untouched)`)
    }
  }

  const links = await prisma.countryLanguage.findMany({
    where: { countryId: india.id },
    include: { language: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log('\nIndia languages now:')
  for (const link of links) {
    console.log(`  ${link.language.code} ${link.language.name} (${link.language.nativeName}) — ${link.contentStatus}`)
  }
}

main().finally(() => prisma.$disconnect())
