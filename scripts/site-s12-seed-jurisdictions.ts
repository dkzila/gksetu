/**
 * GKSetu — SITE-S12: seed the Jurisdiction taxonomy (idempotent)
 *
 * One INTERNATIONAL row (cross-market), one CENTRAL row per ACTIVE country
 * ("Government of India — Central"), and India's 28 states + 8 UTs seeded as
 * STATE rows with their ISO 3166-2 codes (the backfill + Console cascade +
 * goal `stateCode` validation all rely on these).
 *
 * Districts are NOT bulk-seeded (700+ rows of noise helps no one on day one) —
 * they are created on demand in the Console under their state. The seed leaves
 * existing jurisdictions untouched if a matching row already exists.
 *
 * Run: `bun scripts/site-s12-seed-jurisdictions.ts`
 */
import { PrismaClient, type JurisdictionLevel } from '@prisma/client'

const db = new PrismaClient()

interface StateDef {
  code: string // ISO 3166-2 suffix
  name: string // Indian state/UT display name
  sortOrder: number
}

// India's 28 states (ISO 3166-2:IN-XX) — National Informatics Centre list,
// ordered alphabetically. Codes are the canonical suffixes used in URLs.
const INDIAN_STATES: StateDef[] = [
  { code: 'AN', name: 'Andaman and Nicobar Islands', sortOrder: 1 }, // UT
  { code: 'AP', name: 'Andhra Pradesh', sortOrder: 2 },
  { code: 'AR', name: 'Arunachal Pradesh', sortOrder: 3 },
  { code: 'AS', name: 'Assam', sortOrder: 4 },
  { code: 'BR', name: 'Bihar', sortOrder: 5 },
  { code: 'CH', name: 'Chandigarh', sortOrder: 6 }, // UT
  { code: 'CT', name: 'Chhattisgarh', sortOrder: 7 },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', sortOrder: 8 }, // UT
  { code: 'DL', name: 'Delhi (NCT)', sortOrder: 9 }, // UT
  { code: 'GA', name: 'Goa', sortOrder: 10 },
  { code: 'GJ', name: 'Gujarat', sortOrder: 11 },
  { code: 'HP', name: 'Himachal Pradesh', sortOrder: 12 },
  { code: 'HR', name: 'Haryana', sortOrder: 13 },
  { code: 'JH', name: 'Jharkhand', sortOrder: 14 },
  { code: 'JK', name: 'Jammu and Kashmir', sortOrder: 15 }, // UT
  { code: 'KA', name: 'Karnataka', sortOrder: 16 },
  { code: 'KL', name: 'Kerala', sortOrder: 17 },
  { code: 'LA', name: 'Ladakh', sortOrder: 18 }, // UT
  { code: 'LD', name: 'Lakshadweep', sortOrder: 19 }, // UT
  { code: 'MH', name: 'Maharashtra', sortOrder: 20 },
  { code: 'ML', name: 'Meghalaya', sortOrder: 21 },
  { code: 'MN', name: 'Manipur', sortOrder: 22 },
  { code: 'MP', name: 'Madhya Pradesh', sortOrder: 23 },
  { code: 'MZ', name: 'Mizoram', sortOrder: 24 },
  { code: 'NL', name: 'Nagaland', sortOrder: 25 },
  { code: 'OD', name: 'Odisha', sortOrder: 26 },
  { code: 'PB', name: 'Punjab', sortOrder: 27 },
  { code: 'PY', name: 'Puducherry', sortOrder: 28 }, // UT
  { code: 'RJ', name: 'Rajasthan', sortOrder: 29 },
  { code: 'SK', name: 'Sikkim', sortOrder: 30 },
  { code: 'TN', name: 'Tamil Nadu', sortOrder: 31 },
  { code: 'TG', name: 'Telangana', sortOrder: 32 },
  { code: 'TR', name: 'Tripura', sortOrder: 33 },
  { code: 'UP', name: 'Uttar Pradesh', sortOrder: 34 },
  { code: 'UT', name: 'Uttarakhand', sortOrder: 35 },
  { code: 'WB', name: 'West Bengal', sortOrder: 36 },
]

// India's 8 Union Territories (per the J&K reorganisation 2019 + Dadra merger 2020).
// All UTs already share the above list (AN, CH, DH, DL, JK, LA, LD, PY).
const INDIA_UT_CODES = new Set(['AN', 'CH', 'DH', 'DL', 'JK', 'LA', 'LD', 'PY'])

async function upsertJurisdiction(input: {
  level: JurisdictionLevel
  countryId?: string | null
  code?: string | null
  name: string
  parentId?: string | null
  sortOrder: number
}) {
  // Composite key: (countryId, level, code) — null code + null countryId is
  // the unique INTERNATIONAL row. Prisma treats null as distinct in unique
  // indexes, so we look up by hand first to keep this idempotent across runs.
  const where: { countryId?: string | null; level: JurisdictionLevel; code?: string | null } = {
    level: input.level,
  }
  if (input.countryId !== undefined) where.countryId = input.countryId
  if (input.code !== undefined) where.code = input.code
  const existing = await db.jurisdiction.findFirst({
    where,
    select: { id: true },
  })
  if (existing) {
    return db.jurisdiction.update({
      where: { id: existing.id },
      data: { name: input.name, sortOrder: input.sortOrder, parentId: input.parentId ?? null },
    })
  }
  return db.jurisdiction.create({
    data: {
      countryId: input.countryId ?? null,
      level: input.level,
      code: input.code ?? null,
      name: input.name,
      parentId: input.parentId ?? null,
      sortOrder: input.sortOrder,
    },
  })
}

async function main() {
  console.log('SITE-S12 jurisdiction seed — starting (idempotent upserts)…')

  // 1) INTERNATIONAL — one global row (cross-market scope; countryId null).
  const intl = await upsertJurisdiction({
    level: 'INTERNATIONAL',
    countryId: null,
    code: null,
    name: 'International',
    sortOrder: 0,
  })
  console.log(`  INTERNATIONAL: "${intl.name}" (id=${intl.id})`)

  // 2) CENTRAL — one row per ACTIVE country.
  const countries = await db.country.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, isoCode: true, name: true },
    orderBy: { name: 'asc' },
  })
  console.log(`  Found ${countries.length} ACTIVE country(ies) — seeding CENTRAL for each…`)
  for (const country of countries) {
    const central = await upsertJurisdiction({
      level: 'CENTRAL',
      countryId: country.id,
      code: null,
      name: `Government of ${country.name} — Central`,
      sortOrder: 0,
    })
    console.log(`    ${country.isoCode}: "${central.name}" (id=${central.id})`)
  }

  // 3) India's 28 states + 8 UTs as STATE rows with ISO codes.
  const india = countries.find((c) => c.isoCode === 'IN')
  if (!india) {
    console.warn('  India (IN) not found among ACTIVE countries — skipping state/UT seed.')
  } else {
    console.log(`  India (id=${india.id}) — seeding ${INDIAN_STATES.length} STATE rows…`)
    let statesSeeded = 0
    let utsSeeded = 0
    for (const state of INDIAN_STATES) {
      const row = await upsertJurisdiction({
        level: 'STATE',
        countryId: india.id,
        code: state.code,
        name: state.name,
        sortOrder: state.sortOrder,
      })
      if (INDIA_UT_CODES.has(state.code)) utsSeeded += 1
      else statesSeeded += 1
      void row
    }
    console.log(`    ${statesSeeded} states + ${utsSeeded} UTs seeded (STATE level — both share IN-XX ISO codes).`)
  }

  // Final census
  const counts = await db.jurisdiction.groupBy({
    by: ['level'],
    _count: true,
    orderBy: { level: 'asc' },
  })
  console.log('\nFinal census:')
  for (const entry of counts) {
    console.log(`  ${entry.level.padEnd(14)} ${entry._count}`)
  }
  console.log('\nSITE-S12 jurisdiction seed — done.')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('Seed failed:', e)
    await db.$disconnect()
    process.exit(1)
  })
