/**
 * GlobIQ — Sharing: DTOs (P8-S1)
 * Master Plan §21 (a share action on every shareable canonical page; stable
 * share URLs; share cards identify the content title, topic and platform
 * branding; private collections only when the owner explicitly opts in;
 * private user data never in public share metadata; share events tracked as
 * analytics events), §16 (the share URL IS the canonical path — the same
 * grammar the app mirrors after the hash), §32 (the Sharing metric family:
 * share actions + landing visits), §31 (anonymous shares carry no identity;
 * the inventory documents the family), §36 (honest statuses on every card),
 * §37 (client-agnostic, origin-agnostic — the client resolves the origin),
 * §39 (the same endpoints a mobile app calls).
 */

/** The §21 shareable surfaces — the TS mirror of the schema enum. */
export type ShareObjectType =
  | 'KNOWLEDGE_UNIT'
  | 'CURRENT_EVENT'
  | 'TOPIC'
  | 'EXAM'
  | 'QUESTION'
  | 'COLLECTION'

/** §21: how the share reached the user — Web Share API or the copy-link fallback. */
export type ShareChannel = 'WEB_SHARE' | 'COPY_LINK'

/** §32 sharing metrics: a share action, or a landing visit on a shareable page. */
export type ShareEventAction = 'SHARE_CREATE' | 'SHARE_LANDING'

/** Platform branding on every card (§21) — the config single source of truth. */
export interface ShareBrand {
  name: string
  tagline: string
}

/**
 * The §21 share card — what the dialog previews and what a future SSR share
 * surface would render. Title + topic + branding are the §21-mandated trio;
 * `description` is the honest one-line summary (§36 statuses included).
 */
export interface ShareCard {
  objectType: ShareObjectType
  /** The object's stable PUBLIC ref (slug, or id for question/collection — §37). */
  objectRef: string
  /** The content title (§21). */
  title: string
  /** Honest one-line summary; carries §36 status notes (e.g. retired units). */
  description: string
  /** The §35-resolved topic label (null for exams — they carry their own scope line). */
  topicLabel: string | null
  /** Platform branding (§21) — never the sharer's identity (§31). */
  brand: ShareBrand
  /** The §16 canonical path (no origin, no query) — the URL truth (§37). */
  canonicalPath: string
  /**
   * The exact path to place after the hash — canonicalPath plus addressable
   * state (a QUESTION focus `?q={id}`). This is the STABLE SHARE URL's fragment.
   */
  sharePath: string
  /** §16 robots for the shared surface (collections are unlisted — noindex). */
  robots: { index: boolean; reason: string }
  /** The §36 honest status of the underlying object, when it has one. */
  status: string | null
}

/** The parsed §16 share path — the server-side mirror of the hash router's grammar. */
export interface ParsedSharePath {
  objectType: ShareObjectType
  /** The stable public ref extracted from the path (topic/unit/event/exam slug, question/collection id). */
  objectRef: string
  /** For QUESTION shares: the unit path the question lives on (rebuilt canonically). */
  unitPath: string | null
  /** The §35 market the path carried (country iso + language code). */
  countryIso: string
  languageCode: string
}

/** Receipt for a recorded share event — counts never leak (§31 minimisation). */
export interface ShareEventReceipt {
  recorded: true
  action: ShareEventAction
  objectType: ShareObjectType
}

/** One item in a publicly shared collection (§21 eligible collections). */
export interface SharedCollectionItem {
  kind: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION' | 'MOCK_TEST'
  /** Display title/question — the public content, never user data (§21). */
  title: string
  /** Honest §36 status of the saved object. */
  status: string
  /** The §16 path to reopen the item (null only for non-public objects). */
  canonicalPath: string | null
  /** Secondary line: topic name / scope label / format. */
  detail: string | null
}

/** The public shared-collection payload (§21) — no owner identity, ever. */
export interface SharedCollection {
  id: string
  name: string
  itemCount: number
  items: SharedCollectionItem[]
  /** Rendered verbatim: what this surface is and is not. */
  note: string
}

/** The §9 inventory block for the sharing implicit-signal family. */
export interface InventorySharing {
  /** The caller's own attributed share actions (landings are anonymous). */
  shareActionCount: number
  /** §9 effect sentences — rendered verbatim. */
  effects: Array<{ kind: 'ANALYTICS'; text: string }>
  /** The §31 note: what is collected, what it never feeds, what the reset does. */
  note: string
}
