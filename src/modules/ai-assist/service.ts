/**
 * GlobIQ — AI assist: the §26 service (P10-S4, SERVER-ONLY)
 *
 * Imported EXCLUSIVELY by /api/ai-assist/[task] — pulls the z-ai SDK through
 * ./ai-model (the off-barrel constraint). Three assists, all judgment-over-
 * platform-records (§26 — the model never invents entities):
 *
 *  - classify: rank taxonomy topic nodes for a draft (the market's live
 *    visible tree is the candidate universe — §13/§14/§35).
 *  - map: rank syllabus nodes of an exam's CURRENT version for a unit (§6/§8
 *    — mapping is a relationship, the assist only proposes candidates).
 *  - dedup: near-duplicate unit detection — a pg_trgm pre-filter narrows the
 *    universe (§17's engine family), the model judges each candidate.
 *
 * Every result carries the AI_ASSIST_CONTRACT line; nothing is auto-applied;
 * every call is audited (ai.assist) by the route.
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import { getPublicTree } from '@/modules/taxonomy'
import { getPublicExamSyllabus } from '@/modules/exams-syllabus'

import { boundedString, completeJson, stringArray } from './ai-model'
import {
  AI_ASSIST_CONTRACT,
  AiAssistError,
  type ClassificationResult,
  type ClassificationSuggestion,
  type DedupResult,
  type DedupVerdict,
  type MappingResult,
  type MappingSuggestion,
} from './index'

const MODEL_LABEL = 'z-ai (§26 classification/mapping/dedup assist)'

interface TreeLike {
  id: string
  slug: string
  labels?: Array<{ label?: string }>
  children?: TreeLike[]
}

/** Flattens the public taxonomy tree into labelled path candidates. */
function flattenTree(nodes: TreeLike[], prefix: string): Array<{ nodeId: string; slug: string; path: string }> {
  const out: Array<{ nodeId: string; slug: string; path: string }> = []
  for (const node of nodes) {
    const label = node.labels?.[0]?.label ?? node.slug
    const path = prefix ? `${prefix} › ${label}` : label
    out.push({ nodeId: node.id, slug: node.slug, path })
    if (node.children?.length) out.push(...flattenTree(node.children, path))
  }
  return out
}

// ---------- 1. Classification ----------

export async function classifyAssist(
  actor: Actor,
  input: { title: string; body: string; countryIso?: string; languageCode?: string }
): Promise<ClassificationResult> {
  assertCan(actor, 'taxonomy:manage')
  const title = input.title.trim().slice(0, 300)
  const body = input.body.trim().slice(0, 4000)
  if (!title || !body) {
    throw new AiAssistError('AI_ASSIST_VALIDATION', 'Both a title and a body are required for a classification suggestion')
  }

  const tree = await getPublicTree({ country: input.countryIso, language: input.languageCode })
  const candidates = flattenTree(tree as TreeLike[], '')
  if (candidates.length === 0) {
    throw new AiAssistError('AI_ASSIST_NO_CANDIDATES', 'The taxonomy has no visible nodes for this market context')
  }

  const candidateLines = candidates.map((c, i) => `${i + 1}. ${c.path} (slug: ${c.slug})`).join('\n')
  const reply = await completeJson(
    [
      'You are an editorial assistant for GlobIQ, an exam-preparation knowledge platform.',
      'Task: rank the BEST taxonomy topic nodes for the draft content below.',
      'Hard rules:',
      '1. Choose ONLY from the numbered candidate nodes — never invent a node.',
      '2. Return the top 3 (or fewer when genuinely unsure), best first.',
      '3. For each: a one-sentence reason grounded in the draft content.',
      '4. Output ONLY JSON: {"ranked": [{"index": number, "reason": string}]}',
    ].join('\n'),
    [`DRAFT TITLE: ${title}`, '', `DRAFT BODY (excerpt): ${body}`, '', 'CANDIDATE NODES:', candidateLines].join('\n')
  )

  const ranked = Array.isArray(reply.ranked) ? reply.ranked : []
  const suggestions: ClassificationSuggestion[] = []
  for (const entry of ranked.slice(0, 3)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { index?: unknown; reason?: unknown }
    const index = typeof record.index === 'number' ? Math.trunc(record.index) : -1
    const candidate = candidates[index - 1]
    if (!candidate) continue
    suggestions.push({
      nodeId: candidate.nodeId,
      slug: candidate.slug,
      path: candidate.path,
      reason: boundedString(record.reason, 400) ?? 'No reason given',
    })
  }

  return { suggestions, candidateCount: candidates.length, contract: AI_ASSIST_CONTRACT, model: MODEL_LABEL }
}

// ---------- 2. Exam mapping ----------

export async function mappingAssist(
  actor: Actor,
  input: { unitSlug: string; examRef: string; countryIso?: string; languageCode?: string }
): Promise<MappingResult> {
  assertCan(actor, 'exam:manage')
  const unit = await db.knowledgeUnit.findUnique({
    where: { slug: input.unitSlug.trim() },
    select: { id: true, slug: true, canonicalName: true, canonicalSummary: true, status: true },
  })
  if (!unit) {
    throw new AiAssistError('AI_ASSIST_VALIDATION', `Unknown knowledge unit "${input.unitSlug}" — mapping needs a real unit (§6)`)
  }

  const syllabus = await getPublicExamSyllabus(input.examRef.trim(), {
    country: input.countryIso,
    language: input.languageCode,
  })

  // The PUBLIC syllabus tree (§38 — no internal ids leaked): the topic link
  // is the suggestion identity (§13 — syllabus nodes carry canonical topics).
  const flattenSyllabus = (
    nodes: PublicSyllabusNodeLike[],
    prefix: string
  ): Array<{ nodeId: string; slug: string; path: string }> => {
    const out: Array<{ nodeId: string; slug: string; path: string }> = []
    for (const node of nodes) {
      const slug = node.topic?.slug ?? null
      const path = prefix ? `${prefix} › ${node.name}` : node.name
      if (slug) out.push({ nodeId: slug, slug, path: node.canonicalPath ?? path })
      if (node.children?.length) out.push(...flattenSyllabus(node.children, path))
    }
    return out
  }
  const candidates = flattenSyllabus(syllabus.nodes, '')
  if (candidates.length === 0) {
    throw new AiAssistError('AI_ASSIST_NO_CANDIDATES', 'The exam\u2019s current syllabus version has no nodes to suggest')
  }

  const unitText = [unit.canonicalName, unit.canonicalSummary].filter(Boolean).join(' — ')
  const candidateLines = candidates.map((c, i) => `${i + 1}. ${c.path} (slug: ${c.slug})`).join('\n')
  const reply = await completeJson(
    [
      'You are an editorial assistant for GlobIQ, an exam-preparation knowledge platform.',
      'Task: suggest which syllabus topics of this exam the knowledge unit should map to (§8 — exam mapping is a relationship with a required depth).',
      'Hard rules:',
      '1. Choose ONLY from the numbered syllabus nodes — never invent a node.',
      '2. Return the top 5 (or fewer), best first.',
      '3. For each: a one-sentence reason + a depthHint ("SHALLOW" for a brief awareness requirement, "DETAILED" for a deep study requirement).',
      '4. Output ONLY JSON: {"ranked": [{"index": number, "reason": string, "depthHint": "SHALLOW"|"DETAILED"}]}',
    ].join('\n'),
    [
      `KNOWLEDGE UNIT: ${unit.slug} — ${unitText || unit.slug}`,
      '',
      `EXAM: ${syllabus.exam?.name ?? input.examRef} (its CURRENT syllabus version)`,
      '',
      'SYLLABUS NODES:',
      candidateLines,
    ].join('\n')
  )

  const ranked = Array.isArray(reply.ranked) ? reply.ranked : []
  const suggestions: MappingSuggestion[] = []
  for (const entry of ranked.slice(0, 5)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { index?: unknown; reason?: unknown; depthHint?: unknown }
    const index = typeof record.index === 'number' ? Math.trunc(record.index) : -1
    const candidate = candidates[index - 1]
    if (!candidate) continue
    suggestions.push({
      nodeId: candidate.nodeId,
      slug: candidate.slug,
      path: candidate.path,
      reason: boundedString(record.reason, 400) ?? 'No reason given',
      depthHint: record.depthHint === 'DETAILED' ? 'DETAILED' : 'SHALLOW',
    })
  }

  return {
    suggestions,
    candidateCount: candidates.length,
    unit: { slug: unit.slug, title: unit.canonicalName },
    exam: { ref: input.examRef.trim(), name: syllabus.exam?.name ?? input.examRef },
    contract: AI_ASSIST_CONTRACT,
    model: MODEL_LABEL,
  }
}

interface PublicSyllabusNodeLike {
  name: string
  canonicalPath: string | null
  topic: { slug: string; canonicalName: string; label: string } | null
  children?: PublicSyllabusNodeLike[]
}

// ---------- 3. Dedup detection ----------

export async function dedupAssist(
  actor: Actor,
  input: { title: string; body?: string }
): Promise<DedupResult> {
  assertCan(actor, 'knowledge:manage')
  const title = input.title.trim().slice(0, 300)
  if (!title) {
    throw new AiAssistError('AI_ASSIST_VALIDATION', 'A title is required for duplicate detection')
  }

  // §17's engine family: pg_trgm similarity pre-filters the universe — the
  // model judges only the nearest candidates (measured cost control).
  const rows = await db.$queryRaw<Array<{ id: string; slug: string; canonicalName: string; similarity: number }>>`
    SELECT id, slug, "canonicalName", similarity("canonicalName", ${title}) AS similarity
    FROM "KnowledgeUnit"
    WHERE status IN ('VERIFIED', 'DRAFT')
    ORDER BY similarity DESC, slug ASC
    LIMIT 5
  `
  const candidates = rows.map((row) => ({
    unitId: row.id,
    slug: row.slug,
    title: row.canonicalName,
    similarity: Math.round(row.similarity * 1000) / 1000,
  }))
  if (candidates.length === 0) {
    throw new AiAssistError('AI_ASSIST_NO_CANDIDATES', 'No units exist to compare against')
  }

  const candidateLines = candidates
    .map((c, i) => `${i + 1}. "${c.title}" (slug: ${c.slug}, trigram similarity ${c.similarity})`)
    .join('\n')
  const reply = await completeJson(
    [
      'You are an editorial assistant for GlobIQ. Task: judge which existing knowledge units are likely DUPLICATES of a proposed new unit (§7 — one canonical unit per piece of knowledge; duplicates fragment mappings and mastery).',
      'Hard rules:',
      '1. Judge ONLY the numbered existing units — never invent one.',
      '2. A likely duplicate means the same underlying knowledge (not merely the same broad topic).',
      '3. For each candidate: isLikelyDuplicate true/false + a one-sentence reason.',
      '4. Output ONLY JSON: {"verdicts": [{"index": number, "isLikelyDuplicate": boolean, "reason": string}]}',
    ].join('\n'),
    [
      `PROPOSED NEW UNIT TITLE: ${title}`,
      input.body ? `PROPOSED BODY (excerpt): ${input.body.trim().slice(0, 2000)}` : '(no body provided)',
      '',
      'EXISTING UNITS (nearest by title trigram similarity):',
      candidateLines,
    ].join('\n')
  )

  const rawVerdicts = Array.isArray(reply.verdicts) ? reply.verdicts : []
  const verdicts: DedupVerdict[] = []
  for (const entry of rawVerdicts.slice(0, candidates.length)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as { index?: unknown; isLikelyDuplicate?: unknown; reason?: unknown }
    const index = typeof record.index === 'number' ? Math.trunc(record.index) : -1
    const candidate = candidates[index - 1]
    if (!candidate) continue
    verdicts.push({
      ...candidate,
      isLikelyDuplicate: record.isLikelyDuplicate === true,
      reason: boundedString(record.reason, 400) ?? 'No reason given',
    })
  }

  return { verdicts, candidateCount: candidates.length, contract: AI_ASSIST_CONTRACT, model: MODEL_LABEL }
}
