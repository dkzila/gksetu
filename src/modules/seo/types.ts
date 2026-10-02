/**
 * GKSetu — SEO module: public-surface DTOs (P4-S2/P4-S3)
 * Master Plan §33 (SEO landing pages — country GK hubs, evergreen topic
 * pages, topic clusters + internal links; P4-S3: exam pages and syllabus
 * pages), §34 (Homepage Strategy — each country homepage is that country's
 * GK/current-affairs index and discovery hub), §16 (canonical URLs generated
 * from country + language + object identity — never from user input; the
 * exam pattern `…/exams/{exam-slug}/` and the syllabus-topic pattern
 * `…/exams/{exam}/syllabus/{topic}/`), §14/§15 (explicit country scope
 * enforced server-side; COMING_SOON markets browse, never blocked),
 * §35 (only the country's own languages; canonical fallback labelled
 * honestly), §36 (lifecycle-aware — only VERIFIED units, ACTIVE exams,
 * CURRENT versions, in-effect mappings), §37 (client-agnostic JSON, no HTML
 * fragments — mobile-ready per §39), §38 (public app surface), §16
 * (P4-S5: structured data generated where valid — WebSite, WebPage,
 * CollectionPage, BreadcrumbList, Article/LearningResource on knowledge
 * pages; FAQPage and Quiz land with the P7 QnA/mock-test models).
 */
import type {
  MappingPriorityPublic,
  MappingRelevancePublic,
  PublicCoverageNode,
  QuestionLikelihoodPublic,
  RequiredDepthPublic,
} from '@/modules/exam-mapping'

/**
 * The §16 SEO block every public indexable composition ships (P4-S4):
 * canonical path, the hreflang alternate cluster (as §16 paths — §37
 * client-agnostic; clients/sitemap resolve them against an origin), the
 * x-default variant, the robots directive and an honest lastModified.
 */
export interface PageSeo {
  /** §16 canonical path of THIS representation (country + language + identity). */
  canonicalPath: string
  /** hreflang cluster — every variant of this surface incl. itself (§16/§35). */
  alternates: Array<{ hreflang: string; path: string }>
  /** x-default variant (the country's default language when in the cluster). */
  xDefaultPath: string | null
  /** noindex representations (e.g. §36 historical ?version= reads) say so. */
  robots: { index: boolean; follow: boolean; reason: string | null }
  /** W3C date-time of the last substantive change; null when unknown. */
  lastModified: string | null
}

/**
 * One schema.org JSON-LD node (P4-S5, §16 "structured data generated where
 * valid"). URL-bearing fields (`url`, `@id`, `item`, `image`) hold §16 PATHS —
 * the same origin-agnostic contract as PageSeo (§37): clients resolve them
 * against their origin at injection time, the validation layer asserts the
 * contract holds.
 */
export type JsonLdNode = { '@type': string | string[] } & Record<string, unknown>

/** The §16 structured-data block every public composition ships (P4-S5). */
export interface PageStructuredData {
  /**
   * The page's JSON-LD graph — injected as one `application/ld+json` script
   * (`{@context, @graph}`) by whichever client renders the page. Nodes carry
   * §16 paths per the JsonLdNode contract.
   */
  graph: JsonLdNode[]
}

/** §16 home URL prefix builder input (already country/language resolved). */
export type CountryStatusPublic = 'ACTIVE' | 'COMING_SOON'

/** The reader's language as exposed on every discovery surface (§35). */
export interface DiscoveryLanguage {
  code: string
  name: string
  nativeName: string | null
  direction: 'LTR' | 'RTL'
  /** §16 canonical home URL for this language inside the country. */
  url: string
  /** True when this is the country's default language (segment omitted §16). */
  isDefault: boolean
  /** SITE-S2 — PLANNED = announced ("Soon" chip), English-fallback content. */
  contentStatus: 'LIVE' | 'PLANNED'
}

/**
 * §34 homepage element: current affairs. P6 (Current Affairs event system)
 * fills the live branch; until then every homepage renders the honest quiet
 * state — the discovery hub never fakes freshness (§36/§45).
 */
export interface HomepageCurrentAffairsCard {
  slug: string
  title: string
  /** One-line hook — the canonical summary, or the lead representation's
   * opening when the resolved language has a published update. */
  summary: string | null
  lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
  eventDate: string
  /** §16 canonical event-page path in the reader's language. */
  canonicalPath: string
  /** Languages with a published representation (§35 — the honest set). */
  languagesAvailable: string[]
}

/** §34 homepage element: the latest published current-affairs events — the
 * P6-S2 discovery list (NOT the exam-aware feed; personalisation arrives
 * with P6-S4, §22 "current-affairs feed filtered by followed exams"). */
export interface HomepageCurrentAffairs {
  available: boolean
  /** The latest events with ≥1 published representation visible in the
   * reader's country, newest first (§37 deterministic). */
  items: HomepageCurrentAffairsCard[]
  /** Quiet-state note when available=false (COMING_SOON markets), else the
   * honest pointer to the personalised feed (P6-S4). */
  note: string | null
}

/**
 * §34 homepage element: the country's exam directory. Quiet (not empty) for
 * COMING_SOON markets — exam content is country-scoped (§14) and launches
 * with the market (§38); an ACTIVE country with no exams is an honest empty
 * list, not a quiet state.
 */
export interface ExamsSection<Card> {
  available: boolean
  reason: 'COUNTRY_COMING_SOON' | null
  items: Card[]
}

/** An exam card on the homepage (§34 "exams", §36 CURRENT version). */
export interface HomepageExamCard {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  /** The currently effective §36 version, if any. */
  currentVersion: { label: string; effectiveFrom: string } | null
  /** §8 in-effect mappings on the current version (the "how big is it today" signal). */
  mappingCount: number
  /** §16 canonical exam path in the reader's language. */
  canonicalPath: string
}

/** An exam card on a topic landing page — the exam needs units from this topic. */
export interface LandingExamCard {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  /** Distinct units under this topic's subtree that this exam needs today. */
  mappedUnitCount: number
  /** §16 canonical exam path in the reader's language. */
  canonicalPath: string
}

/** §34 "country GK categories": a top-level taxonomy domain (§13) as a hub card. */
export interface HomepageCategory {
  slug: string
  /** Localised label (requested language → country default → canonical). */
  name: string
  labelLanguage: string
  description: string | null
  /** §16 canonical topic-hub path (/gk/{slug}/ under the locale prefix). */
  canonicalPath: string
  /** Visible descendant topics (excluding the domain itself). */
  topicCount: number
  /** VERIFIED units visible under the whole subtree (§14 scope applied). */
  unitCount: number
  /** First-level branches — the §33 cluster preview / internal links. */
  children: Array<{
    slug: string
    name: string
    canonicalPath: string
    topicCount: number
    unitCount: number
  }>
}

/** §34 "major topics": the most content-bearing teachable topics. */
export interface HomepageTopicCard {
  slug: string
  name: string
  labelLanguage: string
  canonicalPath: string
  /** VERIFIED units under the subtree (same rule as category counts). */
  unitCount: number
  scope: 'GLOBAL' | 'COUNTRY'
  /** Breadcrumb labels from the domain down (§33 clusters). */
  path: Array<{ slug: string; name: string }>
}

/**
 * §34 "popular knowledge": a canonical unit teaser card. The summary follows
 * the §22 quick-fact resolution exactly — the published FACT_CARD in the
 * reader's language when it exists, otherwise the canonical summary with an
 * honest fallback marker (§35 — a homepage never pretends a translation
 * exists).
 */
export interface HomepageUnitCard {
  slug: string
  canonicalName: string
  type: string
  difficulty: string
  summary: {
    text: string
    source: 'FACT_CARD' | 'CANONICAL_SUMMARY'
    /** Language of the delivered summary text ('en' for canonical fallback). */
    language: string
  }
  topic: { slug: string; name: string }
  /** §16 canonical knowledge-page path in the reader's language. */
  canonicalPath: string
  /** §8 in-effect requirement rows today: distinct ACTIVE exams of the
   * reader's country needing this unit on CURRENT versions (§36/§14). */
  examCount: number
}

/** GET /api/home payload — the §34 country homepage composition. */
export interface CountryHomepage {
  country: {
    isoCode: string
    slug: string
    name: string
    timezone: string | null
    status: CountryStatusPublic
    isDefault: boolean
  }
  language: { code: string; name: string; nativeName: string | null; direction: 'LTR' | 'RTL' }
  /** §16 canonical home URL for this country × language. */
  canonicalUrl: string
  /** §16 SEO block (P4-S4) — canonical, hreflang cluster, robots, lastmod. */
  seo: PageSeo
  /** §16 structured-data graph (P4-S5) — Organization, WebSite + WebPage. */
  structuredData: PageStructuredData
  /** §35 language switcher — ONLY this country's configured languages. */
  languages: DiscoveryLanguage[]
  /** §34 GK categories (top-level §13 domains visible in this country). */
  categories: HomepageCategory[]
  /** §34 major topics. */
  majorTopics: HomepageTopicCard[]
  /** §34 exams (quiet for COMING_SOON markets). */
  exams: ExamsSection<HomepageExamCard>
  /** §34 popular knowledge (deterministic editorial order — orderIndex, name). */
  popularUnits: HomepageUnitCard[]
  /** §34 current affairs (honest quiet state until the P6 event system). */
  currentAffairs: HomepageCurrentAffairs
  /** Hub counters (visible topics, VERIFIED units, ACTIVE exams). */
  stats: { topics: number; units: number; exams: number }
}

// ---------- Topic landing pages (§33/§16) ----------

/** A visible child topic on a landing page (§33 cluster / internal link). */
export interface LandingChildTopic {
  slug: string
  name: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  /** VERIFIED units under this child's subtree. */
  unitCount: number
  /** Visible descendant topic count (excluding itself). */
  topicCount: number
  canonicalPath: string
}

/** §33 internal links: sibling topics of the landing topic. */
export interface LandingRelatedTopic {
  slug: string
  name: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  unitCount: number
  canonicalPath: string
}

export interface LandingUnitsSection {
  /** Units attached DIRECTLY to this topic (subtopics carry their own). */
  items: HomepageUnitCard[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

/** GET /api/topics/{slug} payload — the §16/§33 topic landing composition. */
export interface TopicLanding {
  topic: {
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    description: string | null
    type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
  }
  /** §16 canonical hub path in the reader's language. */
  canonicalPath: string
  /** §16 SEO block (P4-S4) — canonical, hreflang cluster, robots, lastmod. */
  seo: PageSeo
  /** §16 structured-data graph (P4-S5) — Organization, WebSite,
   * CollectionPage + BreadcrumbList. */
  structuredData: PageStructuredData
  /** Home → … → self, each entry with its own §16 path (null slug = home). */
  breadcrumb: Array<{ slug: string | null; name: string; path: string }>
  /** Visible children (§33 clusters) in stable tree order. */
  children: LandingChildTopic[]
  /** Units directly on this topic (paginated, §37). */
  units: LandingUnitsSection
  /** Exams whose current syllabus needs units under this topic's subtree. */
  exams: ExamsSection<LandingExamCard>
  /** §33 internal links — sibling topics under the same parent. */
  relatedTopics: LandingRelatedTopic[]
  /** Subtree counters (units under the whole subtree, visible topics, exams). */
  stats: { unitCount: number; topicCount: number; examCount: number }
}

// ---------- Exam page + syllabus-topic page (§16/§33, P4-S3) ----------

/**
 * One entry of the exam page's mapped-units study list: the §22 unit teaser
 * (quick fact, §16 path, cross-exam count) plus the unit's strongest §8
 * requirement on the shown version — priority → likelihood → depth; every
 * anchor stays visible in the coverage tree below.
 */
export interface ExamPageUnit {
  unit: HomepageUnitCard
  requiredDepth: RequiredDepthPublic
  priority: MappingPriorityPublic
  questionLikelihood: QuestionLikelihoodPublic
  /** The syllabus node anchoring the strongest requirement (§13). */
  node: { name: string }
}

/**
 * GET /api/exams/{ref}/page payload — the §16/§33 exam SEO page composition
 * (§22 "Exam overview: syllabus coverage"): header, §36 version windows,
 * the mapping-bearing coverage tree with the full §8 vocabulary, the ranked
 * single-exam study list and §33 internal links.
 */
export interface ExamPage {
  exam: {
    slug: string
    name: string
    code: string
    organiser: string
    level: 'NATIONAL' | 'STATE' | 'REGIONAL'
    description: string | null
    countryIso: string
    countryName: string
  }
  /** The shown window — CURRENT by default; an explicitly requested STARTED
   * version is the §36 historical read. Null when no window has started. */
  version:
    | { id: string; label: string; effectiveFrom: string; effectiveTo: string | null; isCurrent: boolean }
    | null
  /** §36 selector input — STARTED windows only (future versions are never
   * public); newest-effective first. */
  versions: Array<{
    id: string
    label: string
    effectiveFrom: string
    effectiveTo: string | null
    isCurrent: boolean
  }>
  /** §16 canonical exam path in the reader's language. */
  canonicalPath: string
  /** §16 SEO block (P4-S4) — canonical (always the current window's clean
   * path), hreflang cluster, robots (historical ?version= reads noindex),
   * lastmod (the shown window's effective date). */
  seo: PageSeo
  /** §16 structured-data graph (P4-S5) — Organization, WebSite,
   * CollectionPage + BreadcrumbList (the historical window renders the same
   * graph — it is served-but-noindex, never a second canonical). */
  structuredData: PageStructuredData
  /** Home → self, every crumb with its §16 path (null slug = home). */
  breadcrumb: Array<{ slug: string | null; name: string; path: string }>
  /** §22 syllabus coverage — mapping-bearing branches, full §8 vocabulary
   * (the requirement layer's public shape, reused verbatim). */
  coverage: {
    unitCount: number
    mappingCount: number
    branchCount: number
    nodes: PublicCoverageNode[]
  }
  /** The ranked study list (§11 base ranking: priority → likelihood →
   * freshness → name; capped, total shipped alongside). */
  units: { items: ExamPageUnit[]; total: number }
  /** §33 internal links — the reader country's other ACTIVE exams. */
  relatedExams: HomepageExamCard[]
  language: { code: string; name: string; nativeName: string | null }
}

/** One placement of a topic inside the exam's current syllabus tree. */
export interface SyllabusPlacement {
  /** The node linking the topic (§13 — the only exam→taxonomy bridge). */
  node: { name: string; priority: number }
  /** Ancestor node names, root first — where the node sits in the tree. */
  ancestors: Array<{ name: string }>
  /** Units mapped at this node (in-effect on the current version). */
  unitCount: number
}

/** One (unit × node) requirement row on the syllabus-topic page. */
export interface SyllabusRequirement {
  unit: HomepageUnitCard
  node: { name: string }
  requiredDepth: RequiredDepthPublic
  priority: MappingPriorityPublic
  relevance: MappingRelevancePublic
  questionLikelihood: QuestionLikelihoodPublic
  expectedScope: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
}

/**
 * GET /api/exams/{ref}/syllabus/{topic} payload — the §16 syllabus-topic
 * page (`…/exams/{exam}/syllabus/{topic}/`, "indexable when valuable"):
 * where a canonical topic sits in the exam's CURRENT syllabus, the units
 * required there with the full §8 vocabulary, and §33 internal links to the
 * exam's other syllabus topics + the evergreen topic hub.
 */
export interface SyllabusTopicPage {
  exam: {
    slug: string
    name: string
    code: string
    organiser: string
    level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  }
  /** The CURRENT version whose syllabus is shown — this is an SEO surface;
   * historical reads stay on the exam page's `?version=` coverage (§36). */
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null }
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string }
  /** §16 syllabus-topic path (…/exams/{exam}/syllabus/{topic}/). */
  canonicalPath: string
  /** §16 SEO block (P4-S4) — canonical, hreflang cluster, robots, lastmod. */
  seo: PageSeo
  /** §16 structured-data graph (P4-S5) — Organization, WebSite,
   * CollectionPage + BreadcrumbList (addressable crumbs only). */
  structuredData: PageStructuredData
  /** §16 exam-page path in the reader's language. */
  examPath: string
  /** §16 topic-hub path (…/gk/{topic}/) — the evergreen internal link. */
  topicHubPath: string
  /** Home → exam → Syllabus → self; non-addressable crumbs carry path null. */
  breadcrumb: Array<{ name: string; path: string | null }>
  placements: SyllabusPlacement[]
  requirements: SyllabusRequirement[]
  /** §33 internal links — the exam's other syllabus topics (current version). */
  relatedTopics: Array<{ slug: string; label: string; unitCount: number; canonicalPath: string }>
  stats: { unitCount: number; requirementCount: number; placementCount: number }
  language: { code: string; name: string; nativeName: string | null }
}
