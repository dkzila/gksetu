/** Check the taxonomy tree structure (top-level topics). Run: bun scripts/s25-check-topics.ts */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })
async function main() {
  const roots = await prisma.topic.findMany({
    where: { parentId: null },
    orderBy: { orderIndex: 'asc' },
    select: { slug: true, canonicalName: true, type: true, status: true },
  })
  console.log(`Root topics: ${roots.length}`)
  for (const t of roots) console.log(`  ${t.slug.padEnd(30)} ${t.type.padEnd(10)} [${t.status}]`)

  // Count children of each root
  for (const r of roots.slice(0, 5)) {
    const childCount = await prisma.topic.count({ where: { parentId: r.slug ? (await prisma.topic.findUnique({ where: { slug: r.slug } }))?.id : null } })
    console.log(`  ${r.slug}: ${childCount} children`)
  }

  // Check for our new S25 topics
  const s25Topics = await prisma.topic.findMany({
    where: { slug: { contains: 'state-gk-' } },
    select: { slug: true, canonicalName: true, parentId: true, type: true },
  })
  console.log(`\nS25 state-gk-* topics: ${s25Topics.length}`)
  for (const t of s25Topics) console.log(`  ${t.slug.padEnd(35)} parent=${t.parentId ?? 'ROOT'}`)
}
main().finally(() => prisma.$disconnect())
