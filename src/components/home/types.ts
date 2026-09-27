'use client'

/**
 * GlobIQ — discovery surface client types (P4-S2)
 *
 * Client mirrors of the public API contracts (§37 — the same payloads a
 * future mobile client consumes, §39). Kept hand-written (not imported from
 * server modules) so the client bundle never pulls server code.
 */

// ---------- GET /api/countries ----------

export interface ApiCountryLanguage {
  code: string
  name: string
  nativeName: string | null
  direction: 'LTR' | 'RTL'
  /** §16 canonical home URL for this language inside the country. */
  url: string
}

export interface ApiCountry {
  isoCode: string
  slug: string
  name: string
  timezone: string | null
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: ApiCountryLanguage[]
}

// ---------- GET /api/home (§34) ----------

export interface HomeUnitCard {
  slug: string
  canonicalName: string
  type: string
  difficulty: string
  summary: {
    text: string
    source: 'FACT_CARD' | 'CANONICAL_SUMMARY'
    language: string
  }
  topic: { slug: string; name: string }
  canonicalPath: string
  examCount: number
}

export interface HomeExamCard {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  currentVersion: { label: string; effectiveFrom: string } | null
  mappingCount: number
  canonicalPath: string
}

export interface HomeCategory {
  slug: string
  name: string
  labelLanguage: string
  description: string | null
  canonicalPath: string
  topicCount: number
  unitCount: number
  children: Array<{
    slug: string
    name: string
    canonicalPath: string
    topicCount: number
    unitCount: number
  }>
}

export interface HomeTopicCard {
  slug: string
  name: string
  labelLanguage: string
  canonicalPath: string
  unitCount: number
  scope: 'GLOBAL' | 'COUNTRY'
  path: Array<{ slug: string; name: string }>
}

export interface CountryHomepage {
  country: {
    isoCode: string
    slug: string
    name: string
    timezone: string | null
    status: 'ACTIVE' | 'COMING_SOON'
    isDefault: boolean
  }
  language: {
    code: string
    name: string
    nativeName: string | null
    direction: 'LTR' | 'RTL'
  }
  canonicalUrl: string
  languages: Array<{
    code: string
    name: string
    nativeName: string | null
    direction: 'LTR' | 'RTL'
    url: string
    isDefault: boolean
  }>
  categories: HomeCategory[]
  majorTopics: HomeTopicCard[]
  exams: {
    available: boolean
    reason: 'COUNTRY_COMING_SOON' | null
    items: HomeExamCard[]
  }
  popularUnits: HomeUnitCard[]
  currentAffairs: { available: false; note: string }
  stats: { topics: number; units: number; exams: number }
}

// ---------- GET /api/topics/{slug} (§33) ----------

export interface LandingChildTopic {
  slug: string
  name: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  unitCount: number
  topicCount: number
  canonicalPath: string
}

export interface LandingExamCard {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  mappedUnitCount: number
  canonicalPath: string
}

export interface LandingRelatedTopic {
  slug: string
  name: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  unitCount: number
  canonicalPath: string
}

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
  canonicalPath: string
  breadcrumb: Array<{ slug: string | null; name: string; path: string }>
  children: LandingChildTopic[]
  units: {
    items: HomeUnitCard[]
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
  }
  exams: {
    available: boolean
    reason: 'COUNTRY_COMING_SOON' | null
    items: LandingExamCard[]
  }
  relatedTopics: LandingRelatedTopic[]
  stats: { unitCount: number; topicCount: number; examCount: number }
}

// ---------- GET /api/exams/{ref}/page (§16/§33, P4-S3) ----------

export interface ExamCoverageNode {
  name: string
  depth: number
  priority: number
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  mappings: Array<{
    unit: {
      slug: string
      canonicalName: string
      canonicalSummary: string | null
      type: string
      difficulty: string
    }
    canonicalPath: string
    requiredDepth: 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
    priority: 'CORE' | 'SUPPORTING' | 'LOW'
    relevance: 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
    expectedScope: string | null
    questionLikelihood: 'HIGH' | 'MEDIUM' | 'LOW'
    effectiveFrom: string | null
    effectiveTo: string | null
  }>
  children: ExamCoverageNode[]
}

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
  version: {
    id: string
    label: string
    effectiveFrom: string
    effectiveTo: string | null
    isCurrent: boolean
  } | null
  versions: Array<{
    id: string
    label: string
    effectiveFrom: string
    effectiveTo: string | null
    isCurrent: boolean
  }>
  canonicalPath: string
  breadcrumb: Array<{ slug: string | null; name: string; path: string }>
  coverage: {
    unitCount: number
    mappingCount: number
    branchCount: number
    nodes: ExamCoverageNode[]
  }
  units: {
    items: Array<{
      unit: HomeUnitCard
      requiredDepth: 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
      priority: 'CORE' | 'SUPPORTING' | 'LOW'
      questionLikelihood: 'HIGH' | 'MEDIUM' | 'LOW'
      node: { name: string }
    }>
    total: number
  }
  relatedExams: HomeExamCard[]
  language: { code: string; name: string; nativeName: string | null }
}

// ---------- GET /api/exams/{ref}/syllabus/{topic} (§16, P4-S3) ----------

export interface SyllabusTopicPage {
  exam: {
    slug: string
    name: string
    code: string
    organiser: string
    level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  }
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null }
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string }
  canonicalPath: string
  examPath: string
  topicHubPath: string
  /** Non-addressable crumbs carry path null (rendered as plain spans). */
  breadcrumb: Array<{ name: string; path: string | null }>
  placements: Array<{
    node: { name: string; priority: number }
    ancestors: Array<{ name: string }>
    unitCount: number
  }>
  requirements: Array<{
    unit: HomeUnitCard
    node: { name: string }
    requiredDepth: 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
    priority: 'CORE' | 'SUPPORTING' | 'LOW'
    relevance: 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
    questionLikelihood: 'HIGH' | 'MEDIUM' | 'LOW'
    expectedScope: string | null
    effectiveFrom: string | null
    effectiveTo: string | null
  }>
  relatedTopics: Array<{ slug: string; label: string; unitCount: number; canonicalPath: string }>
  stats: { unitCount: number; requirementCount: number; placementCount: number }
  language: { code: string; name: string; nativeName: string | null }
}

// ---------- API envelope ----------

export interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}
