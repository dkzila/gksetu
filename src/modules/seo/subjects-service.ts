/**
 * GKSetu — SEO module: subjects directory composition (SITE-S1)
 * Master Plan §13/§14 (one global taxonomy with country extensions; explicit
 * country scope enforced server-side on every query), §16 (every path built
 * via the shared composition builders — never from user input), §34 (the
 * subjects directory is the library-browsing counterpart of the exam
 * directory), §35 (reader-language labels with honest fallback — never a
 * fake translation), §36 (lifecycle-aware reads — VERIFIED units, ACTIVE
 * exams, CURRENT versions, in-effect mappings), §37 (deterministic ordering,
 * client-agnostic DTO), §38 (public app surface).
 *
 * The /subjects/ surface (site-overhaul plan Task 8): every root DOMAIN of
 * the market's visible taxonomy tree EXCEPT `current-affairs` (the events
 * anchor keeps its own dedicated page + nav item). Each entry carries what a
 * browser needs to choose a subject — the reader-language description, the
 * VERIFIED knowledge-page and subtopic counts of its subtree, and the count
 * of ACTIVE exams whose CURRENT syllabus reaches into the subtree (the same
 * §8/§36 liveness as composeExamCards, batched — the India corpus is 135+
 * exams, no per-subject N+1). SITE-S2 seeds the full 20-subject corpus;
 * this composition is ready for it unchanged.
 */
import { z } from 'zod'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { mappingInEffect } from '@/modules/exam-mapping'
import type { PublicTopicDetail } from '@/modules/taxonomy'
import { getPublicTopic, getPublicTree, TaxonomyError } from '@/modules/taxonomy'

import {
  flattenTree,
  isCurrentVersion,
  loadUnitCountByTopic,
  localePath,
  resolveReaderContext,
  subtreeCounts,
  visibleUnitsWhere,
} from './composition-helpers'
import type { ReaderContext } from './composition-helpers'
import { buildPageSeo } from './page-seo'
import type { PageSeo } from './types'

// ---------- Constants ----------

/**
 * The events anchor (Task 8): `current-affairs` stays in the taxonomy as the
 * Current Affairs page's topic tree, but never appears as a subject card —
 * it has its own dedicated page + nav item.
 */
const CURRENT_AFFAIRS_SLUG = 'current-affairs'

/** How many BRANCH children each entry previews (the card chips). */
const CHILDREN_PREVIEW_LIMIT = 4

// ---------- DTO (§37 client-agnostic contract) ----------

/** One subject card of the directory. */
export interface SubjectsDirectoryEntry {
  slug: string
  /** Localised name (requested language → country default → canonical). */
  name: string
  /** Reader-language label description → English label → canonical (§35). */
  description: string | null
  /** VERIFIED units visible under the whole subtree (§14 scope applied). */
  unitCount: number
  /** Visible descendant topics (excluding the domain itself). */
  topicCount: number
  /**
   * ACTIVE exams of the reader's country whose CURRENT version carries ≥1
   * in-effect ExamMapping on a syllabus node whose topic lies inside this
   * subject's subtree (§8/§36 — the composeExamCards liveness).
   */
  examCount: number
  /** First BRANCH children by orderIndex — the card chips. */
  children: Array<{ slug: string; name: string; unitCount: number }>
}

/** GET /api/subjects payload — the whole directory for one market. */
export interface SubjectsDirectory {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  subjects: SubjectsDirectoryEntry[]
  seo: PageSeo
}

// ---------- Query schema ----------
// (Homepage-query shape, self-contained: the module's shared validation.ts
// is outside this file's ownership — same country/language routing hints.)

/** GET /api/subjects query — ?country=&language= (both optional). */
export const subjectsQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type SubjectsQuery = z.infer<typeof subjectsQuerySchema>

// ---------- Public read ----------

/**
 * The /subjects/ directory composition for one country × language context.
 * Unknown/INACTIVE countries surface as the typed 404 (resolveReaderContext);
 * COMING_SOON markets resolve with their (global) subjects and honest zero
 * exam counts (§15 — data scoping, not a wall).
 */
export async function getSubjectsDirectory(input: SubjectsQuery): Promise<SubjectsDirectory> {
  // §29: public + user-independent → 60s in-memory TTL (the homepage
  // precedent — the dev sandbox's pooler latency makes the TTL essential).
  const cacheKey = `seo:subjects:${input.country ?? 'default'}:${input.language ?? 'default'}`
  return cachedPayload(cacheKey, () => loadSubjectsDirectory(input))
}

async function loadSubjectsDirectory(input: SubjectsQuery): Promise<SubjectsDirectory> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(input)

  // ---------- The visible taxonomy (§13/§14 — snapshot-cached) ----------
  // Roots arrive in the taxonomy snapshot's deterministic order (orderIndex
  // asc, then canonicalName — see taxonomy/cache.ts loadSnapshot), which IS
  // the directory's required subject ordering; children inherit the same
  // sibling order, so the BRANCH preview slice is already orderIndex-sorted.
  const tree = await getPublicTree({ country: input.country, language: input.language })

  // Task 8: every root DOMAIN except the current-affairs anchor.
  const subjectRoots = tree.filter((root) => root.slug !== CURRENT_AFFAIRS_SLUG)

  const flat = flattenTree(tree)
  const unitCountByTopic = await loadUnitCountByTopic(
    flat.map((entry) => entry.node.id),
    context.countryRow.id
  )

  // ---------- Reader-language descriptions (§35 honest fallback) ----------
  // The per-root detail walk is the getCountryHomepage precedent — labels
  // with their descriptions come from the same taxonomy snapshot, so this
  // costs no additional database round-trips.
  const details = await Promise.all(
    subjectRoots.map(async (root) => {
      try {
        return await getPublicTopic(root.slug, {
          country: input.country,
          language: input.language,
        })
      } catch (error) {
        if (error instanceof TaxonomyError) return null
        throw error
      }
    })
  )

  // ---------- §8 exam counts per subject (batched — no per-subject N+1) ----------
  // Which subject's subtree each visible topic id belongs to. Tree subtrees
  // are disjoint (one parent per node); the current-affairs subtree and
  // nodes without a taxonomy link simply never enter the map.
  const subjectSlugByTopicId = new Map<string, string>()
  for (const root of subjectRoots) {
    for (const entry of flattenTree([root])) {
      subjectSlugByTopicId.set(entry.node.id, root.slug)
    }
  }
  const examCountBySubject = await loadExamCountBySubject(context, subjectSlugByTopicId)

  // ---------- Assembly (§37 deterministic DTO) ----------
  const subjects: SubjectsDirectoryEntry[] = subjectRoots.map((root, index) => {
    const counts = subtreeCounts(root, unitCountByTopic)
    return {
      slug: root.slug,
      name: root.label,
      description: resolveSubjectDescription(details[index], context.languageCode),
      unitCount: counts.unitCount,
      topicCount: counts.topicCount,
      examCount: examCountBySubject.get(root.slug) ?? 0,
      children: root.children
        .filter((child) => child.type === 'BRANCH')
        .slice(0, CHILDREN_PREVIEW_LIMIT)
        .map((child) => ({
          slug: child.slug,
          name: child.label,
          unitCount: subtreeCounts(child, unitCountByTopic).unitCount,
        })),
    }
  })

  // ---------- §16 SEO block ----------
  // Structural surface: every country-configured language carries a real
  // /subjects/ representation (§35) — the whole language set is the hreflang
  // cluster. lastmod = the newest visible VERIFIED unit update (the same
  // substance measure as the homepage hub).
  const visibleTopicIds = flat.map((entry) => entry.node.id)
  const latestUnit =
    visibleTopicIds.length > 0
      ? await db.knowledgeUnit.aggregate({
          _max: { updatedAt: true },
          where: visibleUnitsWhere(visibleTopicIds, context.countryRow.id),
        })
      : null

  const seo = buildPageSeo({
    country: {
      slug: context.publicCountry.slug,
      isDefault: context.publicCountry.isDefault,
    },
    defaultLanguageCode: context.defaultLanguageCode,
    languageCode: context.languageCode,
    languages: context.publicCountry.languages,
    pathFor: (code) => localePath(context, code, ['subjects']),
    lastModified: latestUnit?._max.updatedAt ?? null,
  })

  return {
    country: { isoCode: context.publicCountry.isoCode, name: context.publicCountry.name },
    language: { code: context.resolution.language.code, name: context.resolution.language.name },
    subjects,
    seo,
  }
}

// ---------- Internal helpers ----------

/**
 * §35 honest description resolution: the reader-language TopicLabel
 * description, then the English label description, then the canonical
 * (English-reference) topic description. A label without a description
 * falls through — never a machine translation.
 */
function resolveSubjectDescription(
  detail: PublicTopicDetail | null,
  readerLanguage: string
): string | null {
  if (!detail) return null
  const byLanguage = new Map(detail.labels.map((label) => [label.language, label]))
  return (
    byLanguage.get(readerLanguage)?.description ??
    byLanguage.get('en')?.description ??
    detail.node.description
  )
}

/**
 * Per-subject count of ACTIVE exams whose CURRENT version carries ≥1
 * in-effect ExamMapping on a syllabus node whose topic lies inside that
 * subject's subtree — the identical §8/§36 liveness to composeExamCards
 * (CURRENT version via isCurrentVersion/windowContains, in-effect mapping
 * via mappingInEffect), answered in TWO batched queries regardless of
 * subject count. COMING_SOON markets get the quiet zero (exam content
 * launches with the market — §14/§38).
 */
async function loadExamCountBySubject(
  context: ReaderContext,
  subjectSlugByTopicId: Map<string, string>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!context.countryActive) return counts

  // §36: the country's ACTIVE exams with their version windows — one query.
  const examRows = await db.exam.findMany({
    where: { countryId: context.countryRow.id, status: 'ACTIVE' },
    select: {
      id: true,
      versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
    },
  })

  // CURRENT version per exam (§36 — the version effective today; newest
  // effectiveFrom wins among overlapping windows, the composeExamCards rule).
  const examIdByVersion = new Map<string, string>()
  for (const exam of examRows) {
    const current = exam.versions
      .filter(isCurrentVersion)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
    if (current) examIdByVersion.set(current.id, exam.id)
  }
  if (examIdByVersion.size === 0) return counts

  // §8 in-effect mappings on those CURRENT versions, carrying the node's
  // canonical topic — one batched query.
  const mappings = await db.examMapping.findMany({
    where: { syllabusNode: { examVersionId: { in: [...examIdByVersion.keys()] } } },
    select: {
      effectiveFrom: true,
      effectiveTo: true,
      syllabusNode: { select: { examVersionId: true, topicId: true } },
    },
  })

  const examsBySubject = new Map<string, Set<string>>()
  for (const mapping of mappings) {
    if (!mappingInEffect(mapping, false)) continue
    const node = mapping.syllabusNode
    const subjectSlug = node.topicId != null ? subjectSlugByTopicId.get(node.topicId) : undefined
    const examId = examIdByVersion.get(node.examVersionId)
    if (!subjectSlug || !examId) continue
    const set = examsBySubject.get(subjectSlug) ?? new Set<string>()
    set.add(examId)
    examsBySubject.set(subjectSlug, set)
  }
  for (const [subjectSlug, examIds] of examsBySubject) {
    counts.set(subjectSlug, examIds.size)
  }
  return counts
}
