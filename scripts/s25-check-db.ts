/**
 * Check the current state of the GKSetu DB: languages, topics, units, questions.
 * Run: bun scripts/s25-check-db.ts
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

async function main() {
  const langs = await prisma.language.findMany({ orderBy: { code: 'asc' } })
  console.log('Languages in DB:', langs.length)
  for (const l of langs) console.log(`  ${l.code.padEnd(5)} ${l.name.padEnd(22)} ${l.nativeName ?? ''} [${l.status}]`)

  const topics = await prisma.topic.count()
  console.log('Topics in DB:', topics)
  const topicSamples = await prisma.topic.findMany({ take: 5, select: { slug: true, canonicalName: true } })
  for (const t of topicSamples) console.log(`  topic: ${t.slug} — ${t.canonicalName}`)

  const units = await prisma.knowledgeUnit.count()
  console.log('KnowledgeUnits in DB:', units)
  const questions = await prisma.question.count()
  console.log('Questions in DB:', questions)
  const qnas = await prisma.qnA.count()
  console.log('QnAs in DB:', qnas)
  const translations = await prisma.translation.count()
  console.log('Translations in DB:', translations)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
