'use client'

/**
 * GlobIQ — the §25 "Report an issue" action (P8-S3)
 * Master Plan §25: "Every public content object has a lightweight 'Report an
 * issue' action" — this button is that action, anchored wherever readers
 * meet the five reportable object types (knowledge unit, content
 * representation, current event, QnA entry, practice question — spec-exact).
 * The dialog owns the four §25 reasons, the description and the honest
 * submission receipt. §25/§38: reporting is public and anonymous-friendly
 * (browse-first readers are exactly who catches errors — the §21 ShareEvent
 * precedent): the button never gates on sign-in; a signed-in report
 * attributes the row (§31 own-reports view + the duplicate fold).
 */
import { useState } from 'react'
import { MessageSquareWarning } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { ReportDialog } from './report-dialog'
import type { FeedbackObjectTypePublic } from '@/modules/content-quality'

export interface ReportButtonProps {
  /** The §25 reportable object type this anchor sits on. */
  objectType: FeedbackObjectTypePublic
  /** The object's public ref: slug for units/events, id for items/QnA/questions. */
  objectRef: string
  /** The surface's honest label (the sr-only context + dialog fallback). */
  objectName: string
  /** The language of the reported representation where the surface knows it
   * (the translation-issue signal). */
  languageCode?: string | null
  size?: 'sm' | 'default'
  className?: string
  /** Icon-only rendering for tight rows (the per-question affordance). */
  iconOnly?: boolean
}

export function ReportButton({
  objectType,
  objectRef,
  objectName,
  languageCode,
  size = 'sm',
  className,
  iconOnly = false,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`gap-2 border-zinc-300 bg-white text-zinc-800 hover:border-rose-400 hover:text-rose-800 ${className ?? ''}`}
      >
        <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
        {!iconOnly && 'Report'}
        {/* The full action in the accessible name either way (icon-only rows
            carry the complete phrase; labelled rows complete it). */}
        <span className="sr-only">{iconOnly ? `Report an issue on ${objectName}` : ` an issue on ${objectName}`}</span>
      </Button>
      {open && (
        <ReportDialog
          objectType={objectType}
          objectRef={objectRef}
          objectName={objectName}
          languageCode={languageCode ?? undefined}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}
