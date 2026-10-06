/**
 * GET /api/exam-notes/admin/chapters?exam={ref} — the chapter picker for the
 * ExamNote create/edit dialog (SITE-S13 Console UI).
 *
 * Returns the exam's CURRENT version's chapter tree, flattened with their
 * syllabusNodeIds + indented labels (so the Console's chapter <select> shows
 * "Indian Polity" / "├─ Fundamental Rights" hierarchically). COUNTRY_ADMIN
 * sees only their own country's exams (the exam:manage precedent).
 *
 * Rides `note:manage` (the same permission the create dialog needs — a writer
 * who can author notes can certainly see the chapter list).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { db } from '@/lib/db'
import { findExam, toExamErrorResponse, currentVersionOf } from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

interface FlatChapter {
  id: string
  name: string
  slug: string | null
  depth: number
  label: string
}

/** Flattens the syllabus tree into a list (DFS, depth-prefixed labels). */
function flatten(nodes: Array<{
  id: string
  name: string
  slug: string | null
  depth: number
  children: Array<unknown>
}>, depth = 0, accumulator: FlatChapter[] = []): FlatChapter[] {
  for (const node of nodes) {
    const flat: FlatChapter = {
      id: node.id,
      name: node.name,
      slug: node.slug,
      depth,
      label: `${'\u00A0\u00A0\u00A0\u00A0'.repeat(depth)}${node.name}`,
    }
    accumulator.push(flat)
    if (node.children && Array.isArray(node.children) && node.children.length > 0) {
      flatten(node.children as Array<typeof node>, depth + 1, accumulator)
    }
  }
  return accumulator
}

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'note:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const examRef = url.searchParams.get('exam') ?? ''
  if (!examRef) {
    return errors.badRequest('The ?exam= query parameter is required (exam slug or id)')
  }

  try {
    const exam = await findExam(examRef)
    if (!exam) {
      return fail(`Exam "${examRef}" not found`, 'EXAM_NOT_FOUND', 404)
    }

    // COUNTRY_ADMIN scope check (the exam:manage precedent).
    if (auth.actor.role === 'COUNTRY_ADMIN' && exam.countryId !== auth.actor.countryId) {
      return fail('This exam belongs to another market', 'COUNTRY_MISMATCH', 403)
    }

    // Find the current version's tree.
    const currentVersion = currentVersionOf(exam.versions)
    if (!currentVersion) {
      return ok({ chapters: [], versionLabel: null })
    }

    // Load the syllabus nodes for this version.
    const nodes = await db.syllabusNode.findMany({
      where: { examVersionId: currentVersion.id },
      orderBy: [{ parentId: 'asc' }, { priority: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        depth: true,
        priority: true,
      },
    })

    // Build a parent → children map + root list.
    const byParent = new Map<string | null, typeof nodes>()
    for (const node of nodes) {
      const key = node.parentId
      const list = byParent.get(key) ?? []
      list.push(node)
      byParent.set(key, list)
    }

    // Build the tree (recursive, depth-first).
    const buildTree = (parentId: string | null, depth: number): Array<typeof nodes[number] & { children: Array<typeof nodes[number] & { children: unknown[] }> }> => {
      const list = byParent.get(parentId) ?? []
      return list.map((node) => ({
        ...node,
        depth,
        children: buildTree(node.id, depth + 1) as Array<typeof nodes[number] & { children: unknown[] }>,
      }))
    }

    const tree = buildTree(null, 0)
    const flat = flatten(tree as Array<{
      id: string
      name: string
      slug: string | null
      depth: number
      children: Array<unknown>
    }>)

    return ok({
      chapters: flat,
      versionLabel: currentVersion.label,
      exam: { id: exam.id, slug: exam.slug, name: exam.name },
    })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/admin/chapters] unexpected error:', error)
    return fail('Could not load the chapter list', 'INTERNAL_ERROR', 500)
  }
}
