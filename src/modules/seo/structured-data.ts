/**
 * GKSetu — SEO module: schema.org structured-data builders (P4-S5)
 * Master Plan §16 ("structured data generated where valid: Article, FAQPage
 * where eligible, BreadcrumbList, WebSite, WebPage, Quiz/educational schema
 * types where applicable"), §33 (metadata + semantic surfaces on every
 * indexable landing page), §22 (the knowledge page is the canonical reading
 * surface — its Article carries the record's own dates and language), §35
 * (each variant's graph names ITS language — inLanguage is the rendered
 * language, never the canonical one), §36 (dates are the honest lifecycle
 * dates — first/last publish, window effective dates), §37 (the graph ships
 * §16 PATHS in every URL-bearing field, exactly like the P4-S4 SEO block —
 * one URL model, many resolvers: the SPA head prefixes the origin at
 * injection, the validation layer asserts the contract).
 *
 * What is deliberately NOT emitted (§16 "where valid/where eligible"):
 * - FAQPage — no Q&A content model exists until the P7 QnA session; emitting
 *   it over non-Q&A prose would be invalid markup.
 * - Quiz — mock tests arrive in P7; no quiz surface exists to describe.
 * - WebSite.potentialAction (SearchAction) — §16 defines no crawlable search
 *   results path (search views are noindex by design); the sitelinks
 *   searchbox can only point at a real, indexable search landing page.
 * - VideoObject/NewsArticle — current-affairs event pages arrive in P6.
 */
import type { JsonLdNode } from './types'

// ---------- Shared constants ----------

/** The site-level identity used across every graph (§16 WebSite/Organization). */
export const SITE_NAME = 'GKSetu'

// ---------- Shared identity nodes ----------

/**
 * The site-level publisher node — identical on every surface and every
 * language variant (the organization is site-global, unlike the localized
 * WebSite node). `logo` is the static brand asset served at /icon.png.
 */
export function buildOrganizationNode(input: { siteName: string }): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': '/#organization',
    name: input.siteName,
    url: '/',
    logo: '/icon.png',
  }
}

/**
 * The localized WebSite node — `url` is the country home IN THE RENDERED
 * LANGUAGE (a Hindi page's graph names the /hi/ site view), so a language
 * variant's graph is internally consistent without cross-variant references.
 */
export function buildWebSiteNode(input: {
  siteName: string
  /** §16 home path in the rendered language (e.g. '/', '/hi/', '/uk/'). */
  homePath: string
  inLanguage: string
}): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': `${input.homePath}#website`,
    url: input.homePath,
    name: input.siteName,
    inLanguage: input.inLanguage,
    publisher: { '@id': '/#organization' },
  }
}

// ---------- Page nodes ----------

/** A WebPage/CollectionPage node for a structural surface. */
export function buildWebPageNode(input: {
  /** 'WebPage' (leaf) or 'CollectionPage' (hub listing other things). */
  type: 'WebPage' | 'CollectionPage'
  name: string
  description: string | null
  /** §16 path of this surface in the rendered language. */
  path: string
  inLanguage: string
  homePath: string
  /** Optional subject — the exam/topic the page is about. */
  about?: string | null
}): JsonLdNode {
  const node: JsonLdNode = {
    '@type': input.type,
    '@id': `${input.path}#webpage`,
    url: input.path,
    name: input.name,
    inLanguage: input.inLanguage,
    isPartOf: { '@id': `${input.homePath}#website` },
  }
  if (input.description) node.description = input.description
  if (input.about) node.about = { '@type': 'Thing', name: input.about }
  return node
}

/**
 * BreadcrumbList from a composition's breadcrumb trail (§33 clusters).
 * Addressable crumbs only (null-path crumbs are UI context, not locations);
 * the LAST item is always the page itself at its canonical path (the
 * schema.org convention). A payload whose trail already ends with the self
 * crumb (topic/exam pages) has it dropped and re-added canonically — one
 * self item, always last, never duplicated.
 */
export function buildBreadcrumbNode(input: {
  crumbs: Array<{ name: string; path: string | null }>
  /** §16 canonical path of THIS page (the final crumb). */
  selfPath: string
  /** Display name of the final crumb (the page itself). */
  selfName: string
}): JsonLdNode {
  const addressable = input.crumbs.filter(
    (crumb): crumb is { name: string; path: string } => !!crumb.path
  )
  const withoutSelf =
    addressable.length > 0 && addressable[addressable.length - 1].path === input.selfPath
      ? addressable.slice(0, -1)
      : addressable
  const items = [...withoutSelf, { name: input.selfName, path: input.selfPath }]
  return {
    '@type': 'BreadcrumbList',
    '@id': `${input.selfPath}#breadcrumb`,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.path,
    })),
  }
}

// ---------- Knowledge-page node (§22/§16 Article + educational schema) ----------

/**
 * The knowledge page's Article, double-typed as LearningResource (§16
 * "educational schema types where applicable" — the platform's knowledge
 * pages ARE study material for exam aspirants; the difficulty and unit-type
 * vocabulary maps directly onto educationalLevel/learningResourceType).
 *
 * Dates follow the P4-S4 lastmod semantics exactly: datePublished = the
 * earliest published revision shown on the page (falling back to the
 * record's creation), dateModified = the newest one (the same value as
 * PageSeo.lastModified — one truth, two fields).
 */
export function buildArticleNode(input: {
  headline: string
  description: string | null
  /** §16 path of this page in the rendered language. */
  path: string
  inLanguage: string
  homePath: string
  /** Topic label — the article's section (§13/§33 cluster context). */
  articleSection: string
  /** W3C date-time strings (already ISO). */
  datePublished: string | null
  dateModified: string | null
  /** §22/§23 vocabulary — the canonical unit's own classification. */
  learningResourceType: string
  educationalLevel: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  siteName: string
}): JsonLdNode {
  const node: JsonLdNode = {
    '@type': ['Article', 'LearningResource'],
    '@id': `${input.path}#article`,
    headline: input.headline,
    inLanguage: input.inLanguage,
    url: input.path,
    mainEntityOfPage: input.path,
    image: '/og.png',
    articleSection: input.articleSection,
    learningResourceType: input.learningResourceType,
    educationalLevel: input.educationalLevel,
    isPartOf: { '@id': `${input.homePath}#website` },
    author: { '@id': '/#organization' },
    publisher: { '@id': '/#organization' },
  }
  if (input.description) node.description = input.description
  if (input.datePublished) node.datePublished = input.datePublished
  if (input.dateModified) node.dateModified = input.dateModified
  return node
}

// ---------- Per-surface graphs ----------

/** The home graph: Organization + localized WebSite + WebPage (no breadcrumb —
 * the home IS the root of every trail). */
export function buildHomeGraph(input: {
  siteName: string
  homePath: string
  inLanguage: string
  name: string
  description: string | null
}): { graph: JsonLdNode[] } {
  return {
    graph: [
      buildOrganizationNode({ siteName: input.siteName }),
      buildWebSiteNode({
        siteName: input.siteName,
        homePath: input.homePath,
        inLanguage: input.inLanguage,
      }),
      buildWebPageNode({
        type: 'WebPage',
        name: input.name,
        description: input.description,
        path: input.homePath,
        inLanguage: input.inLanguage,
        homePath: input.homePath,
      }),
    ],
  }
}

/** A structural hub graph: Organization + WebSite + CollectionPage +
 * BreadcrumbList (topic landing, exam page, syllabus-topic page). */
export function buildHubGraph(input: {
  siteName: string
  homePath: string
  inLanguage: string
  name: string
  /** Display name of the page itself (the final breadcrumb crumb). */
  selfName: string
  description: string | null
  about?: string | null
  path: string
  crumbs: Array<{ name: string; path: string | null }>
}): { graph: JsonLdNode[] } {
  return {
    graph: [
      buildOrganizationNode({ siteName: input.siteName }),
      buildWebSiteNode({
        siteName: input.siteName,
        homePath: input.homePath,
        inLanguage: input.inLanguage,
      }),
      buildWebPageNode({
        type: 'CollectionPage',
        name: input.name,
        description: input.description,
        path: input.path,
        inLanguage: input.inLanguage,
        homePath: input.homePath,
        about: input.about ?? null,
      }),
      buildBreadcrumbNode({ crumbs: input.crumbs, selfPath: input.path, selfName: input.selfName }),
    ],
  }
}

/** The knowledge-page graph: Organization + WebSite + BreadcrumbList +
 * Article/LearningResource. */
export function buildKnowledgeGraph(input: {
  siteName: string
  homePath: string
  inLanguage: string
  /** Home → …topic → self (the reader trail; topic crumbs get §16 hub paths). */
  crumbs: Array<{ name: string; path: string | null }>
  article: Parameters<typeof buildArticleNode>[0]
}): { graph: JsonLdNode[] } {
  return {
    graph: [
      buildOrganizationNode({ siteName: input.siteName }),
      buildWebSiteNode({
        siteName: input.siteName,
        homePath: input.homePath,
        inLanguage: input.inLanguage,
      }),
      buildBreadcrumbNode({
        crumbs: input.crumbs,
        selfPath: input.article.path,
        selfName: input.article.headline,
      }),
      buildArticleNode(input.article),
    ],
  }
}

// ---------- Current-affairs event page (P6-S2, §12/§16 NewsArticle) ----------

/**
 * The event page's NewsArticle (§16 "Structured data generated where valid:
 * Article" — an event's published updates are news coverage of a real-world
 * occurrence; dateline carries §6 location, and the dates follow the P4-S4
 * semantics: datePublished = the earliest published representation shown,
 * dateModified = the newest — the same value as PageSeo.lastModified).
 */
function buildNewsArticleNode(input: {
  headline: string
  description: string | null
  path: string
  inLanguage: string
  homePath: string
  articleSection: string
  dateline: string | null
  datePublished: string | null
  dateModified: string | null
  siteName: string
}): JsonLdNode {
  const node: JsonLdNode = {
    '@type': 'NewsArticle',
    '@id': `${input.path}#article`,
    headline: input.headline,
    inLanguage: input.inLanguage,
    url: input.path,
    mainEntityOfPage: input.path,
    image: '/og.png',
    articleSection: input.articleSection,
    isPartOf: { '@id': `${input.homePath}#website` },
    author: { '@id': '/#organization' },
    publisher: { '@id': '/#organization' },
  }
  if (input.description) node.description = input.description
  if (input.dateline) node.dateline = input.dateline
  if (input.datePublished) node.datePublished = input.datePublished
  if (input.dateModified) node.dateModified = input.dateModified
  return node
}

/** The event-page graph: Organization + WebSite + BreadcrumbList + NewsArticle. */
export function buildEventGraph(input: {
  siteName: string
  homePath: string
  inLanguage: string
  crumbs: Array<{ name: string; path: string | null }>
  article: Parameters<typeof buildNewsArticleNode>[0]
}): { graph: JsonLdNode[] } {
  return {
    graph: [
      buildOrganizationNode({ siteName: input.siteName }),
      buildWebSiteNode({
        siteName: input.siteName,
        homePath: input.homePath,
        inLanguage: input.inLanguage,
      }),
      buildBreadcrumbNode({
        crumbs: input.crumbs,
        selfPath: input.article.path,
        selfName: input.article.headline,
      }),
      buildNewsArticleNode(input.article),
    ],
  }
}
