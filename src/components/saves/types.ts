'use client'

/**
 * GlobIQ — saves client types (P5-S2)
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

export type ApiSavedObject = ApiSavedUnit | ApiSavedContentItem

export interface ApiSave {
  id: string
  objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM'
  savedAt: string
  collectionId: string
  object: ApiSavedObject
}

export interface ApiCollection {
  id: string
  name: string
  isDefault: boolean
  visibility: 'PRIVATE'
  itemCount: number
  createdAt: string
}

export interface ApiSaveList {
  items: ApiSave[]
  counts: { total: number; KNOWLEDGE_UNIT: number; CONTENT_ITEM: number }
  collections: ApiCollection[]
}

export interface ApiSaveMutation {
  save: ApiSave
  alreadySaved: boolean
}

export interface ApiSaveState {
  objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM'
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
