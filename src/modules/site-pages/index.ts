/**
 * GKSetu — Site Pages module (CONSOLE-S1).
 * Managed static pages (About/Contact/Privacy + custom): public reads of the
 * published snapshot + admin CRUD and lifecycle.
 */
export {
  RESERVED_PAGE_SLUGS,
  SitePagesError,
  isReservedPageSlug,
  listPublishedPages,
  getPublishedPage,
  listAllPages,
  getPageById,
  createPage,
  updatePage,
  deletePage,
  transitionPage,
  type PublicPageSummary,
  type PublicSitePage,
  type AdminSitePage,
} from './service'
export {
  createPageSchema,
  updatePageSchema,
  transitionPageSchema,
  type CreatePageInput,
  type UpdatePageInput,
  type TransitionPageInput,
} from './validation'
