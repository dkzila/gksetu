/**
 * SITE-S26A: English-only translation runner.
 * Translates ALL Hindi MCQs to English across all 60 subjects.
 * Uses batch-size 15 for efficiency (~713 LLM calls total).
 *
 * Spawns `bun scripts/s26-translate-one.ts` per subject (crash-resistant).
 *
 * Usage:
 *   bun scripts/s26a-run-english.ts                    # all subjects
 *   bun scripts/s26a-run-english.ts --slug biology-gk  # one subject
 *   bun scripts/s26a-run-english.ts --limit 50          # cap per subject
 */
import { spawn } from 'child_process'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'scripts', 's25-data')
const LANG = 'en'

process.on('SIGHUP', () => {})
process.on('unhandledRejection', (r) => {
  console.log(`  [unhandled] ${String(r).slice(0, 80)} — continuing`)
})

function getSubjects(): string[] {
  const subjects: string[] = []
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      const d = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8'))
      if (Array.isArray(d) && d.length > 0) {
        const hindi = d.filter((m: { language?: string }) => m.language === 'hi')
        if (hindi.length > 0) subjects.push(f.replace(/\.json$/, ''))
      }
    } catch {}
  }
  return subjects.sort()
}

function getEnCached(slug: string): number {
  const f = join(DATA_DIR, 'translations', slug, 'en.json')
  try {
    const d = JSON.parse(readFileSync(f, 'utf-8'))
    return Array.isArray(d) ? d.length : 0
  } catch { return 0 }
}

function getTotalEn(): number {
  let t = 0
  const transDir = join(DATA_DIR, 'translations')
  try {
    for (const subjDir of readdirSync(transDir)) {
      const f = join(transDir, subjDir, 'en.json')
      try {
        const d = JSON.parse(readFileSync(f, 'utf-8'))
        if (Array.isArray(d)) t += d.length
      } catch {}
    }
  } catch {}
  return t
}

function runTranslation(slug: string, limit: number): Promise<{ rc: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', [
      'scripts/s26-translate-one.ts',
      '--slug', slug,
      '--lang', LANG,
      '--limit', String(limit),
      '--batch-size', '15',
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let output = ''
    child.stdout?.on('data', (d) => { output += d.toString() })
    child.stderr?.on('data', () => {})
    child.on('error', (err) => resolve({ rc: -1, output: `spawn error: ${err.message}` }))
    child.on('close', (code) => resolve({ rc: code ?? -1, output }))
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const onlySlug = argv.includes('--slug') ? argv[argv.indexOf('--slug') + 1] : null
  const limit = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]!, 10) : 0  // 0 = all

  const subjects = onlySlug ? [onlySlug] : getSubjects()
  console.log(`SITE-S26A: English translation — ${subjects.length} subjects`)
  console.log(`Started: ${new Date().toISOString()}`)
  console.log(`Initial English translations: ${getTotalEn()}`)
  console.log('')

  let i = 0
  for (const slug of subjects) {
    i++
    const cached = getEnCached(slug)
    // Determine how many to translate
    const inFile = join(DATA_DIR, `${slug}.json`)
    let hindiCount = 0
    try {
      const d = JSON.parse(readFileSync(inFile, 'utf-8'))
      hindiCount = d.filter((m: { language?: string }) => m.language === 'hi').length
    } catch {}
    const target = limit > 0 ? Math.min(limit, hindiCount) : hindiCount
    const remaining = Math.max(0, target - cached)

    if (remaining === 0) {
      console.log(`  [${i}/${subjects.length}] ${slug}: ${cached}/${hindiCount} en cached — skip`)
      continue
    }

    const result = await runTranslation(slug, target)
    const lines = result.output.trim().split('\n').filter((l) => l.trim())
    const lastLine = lines[lines.length - 1] ?? ''
    if (result.rc === 0) {
      console.log(`  [${i}/${subjects.length}] ${slug}: ${lastLine}`)
    } else {
      console.log(`  [${i}/${subjects.length}] ${slug}: [crash rc=${result.rc}] ${lastLine.slice(0, 60)}`)
    }

    if (i % 5 === 0) {
      console.log(`  --- progress: ${i}/${subjects.length} subjects, ${getTotalEn()} en translations ---`)
    }
  }

  console.log('')
  console.log(`========== DONE at ${new Date().toISOString()} ==========`)
  console.log(`Total English translations: ${getTotalEn()}`)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
