'use client'

/**
 * GKSetu — the §25 report dialog (P8-S3)
 * The lightweight "what's wrong?" surface: §25's four reasons with their
 * honest one-line meanings, a description the reporter owns, and an honest
 * receipt — the report routes into the §19 editorial workflow (a CORRECTION
 * task) and the workspace editors are notified (§27). Signed-in reports are
 * attributed (§31: the reporter can follow the outcome on #/feedback);
 * anonymous reports are accepted by design (§21 precedent) — the dialog
 * says which is happening, never silently. Duplicate reports fold: an
 * already-open report by the same reporter on the same object+reason is a
 * receipt, not an error.
 */
import { useEffect, useRef, useState } from 'react'
import { MessageSquareWarning } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import {
  FEEDBACK_TYPES,
  type FeedbackObjectTypePublic,
  type FeedbackTypePublic,
  type MyFeedbackReport,
} from '@/modules/content-quality'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

export interface ReportDialogProps {
  objectType: FeedbackObjectTypePublic
  objectRef: string
  objectName: string
  languageCode?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ReportDialog({
  objectType,
  objectRef,
  objectName,
  languageCode,
  open,
  onOpenChange,
}: ReportDialogProps) {
  const { token, user } = useAuth()
  const { toast } = useToast()

  const [feedbackType, setFeedbackType] = useState<FeedbackTypePublic>('FACTUAL_ERROR')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Fresh surface per open — the last report never leaks into the next.
  useEffect(() => {
    if (open) {
      setFeedbackType('FACTUAL_ERROR')
      setDescription('')
      setSubmitting(false)
    }
  }, [open])

  const trimmed = description.trim()
  const canSubmit = trimmed.length >= 10 && trimmed.length <= 2000 && !submitting

  const onSubmit = async () => {
    setSubmitting(true)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          objectType,
          objectRef,
          feedbackType,
          description: trimmed,
          ...(languageCode ? { languageCode } : {}),
        }),
      })
      const payload = (await response.json()) as Envelope<{
        report: MyFeedbackReport
        created: boolean
        taskOpened: boolean
      }>
      if (!mounted.current) return
      if (payload.status === 'ok' && payload.data) {
        toast({
          title: payload.data.created ? 'Reported — thank you' : 'You already have an open report on this',
          description: payload.data.created
            ? 'It reached our editorial team — an editor takes it from here.'
            : 'The editorial queue already holds your open report — no duplicate was filed.',
        })
        onOpenChange(false)
      } else {
        toast({
          title: 'Could not submit the report',
          description: payload.error?.message ?? 'Please try again in a moment.',
          variant: 'destructive',
        })
      }
    } catch {
      if (mounted.current) {
        toast({
          title: 'Could not submit the report',
          description: 'The network dropped the request — please try again.',
          variant: 'destructive',
        })
      }
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5 text-rose-600" aria-hidden="true" />
            Report an issue
          </DialogTitle>
          <DialogDescription>
            On <span className="font-medium text-zinc-700">{objectName}</span>. Reports go straight to our
            editorial team — an editor reviews, corrects it through the normal workflow, and you can
            follow the outcome. Never shown publicly as ratings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              What is wrong?
            </Label>
            <RadioGroup
              value={feedbackType}
              onValueChange={(value) => setFeedbackType(value as FeedbackTypePublic)}
              className="gap-2"
            >
              {FEEDBACK_TYPES.map((type) => (
                <Label
                  key={type.key}
                  htmlFor={`feedback-type-${type.key}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm font-normal transition-colors ${
                    feedbackType === type.key
                      ? 'border-rose-300 bg-rose-50/60'
                      : 'border-zinc-200 bg-white hover:border-zinc-300'
                  }`}
                >
                  <RadioGroupItem
                    id={`feedback-type-${type.key}`}
                    value={type.key}
                    className="mt-0.5"
                  />
                  <span className="space-y-1">
                    <span className="block font-medium text-zinc-800">{type.label}</span>
                    <span className="block text-xs leading-relaxed text-zinc-500">{type.description}</span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-description" className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Describe the issue
            </Label>
            <Textarea
              id="feedback-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is wrong, and what should it say instead? Point at the exact sentence if you can."
              rows={4}
              maxLength={2000}
              aria-describedby="feedback-description-hint"
            />
            <p id="feedback-description-hint" className="text-xs text-zinc-500">
              {trimmed.length < 10
                ? 'At least 10 characters — a report says what\u2019s wrong.'
                : `${trimmed.length}/2000 characters`}
            </p>
          </div>

          <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
            {user
              ? `Reporting as ${user.email} — you can follow this report\u2019s outcome under Your reports.`
              : 'Reporting anonymously — sign in to follow the outcome under Your reports; anonymous reports are equally reviewed.'}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSubmit}
            className="bg-rose-600 text-white hover:bg-rose-700"
          >
            {submitting ? 'Submitting\u2026' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
