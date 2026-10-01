'use client'

/**
 * GKSetu — Event View (P6-S2, extended P8-S1)
 *
 * The in-app §16 current-affairs page: the P6-S2 reader component
 * (EventPageView) wrapped in the app chrome — a back-to-home bar, the §16
 * canonical path and the P8-S1 §21 share action. Reached from homepage
 * current-affairs cards, search results and the console via the hash router
 * (#/current-affairs/{slug}/).
 */
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ShareButton } from '@/components/shares/share-button'
import { ReportButton } from '@/components/feedback/report-button'
import { EventPageView } from '@/components/current-affairs/event-page-view'

export interface EventViewProps {
  eventSlug: string
  country: string
  language: string
  onGoHome: () => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  /** P6-S3: additional-topic cross-filings open the §13/§16 topic hub. */
  onOpenTopic: (topicSlug: string) => void
  onSwitchLanguage: (code: string) => void
}

export function EventView({
  eventSlug,
  country,
  language,
  onGoHome,
  onOpenUnit,
  onOpenTopic,
  onSwitchLanguage,
}: EventViewProps) {
  return (
    <div className="space-y-4">
      {/* Back to the discovery hub (§34) + the §21 share action */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2 text-zinc-500 hover:text-zinc-900"
          onClick={onGoHome}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to current affairs
        </Button>
        <div className="flex items-center gap-2">
          <ShareButton path={`/current-affairs/${eventSlug}/`} title={eventSlug} className="h-9 px-2.5" />
          {/* P8-S3 §25: report this event's coverage (slug = §16 identity). */}
          <ReportButton
            objectType="CURRENT_EVENT"
            objectRef={eventSlug}
            objectName={eventSlug}
            languageCode={language}
          />
        </div>
      </div>

      <EventPageView
        eventRef={eventSlug}
        country={country}
        language={language}
        onOpenUnit={onOpenUnit}
        onOpenTopic={onOpenTopic}
        onSwitchLanguage={onSwitchLanguage}
      />
    </div>
  )
}
