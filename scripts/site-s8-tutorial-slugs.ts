/**
 * GKSetu — SITE-S8 backfill: chapter slugs for every SyllabusNode.
 * docs/learning-platform-plan.md SITE-S8 — a tutorial is COMPUTED from the
 * frozen syllabus tree, and its chapter URLs are /tutorials/{exam}/{chapter}/
 * where {chapter} is the node's slug. Nodes never carried one, so this script
 * backfills `slug` for EVERY examVersion's nodes (frozen trees included —
 * they keep their slugs forever, §36) using the same deterministic rule the
 * tutorials module documents:
 *
 *   slug = slugify(name) — lowercase [a-z0-9]+ groups joined by '-', ≤60 chars
 *   empty (no alphanumerics) → `chapter-{priority + 1}`
 *   collision within the version → `-2`, `-3`, … suffix
 *
 * Idempotent: only nodes whose slug is NULL are touched — existing slugs
 * (from this run or any console/import path) are respected and reserved
 * against the dedupe set, so re-runs are safe and never renumber.
 *
 * Run: bun scripts/site-s8-tutorial-slugs.ts
 */
import { readFileSync } from 'node:fs'

import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** The tutorials module's deterministic node slug (≤60 chars, kebab-case). */
function slugify(name: string): string {
  const groups = name.toLowerCase().match(/[a-z0-9]+/g)
  if (!groups) return ''
  return groups.join('-').slice(0, 60).replace(/-+$/, '')
}

/** $transaction batches of this size (one pooler round-trip per chunk). */
const CHUNK_SIZE = 200

async function main() {
  // Parents before children: depth asc guarantees a parent is processed
  // before its subtree (parent.depth = child.depth - 1); priority asc keeps
  // the sibling reading order inside each level.
  const nodes = await prisma.syllabusNode.findMany({
    select: { id: true, name: true, slug: true, priority: true, examVersionId: true },
    orderBy: [{ depth: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
  })
  const versions = await prisma.examVersion.findMany({ select: { id: true, exam: { select: { slug: true } } } })
  const examSlugByVersion = new Map(versions.map((version) => [version.id, version.exam.slug]))

  // Per-version dedupe sets: existing slugs first (reserved), then the
  // freshly generated ones — the composite @@unique([examVersionId, slug])
  // can never be violated by this script's own output.
  const usedByVersion = new Map<string, Set<string>>()
  for (const node of nodes) {
    if (node.slug == null) continue
    const set = usedByVersion.get(node.examVersionId) ?? new Set<string>()
    set.add(node.slug)
    usedByVersion.set(node.examVersionId, set)
  }

  const updates: Array<{ id: string; slug: string }> = []
  let fallbackNames = 0
  let deduped = 0

  for (const node of nodes) {
    if (node.slug != null) continue // idempotent — an existing slug always wins
    const used = usedByVersion.get(node.examVersionId) ?? new Set<string>()

    let base = slugify(node.name)
    if (!base) {
      base = `chapter-${node.priority + 1}`
      fallbackNames++
    }
    let slug = base
    if (used.has(slug)) {
      deduped++
      let suffix = 2
      while (used.has(`${base}-${suffix}`)) suffix++
      slug = `${base}-${suffix}`
    }
    used.add(slug)
    usedByVersion.set(node.examVersionId, used)
    updates.push({ id: node.id, slug })
  }

  // Apply in batched transactions — the sandbox pooler costs ~0.7s per
  // round-trip, so 1007 single updates would crawl; ~6 chunks finish fast.
  let applied = 0
  for (let index = 0; index < updates.length; index += CHUNK_SIZE) {
    const chunk = updates.slice(index, index + CHUNK_SIZE)
    await prisma.$transaction(chunk.map((update) => prisma.syllabusNode.update({ where: { id: update.id }, data: { slug: update.slug } })))
    applied += chunk.length
  }

  const remaining = await prisma.syllabusNode.count({ where: { slug: null } })
  const total = nodes.length
  const alreadySlugged = total - updates.length

  console.log(`SITE-S8 chapter-slug backfill:`)
  console.log(`  versions scanned:        ${versions.length}`)
  console.log(`  nodes scanned:           ${total}`)
  console.log(`  nodes already slugged:   ${alreadySlugged}`)
  console.log(`  slugs applied:           ${applied}`)
  console.log(`  fallback chapter-N names:${fallbackNames}`)
  console.log(`  dedupe -2/-3 suffixes:   ${deduped}`)
  console.log(`  nodes still slugless:    ${remaining} (0 expected)`)
  // A quick uniqueness audit per version (defense in depth — the DB
  // constraint would have rejected any violation already).
  const all = await prisma.syllabusNode.findMany({ select: { examVersionId: true, slug: true } })
  const seen = new Map<string, Set<string>>()
  let violations = 0
  for (const node of all) {
    if (node.slug == null) continue
    const set = seen.get(node.examVersionId) ?? new Set<string>()
    if (set.has(node.slug)) violations++
    set.add(node.slug)
    seen.set(node.examVersionId, set)
  }
  console.log(`  uniqueness violations:   ${violations} (0 expected)`)
  // Sample output for eyeballing.
  const sample = await prisma.syllabusNode.findMany({
    where: { examVersion: { exam: { slug: 'upsc-civil-services' } } },
    select: { name: true, slug: true, depth: true, priority: true },
    orderBy: [{ depth: 'asc' }, { priority: 'asc' }],
    take: 8,
  })
  console.log(`  sample (upsc-civil-services):`)
  for (const node of sample) console.log(`    d${node.depth} p${node.priority}  ${node.slug}  ←  ${node.name}`)
  console.log(`  exams touched:           ${new Set(updates.map((u) => u.id)).size > 0 ? examSlugByVersion.size : 0} (all versions walked)`)
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
