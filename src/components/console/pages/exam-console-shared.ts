'use client'

/**
 * GKSetu Console — Exams shared helpers (CONSOLE-S1-E).
 *
 * The small utilities the exams list, exam detail (versions / syllabus /
 * mappings) pages share: slug/code presentation helpers, tree flatteners for
 * parent + node selects, §8 vocabulary option lists and the public country /
 * taxonomy fetches the dialogs need. Types come straight from the modules
 * (§37 client-agnostic contract) — nothing is duplicated.
 */
import type { AdminMappingNode, AdminMapping } from '@/modules/exam-mapping'
import type { AdminSyllabusNode } from '@/modules/exams-syllabus'

// ---------- Presentation helpers ----------

/** Lowercase kebab slug (matches the API's slug pattern as you type). */
export function slugify(value: string, max = 96): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

/** Uppercase code slug (matches the API's CODE pattern, e.g. "UPSC-CSE"). */
export function codify(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** ISO date → `YYYY-MM-DD` (the §36 windows are day-granular). */
export function fmtDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '—'
}

// ---------- Tree flatteners (parent / node selects) ----------

export interface FlatSyllabusEntry {
  node: AdminSyllabusNode
  depth: number
}

export function flattenSyllabusNodes(
  nodes: AdminSyllabusNode[],
  depth = 0,
  out: FlatSyllabusEntry[] = []
): FlatSyllabusEntry[] {
  for (const node of nodes) {
    out.push({ node, depth })
    flattenSyllabusNodes(node.children, depth + 1, out)
  }
  return out
}

export interface FlatMappingEntry {
  node: AdminMappingNode
  depth: number
}

export function flattenMappingNodes(
  nodes: AdminMappingNode[],
  depth = 0,
  out: FlatMappingEntry[] = []
): FlatMappingEntry[] {
  for (const node of nodes) {
    out.push({ node, depth })
    flattenMappingNodes(node.children, depth + 1, out)
  }
  return out
}

/** Every mapping row of a version, flattened with its owning node's name. */
export function flattenMappings(
  nodes: AdminMappingNode[],
  out: Array<{ mapping: AdminMapping; nodeName: string; nodeDepth: number }> = []
): Array<{ mapping: AdminMapping; nodeName: string; nodeDepth: number }> {
  for (const node of nodes) {
    for (const mapping of node.mappings) out.push({ mapping, nodeName: node.name, nodeDepth: node.depth })
    flattenMappings(node.children, out)
  }
  return out
}

// ---------- §8 vocabulary (option lists for the mapping dialog) ----------

export const RELEVANCE_OPTIONS = [
  { value: 'DIRECT', label: 'Direct — core syllabus wording' },
  { value: 'PARTIAL', label: 'Partial — one aspect of the unit' },
  { value: 'CONTEXTUAL', label: 'Contextual — background only' },
] as const

export const PRIORITY_OPTIONS = [
  { value: 'CORE', label: 'Core' },
  { value: 'SUPPORTING', label: 'Supporting' },
  { value: 'LOW', label: 'Low' },
] as const

export const DEPTH_OPTIONS = [
  { value: 'ONE_LINE', label: 'One line' },
  { value: 'FACT', label: 'Fact' },
  { value: 'CONCEPT', label: 'Concept' },
  { value: 'DETAILED', label: 'Detailed' },
  { value: 'ANALYTICAL', label: 'Analytical' },
] as const

export const LIKELIHOOD_OPTIONS = [
  { value: 'HIGH', label: 'Often asked' },
  { value: 'MEDIUM', label: 'Sometimes asked' },
  { value: 'LOW', label: 'Rarely asked' },
] as const

export const DEPTH_SHORT: Record<string, string> = {
  ONE_LINE: '1-line',
  FACT: 'Fact',
  CONCEPT: 'Concept',
  DETAILED: 'Detailed',
  ANALYTICAL: 'Analytical',
}

// ---------- Reference fetches (public, unauthenticated) ----------

export interface CountryRef {
  isoCode: string
  name: string
  status: string
}

/** Active countries for the create-exam / taxonomy country selects. */
export async function fetchActiveCountries(): Promise<CountryRef[]> {
  try {
    const response = await fetch('/api/countries', { cache: 'no-store' })
    const payload = (await response.json()) as {
      status: 'ok' | 'error'
      data?: { countries: CountryRef[] }
    }
    if (payload.status === 'ok' && payload.data) {
      return payload.data.countries.filter((country) => country.status === 'ACTIVE')
    }
  } catch {
    // fall through — callers render an empty country list
  }
  return []
}

export interface TopicOption {
  id: string
  slug: string
  label: string
  depth: number
}

/**
 * The ACTIVE public taxonomy of a country, flattened for the syllabus node's
 * canonical topic link (§13 — the only exam → taxonomy bridge).
 */
export async function fetchTopicOptions(countryIso: string): Promise<TopicOption[]> {
  try {
    const response = await fetch(`/api/taxonomy/tree?country=${encodeURIComponent(countryIso)}`, {
      cache: 'no-store',
    })
    const payload = (await response.json()) as {
      status: 'ok' | 'error'
      data?: { tree: PublicTopicNodeLite[] }
    }
    if (payload.status === 'ok' && payload.data) {
      return flattenTopicTree(payload.data.tree)
    }
  } catch {
    // fall through — the topic select just offers "none"
  }
  return []
}

interface PublicTopicNodeLite {
  id: string
  slug: string
  canonicalName: string
  label: string
  children: PublicTopicNodeLite[]
}

function flattenTopicTree(nodes: PublicTopicNodeLite[], depth = 0, out: TopicOption[] = []): TopicOption[] {
  for (const node of nodes) {
    out.push({ id: node.id, slug: node.slug, label: `${'· '.repeat(depth)}${node.label}`, depth })
    flattenTopicTree(node.children, depth + 1, out)
  }
  return out
}
