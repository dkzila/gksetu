/**
 * GlobIQ — Audit module: public DTOs
 * Master Plan §6 (AuditLog), §19, §30, §36, §37 (client-agnostic shapes).
 */

/** Actor reference embedded in an audit event (all fields optional: system
 * events and anonymous attempts have no user row). */
export interface AuditActorRef {
  userId: string | null
  email: string | null
  role: string | null
}

/** What service-layer mutations pass to `recordAudit`. */
export interface AuditEventInput {
  actor?: AuditActorRef | null
  action: string
  objectType: string
  objectId?: string | null
  objectLabel?: string | null
  /** State prior to the mutation (auto-redacted before write). */
  before?: unknown
  /** State after the mutation (auto-redacted before write). */
  after?: unknown
  metadata?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}

/** Request context services thread into audit calls (§30). */
export interface AuditRequestMeta {
  ip?: string | null
  userAgent?: string | null
}

/** Serialised audit row — before/after/metadata are already redacted at write. */
export interface PublicAuditLog {
  id: string
  action: string
  actor: { id: string | null; email: string | null; role: string | null }
  objectType: string
  objectId: string | null
  objectLabel: string | null
  before: unknown
  after: unknown
  metadata: unknown
  ip: string | null
  createdAt: string
}

export interface AuditPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AuditListResult {
  items: PublicAuditLog[]
  pagination: AuditPagination
  /** Reflects the active filter (coherent with `items`). */
  summary: { total: number; last24h: number; topActions: Array<{ action: string; count: number }> }
  /** Distinct values across the whole trail — powers UI filter dropdowns. */
  facets: { actions: string[]; objectTypes: string[] }
}

/** Namespaced action vocabulary (shared by emitting services and the UI). */
export const AUDIT_ACTIONS = {
  userRegister: 'user.register',
  userLogin: 'auth.login',
  userLoginFailed: 'auth.login.failed',
  userLogout: 'auth.logout',
  sessionRevoke: 'auth.session.revoke',
  countryCreate: 'country.create',
  countryUpdate: 'country.update',
  countryLanguagesSet: 'country.languages.set',
  /** P9-S2 country launch lifecycle (§43 Phase 9 — announce/launch/pause). */
  countryAnnounce: 'country.announce',
  countryLaunch: 'country.launch',
  countryPause: 'country.pause',
  languageCreate: 'language.create',
  languageUpdate: 'language.update',
  topicCreate: 'taxonomy.topic.create',
  topicUpdate: 'taxonomy.topic.update',
  topicRetire: 'taxonomy.topic.retire',
  topicLabelsSet: 'taxonomy.topic.labels.set',
  topicAliasesSet: 'taxonomy.topic.aliases.set',
  knowledgeUnitCreate: 'knowledge.unit.create',
  knowledgeUnitUpdate: 'knowledge.unit.update',
  knowledgeUnitTransition: 'knowledge.unit.transition',
  contentItemCreate: 'content.item.create',
  contentItemUpdate: 'content.item.update',
  contentItemTransition: 'content.item.transition',
  /** P7-S1 QnA (§22/§23/§19 — every QnA mutation is audited). */
  qnaCreate: 'qna.create',
  qnaUpdate: 'qna.update',
  qnaTransition: 'qna.transition',
  /** Object-level QnA denials (country/scope/state mismatch — §20 signal). */
  qnaDenied: 'qna.denied',
  /** P7-S2 Questions (§22/§23/§19 — every Question mutation is audited). */
  questionCreate: 'question.create',
  questionUpdate: 'question.update',
  questionTransition: 'question.transition',
  /** Object-level Question denials (country/scope/state mismatch — §20 signal). */
  questionDenied: 'question.denied',
  /** P7-S3 MockTests (§22/§23/§19 — every MockTest mutation is audited). */
  mocktestCreate: 'mocktest.create',
  mocktestUpdate: 'mocktest.update',
  mocktestTransition: 'mocktest.transition',
  /** Object-level MockTest denials (country/scope/state mismatch — §20 signal). */
  mocktestDenied: 'mocktest.denied',
  /** P7-S3 TestAttempts (§6/§22 — the attempt lifecycle: start, submit, lapse). */
  attemptStart: 'attempt.start',
  attemptSubmit: 'attempt.submit',
  attemptAbandon: 'attempt.abandon',
  sourceCreate: 'source.create',
  sourceUpdate: 'source.update',
  sourceVerify: 'source.verification.transition',
  /** Object-level source-registry denials (role/scope mismatch — §20 signal). */
  sourceDenied: 'source.denied',
  /** §24 provenance join events on content objects. */
  sourceLinkCreate: 'content.item.source.link',
  sourceLinkUpdate: 'content.item.source.update',
  sourceLinkRemove: 'content.item.source.unlink',
  /** Object-level source-link denials (item country/scope mismatch — §20 signal). */
  sourceLinkDenied: 'content.item.source.denied',
  /** Route permission-gate denials (requirePermission). */
  accessDenied: 'access.denied',
  /** Object-level taxonomy denials (country/scope mismatch — §20 signal). */
  taxonomyDenied: 'taxonomy.topic.denied',
  /** Object-level knowledge denials (country/scope/state mismatch — §20 signal). */
  knowledgeDenied: 'knowledge.unit.denied',
  /** Object-level content denials (country/scope/state mismatch — §20 signal). */
  contentDenied: 'content.item.denied',
  /** P2-S4 editorial workspace (§19 — every task mutation is audited). */
  editorialTaskCreate: 'editorial.task.create',
  editorialTaskUpdate: 'editorial.task.update',
  editorialTaskTransition: 'editorial.task.transition',
  /** Object-level editorial denials (scope/assignment mismatch — §20 signal). */
  editorialTaskDenied: 'editorial.task.denied',
  /** P3-S1 exams (§6/§36 — every exam/version mutation is audited). */
  examCreate: 'exam.create',
  examUpdate: 'exam.update',
  examTransition: 'exam.transition',
  examVersionCreate: 'exam.version.create',
  examVersionUpdate: 'exam.version.update',
  examVersionRemove: 'exam.version.remove',
  /** Object-level exam denials (country/scope mismatch — §20 signal). */
  examDenied: 'exam.denied',
  /** P3-S2 syllabus trees (§6/§36 — every node/import mutation is audited). */
  syllabusNodeCreate: 'syllabus.node.create',
  syllabusNodeUpdate: 'syllabus.node.update',
  syllabusNodeRemove: 'syllabus.node.remove',
  syllabusImport: 'syllabus.import',
  /** Object-level syllabus denials (country/scope mismatch — §20 signal). */
  syllabusDenied: 'syllabus.denied',
  /** P3-S3 exam mappings (§8/§36 — every mapping mutation is audited). */
  examMappingCreate: 'exam.mapping.create',
  examMappingUpdate: 'exam.mapping.update',
  examMappingRemove: 'exam.mapping.remove',
  /** Object-level mapping denials (country/scope/state mismatch — §20 signal). */
  examMappingDenied: 'exam.mapping.denied',
  /** P4-S1 search index operations (§17/§38 — rebuilds are admin actions). */
  searchReindex: 'search.reindex',
  /** P5-S1 personalisation signals (§9/§10 — explicit, user-controlled intent). */
  followCreate: 'user.follow.create',
  followRemove: 'user.follow.remove',
  /** P5-S2 saves & collections (§10/§31 — retrieval actions, user-controlled). */
  saveCreate: 'user.save.create',
  saveRemove: 'user.save.remove',
  saveMove: 'user.save.move',
  collectionCreate: 'user.collection.create',
  collectionUpdate: 'user.collection.update',
  collectionRemove: 'user.collection.remove',
  /** P8-S1 (§21): the collection share opt-in/revoke (PRIVATE ↔ LINK). */
  collectionShare: 'user.collection.share',
  /** P8-S2 (§27): a per-category × per-channel notification preference change. */
  notificationPreferenceSet: 'user.notification.preference',
  /** P8-S2 (§27): the batch dispatch sweep (ensure revision digests + deliver
   *  queued rows — the freshness-sweep precedent, counts in metadata). */
  notificationsDispatch: 'notifications.dispatch',
  /** P8-S3 (§25): public feedback reports (submission + every editorial
   *  transition — every report auditable to resolution, §44). */
  feedbackReportCreate: 'feedback.report.create',
  feedbackReportTransition: 'feedback.report.transition',
  /** P5-S3 profile & explicit goals (§6/§9/§31 — self-service, user-controlled). */
  profileUpdate: 'user.profile.update',
  goalSet: 'user.goal.set',
  goalRemove: 'user.goal.remove',
  onboardingComplete: 'user.onboarding.complete',
  onboardingSkip: 'user.onboarding.skip',
  /** P5-S5 explanations & controls (§9/§31 — the explicit reset is a bulk self-service action). */
  personalisationReset: 'user.personalisation.reset',
  /** P6-S1 current affairs (§12/§36 — every event/link mutation is audited). */
  currentEventCreate: 'currentaffairs.event.create',
  currentEventUpdate: 'currentaffairs.event.update',
  currentEventTransition: 'currentaffairs.event.transition',
  /** §12 step 2 source aggregation on events. */
  currentEventSourceLink: 'currentaffairs.event.source.link',
  currentEventSourceUpdate: 'currentaffairs.event.source.update',
  currentEventSourceUnlink: 'currentaffairs.event.source.unlink',
  /** §12 step 3 canonical knowledge links on events. */
  currentEventUnitLink: 'currentaffairs.event.unit.link',
  currentEventUnitUnlink: 'currentaffairs.event.unit.unlink',
  /** P6-S3 §12 step 3 entity links on events. */
  currentEventEntityLink: 'currentaffairs.event.entity.link',
  currentEventEntityUnlink: 'currentaffairs.event.entity.unlink',
  /** P6-S3 §12 step 3 additional-topic cross-filings on events. */
  currentEventTopicLink: 'currentaffairs.event.topic.link',
  currentEventTopicUnlink: 'currentaffairs.event.topic.unlink',
  /** P6-S3 entity registry mutations (§6 Entity row — canonical reference records). */
  entityCreate: 'entity.create',
  entityUpdate: 'entity.update',
  /** Object-level current-affairs denials (scope/state mismatch — §20 signal). */
  currentEventDenied: 'currentaffairs.event.denied',
  /** P6-S5 freshness rules (§12 step 6/§19/§36): the sweep's per-event
   *  automated transitions (actor = the sweep runner, metadata.automated). */
  currentEventAutoTransition: 'currentaffairs.event.autotransition',
  /** P6-S5: one summary entry per applied sweep (applied/skipped counts in
   *  metadata — the freshness overview's "last sweep" reads this). */
  freshnessSweep: 'currentaffairs.freshness.sweep',
  /** P9-S1 translations (§6/§26/§35/§36 — every link mutation is audited;
   *  drift/sync are system-recorded inside the publish transactions). */
  translationCreate: 'translation.create',
  translationAiDraft: 'translation.ai.draft',
  translationRetire: 'translation.retire',
  translationDrift: 'translation.drift',
  translationSync: 'translation.sync',
} as const

/** Object type vocabulary (§6 entities that exist so far). */
export const AUDIT_OBJECT_TYPES = {
  user: 'User',
  authSession: 'AuthSession',
  country: 'Country',
  language: 'Language',
  topic: 'Topic',
  knowledgeUnit: 'KnowledgeUnit',
  contentItem: 'ContentItem',
  contentRevision: 'ContentRevision',
  qna: 'QnA',
  qnaRevision: 'QnARevision',
  question: 'Question',
  questionRevision: 'QuestionRevision',
  mockTest: 'MockTest',
  mockTestRevision: 'MockTestRevision',
  testAttempt: 'TestAttempt',
  editorialTask: 'EditorialTask',
  source: 'Source',
  contentSourceLink: 'ContentSourceLink',
  exam: 'Exam',
  examVersion: 'ExamVersion',
  syllabusNode: 'SyllabusNode',
  examMapping: 'ExamMapping',
  searchDocument: 'SearchDocument',
  userFollow: 'UserFollow',
  savedItem: 'SavedItem',
  collection: 'Collection',
  userGoal: 'UserGoal',
  currentEvent: 'CurrentEvent',
  currentEventSource: 'CurrentEventSource',
  currentEventKnowledgeUnit: 'CurrentEventKnowledgeUnit',
  entity: 'Entity',
  currentEventEntity: 'CurrentEventEntity',
  currentEventTopic: 'CurrentEventTopic',
  /** P8-S2 (§27): notification rows + preference rows. */
  notificationEvent: 'NotificationEvent',
  notificationPreference: 'NotificationPreference',
  /** P8-S3 (§25): the content feedback / quality-loop rows. */
  contentFeedback: 'ContentFeedback',
  /** P9-S1 (§6/§35): the translation provenance links. */
  translation: 'Translation',
  permission: 'Permission',
} as const
