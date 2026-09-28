/**
 * GlobIQ — Knowledge module: ContentItem anchor helpers (P6-S2)
 * Master Plan §12 step 4 (an event's language-specific explanations are
 * ContentItems — "create language-specific ContentItems for explanation"),
 * §7 (a representation always belongs to exactly ONE canonical record), §14
 * (a representation inherits its anchor's country scope — never more visible
 * than its canonical record), §36 (the anchor's end-of-life state gates
 * publishing: ARCHIVED units/events are read-only).
 *
 * Since P6-S2 a ContentItem anchors to EITHER a KnowledgeUnit (§7 knowledge
 * layer) OR a CurrentEvent (§12 step 4 current-affairs layer) — exactly one,
 * never both. These helpers are the single place that resolves the anchor
 * into the shape every content operation needs (permission target, audit
 * label, publishability), so unit- and event-anchored representations behave
 * identically through the §19 workflow.
 */
import type { CurrentEvent, KnowledgeUnit } from '@prisma/client'

/** The minimal anchor row shape every helper accepts. */
export interface AnchoredItem {
  knowledgeUnit: KnowledgeUnit | null
  currentEvent: CurrentEvent | null
}

/** The resolved canonical anchor of a ContentItem (§7/§12 step 4). */
export interface ItemAnchor {
  kind: 'unit' | 'event'
  /** §37 stable public slug of the anchor record. */
  slug: string
  /** Display name of the anchor record (canonical name / event title). */
  name: string
  scope: 'GLOBAL' | 'COUNTRY'
  /** §14 target country (null = GLOBAL — admin-only, like all global objects). */
  countryId: string | null
  /** End-of-life flag: ARCHIVED units and ARCHIVED events are read-only (§36). */
  archived: boolean
  /** VERIFIED (unit §7) / non-archived lifecycle (event §36) — publish gate. */
  publishable: boolean
  /** §37 explanation when publishing is blocked. */
  blockReason: string | null
}

/**
 * Resolves an item's anchor, or null for a corrupted row (both/neither set —
 * impossible through the validated create path; defense in depth).
 */
export function anchorOfItem(item: AnchoredItem): ItemAnchor | null {
  if (item.currentEvent) {
    const archived = item.currentEvent.lifecycleState === 'ARCHIVED'
    return {
      kind: 'event',
      slug: item.currentEvent.slug,
      name: item.currentEvent.title,
      scope: item.currentEvent.scope as 'GLOBAL' | 'COUNTRY',
      countryId:
        item.currentEvent.scope === 'COUNTRY' ? item.currentEvent.countryId : null,
      archived,
      publishable: !archived,
      blockReason: archived
        ? `The event is ARCHIVED (§36) — reopen it via a lifecycle transition before publishing or scheduling its representations`
        : null,
    }
  }
  if (item.knowledgeUnit) {
    const verified = item.knowledgeUnit.status === 'VERIFIED'
    return {
      kind: 'unit',
      slug: item.knowledgeUnit.slug,
      name: item.knowledgeUnit.canonicalName,
      scope: item.knowledgeUnit.scope as 'GLOBAL' | 'COUNTRY',
      countryId: item.knowledgeUnit.scope === 'COUNTRY' ? item.knowledgeUnit.countryId : null,
      archived: item.knowledgeUnit.status === 'ARCHIVED',
      publishable: verified,
      blockReason: verified
        ? null
        : `The owning unit is ${item.knowledgeUnit.status} — content can only be published on VERIFIED units (§7)`,
    }
  }
  return null
}

/** The anchor's §14 permission target (object-level `can` check). */
export function anchorTarget(anchor: ItemAnchor): { countryId: string | null } {
  return { countryId: anchor.countryId }
}

/** The audit/editorial object label — anchor slug / language / format (§30). */
export function anchorLabel(
  anchor: ItemAnchor,
  languageCode: string,
  format: string
): string {
  return `${anchor.slug}/${languageCode}/${format}`
}
