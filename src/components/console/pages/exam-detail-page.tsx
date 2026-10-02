'use client'

/**
 * GKSetu Console — Exam detail (CONSOLE-S1-E).
 *
 * The exam's whole management surface in one scroll: identity + lifecycle
 * header (§36 transitions), the version history (append-only windows — create
 * new, edit metadata, remove future-dated corrections), the selected
 * version's syllabus tree (staged/frozen editability, node CRUD + move, the
 * indented-outline bulk import) and its §8 mapping layer (unit picker with
 * cross-exam context, full vocabulary, edit/remove). Every mutation returns
 * fresh server truth which replaces local state — the UI never guesses.
 *
 * Note: `useConsoleApi()` returns a fresh object each render, so loaders keep
 * it behind a ref and stay identity-stable — effects run once per input, not
 * per render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  CalendarPlus,
  FileInput,
  GraduationCap,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'

import { navigateToPath } from '@/components/home/app-router'
import {
  ConsolePageHeader,
  EmptyState,
  ErrorNotice,
  MetaRow,
  StatusBadge,
  TableSkeleton,
  formatWhen,
} from '@/components/console/ui/primitives'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import type {
  AdminExam,
  AdminExamDetail,
  AdminSyllabusNode,
  AdminVersionTree,
  ExamTransitionAction,
  ExamVersionRef,
} from '@/modules/exams-syllabus'
import type { AdminMapping, AdminVersionMappings, MappingUnitOption } from '@/modules/exam-mapping'

import { fieldErrorMap, useConsoleApi } from '@/components/console/ui/console-api'
import { DEPTH_SHORT, fetchActiveCountries, flattenMappings, fmtDay, type CountryRef } from './exam-console-shared'
import { ExamFormDialog } from './exams-page'
import {
  EditabilityBanner,
  ImportOutlineDialog,
  MappingFormDialog,
  NodeFormDialog,
  SyllabusTreeRow,
  VersionFormDialog,
  type MappingFormValues,
  type NodeFormValues,
  type PartSubmitResult,
  type VersionFormValues,
} from './exam-detail-parts'

function VersionStateBadge({ version }: { version: ExamVersionRef }) {
  if (version.isCurrent) {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2 py-0 text-[11px] font-medium text-emerald-700">
        current
      </Badge>
    )
  }
  if (version.isUpcoming) {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 px-2 py-0 text-[11px] font-medium text-amber-700">
        upcoming
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 px-2 py-0 text-[11px] font-medium text-zinc-500">
      historical
    </Badge>
  )
}

export function ExamDetailPage({ examRef }: { examRef: string }) {
  const { toast } = useToast()
  const api = useConsoleApi()
  // `useConsoleApi()` returns a fresh object each render — keep the latest one
  // behind a ref (updated in the first effect) so the loaders stay
  // identity-stable and their effects run once per input, not per render.
  const apiRef = useRef(api)

  useEffect(() => {
    apiRef.current = api
  })

  // ---------- Exam ----------
  const [exam, setExam] = useState<AdminExamDetail | null>(null)
  const [examLoading, setExamLoading] = useState(true)
  const [examError, setExamError] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [countries, setCountries] = useState<CountryRef[]>([])
  const selectedVersionRef = useRef('')

  // ---------- Syllabus tree ----------
  const [tree, setTree] = useState<AdminVersionTree | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // ---------- Mappings ----------
  const [mappingView, setMappingView] = useState<AdminVersionMappings | null>(null)
  const [mappingLoading, setMappingLoading] = useState(false)
  const [viewTick, setViewTick] = useState(0)

  // ---------- Dialog state ----------
  const [editOpen, setEditOpen] = useState(false)
  const [versionCreateOpen, setVersionCreateOpen] = useState(false)
  const [versionEditTarget, setVersionEditTarget] = useState<ExamVersionRef | null>(null)
  const [versionRemoveTarget, setVersionRemoveTarget] = useState<ExamVersionRef | null>(null)
  const [nodeAddOpen, setNodeAddOpen] = useState(false)
  const [nodeAddParent, setNodeAddParent] = useState<AdminSyllabusNode | null>(null)
  const [nodeEditTarget, setNodeEditTarget] = useState<AdminSyllabusNode | null>(null)
  const [nodeRemoveTarget, setNodeRemoveTarget] = useState<AdminSyllabusNode | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [mappingAddOpen, setMappingAddOpen] = useState(false)
  const [mappingDefaultNode, setMappingDefaultNode] = useState('')
  const [mappingEditTarget, setMappingEditTarget] = useState<AdminMapping | null>(null)
  const [mappingRemoveTarget, setMappingRemoveTarget] = useState<AdminMapping | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchActiveCountries().then((list) => {
      if (!cancelled) setCountries(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** Switches the viewed version + resets the version-scoped views (event contexts only). */
  const selectVersion = useCallback((id: string) => {
    if (id === selectedVersionRef.current) return
    selectedVersionRef.current = id
    setSelectedVersionId(id)
    setTree(null)
    setTreeError(null)
    setTreeLoading(true)
    setMappingView(null)
    setMappingLoading(true)
  }, [])

  const loadExam = useCallback(async () => {
    const { data, error } = await apiRef.current.get<{ exam: AdminExamDetail }>(
      `/api/exams/admin/exams/${examRef}`
    )
    if (data) {
      setExam(data.exam)
      setExamError(null)
      // keep a still-valid selection; otherwise default to the current version
      const versions = data.exam.versions
      if (selectedVersionRef.current && versions.some((version) => version.id === selectedVersionRef.current)) {
        // selection still valid — keep the view as-is
      } else {
        const preferred = versions.find((version) => version.isCurrent) ?? versions[0]
        if (preferred) selectVersion(preferred.id)
        else if (selectedVersionRef.current !== '') {
          selectedVersionRef.current = ''
          setSelectedVersionId('')
          setTree(null)
          setMappingView(null)
          setTreeLoading(false)
          setMappingLoading(false)
        }
      }
    } else {
      setExam(null)
      setExamError(error?.message ?? 'Could not load the exam')
    }
    setExamLoading(false)
  }, [examRef, selectVersion])

  useEffect(() => {
    void loadExam()
  }, [loadExam])

  // ---------- Tree + mappings for the selected version (async continuations only) ----------

  useEffect(() => {
    if (!selectedVersionId) return
    let cancelled = false
    const run = async () => {
      const [treeResult, mappingsResult] = await Promise.all([
        apiRef.current.get<{ tree: AdminVersionTree }>(
          `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/syllabus`
        ),
        apiRef.current.get<{ mappings: AdminVersionMappings }>(
          `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/mappings`
        ),
      ])
      if (cancelled) return
      if (treeResult.data) {
        setTree(treeResult.data.tree)
        setTreeError(null)
        setExpanded(new Set(treeResult.data.tree.tree.map((node) => node.id)))
      } else {
        setTree(null)
        setTreeError(treeResult.error?.message ?? 'Could not load the syllabus tree')
      }
      setMappingView(mappingsResult.data?.mappings ?? null)
      setTreeLoading(false)
      setMappingLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [examRef, selectedVersionId, viewTick])

  const reloadVersionData = () => {
    setTreeLoading(true)
    setMappingLoading(true)
    setViewTick((tick) => tick + 1)
  }

  const applyExam = (next: AdminExam | AdminExamDetail) => {
    setExam((current) => {
      const merged = { ...current, ...next } as AdminExamDetail
      // Version-bearing responses (create/remove) replace the history;
      // PATCH/transition responses keep the loaded one.
      if ('versions' in next && Array.isArray(next.versions)) merged.versions = next.versions
      return merged
    })
  }

  // ---------- Exam mutations ----------

  const saveExamFields = async (values: {
    name: string
    organiser: string
    level: string
    description: string
    notes: string
  }): Promise<true | Record<string, string>> => {
    setBusy(true)
    const { data, error } = await api.patch<{ exam: AdminExam }>(`/api/exams/admin/exams/${examRef}`, {
      name: values.name.trim(),
      organiser: values.organiser.trim(),
      level: values.level,
      ...(values.description.trim() ? { description: values.description.trim() } : { description: null }),
      ...(values.notes.trim() ? { notes: values.notes.trim() } : { notes: null }),
    })
    setBusy(false)
    if (data) {
      applyExam(data.exam)
      toast({ title: 'Exam updated' })
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not update the exam', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const runTransition = async (action: ExamTransitionAction) => {
    if (!exam) return
    setBusy(true)
    const { data, error } = await api.post<{ exam: AdminExam }>(`/api/exams/admin/exams/${examRef}/transition`, {
      action,
      ...(action === 'retire' ? { reason: 'Retired from the exam console' } : {}),
    })
    setBusy(false)
    if (data) {
      applyExam(data.exam)
      toast({
        title: `Exam ${action === 'retire' ? 'retired' : `${action}d`}`,
        description: `${data.exam.name} is now ${data.exam.status}.`,
      })
    } else if (error) {
      toast({ title: 'Transition failed', description: error.message, variant: 'destructive' })
    }
  }

  // ---------- Version mutations ----------

  const createVersion = async (values: VersionFormValues): Promise<PartSubmitResult> => {
    setBusy(true)
    const previousIds = new Set((exam?.versions ?? []).map((version) => version.id))
    const { data, error } = await api.post<{ exam: AdminExamDetail }>(
      `/api/exams/admin/exams/${examRef}/versions`,
      {
        label: values.label.trim(),
        ...(values.effectiveFrom ? { effectiveFrom: values.effectiveFrom } : {}),
        ...(values.effectiveTo ? { effectiveTo: values.effectiveTo } : { effectiveTo: null }),
        ...(values.source.trim() ? { source: values.source.trim() } : {}),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : {}),
      }
    )
    setBusy(false)
    if (data) {
      applyExam(data.exam)
      // view the freshly created version (the id that just appeared)
      const created = data.exam.versions.find((version) => !previousIds.has(version.id)) ?? data.exam.versions[0]
      if (created) selectVersion(created.id)
      toast({
        title: 'Version created',
        description: 'The previous window auto-closed the day before this one starts.',
      })
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not create the version', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const saveVersion = async (values: VersionFormValues): Promise<PartSubmitResult> => {
    if (!versionEditTarget) return {}
    setBusy(true)
    const { data, error } = await api.patch<{ exam: AdminExamDetail }>(
      `/api/exams/admin/exams/${examRef}/versions/${versionEditTarget.id}`,
      {
        label: values.label.trim(),
        ...(values.source.trim() ? { source: values.source.trim() } : { source: null }),
        ...(values.notes.trim() ? { notes: values.notes.trim() } : { notes: null }),
      }
    )
    setBusy(false)
    if (data) {
      applyExam(data.exam)
      toast({ title: 'Version metadata saved' })
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not update the version', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const removeVersion = async () => {
    if (!versionRemoveTarget) return
    setBusy(true)
    const { data, error } = await api.del<{ exam: AdminExamDetail }>(
      `/api/exams/admin/exams/${examRef}/versions/${versionRemoveTarget.id}`
    )
    setBusy(false)
    if (data) {
      applyExam(data.exam)
      const next = data.exam.versions.find((version) => version.isCurrent) ?? data.exam.versions[0]
      selectVersion(next?.id ?? '')
      toast({ title: 'Future version removed', description: 'The predecessor window it auto-closed reopens.' })
      setVersionRemoveTarget(null)
      return
    }
    if (error) toast({ title: 'Could not remove the version', description: error.message, variant: 'destructive' })
  }

  // ---------- Syllabus node mutations ----------

  const submitNode = async (mode: 'add' | 'edit', values: NodeFormValues): Promise<PartSubmitResult> => {
    if (!selectedVersionId) return {}
    setBusy(true)
    const body = {
      name: values.name.trim(),
      parentId: values.parentId === 'root' ? null : values.parentId,
      topicId: values.topicId === 'none' ? null : values.topicId,
      priority: Number(values.priority) || 0,
      notes: values.notes.trim() || null,
    }
    const { data, error } =
      mode === 'add'
        ? await api.post<{ tree: AdminVersionTree }>(
            `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/nodes`,
            body
          )
        : await api.patch<{ tree: AdminVersionTree }>(
            `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/nodes/${nodeEditTarget?.id ?? ''}`,
            body
          )
    setBusy(false)
    if (data) {
      setTree(data.tree)
      setExpanded((current) => {
        const next = new Set(current)
        if (body.parentId) next.add(body.parentId as string)
        if (mode === 'edit' && nodeEditTarget) next.add(nodeEditTarget.id)
        return next
      })
      toast({ title: mode === 'add' ? 'Node added' : 'Node updated' })
      void loadExam()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not save the node', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const removeNode = async () => {
    if (!nodeRemoveTarget || !selectedVersionId) return
    setBusy(true)
    const { data, error } = await api.del<{ tree: AdminVersionTree }>(
      `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/nodes/${nodeRemoveTarget.id}`
    )
    setBusy(false)
    if (data) {
      setTree(data.tree)
      toast({ title: 'Node removed' })
      void loadExam()
      setNodeRemoveTarget(null)
      return
    }
    if (error) {
      toast({ title: 'Could not remove the node', description: error.message, variant: 'destructive' })
      setNodeRemoveTarget(null)
    }
  }

  const importOutline = async (outline: string): Promise<boolean> => {
    if (!selectedVersionId) return false
    setBusy(true)
    const { data, error } = await api.post<{ tree: AdminVersionTree }>(
      `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/import`,
      { outline }
    )
    setBusy(false)
    if (data) {
      setTree(data.tree)
      setExpanded(new Set(data.tree.tree.map((node) => node.id)))
      toast({ title: 'Staged tree replaced', description: `${data.tree.nodeCount} nodes now staged on this version.` })
      void loadExam()
      return true
    }
    if (error) {
      toast({ title: 'Import failed', description: error.message, variant: 'destructive' })
      return false
    }
    return false
  }

  // ---------- Mapping mutations ----------

  const searchUnits = useCallback(
    async (query: string): Promise<MappingUnitOption[]> => {
      if (!selectedVersionId || query.trim().length < 2) return []
      const { data } = await apiRef.current.get<{ units: MappingUnitOption[] }>(
        `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/mappings/units?q=${encodeURIComponent(
          query.trim()
        )}`
      )
      return data?.units ?? []
    },
    [examRef, selectedVersionId]
  )

  const createMapping = async (values: MappingFormValues): Promise<PartSubmitResult> => {
    if (!selectedVersionId) return {}
    setBusy(true)
    const { data, error } = await api.post<{ mappings: AdminVersionMappings }>(
      `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/mappings`,
      {
        unitRef: values.unitRef,
        nodeId: values.nodeId,
        relevance: values.relevance,
        priority: values.priority,
        requiredDepth: values.requiredDepth,
        questionLikelihood: values.questionLikelihood,
        ...(values.expectedScope.trim() ? { expectedScope: values.expectedScope.trim() } : { expectedScope: null }),
        ...(values.sourceBasis.trim() ? { sourceBasis: values.sourceBasis.trim() } : { sourceBasis: null }),
        effectiveFrom: values.effectiveFrom ? new Date(values.effectiveFrom).toISOString() : null,
        effectiveTo: values.effectiveTo ? new Date(values.effectiveTo).toISOString() : null,
        ...(values.notes.trim() ? { notes: values.notes.trim() } : { notes: null }),
      }
    )
    setBusy(false)
    if (data) {
      setMappingView(data.mappings)
      toast({ title: 'Knowledge unit mapped' })
      void loadExam()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not create the mapping', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const saveMapping = async (values: MappingFormValues): Promise<PartSubmitResult> => {
    if (!mappingEditTarget || !selectedVersionId) return {}
    setBusy(true)
    const { data, error } = await api.patch<{ mappings: AdminVersionMappings }>(
      `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/mappings/${mappingEditTarget.id}`,
      {
        relevance: values.relevance,
        priority: values.priority,
        requiredDepth: values.requiredDepth,
        questionLikelihood: values.questionLikelihood,
        ...(values.expectedScope.trim() ? { expectedScope: values.expectedScope.trim() } : { expectedScope: null }),
        ...(values.sourceBasis.trim() ? { sourceBasis: values.sourceBasis.trim() } : { sourceBasis: null }),
        effectiveFrom: values.effectiveFrom ? new Date(values.effectiveFrom).toISOString() : null,
        effectiveTo: values.effectiveTo ? new Date(values.effectiveTo).toISOString() : null,
        ...(values.notes.trim() ? { notes: values.notes.trim() } : { notes: null }),
      }
    )
    setBusy(false)
    if (data) {
      setMappingView(data.mappings)
      toast({ title: 'Mapping updated' })
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not update the mapping', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const removeMapping = async () => {
    if (!mappingRemoveTarget || !selectedVersionId) return
    setBusy(true)
    const { data, error } = await api.del<{ mappings: AdminVersionMappings }>(
      `/api/exams/admin/exams/${examRef}/versions/${selectedVersionId}/mappings/${mappingRemoveTarget.id}`
    )
    setBusy(false)
    if (data) {
      setMappingView(data.mappings)
      toast({ title: 'Mapping removed' })
      void loadExam()
      setMappingRemoveTarget(null)
      return
    }
    if (error) {
      toast({ title: 'Could not remove the mapping', description: error.message, variant: 'destructive' })
      setMappingRemoveTarget(null)
    }
  }

  // ---------- Derived ----------

  const selectedVersion = useMemo(
    () => exam?.versions.find((version) => version.id === selectedVersionId) ?? null,
    [exam, selectedVersionId]
  )
  const treeEditable = tree?.editability === 'staged'
  const mappingWritable = mappingView?.editability === 'staged' || mappingView?.editability === 'live'
  const flatMappingRows = useMemo(() => (mappingView ? flattenMappings(mappingView.tree) : []), [mappingView])
  const versionIsRemovable = (version: ExamVersionRef, index: number) =>
    version.isUpcoming && index === 0 && version.nodeCount === 0 && version.mappingCount === 0

  const toggleExpand = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // ---------- Render ----------

  if (examLoading && !exam) {
    return (
      <div className="space-y-5">
        <ConsolePageHeader
          title="Exam"
          description="Loading the exam…"
          icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
        />
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <TableSkeleton rows={6} cols={5} />
        </div>
      </div>
    )
  }

  if (examError || !exam) {
    return (
      <div className="space-y-5">
        <ConsolePageHeader
          title="Exam not found"
          description={examError ?? 'This exam could not be loaded.'}
          icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
          actions={
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigateToPath('/console/exams')}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to exams
            </Button>
          }
        />
        <ErrorNotice message={examError ?? 'Exam not found'} onRetry={() => void loadExam()} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ---------- Header ---------- */}
      <ConsolePageHeader
        title={exam.name}
        description={`${exam.organiser} · ${exam.countryName} (${exam.countryIso}) · ${exam.level.toLowerCase()} level · ${exam.slug} / ${exam.code}`}
        icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <StatusBadge status={exam.status} />
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => navigateToPath('/console/exams')}>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              All exams
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                setExamLoading(true)
                void loadExam()
              }}
              disabled={examLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${examLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setEditOpen(true)}
              disabled={exam.editability === 'none'}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </Button>
            {exam.allowedTransitions
              .filter((action) => action !== 'retire')
              .map((action) => (
                <Button
                  key={action}
                  size="sm"
                  className="h-8 bg-emerald-600 hover:bg-emerald-700"
                  disabled={busy}
                  onClick={() => void runTransition(action)}
                >
                  {action === 'activate' ? 'Activate' : action === 'reactivate' ? 'Reactivate' : 'Deactivate'}
                </Button>
              ))}
            {exam.allowedTransitions.includes('retire') && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                disabled={busy}
                onClick={() => void runTransition('retire')}
                title="Retire — the audited end-of-life (exams are never hard-deleted)"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Retire
              </Button>
            )}
          </>
        }
      />

      {/* ---------- Overview ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Overview</h2>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <MetaRow label="Organiser" value={exam.organiser} />
            <MetaRow label="Country" value={`${exam.countryName} (${exam.countryIso})`} />
            <MetaRow label="Level" value={<span className="uppercase">{exam.level}</span>} />
            <MetaRow label="Versions" value={exam.versionCount} />
            <MetaRow label="Current version" value={exam.currentVersion ? exam.currentVersion.label : '—'} />
            <MetaRow label="Updated" value={formatWhen(exam.updatedAt)} />
          </div>
          {exam.description && (
            <p className="mt-3 border-t border-zinc-100 pt-3 text-[13px] leading-relaxed text-zinc-600">
              {exam.description}
            </p>
          )}
          {exam.notes && (
            <p className="mt-2 rounded-md bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-500">
              <span className="font-medium text-zinc-600">Notes:</span> {exam.notes}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Selected version</h2>
          {selectedVersion ? (
            <div>
              <MetaRow label="Label" value={selectedVersion.label} />
              <MetaRow
                label="Window"
                value={`${fmtDay(selectedVersion.effectiveFrom)} → ${
                  selectedVersion.effectiveTo ? fmtDay(selectedVersion.effectiveTo) : 'open'
                }`}
              />
              <MetaRow label="State" value={<VersionStateBadge version={selectedVersion} />} />
              <MetaRow label="Nodes" value={selectedVersion.nodeCount} />
              <MetaRow label="Mappings" value={selectedVersion.mappingCount} />
              {selectedVersion.source && <MetaRow label="Source" value={selectedVersion.source} />}
            </div>
          ) : (
            <p className="text-[13px] text-zinc-400">No versions yet — create the first syllabus version below.</p>
          )}
        </div>
      </div>

      {/* ---------- Versions ---------- */}
      <section className="space-y-3" aria-labelledby="versions-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="versions-heading" className="text-[15px] font-semibold tracking-tight text-zinc-900">
              Version history
            </h2>
            <p className="text-xs text-zinc-500">
              Append-only windows — the version whose window contains <em>now</em> is the current one; syllabus
              changes create a new version.
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setVersionCreateOpen(true)}
            disabled={exam.editability === 'none'}
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
            New version
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80">
                  {['Version', 'Window', 'State', 'Nodes', 'Mappings', 'Updated', ''].map((header) => (
                    <th
                      key={header}
                      scope="col"
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exam.versions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-2">
                      <EmptyState
                        title="No versions yet"
                        hint="Create the first syllabus version — a DRAFT exam stages its tree privately until you activate it."
                      />
                    </td>
                  </tr>
                )}
                {exam.versions.map((version, index) => {
                  const isSelected = version.id === selectedVersionId
                  return (
                    <tr
                      key={version.id}
                      className={cn(
                        'cursor-pointer border-b border-zinc-100 last:border-0 transition-colors hover:bg-emerald-50/30',
                        isSelected && 'bg-emerald-50/50'
                      )}
                      onClick={() => selectVersion(version.id)}
                    >
                      <td className="px-3 py-2 text-[13px]">
                        <span className="font-medium text-zinc-900">{version.label}</span>
                        {isSelected && (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0 text-[10px] font-medium uppercase text-emerald-700">
                            viewing
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[13px] text-zinc-500">
                        {fmtDay(version.effectiveFrom)} → {version.effectiveTo ? fmtDay(version.effectiveTo) : 'open'}
                      </td>
                      <td className="px-3 py-2">
                        <VersionStateBadge version={version} />
                      </td>
                      <td className="px-3 py-2 text-[13px] tabular-nums text-zinc-500">{version.nodeCount}</td>
                      <td className="px-3 py-2 text-[13px] tabular-nums text-zinc-500">{version.mappingCount}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-[13px] text-zinc-400">
                        {formatWhen(version.updatedAt)}
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setVersionEditTarget(version)}
                            title="Edit label / source / notes"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          {versionIsRemovable(version, index) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                              onClick={() => setVersionRemoveTarget(version)}
                              title="Remove future-dated correction"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---------- Syllabus tree ---------- */}
      <section className="space-y-3" aria-labelledby="syllabus-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="syllabus-heading" className="text-[15px] font-semibold tracking-tight text-zinc-900">
              Syllabus tree
              {selectedVersion && <span className="ml-2 font-normal text-zinc-400">· {selectedVersion.label}</span>}
            </h2>
            <p className="text-xs text-zinc-500">
              Version-pinned nodes with the canonical topic link — the only exam → taxonomy bridge.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setImportOpen(true)}
              disabled={!treeEditable}
              title={treeEditable ? 'Bulk-replace the staged tree from an indented outline' : 'Only staged trees can be imported'}
            >
              <FileInput className="h-3.5 w-3.5" aria-hidden="true" />
              Import outline
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => {
                setNodeAddParent(null)
                setNodeAddOpen(true)
              }}
              disabled={!treeEditable}
              title={treeEditable ? 'Add a root node' : 'Only staged trees can be edited'}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add node
            </Button>
          </div>
        </div>

        {treeLoading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <TableSkeleton rows={5} cols={4} />
          </div>
        ) : treeError ? (
          <ErrorNotice message={treeError} onRetry={reloadVersionData} />
        ) : !selectedVersion ? (
          <EmptyState title="No version selected" hint="Create a version first — the tree is pinned to one." />
        ) : (
          <div className="space-y-3">
            {tree && (
              <EditabilityBanner
                editability={tree.editability}
                reason={tree.editabilityReason}
                context={`${tree.version.label} · ${tree.nodeCount} node${tree.nodeCount === 1 ? '' : 's'}`}
              />
            )}
            <div
              className="max-h-[28rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-sm"
              role="tree"
              aria-label="Syllabus tree"
            >
              {tree && tree.tree.length > 0 ? (
                <ul>
                  {tree.tree.map((node) => (
                    <SyllabusTreeRow
                      key={node.id}
                      node={node}
                      depth={0}
                      expanded={expanded}
                      onToggle={toggleExpand}
                      onAddChild={(target) => {
                        setNodeAddParent(target)
                        setNodeAddOpen(true)
                      }}
                      onEdit={(target) => setNodeEditTarget(target)}
                      onRemove={(target) => setNodeRemoveTarget(target)}
                      editable={treeEditable}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="Empty tree"
                  hint={
                    treeEditable
                      ? 'Add the first node or import an official-notification outline (2 spaces per level).'
                      : 'This version has no nodes.'
                  }
                />
              )}
            </div>
          </div>
        )}
      </section>

      {/* ---------- Mappings ---------- */}
      <section className="space-y-3" aria-labelledby="mappings-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="mappings-heading" className="text-[15px] font-semibold tracking-tight text-zinc-900">
              Knowledge mappings
              {selectedVersion && <span className="ml-2 font-normal text-zinc-400">· {selectedVersion.label}</span>}
            </h2>
            <p className="text-xs text-zinc-500">
              The §8 requirement layer — which canonical units this exam needs, per syllabus node, at what depth.
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              setMappingDefaultNode('')
              setMappingAddOpen(true)
            }}
            disabled={!mappingWritable || (tree?.nodeCount ?? selectedVersion?.nodeCount ?? 0) === 0}
            title={
              !mappingWritable
                ? 'Mappings are writable on staged or live versions only'
                : 'Anchor a knowledge unit to a syllabus node'
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Map unit
          </Button>
        </div>

        {mappingLoading ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <TableSkeleton rows={4} cols={5} />
          </div>
        ) : !selectedVersion ? (
          <EmptyState title="No version selected" hint="Mappings are pinned to a version." />
        ) : mappingView ? (
          <div className="space-y-3">
            <EditabilityBanner
              editability={mappingView.editability}
              reason={mappingView.editabilityReason}
              context={`${mappingView.version.label} · ${mappingView.mappingCount} mapping${
                mappingView.mappingCount === 1 ? '' : 's'
              }`}
            />
            {flatMappingRows.length === 0 ? (
              <EmptyState
                title="No units mapped yet"
                hint="Map a canonical knowledge unit to a syllabus node to start building what this exam needs."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50/80">
                        {['Unit', 'Syllabus node', 'Depth', 'Priority', 'Likelihood', 'Updated', ''].map((header) => (
                          <th
                            key={header}
                            scope="col"
                            className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {flatMappingRows.map(({ mapping, nodeName }) => (
                        <tr
                          key={mapping.id}
                          className="border-b border-zinc-100 last:border-0 transition-colors hover:bg-emerald-50/30"
                        >
                          <td className="px-3 py-2 text-[13px]">
                            <p className="max-w-[240px] truncate font-medium text-zinc-900" title={mapping.unit.canonicalName}>
                              {mapping.unit.canonicalName}
                            </p>
                            <p className="truncate font-mono text-[10px] text-zinc-400">
                              {mapping.unit.slug} · {mapping.unit.type.toLowerCase()}
                            </p>
                          </td>
                          <td className="max-w-[200px] truncate px-3 py-2 text-[13px] text-zinc-500" title={nodeName}>
                            {nodeName}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant="outline"
                              className="border-teal-200 bg-teal-50 px-2 py-0 text-[11px] text-teal-700"
                            >
                              {DEPTH_SHORT[mapping.requiredDepth] ?? mapping.requiredDepth}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-[13px] text-zinc-500">{mapping.priority.toLowerCase()}</td>
                          <td className="px-3 py-2 text-[13px] text-zinc-500">
                            {mapping.questionLikelihood.toLowerCase()}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-[13px] text-zinc-400">
                            {formatWhen(mapping.updatedAt)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                disabled={!mappingWritable}
                                onClick={() => setMappingEditTarget(mapping)}
                                title="Edit §8 metadata"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                                disabled={!mappingWritable}
                                onClick={() => setMappingRemoveTarget(mapping)}
                                title="Remove mapping"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : (
          <EmptyState title="Mappings unavailable" hint="The mapping read failed — refresh the page." />
        )}
      </section>

      {/* ---------- Dialogs (mounted per open) ---------- */}
      {editOpen && (
        <ExamFormDialog
          mode="edit"
          exam={exam}
          countries={countries}
          onSubmit={saveExamFields}
          busy={busy}
          onClose={() => setEditOpen(false)}
        />
      )}

      {versionCreateOpen && (
        <VersionFormDialog
          mode="create"
          version={null}
          onSubmit={createVersion}
          busy={busy}
          onClose={() => setVersionCreateOpen(false)}
        />
      )}
      {versionEditTarget && (
        <VersionFormDialog
          mode="edit"
          version={versionEditTarget}
          onSubmit={saveVersion}
          busy={busy}
          onClose={() => setVersionEditTarget(null)}
        />
      )}

      {nodeAddOpen && (
        <NodeFormDialog
          mode="add"
          node={nodeAddParent}
          tree={tree?.tree ?? []}
          countryIso={exam.countryIso}
          onSubmit={(values) => submitNode('add', values)}
          busy={busy}
          onClose={() => setNodeAddOpen(false)}
        />
      )}
      {nodeEditTarget && (
        <NodeFormDialog
          mode="edit"
          node={nodeEditTarget}
          tree={tree?.tree ?? []}
          countryIso={exam.countryIso}
          onSubmit={(values) => submitNode('edit', values)}
          busy={busy}
          onClose={() => setNodeEditTarget(null)}
        />
      )}

      {importOpen && (
        <ImportOutlineDialog onSubmit={importOutline} busy={busy} onClose={() => setImportOpen(false)} />
      )}

      {mappingAddOpen && (
        <MappingFormDialog
          mode="add"
          mapping={null}
          mappingView={mappingView}
          defaultNodeId={mappingDefaultNode}
          onSearchUnits={searchUnits}
          onSubmit={createMapping}
          busy={busy}
          onClose={() => setMappingAddOpen(false)}
        />
      )}
      {mappingEditTarget && (
        <MappingFormDialog
          mode="edit"
          mapping={mappingEditTarget}
          mappingView={mappingView}
          defaultNodeId=""
          onSearchUnits={searchUnits}
          onSubmit={saveMapping}
          busy={busy}
          onClose={() => setMappingEditTarget(null)}
        />
      )}

      {/* ---------- Confirmations ---------- */}
      <AlertDialog open={versionRemoveTarget !== null} onOpenChange={(open) => !open && setVersionRemoveTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{versionRemoveTarget?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Only future-dated, unreferenced versions can be removed as a correction. The predecessor window it
              auto-closed reopens.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void removeVersion()
              }}
            >
              Remove version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={nodeRemoveTarget !== null} onOpenChange={(open) => !open && setNodeRemoveTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{nodeRemoveTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Leaf nodes only — remove children first. The staged tree loses this node immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void removeNode()
              }}
            >
              Remove node
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={mappingRemoveTarget !== null} onOpenChange={(open) => !open && setMappingRemoveTarget(null)}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Unmap “{mappingRemoveTarget?.unit.canonicalName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The requirement row is removed from this version. Re-anchoring later means creating the mapping
              again (both acts are audited).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void removeMapping()
              }}
            >
              Remove mapping
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
