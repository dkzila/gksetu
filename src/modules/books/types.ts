/**
 * GKSetu — Books module: public DTOs (SITE-S15)
 *
 * The marketplace registry — books, magazines, notes (PDF + print versions) +
 * the per-language per-format editions + the exam linkage that powers the
 * autosuggest. Mirrors the Prisma `Book` + `BookEdition` + `BookExamLink`
 * rows (§14 country scoping, §16 canonical paths, §19 editorial workflow,
 * §35 language fallback, §36 honest statuses, §37 client-agnostic shapes).
 */
import type { BookFormat, BookStatus, BookType } from '@prisma/client'

export type { BookFormat, BookStatus, BookType }

/** One edition (format × language × price) of a book — the variant the user picks. */
export interface PublicBookEdition {
  id: string
  format: BookFormat
  language: { code: string; name: string; nativeName: string | null }
  /** The price in paise (₹99 = 9900). 0 = free. */
  price: number
  /** The user-facing price label ("₹99" or "Free"). */
  priceLabel: string
  /** The PDF file URL (null for PRINT or when not yet uploaded). */
  fileUrl: string | null
  /** The page count (metadata + the print shipping cost calc). */
  pageCount: number | null
  /** The ISBN (for print editions). */
  isbn: string | null
  /** Whether this edition is currently purchasable. */
  isActive: boolean
}

/** The public book summary (the store directory card + the exam-page book card). */
export interface PublicBookSummary {
  id: string
  slug: string
  type: BookType
  title: string
  subtitle: string | null
  description: string
  coverImageUrl: string | null
  category: string | null
  author: string | null
  publishedAt: string | null
  /** The canonical URL (/store/{slug}/). */
  canonicalPath: string
  /** The available editions (filtered by the resolved language + format). */
  editions: PublicBookEdition[]
  /** The starting price (the cheapest edition's price). 0 = free. */
  startingPrice: number
  startingPriceLabel: string
  /** The exam slugs this book is linked to (for the autosuggest). */
  examSlugs: string[]
}

/** The book detail page payload (GET /api/store/{slug}). */
export interface PublicBookDetail extends PublicBookSummary {
  /** The full marketing copy (markdown). */
  fullDescription: string
  /** All editions (the user picks the format + the language on the page). */
  allEditions: PublicBookEdition[]
  /** The linked exams (with names — for the "Linked exams" section). */
  linkedExams: Array<{ slug: string; name: string; relevance: string }>
  /** Related books (same category, same type). */
  relatedBooks: PublicBookSummary[]
}

/** The store directory payload (GET /api/store). */
export interface PublicStoreDirectory {
  books: PublicBookSummary[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  /** The available filter facets (categories + types + languages). */
  facets: {
    categories: string[]
    types: BookType[]
    languages: Array<{ code: string; name: string; nativeName: string | null }>
  }
  /** The resolved market (for the language switcher's default). */
  country: { isoCode: string; name: string }
  language: { code: string; name: string; nativeName: string | null }
}

/** The exam-linked books payload (GET /api/store?exam={slug} — the autosuggest source). */
export interface PublicExamBooksResult {
  exam: { slug: string; name: string; code: string }
  primary: PublicBookSummary[]
  supplementary: PublicBookSummary[]
}

// ---------- Admin (Console) DTOs ----------

export interface AdminBook {
  id: string
  slug: string
  type: BookType
  status: BookStatus
  title: string
  subtitle: string | null
  description: string
  coverImageUrl: string | null
  category: string | null
  author: string | null
  publishedAt: string | null
  sortOrder: number
  countryIso: string | null
  countryName: string | null
  editionCount: number
  examLinkCount: number
  createdAt: string
  updatedAt: string
  /** Which transitions are allowed from the current status (§36 state machine). */
  allowedTransitions: BookTransitionAction[]
}

export interface AdminBookDetail extends AdminBook {
  editions: Array<{
    id: string
    format: BookFormat
    language: { code: string; name: string }
    price: number
    fileUrl: string | null
    pageCount: number | null
    isbn: string | null
    isActive: boolean
  }>
  examLinks: Array<{
    id: string
    examSlug: string
    examName: string
    relevance: string
    sortOrder: number
  }>
}

export interface AdminBookListResult {
  books: AdminBook[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export type BookTransitionAction = 'publish' | 'retire' | 'reactivate'

/** The transition state machine (§36). */
export const BOOK_TRANSITIONS: Record<BookStatus, Partial<Record<BookTransitionAction, BookStatus>>> = {
  DRAFT: { publish: 'PUBLISHED' },
  PUBLISHED: { retire: 'RETIRED' },
  RETIRED: { reactivate: 'PUBLISHED' },
}

/** Human-readable labels for the type + format (Console + store UI). */
export const BOOK_TYPE_LABELS: Record<BookType, { label: string; description: string }> = {
  BOOK: {
    label: 'Book',
    description: 'A full-length book (e.g. "Indian Polity — the GKSetu edition").',
  },
  MAGAZINE: {
    label: 'Magazine',
    description: 'A periodic issue (e.g. "GKSetu Monthly — October 2026").',
  },
  NOTE_COMPILATION: {
    label: 'Note Compilation',
    description: 'A compiled set of ExamNotes (e.g. "UPSC CSE Polity — all chapters\' notes").',
  },
  CURRENT_AFFAIRS_DIGEST: {
    label: 'CA Digest',
    description: 'A monthly current-affairs compilation (future).',
  },
}

export const BOOK_FORMAT_LABELS: Record<BookFormat, string> = {
  PDF: 'PDF (digital download)',
  PRINT: 'Print (physical shipped)',
}
