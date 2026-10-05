/**
 * GKSetu — SITE-S12: backfill Exam.jurisdictionId (idempotent + honest)
 *
 * Rule (per docs/learning-flow-plan.md SITE-S12-A):
 *   • NATIONAL → the country's CENTRAL row.
 *   • STATE/REGIONAL → infer the state by name/organiser matching the seeded
 *     STATE rows (e.g. "Maharashtra Public Service Commission" → MH).
 *   • explicit "International" in name/organiser → INTERNATIONAL.
 *   • unresolved (no state match) → stays NULL and surfaces in the Console's
 *     "missing jurisdiction" filter (never a guessed assignment).
 *
 * Run: `bun scripts/site-s12-backfill-exam-jurisdiction.ts`
 *
 * Outputs a parity report at the end (N tagged, N gaps listed).
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/** A regex-based state matcher — the FIRST matching state wins. We look at
 * the exam's name + organiser + slug, so "Maharashtra Police Constable" hits
 * MH even when the organiser ("Maharashtra Police (DGP)") does not literally
 * contain the word "Maharashtra Public Service Commission". */
interface StateRule {
  code: string
  /** Regex pattern (case-insensitive) — applied to name + organiser + slug. */
  patterns: RegExp[]
}

// Built from the seeded INDIAN_STATES list. Each rule matches the state name
// as a whole word (Delhi vs. "Delhi Public School" both match — Delhi is a UT
// and any Delhi-conducted exam legitimately buckets there).
const INDIAN_STATE_RULES: StateRule[] = [
  { code: 'AN', patterns: [/\bandaman\b/i, /\bnicobar\b/i] },
  { code: 'AP', patterns: [/\bandhra\s+pradesh\b/i, /\bAPSCRB\b/i, /\bAPPSC\b/i] },
  { code: 'AR', patterns: [/\barunachal\s+pradesh\b/i] },
  { code: 'AS', patterns: [/\bassam\b/i, /\bSLPRB\s+Assam\b/i] },
  { code: 'BR', patterns: [/\bbihar\b/i, /\bBPSC\b/i, /\bBPSSC\b/i, /\bBSSC\b/i, /\bCSBC\b/i, /\bBSEB\b/i] },
  { code: 'CH', patterns: [/\bchandigarh\b/i] },
  { code: 'CT', patterns: [/\bchhattisgarh\b/i, /\bCGPSC\b/i, /\bCGPEB\b/i, /\bvyapam\b/i] },
  { code: 'DH', patterns: [/\bdadra\b/i, /\bdaman\b/i, /\bdiu\b/i] },
  { code: 'DL', patterns: [/\bdelhi\b/i, /\bDSSSB\b/i, /\bDelhi\s+Subordinate\b/i] },
  { code: 'GA', patterns: [/\bgoa\b/i, /\bGPSC\b/i, /\blokrakshak\b/i] },
  { code: 'GJ', patterns: [/\bgujarat\b/i, /\bGPSC\b/i] },
  { code: 'HP', patterns: [/\bhimachal\s+pradesh\b/i, /\bhppsc\b/i, /\bhPBoSE\b/i] },
  { code: 'HR', patterns: [/\bharyana\b/i, /\bhssc\b/i, /\bhPSC\b/i, /\bBSEH\b/i, /\bHTET\b/i] },
  { code: 'JH', patterns: [/\bjharkhand\b/i, /\bJPSC\b/i, /\bJSSC\b/i] },
  { code: 'JK', patterns: [/\bjammu\b/i, /\bkashmir\b/i, /\bJKPSC\b/i] },
  { code: 'KA', patterns: [/\bkarnataka\b/i, /\bKPSC\b/i, /\bKAR\b/i] },
  { code: 'KL', patterns: [/\bkerala\b/i, /\bKER\b/i, /\bKerala\s+PSC\b/i] },
  { code: 'LA', patterns: [/\bladakh\b/i] },
  { code: 'LD', patterns: [/\blakshadweep\b/i] },
  { code: 'MH', patterns: [/\bmaharashtra\b/i, /\bMPSC\b/i, /\bMH-CET\b/i] },
  { code: 'ML', patterns: [/\bmeghalaya\b/i, /\bMPSC\b/i] },
  { code: 'MN', patterns: [/\bmanipur\b/i, /\bMPSC\b/i] },
  { code: 'MP', patterns: [/\bmadhya\s+pradesh\b/i, /\bMPPSC\b/i, /\bMPESB\b/i, /\bMP\s+Police\b/i, /\bMPTET\b/i] },
  { code: 'MZ', patterns: [/\bmizoram\b/i, /\bMPSC\b/i] },
  { code: 'NL', patterns: [/\bnagaland\b/i, /\bNPSC\b/i] },
  { code: 'OD', patterns: [/\bodisha\b/i, /\bOPSC\b/i, /\bOSCB\b/i] },
  { code: 'PB', patterns: [/\bpunjab\b/i] },
  { code: 'PY', patterns: [/\bpuducherry\b/i, /\bpondicherry\b/i] },
  { code: 'RJ', patterns: [/\brajasthan\b/i, /\bRPSC\b/i, /\bRSSB\b/i, /\bRSMSSB\b/i, /\bREET\b/i, /\bRTET\b/i] },
  { code: 'SK', patterns: [/\bsikkim\b/i, /\bSPSC\b/i] },
  { code: 'TN', patterns: [/\btamil\s+nadu\b/i, /\bTNPSC\b/i, /\bTNUSRB\b/i] },
  { code: 'TG', patterns: [/\btelangana\b/i, /\bTGPSC\b/i] },
  { code: 'TR', patterns: [/\btripura\b/i, /\bTPSC\b/i] },
  { code: 'UP', patterns: [/\butter\s+pradesh\b/i, /\bUPPSC\b/i, /\bUPSSSC\b/i, /\bUP\s+Police\b/i, /\bUPPRPB\b/i, /\bSuper\s+TET\b/i] },
  { code: 'UT', patterns: [/\buttarakhand\b/i, /\bUKPSC\b/i, /\bUKSSSC\b/i, /\bUttarakhand\s+Police\b/i] },
  { code: 'WB', patterns: [/\bwest\s+bengal\b/i, /\bWBPSC\b/i, /\bWB\s+Police\b/i, /\bWBP\b/i] },
]

/** Tests whether an exam's NAME carries an "International" marker (truly an
 * international exam — not just a conducting body with "International" in its
 * name, which is common for Indian deemed universities like Symbiosis). */
function looksInternational(name: string): boolean {
  return /\binternational\b/i.test(name) || /\bUN\b/.test(name) || /\bWorld\s+Bank\b/i.test(name)
}

/** The state code if any rule matches the exam's text (else null). */
function inferStateCode(name: string, organiser: string, slug: string): string | null {
  const text = `${name} ${organiser} ${slug}`
  for (const rule of INDIAN_STATE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) return rule.code
    }
  }
  return null
}

interface BackfillRow {
  slug: string
  name: string
  level: string
  organiser: string
  resolved: 'CENTRAL' | 'STATE' | 'INTERNATIONAL' | null
  stateCode: string | null
  reason: string
}

async function main() {
  console.log('SITE-S12 exam backfill — starting (idempotent)…\n')

  const exams = await db.exam.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      organiser: true,
      level: true,
      countryId: true,
      country: { select: { isoCode: true, name: true } },
      jurisdictionId: true,
    },
    orderBy: { slug: 'asc' },
  })
  console.log(`Found ${exams.length} exam rows.\n`)

  // Pre-load jurisdiction rows by composite key for O(1) lookup.
  const allJurisdictions = await db.jurisdiction.findMany({
    select: { id: true, countryId: true, level: true, code: true },
  })
  const centralByCountry = new Map<string, string>()
  const internationalId = allJurisdictions.find((j) => j.level === 'INTERNATIONAL')?.id ?? null
  const stateByCountryCode = new Map<string, Map<string, string>>() // countryId → code → jurisdictionId
  for (const j of allJurisdictions) {
    if (j.level === 'CENTRAL' && j.countryId) centralByCountry.set(j.countryId, j.id)
    if (j.level === 'STATE' && j.countryId && j.code) {
      let inner = stateByCountryCode.get(j.countryId)
      if (!inner) {
        inner = new Map()
        stateByCountryCode.set(j.countryId, inner)
      }
      inner.set(j.code, j.id)
    }
  }

  const report: BackfillRow[] = []
  let tagged = 0
  let gaps = 0
  let skipped = 0 // already had jurisdictionId

  for (const exam of exams) {
    // Skip exams already tagged (idempotent — preserves a manual Console edit).
    if (exam.jurisdictionId) {
      skipped += 1
      report.push({
        slug: exam.slug,
        name: exam.name,
        level: exam.level,
        organiser: exam.organiser,
        resolved: 'STATE',
        stateCode: null,
        reason: 'already tagged (skipped)',
      })
      continue
    }

    let targetJurisdictionId: string | null = null
    let resolved: BackfillRow['resolved'] = null
    let stateCode: string | null = null
    let reason = 'no rule matched — gap surfaced'

    // Rule 1: INTERNATIONAL marker in EXAM NAME (not organiser — Indian deemed
    // universities often carry "International" in their name without being
    // truly international exams; the EXAM NAME is the honest signal).
    if (looksInternational(exam.name) && internationalId) {
      targetJurisdictionId = internationalId
      resolved = 'INTERNATIONAL'
      stateCode = null
      reason = 'international marker in exam name'
    }
    // Rule 2: NATIONAL → the country's CENTRAL row.
    else if (exam.level === 'NATIONAL') {
      const centralId = exam.countryId ? centralByCountry.get(exam.countryId) : null
      if (centralId) {
        targetJurisdictionId = centralId
        resolved = 'CENTRAL'
        reason = `national → ${exam.country?.isoCode} CENTRAL`
      }
    }
    // Rule 3: STATE/REGIONAL → infer the state by name/organiser.
    else if (exam.level === 'STATE' || exam.level === 'REGIONAL') {
      const inferredCode = inferStateCode(exam.name, exam.organiser, exam.slug)
      if (inferredCode && exam.countryId) {
        const stateId = stateByCountryCode.get(exam.countryId)?.get(inferredCode)
        if (stateId) {
          targetJurisdictionId = stateId
          resolved = 'STATE'
          stateCode = inferredCode
          reason = `state → ${exam.country?.isoCode}-${inferredCode}`
        }
      }
    }

    if (targetJurisdictionId) {
      await db.exam.update({
        where: { id: exam.id },
        data: { jurisdictionId: targetJurisdictionId },
      })
      tagged += 1
    } else {
      gaps += 1
    }

    report.push({
      slug: exam.slug,
      name: exam.name,
      level: exam.level,
      organiser: exam.organiser,
      resolved,
      stateCode,
      reason,
    })
  }

  // Parity report
  console.log('=== PARITY REPORT ===')
  console.log(`Total exams:   ${exams.length}`)
  console.log(`Already tagged: ${skipped}`)
  console.log(`Newly tagged:  ${tagged}`)
  console.log(`Gaps (null):   ${gaps}\n`)

  if (gaps > 0) {
    console.log('--- GAPS (these surface in the Console\'s "missing jurisdiction" filter) ---')
    for (const row of report) {
      if (row.resolved === null) {
        console.log(`  ${row.slug.padEnd(40)} | ${row.level.padEnd(8)} | ${row.organiser}`)
      }
    }
  }

  console.log('\n--- RESOLVED BREAKDOWN ---')
  const byLevel = new Map<string, number>()
  for (const row of report) {
    const key = row.resolved ?? 'GAP'
    byLevel.set(key, (byLevel.get(key) ?? 0) + 1)
  }
  for (const [key, count] of byLevel) {
    console.log(`  ${key.padEnd(14)} ${count}`)
  }

  console.log('\nSITE-S12 exam backfill — done.')
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error('Backfill failed:', e)
    await db.$disconnect()
    process.exit(1)
  })
