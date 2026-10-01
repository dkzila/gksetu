/**
 * GKSetu — standalone search reindex (idempotent, safe to re-run any time).
 * Usage: bun scripts/reindex-search.ts
 */
import { readFileSync } from 'node:fs'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1]
if (!url) {
  console.error('GKSETU_DATABASE_URL missing from .env')
  process.exit(1)
}
process.env.GKSETU_DATABASE_URL = url

const { reindexAll } = await import('../src/modules/search/indexing-service')
const result = await reindexAll()
console.log(
  `Reindex complete: ${result.examsIndexed} exams, ${result.unitsIndexed} units, ${result.topicsIndexed} topics, ${result.eventsIndexed} events — ${result.documentsWritten} documents in ${result.tookMs}ms`
)
