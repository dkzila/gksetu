'use client'

/**
 * GKSetu Console — Taxonomy (CONSOLE-S1-E).
 *
 * The one global framework (§13): the full admin tree on the left — every
 * status, country extensions badged, RETIRED nodes dimmed — and the selected
 * node's editor on the right: canonical identity, per-language labels and
 * aliases (§35 rendering dimensions, replace-all semantics), child creation,
 * metadata edits, moves and the leaf-first soft retire (§36). Permission
 * flags come from the server per node — the UI never decides access.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleOff,
  Globe2,
  Layers,
  Loader2,
  MapPin,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Tag,
  Trash2,
  X,
} from 'lucide-react'

import {
  ConsolePageHeader,
  ErrorNotice,
  MetaRow,
  StatusBadge,
  TableSkeleton,
  formatWhen,
} from '@/components/console/ui/primitives'
import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
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
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import type { AdminTopicDetail, AdminTopicNode } from '@/modules/taxonomy/types'

import { fetchActiveCountries, slugify, type CountryRef } from './exam-console-shared'

// ---------- Presentation helpers ----------

const TYPE_ICON: Record<string, React.ReactNode> = {
  DOMAIN: <Layers className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />,
  BRANCH: <Globe2 className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />,
  TOPIC: <Tag className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />,
}

interface LanguageRef {
  code: string
  name: string
  status: string
}

interface FlatNode {
  id: string
  slug: string
  canonicalName: string
  label: string
  depth: number
  status: string
}

function flattenTree(nodes: AdminTopicNode[], depth = 0, prefix = ''): FlatNode[] {
  return nodes.flatMap((node) => {
    const label = `${prefix}${node.canonicalName}`
    return [
      { id: node.id, slug: node.slug, canonicalName: node.canonicalName, label, depth, status: node.status },
      ...flattenTree(node.children, depth + 1, `${prefix}  `),
    ]
  })
}

// ---------- Tree row ----------

function TreeRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: AdminTopicNode
  depth: number
  expanded: Set<string>
  selectedId: string | null
  onToggle: (id: string) => void
  onSelect: (id: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.id)
  const isSelected = selectedId === node.id
  const retired = node.status === 'RETIRED'

  return (
    <li role="treeitem" aria-selected={isSelected} aria-expanded={hasChildren ? isOpen : undefined} className="min-w-0">
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors',
          isSelected ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-zinc-100'
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
            aria-label={isOpen ? `Collapse ${node.canonicalName}` : `Expand ${node.canonicalName}`}
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
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className={cn(
              'h-2 w-2 shrink-0 rounded-full',
              node.status === 'ACTIVE' ? 'bg-emerald-500' : node.status === 'INACTIVE' ? 'bg-amber-400' : 'bg-zinc-300'
            )}
            aria-hidden="true"
          />
          <span aria-hidden="true">{TYPE_ICON[node.type]}</span>
          <span
            className={cn('truncate text-[13px]', retired ? 'text-zinc-400 line-through' : 'text-zinc-800')}
            title={node.canonicalName}
          >
            {node.canonicalName}
          </span>
          {node.scope === 'COUNTRY' && (
            <Badge className="shrink-0 bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
              <MapPin className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
              {node.countryIso}
            </Badge>
          )}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------- Label / alias editor rows ----------

interface LabelRow {
  language: string
  name: string
}

interface AliasRow {
  value: string
  language: string // '' = language-neutral
}

function LabelEditor({
  rows,
  languages,
  onChange,
  disabled,
}: {
  rows: LabelRow[]
  languages: LanguageRef[]
  onChange: (rows: LabelRow[]) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <select
            value={row.language}
            disabled={disabled}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, language: event.target.value }
              onChange(next)
            }}
            aria-label={`Label ${index + 1} language`}
            className="h-8 w-[110px] shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
          >
            <option value="">Language…</option>
            {languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.code} · {language.name}
              </option>
            ))}
          </select>
          <Input
            value={row.name}
            disabled={disabled}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, name: event.target.value }
              onChange(next)
            }}
            placeholder="Labelled name"
            className="h-8 flex-1 text-[13px]"
            aria-label={`Label ${index + 1} name`}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-red-600 hover:text-red-700"
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
            aria-label="Remove label"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        disabled={disabled || rows.length >= 20}
        onClick={() => onChange([...rows, { language: '', name: '' }])}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add label
      </Button>
    </div>
  )
}

function AliasEditor({
  rows,
  languages,
  onChange,
  disabled,
}: {
  rows: AliasRow[]
  languages: LanguageRef[]
  onChange: (rows: AliasRow[]) => void
  disabled: boolean
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            value={row.value}
            disabled={disabled}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, value: event.target.value }
              onChange(next)
            }}
            placeholder="Alternate search term"
            className="h-8 flex-1 text-[13px]"
            aria-label={`Alias ${index + 1}`}
          />
          <select
            value={row.language}
            disabled={disabled}
            onChange={(event) => {
              const next = [...rows]
              next[index] = { ...row, language: event.target.value }
              onChange(next)
            }}
            aria-label={`Alias ${index + 1} language`}
            className="h-8 w-[110px] shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
          >
            <option value="">Any language</option>
            {languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.code} · {language.name}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 shrink-0 p-0 text-red-600 hover:text-red-700"
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, position) => position !== index))}
            aria-label="Remove alias"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1 text-xs"
        disabled={disabled || rows.length >= 20}
        onClick={() => onChange([...rows, { value: '', language: '' }])}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Add alias
      </Button>
    </div>
  )
}

// ---------- Create dialog ----------

interface CreateValues {
  canonicalName: string
  slug: string
  type: string
  scope: string
  country: string
  parent: string
  description: string
  orderIndex: string
}

function CreateNodeDialog({
  parentSlug,
  parentName,
  flatNodes,
  countries,
  isAdmin,
  onSubmit,
  busy,
  onClose,
}: {
  parentSlug: string
  parentName: string | null
  flatNodes: FlatNode[]
  countries: CountryRef[]
  isAdmin: boolean
  onSubmit: (values: CreateValues) => Promise<boolean>
  busy: boolean
  onClose: () => void
}) {
  const [values, setValues] = useState<CreateValues>(() => ({
    canonicalName: '',
    slug: '',
    type: 'BRANCH',
    scope: 'GLOBAL',
    country: '',
    parent: parentSlug,
    description: '',
    orderIndex: '0',
  }))
  const [slugTouched, setSlugTouched] = useState(false)

  const hasParent = Boolean(values.parent)

  const submit = async () => {
    const payload: CreateValues = {
      ...values,
      type: hasParent ? values.type : 'DOMAIN',
      scope: hasParent ? values.scope : 'GLOBAL',
    }
    const ok = await onSubmit(payload)
    if (ok) onClose()
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
          <DialogTitle>{parentName ? `New child under “${parentName}”` : 'New taxonomy node'}</DialogTitle>
          <DialogDescription>
            Slug, type and scope are immutable after creation. Global nodes never carry a country; country
            extensions live under a global parent.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="taxo-parent">Parent</Label>
            <select
              id="taxo-parent"
              value={values.parent}
              onChange={(event) => setValues((current) => ({ ...current, parent: event.target.value }))}
              className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            >
              <option value="">— root domain —</option>
              {flatNodes
                .filter((node) => node.status !== 'RETIRED')
                .map((node) => (
                  <option key={node.id} value={node.slug}>
                    {node.label.trim()}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="taxo-type">Type</Label>
              <select
                id="taxo-type"
                value={hasParent ? values.type : 'DOMAIN'}
                disabled={!hasParent || !isAdmin}
                onChange={(event) => setValues((current) => ({ ...current, type: event.target.value }))}
                className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
              >
                <option value="DOMAIN" disabled>Domain (root)</option>
                <option value="BRANCH">Branch</option>
                <option value="TOPIC">Topic</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxo-scope">Scope</Label>
              <select
                id="taxo-scope"
                value={hasParent ? values.scope : 'GLOBAL'}
                disabled={!hasParent || !isAdmin}
                onChange={(event) => setValues((current) => ({ ...current, scope: event.target.value }))}
                className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
              >
                <option value="GLOBAL">Global</option>
                <option value="COUNTRY">Country extension</option>
              </select>
            </div>
          </div>
          {hasParent && values.scope === 'COUNTRY' && (
            <div className="space-y-1.5">
              <Label htmlFor="taxo-country">Country</Label>
              <select
                id="taxo-country"
                value={values.country}
                onChange={(event) => setValues((current) => ({ ...current, country: event.target.value }))}
                className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                <option value="">Pick a country…</option>
                {countries.map((country) => (
                  <option key={country.isoCode} value={country.isoCode}>
                    {country.name} ({country.isoCode})
                  </option>
                ))}
              </select>
              {values.scope === 'COUNTRY' && !values.country && <p className="text-xs text-red-600">A country is required for country extensions.</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="taxo-name">
              Canonical name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="taxo-name"
              value={values.canonicalName}
              onChange={(event) => {
                setValues((current) => ({ ...current, canonicalName: event.target.value }))
                if (!slugTouched) setValues((current) => ({ ...current, slug: slugify(event.target.value, 64) }))
              }}
              placeholder="e.g. Environmental Laws"
              className="h-8 text-[13px]"
            />
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="taxo-slug">Slug (immutable)</Label>
              <Input
                id="taxo-slug"
                value={values.slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setValues((current) => ({ ...current, slug: slugify(event.target.value, 64) }))
                }}
                placeholder="environmental-laws"
                className="h-8 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxo-order">Order</Label>
              <Input
                id="taxo-order"
                type="number"
                min={0}
                max={9999}
                value={values.orderIndex}
                onChange={(event) => setValues((current) => ({ ...current, orderIndex: event.target.value }))}
                className="h-8 text-[13px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="taxo-description">Description (optional)</Label>
            <Input
              id="taxo-description"
              value={values.description}
              onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
              placeholder="What this node covers"
              className="h-8 text-[13px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void submit()}
            disabled={busy || values.canonicalName.trim().length < 2 || values.slug.length < 2 || (values.scope === 'COUNTRY' && hasParent && !values.country)}
          >
            Create node
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- The page ----------

export function TaxonomyPage() {
  const { toast } = useToast()
  const api = useConsoleApi()
  const canManage = useHasPermission('taxonomy:manage')
  // `useConsoleApi()` returns a fresh object each render — keep it behind a ref
  // (updated in the first effect) so loaders stay identity-stable and effects
  // run once, not every render.
  const apiRef = useRef(api)

  useEffect(() => {
    apiRef.current = api
  })

  const [tree, setTree] = useState<AdminTopicNode[] | null>(null)
  const [treeMeta, setTreeMeta] = useState<{ actorRole: string; scope: string; nodeCount: number } | null>(null)
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminTopicDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const [languages, setLanguages] = useState<LanguageRef[]>([])
  const [countries, setCountries] = useState<CountryRef[]>([])

  // Editor state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [orderIndex, setOrderIndex] = useState('0')
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const [parentSlug, setParentSlug] = useState('')
  const [labelRows, setLabelRows] = useState<LabelRow[]>([])
  const [aliasRows, setAliasRows] = useState<AliasRow[]>([])

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [createParentSlug, setCreateParentSlug] = useState('')
  const [createParentName, setCreateParentName] = useState<string | null>(null)
  const [retireOpen, setRetireOpen] = useState(false)

  const flatNodes = useMemo(() => (tree ? flattenTree(tree) : []), [tree])

  const loadTree = useCallback(async () => {
    const { data, error } = await apiRef.current.get<{
      actorRole: string
      scope: string
      nodeCount: number
      tree: AdminTopicNode[]
    }>('/api/taxonomy/admin/tree')
    if (data) {
      setTree(data.tree)
      setTreeMeta({ actorRole: data.actorRole, scope: data.scope, nodeCount: data.nodeCount })
      setTreeError(null)
    } else {
      setTree([])
      setTreeError(error?.message ?? 'Could not load the taxonomy')
    }
    setTreeLoading(false)
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await apiRef.current.get<{ languages: LanguageRef[] }>('/api/languages')
      if (cancelled) return
      if (data) setLanguages(data.languages.filter((language) => language.status === 'ACTIVE'))
    }
    void load()
    void fetchActiveCountries().then((list) => {
      if (!cancelled) setCountries(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadDetail = useCallback(
    async (id: string) => {
      setSelectedId(id)
      setDetail(null)
      setDetailLoading(true)
      const { data, error } = await api.get<{ topic: AdminTopicDetail }>(`/api/taxonomy/admin/nodes/${id}`)
      if (data) {
        const topic = data.topic
        setDetail(topic)
        setName(topic.canonicalName)
        setDescription(topic.description ?? '')
        setOrderIndex(String(topic.orderIndex))
        setStatus(topic.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')
        setParentSlug(topic.parentSlug ?? '')
        setLabelRows(topic.labels.map((label) => ({ language: label.language, name: label.name })))
        setAliasRows(topic.aliases.map((alias) => ({ value: alias.value, language: alias.language ?? '' })))
      } else {
        toast({ title: 'Could not load the node', description: error?.message, variant: 'destructive' })
      }
      setDetailLoading(false)
    },
    [api, toast]
  )

  const runAction = useCallback(
    async (path: string, init: { method: string; body?: unknown }, successMessage: string): Promise<AdminTopicDetail | null> => {
      setBusy(true)
      const { data, error } =
        init.method === 'DELETE'
          ? await api.del<{ topic: AdminTopicDetail }>(path)
          : init.method === 'PATCH'
            ? await api.patch<{ topic: AdminTopicDetail }>(path, init.body)
            : init.method === 'PUT'
              ? await api.put<{ topic: AdminTopicDetail }>(path, init.body)
              : await api.post<{ topic: AdminTopicDetail }>(path, init.body)
      setBusy(false)
      if (data) {
        setDetail(data.topic)
        toast({ title: successMessage })
        await loadTree()
        return data.topic
      }
      toast({ title: 'Operation failed', description: error?.message, variant: 'destructive' })
      return null
    },
    [api, toast, loadTree]
  )

  const saveBasics = async () => {
    if (!detail) return
    await runAction(
      `/api/taxonomy/admin/nodes/${detail.id}`,
      {
        method: 'PATCH',
        body: {
          canonicalName: name.trim(),
          description: description.trim().length === 0 ? null : description.trim(),
          orderIndex: Number(orderIndex) || 0,
          ...(detail.status !== 'RETIRED' ? { status } : {}),
        },
      },
      'Node updated'
    )
  }

  const moveNode = async () => {
    if (!detail) return
    await runAction(
      `/api/taxonomy/admin/nodes/${detail.id}`,
      { method: 'PATCH', body: { parent: parentSlug } },
      'Node moved'
    )
  }

  const saveLabels = async () => {
    if (!detail) return
    const labels = labelRows
      .filter((row) => row.language && row.name.trim().length > 0)
      .map((row) => ({ language: row.language, name: row.name.trim() }))
    await runAction(`/api/taxonomy/admin/nodes/${detail.id}/labels`, { method: 'PUT', body: { labels } }, 'Labels saved')
  }

  const saveAliases = async () => {
    if (!detail) return
    const aliases = aliasRows
      .filter((row) => row.value.trim().length > 0)
      .map((row) => ({ value: row.value.trim(), ...(row.language ? { language: row.language } : {}) }))
    await runAction(`/api/taxonomy/admin/nodes/${detail.id}/aliases`, { method: 'PUT', body: { aliases } }, 'Aliases saved')
  }

  const retireNode = async () => {
    if (!detail) return
    const updated = await runAction(`/api/taxonomy/admin/nodes/${detail.id}`, { method: 'DELETE' }, 'Node retired (soft-delete)')
    if (updated) setRetireOpen(false)
  }

  const createNode = async (values: CreateValues): Promise<boolean> => {
    const payload: Record<string, unknown> = {
      canonicalName: values.canonicalName.trim(),
      slug: values.slug.trim(),
      type: values.parent ? values.type : 'DOMAIN',
      scope: values.parent ? values.scope : 'GLOBAL',
      orderIndex: Number(values.orderIndex) || 0,
    }
    if (values.parent) payload.parent = values.parent
    if (values.parent && values.scope === 'COUNTRY') payload.country = values.country
    if (values.description.trim().length > 0) payload.description = values.description.trim()

    const created = await runAction('/api/taxonomy/admin/nodes', { method: 'POST', body: payload }, 'Node created')
    if (created) {
      setCreateOpen(false)
      await loadDetail(created.id)
      // expand the parent so the new node is visible in the tree
      if (values.parent) {
        const parent = flatNodes.find((node) => node.slug === values.parent)
        if (parent) setExpanded((current) => new Set(current).add(parent.id))
      }
      return true
    }
    return false
  }

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const isAdmin = treeMeta?.actorRole === 'ADMIN'
  const canEdit = detail?.permissions.canEdit === true && detail.status !== 'RETIRED'
  const readOnly = detail !== null && !canEdit

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Taxonomy"
        description="The one global knowledge framework — domains, branches and topics with per-country extensions. Labels and aliases are rendering dimensions of a single canonical record; slugs, type and scope are immutable."
        icon={<Network className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => {
                setTreeLoading(true)
                void loadTree()
              }}
              disabled={treeLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${treeLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              disabled={!canManage}
              onClick={() => {
                setCreateParentSlug('')
                setCreateParentName(null)
                setCreateOpen(true)
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              New node
            </Button>
          </>
        }
      />

      {treeMeta && (
        <p className="text-xs text-zinc-400">
          {isAdmin ? 'Platform admin — full control, including global nodes and root domains.' : `Country scope: ${treeMeta.scope}`}{' '}
          · {treeMeta.nodeCount} nodes
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-5">
        {/* ---------- Tree ---------- */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Full tree</h2>
            <span className="text-xs tabular-nums text-zinc-400">{flatNodes.length} nodes</span>
          </div>
          {treeLoading && !tree ? (
            <TableSkeleton rows={7} cols={3} />
          ) : treeError ? (
            <ErrorNotice
              message={treeError}
              onRetry={() => {
                setTreeLoading(true)
                void loadTree()
              }}
            />
          ) : (
            <ul role="tree" aria-label="Admin taxonomy tree" className="max-h-[36rem] overflow-y-auto">
              {tree?.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  selectedId={selectedId}
                  onToggle={toggle}
                  onSelect={(id) => void loadDetail(id)}
                />
              ))}
            </ul>
          )}
        </div>

        {/* ---------- Detail panel ---------- */}
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:col-span-3">
          {detailLoading && !detail ? (
            <TableSkeleton rows={6} cols={4} />
          ) : !detail ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Network className="h-8 w-8 text-zinc-300" aria-hidden="true" />
              <p className="text-sm font-medium text-zinc-600">Select a node from the tree</p>
              <p className="max-w-sm text-xs text-zinc-400">
                Its canonical identity, labels, aliases and lifecycle controls open here.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden="true">{TYPE_ICON[detail.type]}</span>
                <h3 className="text-base font-semibold tracking-tight text-zinc-900">{detail.canonicalName}</h3>
                <StatusBadge status={detail.status} />
                {detail.scope === 'COUNTRY' ? (
                  <Badge className="bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
                    <MapPin className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                    {detail.countryIso}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] font-normal text-zinc-500">
                    GLOBAL
                  </Badge>
                )}
                {readOnly && (
                  <Badge variant="outline" className="border-zinc-300 text-[10px] font-normal text-zinc-500">
                    read-only for your role
                  </Badge>
                )}
                <span className="ml-auto font-mono text-[11px] text-zinc-400">/{detail.slug}</span>
              </div>

              {detail.path.length > 1 && (
                <p className="text-xs text-zinc-500">{detail.path.map((entry) => entry.canonicalName).join(' › ')}</p>
              )}

              <div className="grid gap-x-8 border-t border-zinc-100 pt-3 sm:grid-cols-2">
                <MetaRow label="Type" value={<span className="uppercase">{detail.type}</span>} />
                <MetaRow
                  label="Children"
                  value={`${detail.childCount} (${detail.childStatuses.active} active · ${detail.childStatuses.inactive} inactive · ${detail.childStatuses.retired} retired)`}
                />
                <MetaRow label="Created" value={formatWhen(detail.createdAt)} />
                <MetaRow label="Updated" value={formatWhen(detail.updatedAt)} />
              </div>

              {/* Basics */}
              <section className="space-y-3">
                <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-zinc-700">
                  <Pencil className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Basics
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="taxo-edit-name">Canonical name</Label>
                    <Input
                      id="taxo-edit-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={!canEdit}
                      className="h-8 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="taxo-edit-order">Order index</Label>
                    <Input
                      id="taxo-edit-order"
                      type="number"
                      min={0}
                      max={9999}
                      value={orderIndex}
                      onChange={(event) => setOrderIndex(event.target.value)}
                      disabled={!canEdit}
                      className="h-8 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="taxo-edit-description">Description</Label>
                    <Input
                      id="taxo-edit-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      disabled={!canEdit}
                      className="h-8 text-[13px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="taxo-edit-status">Visibility</Label>
                    <select
                      id="taxo-edit-status"
                      value={status}
                      onChange={(event) => setStatus(event.target.value as 'ACTIVE' | 'INACTIVE')}
                      disabled={!canEdit}
                      className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
                    >
                      <option value="ACTIVE">Active (visible)</option>
                      <option value="INACTIVE">Inactive (hidden, reversible)</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => void saveBasics()}
                      disabled={!canEdit || busy}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                      Save basics
                    </Button>
                  </div>
                </div>
              </section>

              {/* Move */}
              {detail.type !== 'DOMAIN' && (
                <section className="space-y-3 rounded-lg border border-zinc-200 p-3">
                  <div>
                    <h4 className="text-[13px] font-semibold text-zinc-700">Move node</h4>
                    <p className="text-xs text-zinc-400">Cycles and cross-country moves are rejected server-side.</p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Label htmlFor="taxo-edit-parent">Parent</Label>
                      <select
                        id="taxo-edit-parent"
                        value={parentSlug}
                        onChange={(event) => setParentSlug(event.target.value)}
                        disabled={!detail.permissions.canMove || detail.status === 'RETIRED'}
                        className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:opacity-50"
                      >
                        <option value="">— root domain —</option>
                        {flatNodes
                          .filter((node) => node.id !== detail.id && node.status !== 'RETIRED')
                          .map((node) => (
                            <option key={node.id} value={node.slug}>
                              {node.label.trim()}
                            </option>
                          ))}
                      </select>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => void moveNode()}
                      disabled={!detail.permissions.canMove || detail.status === 'RETIRED' || busy}
                    >
                      Move
                    </Button>
                  </div>
                </section>
              )}

              {/* Labels */}
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-zinc-700">Labels (per language)</h4>
                  <span className="text-xs text-zinc-400">{labelRows.length} · replaces all on save</span>
                </div>
                <LabelEditor
                  rows={labelRows}
                  languages={languages}
                  onChange={setLabelRows}
                  disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED'}
                />
                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => void saveLabels()}
                  disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED' || busy}
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  Save labels
                </Button>
              </section>

              {/* Aliases */}
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[13px] font-semibold text-zinc-700">Aliases (search terms)</h4>
                  <span className="text-xs text-zinc-400">{aliasRows.length} · replaces all on save</span>
                </div>
                <AliasEditor
                  rows={aliasRows}
                  languages={languages}
                  onChange={setAliasRows}
                  disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED'}
                />
                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => void saveAliases()}
                  disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED' || busy}
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  Save aliases
                </Button>
              </section>

              {/* Lifecycle actions */}
              <section className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={!canManage || busy || detail.type === 'DOMAIN'}
                  onClick={() => {
                    setCreateParentSlug(detail.slug)
                    setCreateParentName(detail.canonicalName)
                    setCreateOpen(true)
                  }}
                  title={detail.type === 'DOMAIN' ? 'Create children from the tree root' : `Create a child under ${detail.canonicalName}`}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Create child
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                  disabled={!detail.permissions.canRetire || detail.status === 'RETIRED' || busy}
                  onClick={() => setRetireOpen(true)}
                >
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                  Retire node
                </Button>
                {detail.status === 'RETIRED' && (
                  <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <CircleOff className="h-3.5 w-3.5" aria-hidden="true" />
                    Retired — soft-deleted, read-only
                  </span>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* Create dialog (mounted per open — fresh state each time) */}
      {createOpen && (
        <CreateNodeDialog
          parentSlug={createParentSlug}
          parentName={createParentName}
          flatNodes={flatNodes}
          countries={countries}
          isAdmin={isAdmin}
          onSubmit={createNode}
          busy={busy}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {/* Retire confirm */}
      <AlertDialog open={retireOpen} onOpenChange={setRetireOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Retire “{detail?.canonicalName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Retirement is the soft delete — the node is hidden and made read-only, leaf-first (children must be
              retired or moved first). History is preserved; the slug never frees up for reuse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault()
                void retireNode()
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Retire node
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
