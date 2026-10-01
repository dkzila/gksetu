/**
 * GKSetu — INDIA EXAM CORPUS PUBLISHER (one-time, idempotent)
 *
 * Publishes every GK/Current-Affairs-bearing Indian exam from
 * scripts/india-exams-data.ts into the live database:
 *   1. Exam row (ACTIVE, IN, authored by the platform admin)
 *   2. One CURRENT ExamVersion (this year's window, official source string)
 *   3. The GK/CA SyllabusNode tree (topic-linked where the canonical
 *      taxonomy has a topic — §13's only exam→knowledge bridge)
 *   4. ExamMapping rows on every topic-linked node (the §8 requirement
 *      layer: the same canonical units serving many exams at honest depths)
 *   5. ACTIVATES the existing DRAFT upsc-engineering-services (its Paper I
 *      is General Studies — the corpus rule) with version + tree
 *   6. Full search reindex (exam documents for every ACTIVE exam)
 *
 * Re-running is safe: existing exam slugs are skipped, mappings use
 * skipDuplicates, the reindex is idempotent.
 *
 * Usage: bun scripts/publish-india-exams.ts [--dry-run]
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

import {
  ESE_ACTIVATION,
  INDIA_EXAM_BLUEPRINTS,
  MAPPING_RULES,
  type BlueprintNode,
  type MappingRule,
} from './india-exams-data'

const DRY_RUN = process.argv.includes('--dry-run')

// ---------- Env: the app modules (search reindex) read this variable ----------

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1]
if (!url) {
  console.error('GKSETU_DATABASE_URL missing from .env')
  process.exit(1)
}
process.env.GKSETU_DATABASE_URL = url

const prisma = new PrismaClient({ datasources: { db: { url } } })

// ---------- Shared state (resolved in main) ----------

let indiaId = ''
let adminId = ''
const topicIdBySlug = new Map<string, string>()
const unitIdBySlug = new Map<string, string>()

/** A mapping planned during tree creation — the rule carries the §8 vocabulary. */
interface PlannedMapping {
  knowledgeUnitId: string
  syllabusNodeId: string
  rule: MappingRule
}

interface TreeStats {
  nodes: number
  planned: PlannedMapping[]
}

/** Recursively creates one exam's GK/CA syllabus tree, planning mappings. */
async function createTree(
  versionId: string,
  nodes: BlueprintNode[],
  parentId: string | null,
  depth: number,
  stats: TreeStats
): Promise<void> {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    const topicId = node.topic ? (topicIdBySlug.get(node.topic) ?? null) : null
    if (node.topic && !topicId) {
      console.warn(`  ! topic "${node.topic}" not found — node "${node.name}" stays unlinked`)
    }
    const row = await prisma.syllabusNode.create({
      data: { examVersionId: versionId, parentId, name: node.name, topicId, depth, priority: index },
    })
    stats.nodes += 1
    if (topicId) {
      for (const rule of MAPPING_RULES[node.topic!] ?? []) {
        stats.planned.push({
          knowledgeUnitId: unitIdBySlug.get(rule.unit)!,
          syllabusNodeId: row.id,
          rule,
        })
      }
    }
    if (node.children?.length) {
      await createTree(versionId, node.children, row.id, depth + 1, stats)
    }
  }
}

/** Writes the planned §8 requirement rows with each rule's honest vocabulary. */
async function writePlannedMappings(planned: PlannedMapping[], examCode: string, versionId: string): Promise<number> {
  if (!planned.length) return 0
  const result = await prisma.examMapping.createMany({
    data: planned.map((p) => ({
      knowledgeUnitId: p.knowledgeUnitId,
      syllabusNodeId: p.syllabusNodeId,
      examVersionId: versionId,
      relevance: p.rule.relevance,
      priority: p.rule.priority,
      requiredDepth: p.rule.requiredDepth,
      questionLikelihood: p.rule.questionLikelihood,
      expectedScope: p.rule.expectedScope,
      sourceBasis: `GKSetu India exam-corpus publish — ${examCode} GK/Current-Affairs syllabus section.`,
      createdById: adminId,
    })),
    skipDuplicates: true,
  })
  return result.count
}

async function main() {
  const year = new Date().getUTCFullYear()
  const versionLabel = `${year} syllabus`
  const effectiveFrom = new Date(Date.UTC(year, 0, 1))

  // ---------- Resolve anchors ----------

  const india = await prisma.country.findUnique({ where: { isoCode: 'IN' } })
  if (!india) throw new Error('Country IN not found — run the seed first')
  const admin =
    (await prisma.user.findUnique({ where: { email: 'admin@gksetu.dev' } })) ??
    (await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } }))
  if (!admin) throw new Error('No ADMIN user found — run the seed first')
  indiaId = india.id
  adminId = admin.id

  for (const topic of await prisma.topic.findMany({ select: { id: true, slug: true } })) {
    topicIdBySlug.set(topic.slug, topic.id)
  }
  const neededUnits = [...new Set(Object.values(MAPPING_RULES).flatMap((rules) => rules.map((r) => r.unit)))]
  for (const unit of await prisma.knowledgeUnit.findMany({
    where: { slug: { in: neededUnits } },
    select: { id: true, slug: true },
  })) {
    unitIdBySlug.set(unit.slug, unit.id)
  }
  const missingUnits = neededUnits.filter((slug) => !unitIdBySlug.has(slug))
  if (missingUnits.length) {
    throw new Error(`Mappable units missing from the database: ${missingUnits.join(', ')}`)
  }

  console.log(
    `Anchors: IN=${indiaId} admin=${admin.email} topics=${topicIdBySlug.size} units=${unitIdBySlug.size} year=${year} (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`
  )

  // ---------- 1. The corpus ----------

  console.log(`\nPublishing ${INDIA_EXAM_BLUEPRINTS.length} exam blueprints…`)
  let created = 0
  let skipped = 0
  for (const blueprint of INDIA_EXAM_BLUEPRINTS) {
    const existing = await prisma.exam.findUnique({ where: { slug: blueprint.slug }, select: { id: true } })
    if (existing) {
      skipped += 1
      continue
    }
    if (DRY_RUN) {
      created += 1
      console.log(`  · would create ${blueprint.slug} (${blueprint.code})`)
      continue
    }

    const exam = await prisma.exam.create({
      data: {
        slug: blueprint.slug,
        code: blueprint.code,
        name: blueprint.name,
        organiser: blueprint.organiser,
        level: blueprint.level,
        status: 'ACTIVE',
        countryId: indiaId,
        description: blueprint.description,
        createdById: adminId,
        versions: {
          create: {
            label: versionLabel,
            effectiveFrom,
            effectiveTo: null,
            source: blueprint.source,
            createdById: adminId,
          },
        },
      },
      include: { versions: { select: { id: true } } },
    })
    const stats: TreeStats = { nodes: 0, planned: [] }
    await createTree(exam.versions[0].id, blueprint.tree, null, 0, stats)
    const mappingsWritten = await writePlannedMappings(stats.planned, blueprint.code, exam.versions[0].id)
    console.log(`  + ${blueprint.slug} (${blueprint.code}) — ${stats.nodes} nodes, ${mappingsWritten} mappings`)
    created += 1
  }
  console.log(`Corpus: ${created} created, ${skipped} skipped (already present)`)

  // ---------- 2. ESE activation (DRAFT → ACTIVE + its missing version/tree) ----------

  const ese = await prisma.exam.findUnique({
    where: { slug: ESE_ACTIVATION.slug },
    include: { versions: { select: { id: true } } },
  })
  if (ese && ese.status === 'DRAFT' && ese.versions.length === 0) {
    if (DRY_RUN) {
      console.log(`  · would activate ${ESE_ACTIVATION.slug} (DRAFT → ACTIVE with version + tree)`)
    } else {
      const version = await prisma.examVersion.create({
        data: {
          examId: ese.id,
          label: versionLabel,
          effectiveFrom,
          effectiveTo: null,
          source: 'UPSC Engineering Services Examination Notification — https://upsc.gov.in',
          createdById: adminId,
        },
      })
      const stats: TreeStats = { nodes: 0, planned: [] }
      await createTree(version.id, ESE_ACTIVATION.tree, null, 0, stats)
      const mappingsWritten = await writePlannedMappings(stats.planned, 'UPSC-ESE', version.id)
      await prisma.exam.update({ where: { id: ese.id }, data: { status: 'ACTIVE' } })
      console.log(`  + ${ESE_ACTIVATION.slug} activated (DRAFT → ACTIVE) — ${stats.nodes} nodes, ${mappingsWritten} mappings`)
    }
  } else if (ese) {
    console.log(`  = ${ESE_ACTIVATION.slug} already ${ese.status} with ${ese.versions.length} version(s) — untouched`)
  } else {
    console.log(`  = ${ESE_ACTIVATION.slug} not found — skipped`)
  }

  // ---------- 3. Search reindex (exam documents for every ACTIVE exam) ----------

  if (!DRY_RUN) {
    console.log('\nReindexing search (full, idempotent)…')
    const { reindexAll } = await import('../src/modules/search/indexing-service')
    const result = await reindexAll()
    console.log(
      `Reindex: ${result.examsIndexed} exams, ${result.unitsIndexed} units, ${result.topicsIndexed} topics, ${result.eventsIndexed} events — ${result.documentsWritten} documents in ${result.tookMs}ms`
    )
  }

  // ---------- Summary ----------

  const [totalExams, activeIn, versions, nodes, mappings] = await Promise.all([
    prisma.exam.count(),
    prisma.exam.count({ where: { countryId: indiaId, status: 'ACTIVE' } }),
    prisma.examVersion.count(),
    prisma.syllabusNode.count(),
    prisma.examMapping.count(),
  ])
  console.log('\n===== DATABASE STATE =====')
  console.log(`exams total: ${totalExams} | ACTIVE in India: ${activeIn}`)
  console.log(`exam versions: ${versions} | syllabus nodes: ${nodes} | exam mappings: ${mappings}`)
}

main()
  .catch((error) => {
    console.error('PUBLISH FAILED:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
