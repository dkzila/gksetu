'use client'

/**
 * GKSetu Console — Exam detail parts (CONSOLE-S1-E).
 *
 * The dialog + tree building blocks of the exam detail page: version
 * create/edit, syllabus node add/edit, the outline import, the mapping form
 * (node select + §14 country-guarded unit picker + §8 vocabulary) and the
 * collapsible tree rows. Every dialog is mounted per open — its form state
 * initialises from props at mount, so there is no reset effect; all async
 * work (topic options, unit search) happens in continuations. The parent owns
 * the open state through `onClose` (§37 server truth in, server truth out).
 */
import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type {
  AdminMapping,
  AdminMappingNode,
  AdminVersionMappings,
  MappingUnitOption,
} from '@/modules/exam-mapping'
import type { AdminSyllabusNode, ExamVersionRef, SyllabusEditability } from '@/modules/exams-syllabus'

import {
  DEPTH_OPTIONS,
  DEPTH_SHORT,
  LIKELIHOOD_OPTIONS,
  PRIORITY_OPTIONS,
  RELEVANCE_OPTIONS,
  fetchTopicOptions,
  flattenMappingNodes,
  flattenSyllabusNodes,
  fmtDay,
  type TopicOption,
} from './exam-console-shared'

/** Submit outcome: `true` on success, else a field-error map for inline display. */
export type PartSubmitResult = true | Record<string, string>

const SELECT_CLASS =
  'h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50'

// ===================================================================
// Version dialogs
// ===================================================================

export interface VersionFormValues {
  label: string
  effectiveFrom: string
  effectiveTo: string
  source: string
  notes: string
}

export function VersionFormDialog({
  mode,
  version,
  onSubmit,
  busy,
  onClose,
}: {
  mode: 'create' | 'edit'
  version: ExamVersionRef | null
  onSubmit: (values: VersionFormValues) => Promise<PartSubmitResult>
  busy: boolean
  onClose: () => void
}) {
  const [values, setValues] = useState<VersionFormValues>(() =>
    mode === 'edit' && version
      ? {
          label: version.label,
          effectiveFrom: fmtDay(version.effectiveFrom),
          effectiveTo: version.effectiveTo ? fmtDay(version.effectiveTo) : '',
          source: version.source ?? '',
          notes: version.notes ?? '',
        }
      : { label: '', effectiveFrom: '', effectiveTo: '', source: '', notes: '' }
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async () => {
    setErrors({})
    setFormError(null)
    const result = await onSubmit(values)
    if (result === true) {
      onClose()
      return
    }
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New syllabus version' : 'Edit version metadata'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Syllabus changes create a new version — the previous window closes the day before this one starts. Windows are immutable afterwards.'
              : 'Metadata only — the effective window is immutable after create (corrections are a new version).'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <label htmlFor="version-label" className="text-[13px] font-medium text-zinc-700">
              Label <span className="text-red-500">*</span>
            </label>
            <Input
              id="version-label"
              value={values.label}
              onChange={(event) => setValues((current) => ({ ...current, label: event.target.value }))}
              placeholder="e.g. 2027 syllabus"
              className="h-8 text-[13px]"
              aria-invalid={Boolean(errors.label)}
            />
            {errors.label && <p className="text-xs text-red-600">{errors.label}</p>}
          </div>
          {mode === 'create' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="version-from" className="text-[13px] font-medium text-zinc-700">
                  Effective from
                </label>
                <Input
                  id="version-from"
                  type="date"
                  value={values.effectiveFrom}
                  onChange={(event) => setValues((current) => ({ ...current, effectiveFrom: event.target.value }))}
                  className="h-8 text-[13px]"
                  aria-invalid={Boolean(errors.effectiveFrom)}
                />
                <p className="text-xs text-zinc-400">{errors.effectiveFrom ?? 'Defaults to today'}</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="version-to" className="text-[13px] font-medium text-zinc-700">
                  Effective to
                </label>
                <Input
                  id="version-to"
                  type="date"
                  value={values.effectiveTo}
                  onChange={(event) => setValues((current) => ({ ...current, effectiveTo: event.target.value }))}
                  className="h-8 text-[13px]"
                  aria-invalid={Boolean(errors.effectiveTo)}
                />
                <p className="text-xs text-zinc-400">{errors.effectiveTo ?? 'Empty = in effect until superseded'}</p>
              </div>
            </div>
          )}
          {mode === 'edit' && (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              Window {fmtDay(version?.effectiveFrom)} → {version?.effectiveTo ? fmtDay(version.effectiveTo) : 'open'} —{' '}
              {version?.isCurrent ? 'currently in effect' : version?.isUpcoming ? 'starts in the future' : 'historical'}.
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="version-source" className="text-[13px] font-medium text-zinc-700">
              Source
            </label>
            <Input
              id="version-source"
              value={values.source}
              onChange={(event) => setValues((current) => ({ ...current, source: event.target.value }))}
              placeholder="e.g. UPSC notification 2027, §4.2"
              className="h-8 text-[13px]"
            />
            {errors.source && <p className="text-xs text-red-600">{errors.source}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="version-notes" className="text-[13px] font-medium text-zinc-700">
              Notes
            </label>
            <Input
              id="version-notes"
              value={values.notes}
              onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Private console notes"
              className="h-8 text-[13px]"
            />
            {errors.notes && <p className="text-xs text-red-600">{errors.notes}</p>}
          </div>
          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={busy}>
            {mode === 'create' ? 'Create version' : 'Save metadata'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Syllabus node dialog (add / edit+move)
// ===================================================================

export interface NodeFormValues {
  name: string
  parentId: string
  topicId: string
  priority: string
  notes: string
}

export function NodeFormDialog({
  mode,
  node,
  tree,
  countryIso,
  onSubmit,
  busy,
  onClose,
}: {
  mode: 'add' | 'edit'
  node: AdminSyllabusNode | null
  tree: AdminSyllabusNode[]
  countryIso: string
  onSubmit: (values: NodeFormValues) => Promise<PartSubmitResult>
  busy: boolean
  onClose: () => void
}) {
  const [values, setValues] = useState<NodeFormValues>(() =>
    mode === 'edit' && node
      ? {
          name: node.name,
          parentId: node.parentId ?? 'root',
          topicId: node.topicId ?? 'none',
          priority: String(node.priority),
          notes: node.notes ?? '',
        }
      : { name: '', parentId: node?.id ?? 'root', topicId: 'none', priority: '0', notes: '' }
  )
  const [topics, setTopics] = useState<TopicOption[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  // Topic options load per mount (async continuation only).
  useEffect(() => {
    let cancelled = false
    void fetchTopicOptions(countryIso).then((options) => {
      if (!cancelled) setTopics(options)
    })
    return () => {
      cancelled = true
    }
  }, [countryIso])

  const flat = flattenSyllabusNodes(tree)

  const submit = async () => {
    setErrors({})
    setFormError(null)
    const result = await onSubmit(values)
    if (result === true) {
      onClose()
      return
    }
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'add' ? (node ? `Add child under “${node.name}”` : 'Add root node') : 'Edit syllabus node'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? 'Staging only — use the exam’s official notification wording. The canonical topic link is the only exam → taxonomy bridge.'
              : 'Renaming, reprioritising, moving (parent) and relinking the topic are all allowed on staged trees.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <label htmlFor="node-name" className="text-[13px] font-medium text-zinc-700">
              Node name <span className="text-red-500">*</span>
            </label>
            <Input
              id="node-name"
              value={values.name}
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              placeholder="e.g. Indian Polity and Governance"
              className="h-8 text-[13px]"
              aria-invalid={Boolean(errors.name)}
            />
            {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="node-parent" className="text-[13px] font-medium text-zinc-700">
                Parent
              </label>
              <select
                id="node-parent"
                value={values.parentId}
                onChange={(event) => setValues((current) => ({ ...current, parentId: event.target.value }))}
                className={SELECT_CLASS}
              >
                <option value="root">— root —</option>
                {flat.map(({ node: entry, depth }) => (
                  <option key={entry.id} value={entry.id}>
                    {'· '.repeat(depth)}
                    {entry.name}
                  </option>
                ))}
              </select>
              {errors.parentId && <p className="text-xs text-red-600">{errors.parentId}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="node-topic" className="text-[13px] font-medium text-zinc-700">
                Canonical topic link
              </label>
              <select
                id="node-topic"
                value={values.topicId}
                onChange={(event) => setValues((current) => ({ ...current, topicId: event.target.value }))}
                className={SELECT_CLASS}
              >
                <option value="none">— none —</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.label}
                  </option>
                ))}
              </select>
              {errors.topicId && <p className="text-xs text-red-600">{errors.topicId}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="node-priority" className="text-[13px] font-medium text-zinc-700">
                Priority
              </label>
              <Input
                id="node-priority"
                type="number"
                min={0}
                max={9999}
                value={values.priority}
                onChange={(event) => setValues((current) => ({ ...current, priority: event.target.value }))}
                className="h-8 text-[13px]"
              />
              {errors.priority && <p className="text-xs text-red-600">{errors.priority}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="node-notes" className="text-[13px] font-medium text-zinc-700">
                Notes
              </label>
              <Input
                id="node-notes"
                value={values.notes}
                onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Private console notes"
                className="h-8 text-[13px]"
              />
              {errors.notes && <p className="text-xs text-red-600">{errors.notes}</p>}
            </div>
          </div>
          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={busy}>
            {mode === 'add' ? 'Add node' : 'Save node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Outline import dialog
// ===================================================================

const OUTLINE_HINT = `Two spaces (or one tab) per level of depth. Blank lines and lines starting with "#" are ignored. Submitting replaces the whole staged tree — an empty outline clears it. Frozen versions refuse the import.`

export function ImportOutlineDialog({
  onSubmit,
  busy,
  onClose,
}: {
  onSubmit: (outline: string) => Promise<boolean>
  busy: boolean
  onClose: () => void
}) {
  const [outline, setOutline] = useState('')

  const submit = async () => {
    const ok = await onSubmit(outline)
    if (ok) onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import syllabus outline</DialogTitle>
          <DialogDescription>{OUTLINE_HINT}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <textarea
            value={outline}
            onChange={(event) => setOutline(event.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={'Prelims\n  General Studies — Paper I\n    Current events of national importance\n    History of India\n  CSAT\nMains\n  Essay\n  General Studies — I'}
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            aria-label="Syllabus outline"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={busy}>
            Replace staged tree
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===================================================================
// Mapping form dialog (add / edit)
// ===================================================================

export interface MappingFormValues {
  nodeId: string
  unitRef: string
  relevance: string
  priority: string
  requiredDepth: string
  questionLikelihood: string
  expectedScope: string
  sourceBasis: string
  effectiveFrom: string
  effectiveTo: string
  notes: string
}

const MAPPING_DEFAULTS: Omit<MappingFormValues, 'nodeId' | 'unitRef'> = {
  relevance: 'DIRECT',
  priority: 'SUPPORTING',
  requiredDepth: 'CONCEPT',
  questionLikelihood: 'MEDIUM',
  expectedScope: '',
  sourceBasis: '',
  effectiveFrom: '',
  effectiveTo: '',
  notes: '',
}

export function MappingFormDialog({
  mode,
  mapping,
  mappingView,
  defaultNodeId,
  onSearchUnits,
  onSubmit,
  busy,
  onClose,
}: {
  mode: 'add' | 'edit'
  mapping: AdminMapping | null
  mappingView: AdminVersionMappings | null
  defaultNodeId: string
  onSearchUnits: (query: string) => Promise<MappingUnitOption[]>
  onSubmit: (values: MappingFormValues) => Promise<PartSubmitResult>
  busy: boolean
  onClose: () => void
}) {
  const [values, setValues] = useState<MappingFormValues>(() =>
    mode === 'edit' && mapping
      ? {
          nodeId: '',
          unitRef: '',
          relevance: mapping.relevance,
          priority: mapping.priority,
          requiredDepth: mapping.requiredDepth,
          questionLikelihood: mapping.questionLikelihood,
          expectedScope: mapping.expectedScope ?? '',
          sourceBasis: mapping.sourceBasis ?? '',
          effectiveFrom: mapping.effectiveFrom ? fmtDay(mapping.effectiveFrom) : '',
          effectiveTo: mapping.effectiveTo ? fmtDay(mapping.effectiveTo) : '',
          notes: mapping.notes ?? '',
        }
      : { ...MAPPING_DEFAULTS, nodeId: defaultNodeId, unitRef: '' }
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  // Unit picker state (§14 country-guarded search, debounced in the change handler)
  const [unitQuery, setUnitQuery] = useState('')
  const [unitResults, setUnitResults] = useState<MappingUnitOption[]>([])
  const [unitSearching, setUnitSearching] = useState(false)
  const [pickedUnit, setPickedUnit] = useState<MappingUnitOption | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flatNodes = mappingView ? flattenMappingNodes(mappingView.tree) : []

  const runSearch = async (query: string) => {
    if (query.trim().length < 2) {
      setUnitResults([])
      return
    }
    setUnitSearching(true)
    const units = await onSearchUnits(query.trim())
    setUnitResults(units)
    setUnitSearching(false)
  }

  const onQueryChange = (query: string) => {
    setUnitQuery(query)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void runSearch(query), 350)
  }

  const submit = async () => {
    setErrors({})
    setFormError(null)
    const result = await onSubmit(values)
    if (result === true) {
      onClose()
      return
    }
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  const set = <K extends keyof MappingFormValues>(key: K, value: MappingFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Map a knowledge unit' : 'Edit mapping'}</DialogTitle>
          <DialogDescription>
            {mode === 'add'
              ? 'Anchor a canonical knowledge unit to a syllabus node — the §8 requirement layer the combination engine expands.'
              : 'Metadata only — anchors (unit + node) are immutable; re-anchoring means remove + re-create.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {mode === 'add' && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="mapping-node" className="text-[13px] font-medium text-zinc-700">
                    Syllabus node <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="mapping-node"
                    value={values.nodeId}
                    onChange={(event) => set('nodeId', event.target.value)}
                    className={SELECT_CLASS}
                    aria-invalid={Boolean(errors.nodeId)}
                  >
                    <option value="">Pick a node…</option>
                    {flatNodes.map(({ node, depth }) => (
                      <option key={node.id} value={node.id}>
                        {'· '.repeat(depth)}
                        {node.name}
                      </option>
                    ))}
                  </select>
                  {errors.nodeId && <p className="text-xs text-red-600">{errors.nodeId}</p>}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="mapping-unit" className="text-[13px] font-medium text-zinc-700">
                    Knowledge unit <span className="text-red-500">*</span>
                  </label>
                  {pickedUnit ? (
                    <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-emerald-900">{pickedUnit.canonicalName}</p>
                        <p className="truncate font-mono text-[10px] text-emerald-600">
                          {pickedUnit.slug} · {pickedUnit.type.toLowerCase()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPickedUnit(null)
                          setUnitQuery('')
                          setUnitResults([])
                        }}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-100"
                        aria-label="Clear picked unit"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Search
                        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                        aria-hidden="true"
                      />
                      <Input
                        id="mapping-unit"
                        value={unitQuery}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder="Type at least 2 characters to search…"
                        className="h-8 pl-8 text-[13px]"
                        aria-invalid={Boolean(errors.unitRef)}
                      />
                    </div>
                  )}
                  {errors.unitRef && <p className="text-xs text-red-600">{errors.unitRef}</p>}
                </div>
              </div>

              {!pickedUnit && (unitSearching || unitResults.length > 0 || unitQuery.trim().length >= 2) && (
                <div className="max-h-44 overflow-y-auto rounded-md border border-zinc-200 bg-white">
                  {unitSearching && unitResults.length === 0 && (
                    <p className="flex items-center gap-2 px-3 py-2 text-xs text-zinc-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching units…
                    </p>
                  )}
                  {!unitSearching && unitResults.length === 0 && (
                    <p className="px-3 py-2 text-xs text-zinc-400">No units match — try another term.</p>
                  )}
                  {unitResults.map((unit) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => {
                        setPickedUnit(unit)
                        set('unitRef', unit.id)
                      }}
                      className="flex w-full flex-col gap-0.5 border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-emerald-50/50"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-zinc-800">{unit.canonicalName}</span>
                        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0 text-[10px] uppercase text-zinc-500">
                          {unit.type}
                        </span>
                        {unit.topic && (
                          <span className="hidden shrink-0 text-[10px] text-zinc-400 sm:inline">/{unit.topic.slug}</span>
                        )}
                      </span>
                      {unit.mappedOn.length > 0 && (
                        <span className="truncate text-[10px] text-emerald-700">
                          Already mapped on {unit.mappedOn.length} node{unit.mappedOn.length === 1 ? '' : 's'} —{' '}
                          {unit.mappedOn
                            .slice(0, 3)
                            .map((context) => `${context.examCode}: ${context.nodeName}`)
                            .join(' · ')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === 'edit' && mapping && (
            <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
              <span className="font-medium text-zinc-700">{mapping.unit.canonicalName}</span> on{' '}
              <span className="font-medium text-zinc-700">
                {mappingView ? nodeNameOf(mappingView, mapping) : '—'}
              </span>{' '}
              · {DEPTH_SHORT[mapping.requiredDepth]}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <label htmlFor="mapping-relevance" className="text-[13px] font-medium text-zinc-700">
                Relevance
              </label>
              <select
                id="mapping-relevance"
                value={values.relevance}
                onChange={(event) => set('relevance', event.target.value)}
                className={SELECT_CLASS}
              >
                {RELEVANCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mapping-priority" className="text-[13px] font-medium text-zinc-700">
                Priority
              </label>
              <select
                id="mapping-priority"
                value={values.priority}
                onChange={(event) => set('priority', event.target.value)}
                className={SELECT_CLASS}
              >
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mapping-depth" className="text-[13px] font-medium text-zinc-700">
                Required depth
              </label>
              <select
                id="mapping-depth"
                value={values.requiredDepth}
                onChange={(event) => set('requiredDepth', event.target.value)}
                className={SELECT_CLASS}
              >
                {DEPTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mapping-likelihood" className="text-[13px] font-medium text-zinc-700">
                Question likelihood
              </label>
              <select
                id="mapping-likelihood"
                value={values.questionLikelihood}
                onChange={(event) => set('questionLikelihood', event.target.value)}
                className={SELECT_CLASS}
              >
                {LIKELIHOOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="mapping-scope" className="text-[13px] font-medium text-zinc-700">
                Expected scope
              </label>
              <Input
                id="mapping-scope"
                value={values.expectedScope}
                onChange={(event) => set('expectedScope', event.target.value)}
                placeholder="Which portion/aspect is relevant"
                className="h-8 text-[13px]"
              />
              {errors.expectedScope && <p className="text-xs text-red-600">{errors.expectedScope}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mapping-basis" className="text-[13px] font-medium text-zinc-700">
                Source basis
              </label>
              <Input
                id="mapping-basis"
                value={values.sourceBasis}
                onChange={(event) => set('sourceBasis', event.target.value)}
                placeholder="Notification §, PYQ pattern, editor judgement"
                className="h-8 text-[13px]"
              />
              {errors.sourceBasis && <p className="text-xs text-red-600">{errors.sourceBasis}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mapping-from" className="text-[13px] font-medium text-zinc-700">
                Effective from
              </label>
              <Input
                id="mapping-from"
                type="date"
                value={values.effectiveFrom}
                onChange={(event) => set('effectiveFrom', event.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mapping-to" className="text-[13px] font-medium text-zinc-700">
                Effective to
              </label>
              <Input
                id="mapping-to"
                type="date"
                value={values.effectiveTo}
                onChange={(event) => set('effectiveTo', event.target.value)}
                className="h-8 text-[13px]"
              />
              {(errors.effectiveFrom || errors.effectiveTo) && (
                <p className="text-xs text-red-600">{errors.effectiveFrom ?? errors.effectiveTo}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="mapping-notes" className="text-[13px] font-medium text-zinc-700">
              Notes
            </label>
            <Input
              id="mapping-notes"
              value={values.notes}
              onChange={(event) => set('notes', event.target.value)}
              placeholder="Private console notes"
              className="h-8 text-[13px]"
            />
          </div>

          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void submit()}
            disabled={busy || (mode === 'add' && (!values.nodeId || !values.unitRef))}
          >
            {mode === 'add' ? 'Map unit' : 'Save mapping'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function nodeNameOf(view: AdminVersionMappings, mapping: AdminMapping): string {
  const flat = flattenMappingNodes(view.tree)
  const entry = flat.find(({ node }) => node.mappings.some((candidate) => candidate.id === mapping.id))
  return entry?.node.name ?? '—'
}

// ===================================================================
// Tree rendering (syllabus)
// ===================================================================

export function SyllabusTreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onAddChild,
  onEdit,
  onRemove,
  editable,
}: {
  node: AdminSyllabusNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onAddChild: (node: AdminSyllabusNode) => void
  onEdit: (node: AdminSyllabusNode) => void
  onRemove: (node: AdminSyllabusNode) => void
  editable: boolean
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.id)
  return (
    <li role="treeitem" aria-selected={false} aria-expanded={hasChildren ? isOpen : undefined} className="min-w-0">
      <div
        className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-zinc-50"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
            aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800" title={node.name}>
          {node.name}
        </span>
        {node.topic && (
          <Badge
            variant="outline"
            className="hidden max-w-[140px] shrink-0 gap-1 border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-800 sm:inline-flex"
          >
            <Link2 className="h-2.5 w-2.5" aria-hidden="true" />
            <span className="truncate">{node.topic.canonicalName}</span>
          </Badge>
        )}
        {node.priority > 0 && <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">#{node.priority}</span>}
        {editable && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onEdit(node)} title="Edit / move node">
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onAddChild(node)} title="Add child node">
              <Plus className="h-3 w-3" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
              onClick={() => onRemove(node)}
              title={node.childCount > 0 ? `Remove the ${node.childCount} children first` : 'Remove node'}
              disabled={node.childCount > 0}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </Button>
          </span>
        )}
      </div>
      {hasChildren && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <SyllabusTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onRemove={onRemove}
              editable={editable}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ===================================================================
// Editability banner
// ===================================================================

const EDITABILITY_STYLE: Record<string, string> = {
  staged: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  live: 'border-teal-200 bg-teal-50 text-teal-800',
  frozen: 'border-amber-200 bg-amber-50 text-amber-800',
  locked: 'border-zinc-200 bg-zinc-50 text-zinc-500',
}

export function EditabilityBanner({
  editability,
  reason,
  context,
}: {
  editability: SyllabusEditability | string
  reason: string
  context: string
}) {
  const label =
    editability === 'staged'
      ? 'Staged — editable'
      : editability === 'live'
        ? 'Live — mappings keep flowing'
        : editability === 'frozen'
          ? 'Frozen — §36 history'
          : 'Locked — read-only'
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px]',
        EDITABILITY_STYLE[editability] ?? EDITABILITY_STYLE.locked
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="text-xs opacity-80">
        {context} · {reason}
      </span>
    </div>
  )
}

/** Maps a mapping-tree node (AdminMappingNode) for shared rendering helpers. */
export type MappingNodeRow = AdminMappingNode
