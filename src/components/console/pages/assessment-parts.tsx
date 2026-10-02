'use client'

/**
 * GKSetu Console — assessment shared parts (CONSOLE-S1-D): the pieces the
 * Questions / Q&A / Mock Tests pages share — the §19 lifecycle dropdown + its
 * dialogs (schedule needs a future datetime, re-publish needs a change
 * summary §36, retire confirms), the language + exam-anchor option loaders,
 * and small presentation atoms. Every affordance comes from the server's
 * `allowedTransitions` (§20) — the server re-checks each operation anyway.
 */
import { ReactNode, useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Clock,
  Loader2,
  MoreHorizontal,
  Send,
  Undo2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/stores/auth'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { useConsoleApi, consoleFetch } from '@/components/console/ui/console-api'
import { TextArea } from '@/components/console/ui/form-fields'
import { formatWhen } from '@/components/console/ui/primitives'

// ---------- Shared DTO shapes (structural — the module types satisfy these) ----------

export type LifecycleAction = 'submit_review' | 'send_back' | 'schedule' | 'publish' | 'retire'

/** The admin-entry slice the lifecycle machinery needs (§37 affordances). */
export interface LifecycleEntry {
  id: string
  status: string
  liveRevision: { revisionNumber: number } | null
  allowedTransitions: string[]
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface StatusSummary {
  total: number
  DRAFT: number
  IN_REVIEW: number
  SCHEDULED: number
  PUBLISHED: number
  RETIRED: number
}

// ---------- Presentation atoms ----------

const DIFFICULTY_STYLES: Record<string, string> = {
  BASIC: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-orange-200 bg-orange-50 text-orange-700',
}

export function DifficultyBadge({ difficulty }: { difficulty: string | null | undefined }) {
  if (!difficulty) return <span className="text-xs text-zinc-400">—</span>
  return (
    <Badge
      variant="outline"
      className={cn('px-2 py-0 text-[11px] font-medium tracking-wide', DIFFICULTY_STYLES[difficulty] ?? DIFFICULTY_STYLES.BASIC)}
    >
      {difficulty.toLowerCase()}
    </Badge>
  )
}

/** “42 questions · 30 published · 3 in review · 6 drafts · 3 retired”. */
export function SummaryLine({ summary, noun }: { summary: StatusSummary; noun: string }) {
  const parts = [`${summary.total} ${summary.total === 1 ? noun.replace(/s$/, '') : noun}`]
  if (summary.PUBLISHED > 0) parts.push(`${summary.PUBLISHED} published`)
  if (summary.IN_REVIEW > 0) parts.push(`${summary.IN_REVIEW} in review`)
  if (summary.SCHEDULED > 0) parts.push(`${summary.SCHEDULED} scheduled`)
  if (summary.DRAFT > 0) parts.push(`${summary.DRAFT} draft${summary.DRAFT === 1 ? '' : 's'}`)
  if (summary.RETIRED > 0) parts.push(`${summary.RETIRED} retired`)
  return (
    <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
      {parts.join(' · ')}
    </Badge>
  )
}

export function truncateText(text: string, max = 96): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed
}

/** The server's §18 read-only reason for locked working copies. */
export function readOnlyReason(entry: { status: string }): string {
  if (entry.status === 'RETIRED') return 'Retired — read-only (end-of-life, §36)'
  if (entry.status === 'SCHEDULED') return 'Locked — review approved exactly this content (§19)'
  return 'Read-only in this status'
}

// ---------- Option loaders ----------

export interface LanguageOption {
  code: string
  label: string
}

/** Fallback pair while (or if) the platform language table can't be read. */
const DEFAULT_LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English (en)' },
  { code: 'hi', label: 'हिन्दी (hi)' },
]

/**
 * The create-form language options — the staff /api/languages table (§38;
 * ADMIN/COUNTRY_ADMIN/WRITER all hold taxonomy:manage or content:manage),
 * falling back to the seeded market pair. The service validates the code
 * against country-locale anyway (§35) and returns explicit field errors.
 */
export function useLanguageOptions(): LanguageOption[] {
  const { token } = useConsoleApi()
  const [options, setOptions] = useState<LanguageOption[]>(DEFAULT_LANGUAGE_OPTIONS)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    async function run() {
      const { data } = await consoleFetch<{ languages: Array<{ code: string; name: string }> }>('/api/languages', { token })
      if (cancelled || !data?.languages?.length) return
      setOptions(data.languages.map((language) => ({ code: language.code, label: `${language.name} (${language.code})` })))
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  return options
}

export interface ExamAnchorOption {
  slug: string
  name: string
  code: string
  versionLabel: string
}

/**
 * The anchorable exams (public GET /api/exams — only exams with a currently
 * effective version are anchorable, §11 step 2). Scoped to the viewer's home
 * country (the demo's IN default when unknown).
 */
export function useExamAnchorOptions(): ExamAnchorOption[] {
  const country = useAuth((state) => state.user?.homeCountry?.isoCode ?? 'IN')
  const [options, setOptions] = useState<ExamAnchorOption[]>([])

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const response = await fetch(`/api/exams?country=${country}&pageSize=300`, { cache: 'no-store' })
        const payload = (await response.json()) as {
          status: 'ok' | 'error'
          data?: { exams: Array<{ slug: string; name: string; code: string; currentVersion: { label: string } | null }> }
        }
        if (cancelled || payload.status !== 'ok' || !payload.data) return
        setOptions(
          payload.data.exams
            .filter((exam) => exam.currentVersion)
            .map((exam) => ({ slug: exam.slug, name: exam.name, code: exam.code, versionLabel: exam.currentVersion!.label }))
        )
      } catch {
        // Silent — the exam select simply offers "None" until the next render.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [country])

  return options
}

// ---------- The §19 lifecycle dropdown ----------

const ACTION_META: Record<LifecycleAction, { label: string; shortLabel: string; icon: typeof Send }> = {
  submit_review: { label: 'Submit for review', shortLabel: 'Submit for review', icon: Send },
  send_back: { label: 'Send back to draft', shortLabel: 'Send back', icon: Undo2 },
  schedule: { label: 'Schedule release…', shortLabel: 'Schedule', icon: Clock },
  publish: { label: 'Publish now', shortLabel: 'Publish', icon: CheckCircle2 },
  retire: { label: 'Retire…', shortLabel: 'Retire', icon: Archive },
}

/** The row lifecycle menu — renders exactly what the server allows (§20). */
export function LifecycleMenu<E extends LifecycleEntry>({
  entry,
  busy,
  onAction,
  extraItems,
}: {
  entry: E
  busy: string | null
  onAction: (entry: E, action: LifecycleAction) => void
  /** Extra menu items (view public page, etc.) rendered above the transitions. */
  extraItems?: ReactNode
}) {
  const actions = entry.allowedTransitions as LifecycleAction[]
  if (actions.length === 0 && !extraItems) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700" aria-label="Lifecycle actions">
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {extraItems}
        {extraItems && actions.length > 0 && <DropdownMenuSeparator />}
        {actions.map((action) => {
          const meta = ACTION_META[action]
          const Icon = meta.icon
          const label =
            action === 'publish' && entry.status === 'PUBLISHED' ? 'Publish correction…' : meta.label
          return (
            <DropdownMenuItem
              key={action}
              disabled={busy !== null}
              onSelect={() => onAction(entry, action)}
              className={cn('gap-2 text-[13px]', action === 'retire' && 'text-red-600 focus:text-red-700')}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
              {busy === action && <Loader2 className="ml-auto h-3 w-3 animate-spin" aria-hidden="true" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------- The lifecycle engine (dialogs + transition POST) ----------

/**
 * One hook per page: routes menu actions through the right UX —
 * submit_review/send_back/first-publish fire immediately, `schedule` opens
 * the datetime dialog, re-publish opens the §36 change-summary dialog and
 * `retire` confirms — then toasts and hands the fresh entry back.
 */
export function useLifecycle<E extends LifecycleEntry>({
  transitionPath,
  noun,
  onComplete,
}: {
  transitionPath: (id: string) => string
  noun: string
  onComplete: (item: E) => void
}) {
  const { token } = useConsoleApi()
  const { toast } = useToast()

  const [target, setTarget] = useState<E | null>(null)
  const [pending, setPending] = useState<LifecycleAction | null>(null)
  const [busy, setBusy] = useState<LifecycleAction | null>(null)
  const [scheduleFor, setScheduleFor] = useState('')
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [changeSummary, setChangeSummary] = useState('')
  const [changeError, setChangeError] = useState<string | null>(null)

  const perform = useCallback(
    async (entry: E, action: LifecycleAction, extra?: { changeSummary?: string; scheduledFor?: string }) => {
      if (!token) return
      setBusy(action)
      const { data, error } = await consoleFetch<{ item: E }>(transitionPath(entry.id), {
        method: 'POST',
        token,
        body: {
          action,
          ...(extra?.changeSummary !== undefined ? { changeSummary: extra.changeSummary } : {}),
          ...(extra?.scheduledFor !== undefined ? { scheduledFor: extra.scheduledFor } : {}),
        },
      })
      setBusy(null)
      if (error || !data) {
        toast({
          title: 'Transition failed',
          description: error?.message ?? 'The operation failed — please retry.',
          variant: 'destructive',
        })
        return
      }
      const item = data.item
      toast({
        title:
          action === 'publish'
            ? `Published revision ${item.liveRevision?.revisionNumber ?? ''}`.trim()
            : action === 'submit_review'
              ? 'Submitted for review'
              : action === 'send_back'
                ? 'Sent back to draft'
                : action === 'schedule'
                  ? 'Scheduled for release'
                  : 'Retired',
        description:
          action === 'publish'
            ? 'An immutable revision snapshot was appended — the public layer serves it now.'
            : action === 'submit_review'
              ? 'An editor reviews it next — the §19 workflow.'
              : action === 'schedule'
                ? `Goes live ${formatWhen(extra?.scheduledFor ?? null)}.`
                : action === 'retire'
                  ? `Withdrawn from the public layer — the ${noun} and its history stay intact.`
                  : 'Editable again.',
      })
      onComplete(item)
    },
    // `toast` is the module-level stable shadcn emitter — safe to depend on.
    [token, transitionPath, noun, onComplete, toast]
  )

  /** Menu entry point — decides between an immediate fire and a dialog. */
  const start = useCallback(
    (entry: E, action: LifecycleAction) => {
      if (action === 'schedule') {
        setTarget(entry)
        setScheduleFor('')
        setScheduleError(null)
        setPending('schedule')
        return
      }
      if (action === 'retire') {
        setTarget(entry)
        setPending('retire')
        return
      }
      // Re-publishing a live entry requires the §36 change summary.
      if (action === 'publish' && entry.status === 'PUBLISHED') {
        setTarget(entry)
        setChangeSummary('')
        setChangeError(null)
        setPending('publish')
        return
      }
      void perform(entry, action)
    },
    [perform]
  )

  const dialogs = (
    <>
      {/* Retire confirmation (§19 archive/withdraw — the destructive gate) */}
      <AlertDialog open={pending === 'retire' && target !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this {noun}?</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring withdraws it from the public layer immediately and makes the record read-only.
              Its revision history stays preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={busy !== null}
              onClick={() => {
                const entry = target
                setPending(null)
                if (entry) void perform(entry, 'retire')
              }}
            >
              {busy === 'retire' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Retire'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule release (§19 step 7 — reviewed content, future release) */}
      <Dialog
        open={pending === 'schedule' && target !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule this {noun} for release?</DialogTitle>
            <DialogDescription>
              The working copy locks (review approved exactly this content) and it goes live
              automatically at the chosen time. You can still publish early or send it back.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="lifecycle-schedule-for" className="text-[13px] font-medium text-zinc-700">
              Release date &amp; time
            </Label>
            <Input
              id="lifecycle-schedule-for"
              type="datetime-local"
              value={scheduleFor}
              onChange={(event) => {
                setScheduleFor(event.target.value)
                setScheduleError(null)
              }}
              className="h-8 text-[13px]"
            />
            {scheduleError ? (
              <p className="text-xs text-red-600" role="alert">
                {scheduleError}
              </p>
            ) : (
              <p className="text-xs text-zinc-400">Must be in the future, within the next year. Timezone: your local clock.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy !== null || scheduleFor.trim().length === 0}
              onClick={() => {
                // datetime-local carries no timezone — interpret it as local time.
                const when = new Date(scheduleFor)
                if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
                  setScheduleError('Pick a valid future date & time.')
                  return
                }
                const entry = target
                setPending(null)
                if (entry) void perform(entry, 'schedule', { scheduledFor: when.toISOString() })
              }}
            >
              {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Schedule release'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Re-publish correction (§36 — change summaries are never silent) */}
      <Dialog
        open={pending === 'publish' && target !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publish a correction</DialogTitle>
            <DialogDescription>
              This {noun} is already live — publishing appends a new immutable revision. Describe what
              changed and why (readers see the provenance trail).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="lifecycle-change-summary" className="text-[13px] font-medium text-zinc-700">
              Change summary <span className="text-red-500" aria-hidden="true">*</span>
            </Label>
            <TextArea
              id="lifecycle-change-summary"
              value={changeSummary}
              onChange={(value) => {
                setChangeSummary(value)
                setChangeError(null)
              }}
              rows={3}
              placeholder="e.g. Fixed the option wording flagged in review"
            />
            {changeError ? (
              <p className="text-xs text-red-600" role="alert">
                {changeError}
              </p>
            ) : (
              <p className="text-xs text-zinc-400">Up to 500 characters — required for every correction.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={busy !== null}
              onClick={() => {
                const summary = changeSummary.trim()
                if (!summary) {
                  setChangeError('A change summary is required to publish a correction.')
                  return
                }
                const entry = target
                setPending(null)
                if (entry) void perform(entry, 'publish', { changeSummary: summary })
              }}
            >
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Publish correction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )

  return { start, busy, dialogs }
}

/** Inline form-level error row (when validation details carry no known field). */
export function FormErrorNotice({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

/** A read-only identity chip (create-time fields, §11 — shown in editors). */
export function IdentityMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/70 px-2.5 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-zinc-700">{value}</p>
    </div>
  )
}
