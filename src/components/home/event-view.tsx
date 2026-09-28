'use client'

/**
 * GlobIQ — Event View (P6-S2)
 *
 * The in-app §16 current-affairs page: the P6-S2 reader component
 * (EventPageView) wrapped in the app chrome — a back-to-home bar and the
 * §16 canonical path. Reached from homepage current-affairs cards, search
 * results and the console via the hash router
 * (#/current-affairs/{slug}/).
 */
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

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
      {/* Back to the discovery hub (§34 — the homepage's current-affairs section) */}
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
        <p className="font-mono text-[11px] text-zinc-400" aria-label="Canonical path">
          #/current-affairs/{eventSlug}/
        </p>
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
