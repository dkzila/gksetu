/**
 * GlobIQ — SEO module: syllabus-topic page composition (P4-S3)
 * Master Plan §16 (the syllabus-topic pattern `…/exams/{exam}/syllabus/{topic}/`
 * — "indexable when valuable"), §33 (syllabus pages as indexable landing
 * surfaces with internal links to the exam's other syllabus topics and the
 * evergreen topic hub), §13 (SyllabusNode → ExamMapping as the only
 * exam→knowledge path — the page resolves by the node's canonical topic
 * link), §8 (the full requirement vocabulary on every row), §14/§15
 * (server-side country scope — the exam resolves only inside its owning
 * ACTIVE market), §35 (topic labels resolved requested → country default →
 * canonical), §36 (CURRENT version only by design — this is an SEO surface
 * answering "what this exam needs today in this topic"; historical reads
 * stay on the exam page's `?version=` coverage), §37 (deterministic
 * ordering, typed errors, client-agnostic DTO).
 *
 * Nothing persists. The page composes from the FULL current-version node
 * tree (not the pruned coverage tree — a syllabus topic is part of the exam
 * even before editors map units to it), with mapping visibility mirroring
 * the requirement layer's public rules exactly: VERIFIED units, §14 scope
 * (GLOBAL or the reader's market), and §8 in-effect periods (§36).
 */
import { db } from '@/lib/db'
import { ExamError, getPublicExam } from '@/modules/exams-syllabus'
import type { PublicExamDetail } from '@/modules/exams-syllabus'
import { mappingInEffect, resolveTopicLabels } from '@/modules/exam-mapping'
import { getPublicTree } from '@/modules/taxonomy'

import {
  composeUnitCards,
  examPath,
  flattenTree,
  localePath,
  resolveReaderContext,
  syllabusTopicPath,
  topicHubPath,
  type ReaderContext,
} from './composition-helpers'
import { buildPageSeo } from './page-seo'
import { buildHubGraph, SITE_NAME } from './structured-data'
import { SeoError } from './errors'
import type {
  SyllabusPlacement,
  SyllabusRequirement,
  SyllabusTopicPage,
} from './types'
import type { SyllabusTopicQuery } from './validation'

// ---------- Constants ----------

/** §33 internal links — the exam's other syllabus topics (current version). */
const RELATED_TOPIC_LIMIT = 8

// ---------- Row shapes (local, §37 — no internal ids leak into the DTO) ----------

interface NodeRow {
  id: string
  parentId: string | null
  name: string
  depth: number
  priority: number
  topicId: string | null
  topic: { id: string; slug: string; canonicalName: string } | null
  examMappings: MappingRow[]
}

interface MappingRow {
  knowledgeUnitId: string
  effectiveFrom: Date | null
  effectiveTo: Date | null
  requiredDepth: SyllabusRequirement['requiredDepth']
  priority: SyllabusRequirement['priority']
  relevance: SyllabusRequirement['relevance']
  questionLikelihood: SyllabusRequirement['questionLikelihood']
  expectedScope: string | null
  knowledgeUnit: {
    slug: string
    canonicalName: string
    status: string
    scope: string
    countryId: string | null
  }
}

// ---------- Public read ----------

/**
 * The §16 syllabus-topic page composition: where a canonical topic sits in
 * the exam's CURRENT syllabus (every placement, with its node chain), the
 * units required there with the full §8 vocabulary, the §33 internal links
 * (the exam's other syllabus topics + the evergreen topic hub) and the exam
 * page breadcrumb.
 */
export async function getSyllabusTopicPage(
  examRef: string,
  topicRef: string,
  query: SyllabusTopicQuery
): Promise<SyllabusTopicPage> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(query)

  // ---------- Exam detail — header, organiser, §14 guard, §16 paths ----------
  let detail: PublicExamDetail
  try {
    detail = await getPublicExam(examRef, query)
  } catch (error) {
    if (error instanceof ExamError) throw mapExamError(error)
    throw error
  }
  if (!detail.currentVersion) {
    throw new SeoError(
      'SYLLABUS_TOPIC_NOT_FOUND',
      'This exam has no syllabus version in effect yet — its topic pages appear with the first started window (§36)'
    )
  }

  // ---------- The FULL current-version node tree (§13 links + §8 rows) ----------
  const nodes = await db.syllabusNode.findMany({
    where: { examVersionId: detail.currentVersion.id },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }], // deterministic (§37 — tree order)
    include: {
      topic: { select: { id: true, slug: true, canonicalName: true } },
      examMappings: {
        // The requirement layer's deterministic mapping order (§37).
        orderBy: [{ knowledgeUnit: { canonicalName: 'asc' } }, { id: 'asc' }],
        include: {
          knowledgeUnit: {
            select: {
              slug: true,
              canonicalName: true,
              status: true,
              scope: true,
              countryId: true,
            },
          },
        },
      },
    },
  })

  // ---------- §35 labels for every topic-linked node in the tree ----------
  const topicIds = [...new Set(nodes.map((node) => node.topicId).filter((id): id is string => id != null))]
  const labels = await resolveTopicLabels(
    topicIds,
    context.languageCode,
    context.defaultLanguageCode
  )

  /** Public reality (§38 + §14 + §36): VERIFIED, country-visible, in effect. */
  const visibleMappings = (node: NodeRow) =>
    node.examMappings.filter(
      (mapping) =>
        mapping.knowledgeUnit.status === 'VERIFIED' &&
        (mapping.knowledgeUnit.scope === 'GLOBAL' ||
          mapping.knowledgeUnit.countryId === context.countryRow.id) &&
        mappingInEffect(mapping, false)
    )

  // ---------- The topic's placements (§13 — by canonical topic link) ----------
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const placements: SyllabusPlacement[] = []
  const placementNodes: Array<{ row: NodeRow; visible: MappingRow[] }> = []
  for (const node of nodes) {
    if (node.topic?.slug !== topicRef) continue
    // Ancestor chain, root first (parentId walk — the tree never spans versions).
    const ancestors: Array<{ name: string }> = []
    let cursor: NodeRow | undefined = node
    while (cursor?.parentId) {
      const parent: NodeRow | undefined = nodeById.get(cursor.parentId)
      if (!parent) break
      ancestors.unshift({ name: parent.name })
      cursor = parent
    }
    const visible = visibleMappings(node)
    placements.push({
      node: { name: node.name, priority: node.priority },
      ancestors,
      unitCount: visible.length,
    })
    placementNodes.push({ row: node, visible })
  }
  if (placements.length === 0) {
    throw new SeoError(
      'SYLLABUS_TOPIC_NOT_FOUND',
      'This topic is not part of the current syllabus of this exam — browse the exam page for its mapped topics'
    )
  }

  // ---------- Requirement rows — §22 quick-fact cards + §8 vocabulary ----------
  const requirements = await composeRequirements(placementNodes, context, query)

  // ---------- §33 internal links — the exam's other syllabus topics ----------
  const syllabusTopics = new Map<string, { label: string; unitCount: number }>()
  for (const node of nodes) {
    if (!node.topic || node.topic.slug === topicRef) continue
    const entry = syllabusTopics.get(node.topic.slug) ?? {
      label: labels.get(node.topic.id)?.label ?? node.topic.canonicalName,
      unitCount: 0,
    }
    entry.unitCount += visibleMappings(node).length
    syllabusTopics.set(node.topic.slug, entry)
  }
  const relatedTopics = [...syllabusTopics.entries()]
    .map(([slug, { label, unitCount }]) => ({
      slug,
      label,
      unitCount,
      canonicalPath: syllabusTopicPath(context, detail.slug, slug),
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.slug.localeCompare(b.slug)) // deterministic (§37)
    .slice(0, RELATED_TOPIC_LIMIT)

  // ---------- Assembly ----------
  const topicRow = placementNodes[0].row.topic!

  // ---------- §16 SEO block (P4-S4) — canonical, hreflang cluster, lastmod ----------
  // CURRENT-only by design (§36): the syllabus page answers "today" — always
  // indexable, lastmod = the current window's effective date.
  const seo = buildPageSeo({
    country: {
      slug: context.publicCountry.slug,
      isDefault: context.publicCountry.isDefault,
    },
    defaultLanguageCode: context.defaultLanguageCode,
    languageCode: context.languageCode,
    languages: context.publicCountry.languages,
    pathFor: (code) => localePath(context, code, ['exams', detail.slug, 'syllabus', topicRow.slug]),
    lastModified: new Date(detail.currentVersion.effectiveFrom),
  })

  // ---------- §16 structured-data graph (P4-S5) ----------
  // Where the topic sits in the exam's CURRENT syllabus — a CollectionPage
  // whose description carries the honest requirement counters.
  const topicLabel = labels.get(topicRow.id)?.label ?? topicRow.canonicalName
  const structuredData = buildHubGraph({
    siteName: SITE_NAME,
    homePath: context.resolution.canonicalUrl,
    inLanguage: context.languageCode,
    name: topicLabel,
    selfName: topicLabel,
    description: `${topicLabel} in the ${detail.name} syllabus (${detail.currentVersion.label}) — ${new Set(requirements.map((row) => row.unit.slug)).size} required knowledge units across ${placements.length} placements.`,
    about: topicLabel,
    path: syllabusTopicPath(context, detail.slug, topicRow.slug),
    crumbs: [
      { name: 'Home', path: context.resolution.canonicalUrl },
      { name: detail.name, path: examPath(context, detail.slug) },
      { name: 'Syllabus', path: null }, // the coverage tree lives on the exam page
      { name: topicLabel, path: null }, // self
    ],
  })

  return {
    exam: {
      slug: detail.slug,
      name: detail.name,
      code: detail.code,
      organiser: detail.organiser,
      level: detail.level,
    },
    version: {
      id: detail.currentVersion.id,
      label: detail.currentVersion.label,
      effectiveFrom: detail.currentVersion.effectiveFrom,
      effectiveTo: detail.currentVersion.effectiveTo,
    },
    topic: {
      slug: topicRow.slug,
      canonicalName: topicRow.canonicalName,
      label: topicLabel,
      labelLanguage: labels.get(topicRow.id)?.language ?? 'canonical',
    },
    canonicalPath: syllabusTopicPath(context, detail.slug, topicRow.slug),
    seo,
    structuredData,
    examPath: examPath(context, detail.slug),
    topicHubPath: topicHubPath(context, topicRow.slug),
    breadcrumb: [
      { name: 'Home', path: context.resolution.canonicalUrl },
      { name: detail.name, path: examPath(context, detail.slug) },
      { name: 'Syllabus', path: null }, // the coverage tree lives on the exam page
      { name: topicLabel, path: null }, // self
    ],
    placements,
    requirements,
    relatedTopics,
    stats: {
      unitCount: new Set(requirements.map((row) => row.unit.slug)).size,
      requirementCount: requirements.length,
      placementCount: placements.length,
    },
    language: detail.language,
  }
}

// ---------- Requirement rows ----------

/** One row per (placement node × visible mapped unit), in stable tree order. */
async function composeRequirements(
  placementNodes: Array<{ row: NodeRow; visible: MappingRow[] }>,
  context: ReaderContext,
  query: SyllabusTopicQuery
): Promise<SyllabusRequirement[]> {
  const unitSlugs = [
    ...new Set(placementNodes.flatMap(({ visible }) => visible.map((m) => m.knowledgeUnit.slug))),
  ]
  if (unitSlugs.length === 0) return []

  // Re-fetch the canonical rows for the §22 card composition (§14 scope).
  const unitRows = await db.knowledgeUnit.findMany({
    where: {
      slug: { in: unitSlugs },
      status: 'VERIFIED',
      OR: [{ scope: 'GLOBAL' }, { countryId: context.countryRow.id }],
    },
  })

  // The visible tree powers topic labels + §16 paths on the cards (§35).
  const tree = await getPublicTree({ country: query.country, language: query.language })
  const flat = flattenTree(tree)
  const nodeById = new Map(flat.map((entry) => [entry.node.id, entry.node]))
  const cards = await composeUnitCards({ unitRows, context, nodeById })
  const cardBySlug = new Map(cards.map((card) => [card.slug, card]))

  const rows: SyllabusRequirement[] = []
  for (const { row, visible } of placementNodes) {
    for (const mapping of visible) {
      const card = cardBySlug.get(mapping.knowledgeUnit.slug)
      if (!card) continue // a unit hidden from this reader never appears
      rows.push({
        unit: card,
        node: { name: row.name },
        requiredDepth: mapping.requiredDepth,
        priority: mapping.priority,
        relevance: mapping.relevance,
        questionLikelihood: mapping.questionLikelihood,
        expectedScope: mapping.expectedScope,
        effectiveFrom: mapping.effectiveFrom?.toISOString() ?? null,
        effectiveTo: mapping.effectiveTo?.toISOString() ?? null,
      })
    }
  }
  return rows
}

// ---------- Error mapping (§37 — upstream ExamError never leaks raw) ----------

function mapExamError(error: ExamError): SeoError {
  switch (error.code) {
    case 'COUNTRY_NOT_FOUND':
      return new SeoError('COUNTRY_NOT_FOUND', error.message)
    case 'EXAM_NOT_FOUND':
      return new SeoError(
        'EXAM_NOT_FOUND',
        'Exam not found — exams are country-scoped (§14) and only ACTIVE exams have pages'
      )
    default:
      return new SeoError('SYLLABUS_PAGE_FAILED', 'The syllabus page could not be composed')
  }
}
