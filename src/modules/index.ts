/**
 * GlobIQ — Modular Monolith Module Registry
 * Master Plan §28 (Recommended Technical Boundary): 18 logical modules with
 * explicit interfaces and clear ownership, starting in one deployable app.
 *
 * This registry is the architecture contract: every module lists the phase and
 * session(s) that will implement it. Modules receive code under
 * `src/modules/<key>/` in their scheduled session — never early (§41/§48).
 */

export type ModuleStatus = 'planned' | 'in_progress' | 'delivered'

export interface ModuleDescriptor {
  key: string
  name: string
  description: string
  /** Master Plan phase that implements this module. */
  phase: string
  /** Session(s) from the §43 roadmap. */
  session: string
  status: ModuleStatus
}

export const MODULES: ModuleDescriptor[] = [
  { key: 'identity-access', name: 'Identity & Access', description: 'Token-based authentication, users, roles, sessions', phase: 'P1', session: 'P1-S2', status: 'delivered' },
  { key: 'country-locale', name: 'Country & Locale', description: 'Country/language configuration, routing context, server-side scoping', phase: 'P1', session: 'P1-S3', status: 'delivered' },
  { key: 'taxonomy', name: 'Taxonomy', description: 'Canonical topic taxonomy with country extensions', phase: 'P1', session: 'P1-S4', status: 'delivered' },
  { key: 'audit', name: 'Audit', description: 'Audit logging for privileged operations', phase: 'P1', session: 'P1-S5', status: 'delivered' },
  { key: 'knowledge', name: 'Knowledge', description: 'KnowledgeUnit canonical model, ContentItems, Source provenance, §22 knowledge-page rendering', phase: 'P2', session: 'P2-S1…S5', status: 'delivered' },
  { key: 'editorial', name: 'Editorial', description: 'Editorial workspace, workflow, scoped roles', phase: 'P2', session: 'P2-S4', status: 'delivered' },
  { key: 'exams-syllabus', name: 'Exams & Syllabus', description: 'Country-scoped exams with §36 versioned structures and version-pinned §13 topic-linked SyllabusNode trees', phase: 'P3', session: 'P3-S1…S2', status: 'delivered' },
  { key: 'exam-mapping', name: 'Exam Mapping', description: '§8 requirement-layer mappings (one unit, many depths), public coverage reads + exam-facing pages, unit-side exam-coverage mirror, multi-exam union & deduplication engine', phase: 'P3', session: 'P3-S3…S5', status: 'delivered' },
  { key: 'search', name: 'Search', description: 'Country/exam-aware search abstraction and indexing (§17 tiers: exact/prefix/alias, typo tolerance, language-aware FTS, canonical dedup, explanations)', phase: 'P4', session: 'P4-S1', status: 'delivered' },
  { key: 'seo', name: 'SEO', description: 'Country homepages (§34 discovery hubs), topic landing pages (§33), exam + syllabus-topic SEO pages (§16/§22), the §16 SEO block (canonical/hreflang/robots) on every public composition, segmented sitemaps + robots.txt, schema.org structured data (JSON-LD) + the SEO validation layer', phase: 'P4', session: 'P4-S2…S5', status: 'delivered' },
  { key: 'follow-save', name: 'Follow & Save', description: 'UserFollow signals vs SavedItem collections (separate concepts, §10) — follow APIs + UI (P5-S1) and save/collection APIs + UI (P5-S2), both delivered', phase: 'P5', session: 'P5-S1…S2', status: 'delivered' },
  { key: 'personalisation', name: 'Personalisation', description: 'Goals, explainable recommendations, dashboard, reset controls — the goal/onboarding half (UserGoal + onboarding state machine + profile basics, P5-S3), the dashboard/feed half (§9 signal union → §11 combined queue with per-unit reasons, #/dashboard + homepage teaser, P5-S4) and the explanations & controls half (§9 signal inventory with effect sentences + the §31 explicit reset, #/personalisation, P5-S5) delivered', phase: 'P5', session: 'P5-S3…S5', status: 'delivered' },
  { key: 'current-affairs', name: 'Current Affairs', description: 'Event-centric current affairs (§12): the CurrentEvent record with its lifecycle and source-aggregation workflow (P6-S1), publishing and revisions (P6-S2 — event representations ride the §19 workflow with immutable §36 revisions, and the public §16 event page assembles the record, live revisions, §24 evidence and §7 unit links), the entity/taxonomy linking layer (P6-S3 — the Entity reference registry with §14 scope/§36 soft delete, event entity links and additional-topic cross-filings feeding the §17 search surface and the public page), and the exam-aware feed (P6-S4 — §12 step 5: events flow into followed/goal exam syllabi via §11 match chains, single-exam + combined modes, §9 reasons); freshness rules (P6-S5 — §12 step 6 automated age windows drive emerging→developing→stable→archived via a preview-first, dry-run-default, audited sweep; §17 tiers label every feed item, event page and workspace row server-side)', phase: 'P6', session: 'P6-S1…S5', status: 'delivered' },
  { key: 'assessment', name: 'Questions & Assessment', description: 'QnA, Questions, MockTests, TestAttempts, mastery, revision — the QnA learning layer (P7-S1) and the scored Question practice layer (P7-S2: §6 MCQ model with §19 workflow + §36 revisions, §22 knowledge-page scored practice with server-side answer checks, §10 QUESTION saves, §17 search fold) delivered; MockTests (P7-S3) and mastery (P7-S4…) follow', phase: 'P7', session: 'P7-S1…S5', status: 'in_progress' },
  { key: 'sharing', name: 'Sharing', description: 'Stable share URLs, OG metadata, Web Share API', phase: 'P8', session: 'P8-S1', status: 'planned' },
  { key: 'notifications', name: 'Notifications', description: 'Channel-agnostic engine with per-category preferences', phase: 'P8', session: 'P8-S2', status: 'planned' },
  { key: 'content-quality', name: 'Content Feedback / Quality', description: 'User error reports routed into the editorial quality loop', phase: 'P8', session: 'P8-S3', status: 'planned' },
  { key: 'analytics', name: 'Analytics', description: 'Relevance & learning metrics, editorial analytics', phase: 'P8', session: 'P8-S4…S5', status: 'planned' },
]
