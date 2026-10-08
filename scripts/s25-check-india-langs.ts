/** Check India's configured languages. Run: bun scripts/s25-check-india-langs.ts */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })
async function main() {
  const india = await prisma.country.findUnique({
    where: { isoCode: 'IN' },
    include: { supported: { include: { language: true } }, defaultLanguage: true },
  })
  if (!india) { console.log('India not found'); return }
  console.log(`India: defaultLanguage = ${india.defaultLanguage?.code ?? 'none'}`)
  console.log(`Supported languages (${india.supported.length}):`)
  for (const cl of india.supported) {
    console.log(`  ${cl.language.code.padEnd(5)} ${cl.language.name.padEnd(22)} ${cl.language.nativeName ?? ''} [${cl.contentStatus}]`)
  }
}
main().finally(() => prisma.$disconnect())
