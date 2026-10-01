'use client'

/**
 * GKSetu — saves client types (P5-S2)
 *
 * Client mirrors of the /api/saves + /api/collections contracts (§37 — the
 * same payloads a future mobile client consumes, §39). Hand-written so the
 * client bundle never pulls server code.
 */

// ---------- API envelope (mirrors src/lib/api/response.ts) ----------

export interface SaveEnvelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
  meta?: { timestamp: string }
}

// ---------- Mirrors of the follow-save module SAVE-half DTOs ----------

export interface ApiSavedUnit {
  kind: 'KNOWLEDGE_UNIT'
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topicSlug: string
  topicCanonicalName: string
  canonicalPath: string
  languageCode: string
}

export interface ApiSavedContentItem {
  kind: 'CONTENT_ITEM'
  id: string
  title: string
  format: string
  languageCode: string
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  unit: {
    slug: string
    canonicalName: string
    type: string
    status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  }
  topicSlug: string
  topicCanonicalName: string
  canonicalPath: string
  countryIso: string | null
}

export type ApiSavedObject =
  | ApiSavedUnit
  | ApiSavedContentItem
  | ApiSavedEvent
  | ApiSavedQna
  | ApiSavedQuestion
  | ApiSavedMockTest

/** P6-S3 §10/§12/§16 — a saved current event. The event record is the saved
 * object; its §16 page (/current-affairs/{slug}/) is the retrieval surface.
 * ARCHIVED events stay listed — permanent historical reference (§36). */
export interface ApiSavedEvent {
  kind: 'CURRENT_EVENT'
  slug: string
  title: string
  lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
  eventDate: string
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topicSlug: string
  topicCanonicalName: string
  canonicalPath: string
  languageCode: string
}

/** P7-S1 §22/§23/§10 — a saved explanatory Q&A entry (a LEARNING
 * representation of its canonical unit). The unit's §22 knowledge page is
 * the retrieval surface (its Practice — Q&A layer); RETIRED entries stay
 * listed as honest tombstones (§36). */
export interface ApiSavedQna {
  kind: 'QNA'
  id: string
  /** Live published revision question (fallback: the working copy — honest §36). */
  question: string
  /** Short excerpt of the live answer — enough to recognise the entry. */
  answerExcerpt: string
  languageCode: string
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  unit: {
    slug: string
    canonicalName: string
    type: string
    status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  }
  topicSlug: string
  topicCanonicalName: string
  /** §16 knowledge-page path in the entry's own language market. */
  canonicalPath: string
  countryIso: string | null
}

/** P7-S2 §22/§23/§10 — a saved scored MCQ question. Like a saved Q&A, the
 * unit's §22 knowledge page is the retrieval surface (its Practice — Test
 * yourself layer), opened in the entry's own language; RETIRED questions
 * stay listed as honest tombstones (§36). */
export interface ApiSavedQuestion {
  kind: 'QUESTION'
  id: string
  /** Live published revision question (fallback: the working copy — honest §36). */
  question: string
  /** The live revision's frozen classification (§36 — never the staged copy). */
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  languageCode: string
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  unit: {
    slug: string
    canonicalName: string
    type: string
    status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  }
  topicSlug: string
  topicCanonicalName: string
  /** §16 knowledge-page path in the entry's own language market. */
  canonicalPath: string
  countryIso: string | null
}

/** P7-S3 §22/§6/§10 — a saved mock test. The test's own §22 runner page
 * (…/exams/{exam}/mock-tests/{slug}/ or …/gk/{topic}/mock-tests/{slug}/)
 * is the retrieval surface — canonicalPath carries it, so the row reopens
 * the runner by converting the server-built path to a hash. RETIRED tests
 * stay listed as honest tombstones (§36). */
export interface ApiSavedMockTest {
  kind: 'MOCK_TEST'
  id: string
  slug: string
  title: string
  questionCount: number
  durationMinutes: number
  passPercent: number
  languageCode: string
  status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  scopeType: 'TOPIC' | 'EXAM'
  /** e.g. “UPSC Civil Services Examination — 2026 syllabus” / “Fundamental Rights”. */
  scopeLabel: string
  /** The runner's §16 path in the test's own market. */
  canonicalPath: string
  countryIso: string | null
}

export interface ApiSave {
  id: string
  objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION' | 'MOCK_TEST'
  savedAt: string
  collectionId: string
  object: ApiSavedObject
}

export interface ApiCollection {
  id: string
  name: string
  isDefault: boolean
  /** P8-S1 §21: LINK = the owner explicitly made this collection shareable via its stable link. */
  visibility: 'PRIVATE' | 'LINK'
  itemCount: number
  createdAt: string
}

export interface ApiSaveList {
  items: ApiSave[]
  counts: {
    total: number
    KNOWLEDGE_UNIT: number
    CONTENT_ITEM: number
    CURRENT_EVENT: number
    QNA: number
    QUESTION: number
    MOCK_TEST: number
  }
  collections: ApiCollection[]
}

export interface ApiSaveMutation {
  save: ApiSave
  alreadySaved: boolean
}

export interface ApiSaveState {
  objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION' | 'MOCK_TEST'
  objectRef: string
  objectSlug: string | null
  objectFound: boolean
  saved: boolean
  save: ApiSave | null
}

export interface ApiCollectionMutation {
  collection: ApiCollection
}

export interface ApiCollectionRemoval {
  removed: boolean
  movedItems: number
  name: string
}
