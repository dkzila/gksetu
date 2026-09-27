/**
 * GlobIQ — SEO module: exam page composition (P4-S3)
 * Master Plan §16 (the country-specific exam page `…/exams/{exam-slug}/`
 * generated from country + language + object identity), §33 (exam pages as
 * indexable landing pages with internal links), §22 ("Exam overview:
 * syllabus coverage" — what this exam needs today), §8 (the full requirement
 * vocabulary on every row), §11 (the study list applies the engine's base
 * ranking — priority → likelihood → freshness → name; the combined queue
 * across followed exams arrives with P5), §13 (SyllabusNode → ExamMapping as
 * the only exam→knowledge path), §14/§15 (server-side country scope — an exam
 * resolves only inside its owning ACTIVE market; COMING_SOON markets get the
 * typed 404, never an IN-data leak), §35 (labels resolved requested →
 * country default → canonical), §36 (CURRENT version by default; `?version=`
 * reads a STARTED window historically; future windows are never public),
 * §37 (deterministic ordering, typed errors, client-agnostic DTO).
 *
 * Nothing persists — the page is a computed view over the canonical model
 * (§7 store-once): the header comes from the public exam detail, the coverage
 * tree from the requirement layer's public coverage read (reused verbatim so
 * no aggregation can drift from §8/§36 semantics), the study list from the
 * §22 quick-fact card composition, and the related-exam links from the shared
 * §34 exam-card directory.
 */
import { db } from '@/lib/db'
import {
  ExamError,
  getPublicExam,
  type ExamVersionRef,
  type PublicExamDetail,
} from '@/modules/exams-syllabus'
import { getPublicExamCoverage } from '@/modules/exam-mapping'
import type { PublicExamCoverage, PublicCoverageNode } from '@/modules/exam-mapping'
import { REQUIRED_DEPTH_ORDER } from '@/modules/exam-mapping'
import { getPublicTree } from '@/modules/taxonomy'

import {
  composeExamCards,
  composeUnitCards,
  examPath,
  flattenTree,
  resolveReaderContext,
  type ReaderContext,
} from './composition-helpers'
import { SeoError } from './errors'
import type { ExamPage, ExamPageUnit } from './types'
import type { ExamPageQuery } from './validation'

// ---------- Constants ----------

/** §33 related-exam internal links on the exam page. */
const RELATED_EXAM_LIMIT = 6
/**
 * §37: the study list is a ranked digest, not the whole requirement set —
 * every row stays visible in the coverage tree below; `total` ships alongside
 * so the cap is always labelled honestly.
 */
const STUDY_LIST_LIMIT = 50

// ---------- §11 base ranking (mirrors the combination engine) ----------

const PRIORITY_WEIGHT = { CORE: 3, SUPPORTING: 2, LOW: 1 } as const
const LIKELIHOOD_WEIGHT = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const
const DEPTH_WEIGHT: Record<string, number> = Object.fromEntries(
  REQUIRED_DEPTH_ORDER.map((depth, index) => [depth, index])
)

/** The strongest (unit × node) row for one unit: priority → likelihood → depth. */
function isStronger(
  candidate: { priority: string; questionLikelihood: string; requiredDepth: string },
  incumbent: { priority: string; questionLikelihood: string; requiredDepth: string }
): boolean {
  if (PRIORITY_WEIGHT[candidate.priority] !== PRIORITY_WEIGHT[incumbent.priority]) {
    return PRIORITY_WEIGHT[candidate.priority] > PRIORITY_WEIGHT[incumbent.priority]
  }
  if (LIKELIHOOD_WEIGHT[candidate.questionLikelihood] !== LIKELIHOOD_WEIGHT[incumbent.questionLikelihood]) {
    return LIKELIHOOD_WEIGHT[candidate.questionLikelihood] > LIKELIHOOD_WEIGHT[incumbent.questionLikelihood]
  }
  return DEPTH_WEIGHT[candidate.requiredDepth] > DEPTH_WEIGHT[incumbent.requiredDepth]
}

// ---------- Error mapping (§37 — upstream ExamError never leaks raw) ----------

function mapExamError(error: ExamError, fallbackCode: 'EXAM_PAGE_FAILED' | 'SYLLABUS_PAGE_FAILED'): SeoError {
  switch (error.code) {
    case 'COUNTRY_NOT_FOUND':
      return new SeoError('COUNTRY_NOT_FOUND', error.message)
    case 'EXAM_NOT_FOUND':
      return new SeoError(
        'EXAM_NOT_FOUND',
        'Exam not found — exams are country-scoped (§14) and only ACTIVE exams have pages'
      )
    case 'VERSION_NOT_FOUND':
      return new SeoError('EXAM_VERSION_NOT_FOUND', 'That syllabus version does not exist on this exam')
    case 'VERSION_NOT_STARTED':
      return new SeoError(
        'EXAM_VERSION_NOT_STARTED',
        'This version has not taken effect yet — staged coverage is not public (§36)'
      )
    default:
      return new SeoError(fallbackCode, 'The exam page could not be composed')
  }
}

// ---------- Coverage-tree walking ----------

interface UnitSeed {
  slug: string
  /** The unit's strongest requirement row on the shown version. */
  strongest: {
    requiredDepth: ExamPageUnit['requiredDepth']
    priority: ExamPageUnit['priority']
    questionLikelihood: ExamPageUnit['questionLikelihood']
    nodeName: string
  }
  /** Most recent mapping effectiveFrom across the unit's rows (§11 step 7). */
  latestEffectiveFrom: number | null
}

/** Walks the mapping-bearing tree collecting per-unit strongest rows + freshness. */
function collectUnitSeeds(nodes: PublicCoverageNode[]): Map<string, UnitSeed> {
  const seeds = new Map<string, UnitSeed>()
  const walk = (node: PublicCoverageNode) => {
    for (const mapping of node.mappings) {
      const strongest = {
        requiredDepth: mapping.requiredDepth,
        priority: mapping.priority,
        questionLikelihood: mapping.questionLikelihood,
        nodeName: node.name,
      }
      const fresh = mapping.effectiveFrom ? Date.parse(mapping.effectiveFrom) : null
      const incumbent = seeds.get(mapping.unit.slug)
      if (!incumbent) {
        seeds.set(mapping.unit.slug, {
          slug: mapping.unit.slug,
          strongest,
          latestEffectiveFrom: fresh,
        })
      } else {
        if (isStronger(strongest, incumbent.strongest)) incumbent.strongest = strongest
        if (fresh != null && (incumbent.latestEffectiveFrom == null || fresh > incumbent.latestEffectiveFrom)) {
          incumbent.latestEffectiveFrom = fresh
        }
      }
    }
    for (const child of node.children) walk(child)
  }
  for (const node of nodes) walk(node)
  return seeds
}

/** Mapping-bearing branches in the pruned tree (ancestors kept for context). */
function countBranches(nodes: PublicCoverageNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countBranches(node.children), 0)
}

// ---------- Public read ----------

/**
 * The §16/§33/§22 exam page composition: header + §36 version windows, the
 * current (or explicitly requested started) version's mapping-bearing
 * coverage tree with the full §8 vocabulary, the ranked single-exam study
 * list, and §33 related-exam internal links.
 */
export async function getExamPage(ref: string, query: ExamPageQuery): Promise<ExamPage> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(query)

  // ---------- Exam detail — header, §36 windows, §16 path (§14 guard) ----------
  let detail: PublicExamDetail
  try {
    detail = await getPublicExam(ref, query)
  } catch (error) {
    if (error instanceof ExamError) throw mapExamError(error, 'EXAM_PAGE_FAILED')
    throw error
  }

  // ---------- Coverage — the requirement layer's public read, reused (§8/§36) ----------
  let coverage: PublicExamCoverage
  try {
    coverage = await getPublicExamCoverage(ref, {
      country: query.country,
      language: query.language,
      version: query.version,
    })
  } catch (error) {
    if (error instanceof ExamError) throw mapExamError(error, 'EXAM_PAGE_FAILED')
    throw error
  }

  // ---------- §33 related exams — the country's other ACTIVE exams ----------
  const relatedExams = await composeExamCards(context, {
    excludeSlug: detail.slug,
    limit: RELATED_EXAM_LIMIT,
  })

  // ---------- Ranked study list (§11 base ranking, §22 quick facts) ----------
  const studyList = await composeStudyList(coverage, context, query)

  // ---------- §36 selector input — STARTED windows only (future never public) ----------
  const startedVersions: ExamPage['versions'] = detail.versions
    .filter((version: ExamVersionRef) => !version.isUpcoming)
    .map((version) => ({
      id: version.id,
      label: version.label,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      isCurrent: version.isCurrent,
    }))

  // ---------- Assembly ----------
  return {
    exam: {
      slug: detail.slug,
      name: detail.name,
      code: detail.code,
      organiser: detail.organiser,
      level: detail.level,
      description: detail.description,
      countryIso: detail.countryIso,
      countryName: context.publicCountry.name,
    },
    version: coverage.version
      ? {
          id: coverage.version.id,
          label: coverage.version.label,
          effectiveFrom: coverage.version.effectiveFrom,
          effectiveTo: coverage.version.effectiveTo,
          isCurrent: coverage.version.isCurrent,
        }
      : null,
    versions: startedVersions,
    canonicalPath: detail.canonicalPath,
    breadcrumb: [
      { slug: null, name: 'Home', path: context.resolution.canonicalUrl },
      { slug: detail.slug, name: detail.name, path: examPath(context, detail.slug) },
    ],
    coverage: {
      unitCount: coverage.unitCount,
      mappingCount: coverage.mappingCount,
      branchCount: countBranches(coverage.nodes),
      nodes: coverage.nodes,
    },
    units: studyList,
    relatedExams: relatedExams.available ? relatedExams.items : [],
    language: detail.language,
  }
}

// ---------- Study list ----------

/**
 * The single-exam study list: every distinct mapped unit ONCE with its
 * strongest §8 requirement on the shown version, ranked by the §11 base
 * order (priority → likelihood → freshness → name → slug), presented with
 * the §22 quick-fact card (topic label, §16 path, cross-exam count — the
 * count is always TODAY's signal, even on a historical window read).
 */
async function composeStudyList(
  coverage: PublicExamCoverage,
  context: ReaderContext,
  query: ExamPageQuery
): Promise<ExamPage['units']> {
  const seeds = collectUnitSeeds(coverage.nodes)
  if (seeds.size === 0) return { items: [], total: 0 }

  // Re-fetch the coverage-filtered canonical rows (§14 scope re-applied —
  // the coverage read already filtered; this keeps the card composition safe).
  const unitRows = await db.knowledgeUnit.findMany({
    where: {
      slug: { in: [...seeds.keys()] },
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

  const entries: ExamPageUnit[] = []
  for (const seed of seeds.values()) {
    const card = cardBySlug.get(seed.slug)
    if (!card) continue // a unit hidden from this reader never appears
    entries.push({
      unit: card,
      requiredDepth: seed.strongest.requiredDepth,
      priority: seed.strongest.priority,
      questionLikelihood: seed.strongest.questionLikelihood,
      node: { name: seed.strongest.nodeName },
    })
  }

  // §11 base ranking: priority → likelihood → freshness → name → slug.
  entries.sort((a, b) => {
    const priorityDelta = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
    if (priorityDelta !== 0) return priorityDelta
    const likelihoodDelta =
      LIKELIHOOD_WEIGHT[b.questionLikelihood] - LIKELIHOOD_WEIGHT[a.questionLikelihood]
    if (likelihoodDelta !== 0) return likelihoodDelta
    const aFresh = seeds.get(a.unit.slug)?.latestEffectiveFrom ?? null
    const bFresh = seeds.get(b.unit.slug)?.latestEffectiveFrom ?? null
    if (aFresh !== bFresh) {
      if (aFresh == null) return 1 // freshness: newest first, never-attached last
      if (bFresh == null) return -1
      return bFresh - aFresh
    }
    return (
      a.unit.canonicalName.localeCompare(b.unit.canonicalName) ||
      a.unit.slug.localeCompare(b.unit.slug) // deterministic (§37)
    )
  })

  return { items: entries.slice(0, STUDY_LIST_LIMIT), total: entries.length }
}
