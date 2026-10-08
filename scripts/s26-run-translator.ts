/**
 * SITE-S26: Node.js translation runner — spawns `bun scripts/s26-translate-one.ts`
 * for each subject × language combination, and continues even if a child crashes.
 *
 * The bash wrapper kept dying when bun crashed (nohup/setsid couldn't keep it alive).
 * Node.js child_process.spawn with detached:false + error handling is more robust.
 *
 * Usage:
 *   bun scripts/s26-run-translator.ts                    # all subjects, 50/lang
 *   bun scripts/s26-run-translator.ts --limit 30         # 30 MCQs per subject
 *   bun scripts/s26-run-translator.ts --lang en          # only English
 */
import { spawn } from 'child_process'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'scripts', 's25-data')
const LANGS = ['en', 'bn', 'gu', 'kn', 'ml', 'mr', 'or', 'ta', 'te']

// Ignore SIGHUP — when the parent shell exits, this process should keep running.
process.on('SIGHUP', () => {})
process.on('unhandledRejection', (r) => {
  console.log(`  [unhandled] ${String(r).slice(0, 80)} — continuing`)
})

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

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

function getTotalTranslations(): number {
  let t = 0
  const transDir = join(DATA_DIR, 'translations')
  try {
    for (const subjDir of readdirSync(transDir)) {
      const subjPath = join(transDir, subjDir)
      if (!statSync(subjPath).isDirectory()) continue
      for (const f of readdirSync(subjPath)) {
        if (!f.endsWith('.json')) continue
        try {
          const d = JSON.parse(readFileSync(join(subjPath, f), 'utf-8'))
          if (Array.isArray(d)) t += d.length
        } catch {}
      }
    }
  } catch {}
  return t
}

/** Run a single subject × language translation as a child process. */
function runTranslation(slug: string, lang: string, limit: number): Promise<{ rc: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn('bun', [
      'scripts/s26-translate-one.ts',
      '--slug', slug,
      '--lang', lang,
      '--limit', String(limit),
      '--batch-size', '8',
    ], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let output = ''
    child.stdout?.on('data', (d) => { output += d.toString() })
    child.stderr?.on('data', () => { /* suppress SDK noise */ })

    child.on('error', (err) => {
      resolve({ rc: -1, output: `spawn error: ${err.message}` })
    })

    child.on('close', (code) => {
      resolve({ rc: code ?? -1, output })
    })
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const limitArg = argv.includes('--limit') ? parseInt(argv[argv.indexOf('--limit') + 1]!, 10) : 50
  const onlyLang = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null
  const langs = onlyLang ? [onlyLang] : LANGS

  const subjects = getSubjects()
  console.log(`SITE-S26 translator: ${subjects.length} subjects × ${langs.join(',')} × ${limitArg} MCQs/lang`)
  console.log(`Started at: ${new Date().toISOString()}`)
  console.log(`Initial total: ${getTotalTranslations()} translations`)
  console.log('')

  let i = 0
  for (const slug of subjects) {
    i++
    for (const lang of langs) {
      const result = await runTranslation(slug, lang, limitArg)
      const lines = result.output.trim().split('\n').filter((l) => l.trim())
      const lastLine = lines[lines.length - 1] ?? ''
      if (result.rc === 0) {
        console.log(lastLine)
      } else {
        console.log(`  [crash rc=${result.rc}] ${slug} → ${lang}: ${lastLine.slice(0, 80)}`)
      }
    }
    if (i % 3 === 0) {
      const total = getTotalTranslations()
      console.log(`  --- [${i}/${subjects.length} done] total translations: ${total} ---`)
    }
  }

  console.log('')
  console.log(`========== ALL SUBJECTS DONE at ${new Date().toISOString()} ==========`)
  const total = getTotalTranslations()
  console.log(`Total translations: ${total}`)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
