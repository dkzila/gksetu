/**
 * GKSetu — P5-S3 suite helper: set a user's home country directly (SQL).
 * GB is COMING_SOON (§36) so /api/profile refuses it (ACTIVE-only §35 guard
 * — verified separately); the §14 goal-market guard needs a non-IN home to
 * exercise, so the suite flips the test user's homeCountryId here.
 * Usage: bun scripts/p5s3-set-home.ts <email> <ISO_CODE|none>
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1]
if (!url) {
  console.error('GKSETU_DATABASE_URL missing')
  process.exit(1)
}
const prisma = new PrismaClient({ datasources: { db: { url } } })
const [email, iso] = process.argv.slice(2)
if (!email || !iso) {
  console.error('usage: bun scripts/p5s3-set-home.ts <email> <ISO_CODE|none>')
  process.exit(1)
}
try {
  let countryId: string | null = null
  if (iso !== 'none') {
    const country = await prisma.country.findUnique({ where: { isoCode: iso } })
    if (!country) {
      console.error(`unknown country ${iso}`)
      process.exit(1)
    }
    countryId = country.id
  }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.error(`unknown user ${email}`)
    process.exit(1)
  }
  await prisma.user.update({ where: { id: user.id }, data: { homeCountryId: countryId } })
  console.log(`ok ${email} home=${iso}`)
} finally {
  await prisma.$disconnect()
}
