/**
 * GlobIQ — P1-S1 + P1-S2 + P1-S4 + P2-S1 + P2-S2 + P2-S3 Seed
 * Master Plan §45 (Seed Data Strategy): intentionally small but structurally rich.
 *
 * P1-S1 scope: languages + countries (India = default root market, English default).
 * India's supported languages: English (default) + Hindi — matching the URL
 * architecture in §16/Appendix B ("/" for English, "/hi/" for Hindi).
 *
 * P1-S2 scope: one development admin account (§45 "sample editorial users with
 * scoped roles" begins here; full scoped staff seeding lands with the editorial
 * console in P2-S4/S5). Credentials are DEV-ONLY — never use in production.
 *
 * P1-S4 scope: a few structurally rich taxonomy branches (§45) — global domains,
 * country-scoped extensions (IN), nested branch→topic nodes, en/hi labels and
 * aliases — plus one dev COUNTRY_ADMIN (IN) to exercise scoped RBAC (§38).
 *
 * P2-S1 scope: structurally rich knowledge units (§45) — types, difficulties,
 * scopes, lifecycle statuses (one DRAFT for the transition demo).
 *
 * P2-S2 scope: ContentItems + revisions — multiple formats (§23), languages
 * (en/hi, §35), a two-revision correction (§36 preservation + provenance) and
 * one DRAFT for the lifecycle demo.
 *
 * P2-S3 scope: Sources + provenance links (§24) — verification states (one
 * UNRELIABLE for the trust demo), claim/content-level attribution, and one
 * AI-assisted DRAFT CURRENT_EVENT_UPDATE (§26 provenance flag + the
 * source-backed-update format the P2-S2 handoff called for).
 *
 * P3-S1 scope: Exams + ExamVersions (§6/§14/§36) — India gets the full demo
 * matrix (three ACTIVE + one DRAFT exam, NATIONAL/STATE levels, historical
 * superseded + current + upcoming future-dated windows); UK (COMING_SOON)
 * carries one DRAFT exam to exercise §14 country scoping.
 *
 * P6-S1 scope: CurrentEvents + source aggregation (§12/§45) — all four
 * lifecycle states, GLOBAL + COUNTRY/IN scopes, multi-source aggregation
 * reusing the shared §24 registry by URL, and VERIFIED canonical unit links.
 *
 * Run: bun run db:seed
 */
import { PrismaClient } from '@prisma/client'

import { hashPassword } from '../src/modules/identity-access/password'
import { getIndexStats, reindexAll } from '../src/modules/search'

const prisma = new PrismaClient()

// Dev-only admin credentials (documented in docs/sessions/P1-S2.md).
const DEV_ADMIN_EMAIL = 'admin@globiq.dev'
const DEV_ADMIN_PASSWORD = 'GlobIQ-Dev-Admin-1'
const DEV_IN_ADMIN_EMAIL = 'in-admin@globiq.dev'
const DEV_IN_ADMIN_PASSWORD = 'GlobIQ-Dev-INAdmin-1'
// P2-S4 (§18/§20): dev WRITER accounts — one all-language, one Hindi-scoped.
const DEV_WRITER_IN_EMAIL = 'writer-in@globiq.dev'
const DEV_WRITER_IN_PASSWORD = 'GlobIQ-Dev-Writer-1'
const DEV_WRITER_HI_EMAIL = 'writer-hi@globiq.dev'
const DEV_WRITER_HI_PASSWORD = 'GlobIQ-Dev-Writer-Hi-1'

async function main() {
  // ---------- Languages ----------
  const en = await prisma.language.upsert({
    where: { code: 'en' },
    update: {},
    create: {
      code: 'en',
      name: 'English',
      nativeName: 'English',
      direction: 'LTR',
      status: 'ACTIVE',
    },
  })

  const hi = await prisma.language.upsert({
    where: { code: 'hi' },
    update: {},
    create: {
      code: 'hi',
      name: 'Hindi',
      nativeName: 'हिन्दी',
      direction: 'LTR',
      status: 'ACTIVE',
    },
  })

  const fr = await prisma.language.upsert({
    where: { code: 'fr' },
    update: {},
    create: {
      code: 'fr',
      name: 'French',
      nativeName: 'Français',
      direction: 'LTR',
      status: 'ACTIVE',
    },
  })

  // ---------- Countries ----------
  const india = await prisma.country.upsert({
    where: { isoCode: 'IN' },
    update: {
      name: 'India',
      slug: 'in',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      isDefault: true,
      defaultLanguageId: en.id,
    },
    create: {
      isoCode: 'IN',
      slug: 'in',
      name: 'India',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      isDefault: true,
      defaultLanguageId: en.id,
    },
  })

  const uk = await prisma.country.upsert({
    where: { isoCode: 'GB' },
    update: {
      name: 'United Kingdom',
      slug: 'uk',
      timezone: 'Europe/London',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: en.id,
    },
    create: {
      isoCode: 'GB',
      slug: 'uk',
      name: 'United Kingdom',
      timezone: 'Europe/London',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: en.id,
    },
  })

  const france = await prisma.country.upsert({
    where: { isoCode: 'FR' },
    update: {
      name: 'France',
      slug: 'fr',
      timezone: 'Europe/Paris',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: fr.id,
    },
    create: {
      isoCode: 'FR',
      slug: 'fr',
      name: 'France',
      timezone: 'Europe/Paris',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: fr.id,
    },
  })

  // ---------- Supported languages per country (§35: only own configured languages) ----------
  const links: Array<{ countryId: string; languageId: string }> = [
    { countryId: india.id, languageId: en.id }, // India: English (default)
    { countryId: india.id, languageId: hi.id }, // India: Hindi → /hi/
    { countryId: uk.id, languageId: en.id }, // UK: English (default)
    { countryId: france.id, languageId: fr.id }, // France: French (default)
  ]

  for (const link of links) {
    await prisma.countryLanguage.upsert({
      where: {
        countryId_languageId: {
          countryId: link.countryId,
          languageId: link.languageId,
        },
      },
      update: {},
      create: link,
    })
  }

  // ---------- Dev admin (P1-S2, §45) ----------
  const admin = await prisma.user.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    update: {}, // never overwrite a manually-changed password on re-seed
    create: {
      email: DEV_ADMIN_EMAIL,
      name: 'Dev Admin',
      passwordHash: await hashPassword(DEV_ADMIN_PASSWORD),
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: en.id,
    },
  })

  // Dev country admin for India (P1-S4, §38/§45): exercises scoped RBAC.
  const inAdmin = await prisma.user.upsert({
    where: { email: DEV_IN_ADMIN_EMAIL },
    update: {},
    create: {
      email: DEV_IN_ADMIN_EMAIL,
      name: 'Dev India Admin',
      passwordHash: await hashPassword(DEV_IN_ADMIN_PASSWORD),
      role: 'COUNTRY_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: en.id,
    },
  })

  // ---------- P2-S4: editorial staff (Master Plan §18/§20/§45) ----------
  // Writers create/edit/submit content but never publish (§18); scopes are
  // explicit country (+ optionally language) and enforced server-side (§20).
  const writerIn = await prisma.user.upsert({
    where: { email: DEV_WRITER_IN_EMAIL },
    update: {}, // never overwrite live role/scope edits
    create: {
      email: DEV_WRITER_IN_EMAIL,
      name: 'Dev Writer (IN, all languages)',
      passwordHash: await hashPassword(DEV_WRITER_IN_PASSWORD),
      role: 'WRITER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: en.id,
      // languageScopeId null = all languages within the IN scope
    },
  })
  const writerHi = await prisma.user.upsert({
    where: { email: DEV_WRITER_HI_EMAIL },
    update: {},
    create: {
      email: DEV_WRITER_HI_EMAIL,
      name: 'Dev Writer (IN, Hindi-scoped)',
      passwordHash: await hashPassword(DEV_WRITER_HI_PASSWORD),
      role: 'WRITER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: hi.id,
      languageScopeId: hi.id, // §20 explicit language scope — Hindi only
    },
  })

  // ---------- Taxonomy branches (P1-S4, §13/§45) ----------
  // Configurable domains (never hard-coded in code) + country-scoped extensions.
  // upsert update: {} — re-seed must not overwrite live admin edits (§36).
  interface SeedTopic {
    slug: string
    canonicalName: string
    type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
    scope: 'GLOBAL' | 'COUNTRY'
    countryId?: string
    parent?: string // parent slug (resolved after creation)
    orderIndex?: number
    description?: string
    labels?: Array<{ languageCode: string; name: string }>
    aliases?: Array<{ value: string; languageCode?: string }>
  }

  const topics: SeedTopic[] = [
    // Root domains — the global framework (§13)
    {
      slug: 'polity-governance',
      canonicalName: 'Polity & Governance',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 1,
      description: 'Constitutions, political systems, governance and public administration.',
      labels: [
        { languageCode: 'en', name: 'Polity & Governance' },
        { languageCode: 'hi', name: 'राजव्यवस्था और शासन' },
      ],
    },
    {
      slug: 'history',
      canonicalName: 'History',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 2,
      description: 'World and national history from ancient to modern times.',
      labels: [
        { languageCode: 'en', name: 'History' },
        { languageCode: 'hi', name: 'इतिहास' },
      ],
    },
    {
      slug: 'science-technology',
      canonicalName: 'Science & Technology',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 3,
      description: 'Physical sciences, life sciences, and technological progress.',
      labels: [
        { languageCode: 'en', name: 'Science & Technology' },
        { languageCode: 'hi', name: 'विज्ञान और प्रौद्योगिकी' },
      ],
    },
    {
      slug: 'current-affairs',
      canonicalName: 'Current Affairs',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 4,
      description: 'Ongoing events and developments with exam relevance.',
      labels: [
        { languageCode: 'en', name: 'Current Affairs' },
        { languageCode: 'hi', name: 'समकालीन घटनाएँ' },
      ],
    },
    // Polity branches
    {
      slug: 'constitutional-framework',
      canonicalName: 'Constitutional Framework',
      type: 'BRANCH',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'polity-governance',
      orderIndex: 1,
      description: 'The Constitution of India: structure, organs, and amendments.',
      labels: [
        { languageCode: 'en', name: 'Constitutional Framework' },
        { languageCode: 'hi', name: 'संवैधानिक ढाँचा' },
      ],
    },
    {
      slug: 'fundamental-rights',
      canonicalName: 'Fundamental Rights',
      type: 'TOPIC',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'constitutional-framework',
      orderIndex: 1,
      description: 'Part III of the Constitution: Articles 12–35 and landmark judgments.',
      labels: [
        { languageCode: 'en', name: 'Fundamental Rights' },
        { languageCode: 'hi', name: 'मौलिक अधिकार' },
      ],
      aliases: [
        { value: 'FR' },
        { value: 'Fundamental Rights in India' },
        { value: 'मौलिक अधिकार', languageCode: 'hi' },
      ],
    },
    {
      slug: 'international-organisations',
      canonicalName: 'International Organisations',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'polity-governance',
      orderIndex: 2,
      description: 'UN, WTO, IMF, World Bank and other global bodies.',
      labels: [
        { languageCode: 'en', name: 'International Organisations' },
        { languageCode: 'hi', name: 'अंतर्राष्ट्रीय संगठन' },
      ],
    },
    {
      slug: 'united-nations',
      canonicalName: 'United Nations',
      type: 'TOPIC',
      scope: 'GLOBAL',
      parent: 'international-organisations',
      orderIndex: 1,
      description: 'UN structure, principal organs, agencies, and peacekeeping.',
      labels: [
        { languageCode: 'en', name: 'United Nations' },
        { languageCode: 'hi', name: 'संयुक्त राष्ट्र' },
      ],
      aliases: [{ value: 'UN' }],
    },
    // History branches
    {
      slug: 'ancient-india',
      canonicalName: 'Ancient India',
      type: 'BRANCH',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'history',
      orderIndex: 1,
      description: 'Indus Valley civilisation through the early medieval period.',
      labels: [
        { languageCode: 'en', name: 'Ancient India' },
        { languageCode: 'hi', name: 'प्राचीन भारत' },
      ],
    },
    {
      slug: 'mauryan-empire',
      canonicalName: 'Mauryan Empire',
      type: 'TOPIC',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'ancient-india',
      orderIndex: 1,
      description: 'Chandragupta, Bindusara, Ashoka and Mauryan administration.',
      labels: [
        { languageCode: 'en', name: 'Mauryan Empire' },
        { languageCode: 'hi', name: 'मौर्य साम्राज्य' },
      ],
    },
    {
      slug: 'world-history',
      canonicalName: 'World History',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'history',
      orderIndex: 2,
      description: 'Revolutions, world wars, and global transformations.',
      labels: [
        { languageCode: 'en', name: 'World History' },
        { languageCode: 'hi', name: 'विश्व इतिहास' },
      ],
    },
    // Science & Technology branches
    {
      slug: 'space-technology',
      canonicalName: 'Space Technology',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'science-technology',
      orderIndex: 1,
      description: 'Launch systems, satellites, deep-space missions, and agencies.',
      labels: [
        { languageCode: 'en', name: 'Space Technology' },
        { languageCode: 'hi', name: 'अंतरिक्ष प्रौद्योगिकी' },
      ],
    },
    {
      slug: 'isro-programmes',
      canonicalName: 'ISRO Programmes',
      type: 'TOPIC',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'space-technology',
      orderIndex: 1,
      description: 'Chandrayaan, Mangalyaan, Gaganyaan, PSLV/GSLV and ISRO history.',
      labels: [
        { languageCode: 'en', name: 'ISRO Programmes' },
        { languageCode: 'hi', name: 'इसरो कार्यक्रम' },
      ],
    },
    // Current affairs branch
    {
      slug: 'awards-honours',
      canonicalName: 'Awards & Honours',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'current-affairs',
      orderIndex: 1,
      description: 'National and international awards, prizes, and honours.',
      labels: [
        { languageCode: 'en', name: 'Awards & Honours' },
        { languageCode: 'hi', name: 'पुरस्कार और सम्मान' },
      ],
    },
  ]

  const languageIdByCode = new Map([
    ['en', en.id],
    ['hi', hi.id],
    ['fr', fr.id],
  ])

  const topicIdBySlug = new Map<string, string>()
  for (const seed of topics) {
    const created = await prisma.topic.upsert({
      where: { slug: seed.slug },
      update: {},
      create: {
        slug: seed.slug,
        canonicalName: seed.canonicalName,
        description: seed.description ?? null,
        type: seed.type,
        status: 'ACTIVE',
        scope: seed.scope,
        countryId: seed.scope === 'COUNTRY' ? (seed.countryId ?? india.id) : null,
        parentId: seed.parent ? (topicIdBySlug.get(seed.parent) ?? null) : null,
        orderIndex: seed.orderIndex ?? 0,
      },
    })
    topicIdBySlug.set(seed.slug, created.id)

    for (const label of seed.labels ?? []) {
      await prisma.topicLabel.upsert({
        where: {
          topicId_languageId: {
            topicId: created.id,
            languageId: languageIdByCode.get(label.languageCode)!,
          },
        },
        update: {},
        create: {
          topicId: created.id,
          languageId: languageIdByCode.get(label.languageCode)!,
          name: label.name,
        },
      })
    }

    for (const alias of seed.aliases ?? []) {
      await prisma.topicAlias.upsert({
        where: {
          topicId_value: {
            topicId: created.id,
            value: alias.value,
          },
        },
        update: {},
        create: {
          topicId: created.id,
          value: alias.value,
          languageId: alias.languageCode ? (languageIdByCode.get(alias.languageCode) ?? null) : null,
        },
      })
    }
  }

  // ---------- P2-S1: Knowledge Units (Master Plan §45) ----------
  // Structurally rich: multiple types (§23), difficulties, scopes (§14) and
  // lifecycle statuses — one DRAFT unit exercises the transition demo. Seed
  // writes never overwrite live edits made through the CRUD APIs (§36).

  interface KnowledgeSeed {
    slug: string
    canonicalName: string
    canonicalSummary: string
    canonicalBody: string
    type:
      | 'FACT'
      | 'CONCEPT'
      | 'TIMELINE'
      | 'PERSON_PROFILE'
      | 'PLACE_PROFILE'
      | 'ORGANISATION_PROFILE'
      | 'COMPARISON'
    status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
    difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
    scope: 'GLOBAL' | 'COUNTRY'
    topicSlug: string
    validFrom?: Date
    orderIndex?: number
  }

  const knowledgeUnits: KnowledgeSeed[] = [
    {
      slug: 'fundamental-rights-articles-12-35',
      canonicalName: 'Fundamental Rights — Articles 12–35',
      canonicalSummary:
        'Part III of the Constitution guarantees six Fundamental Rights, enforceable against the State under Article 32.',
      canonicalBody:
        'Fundamental Rights are enshrined in Part III of the Constitution of India, Articles 12–35. Article 12 defines "the State" broadly (legislature, executive, local authorities, statutory bodies), and Article 13 bars laws inconsistent with Fundamental Rights. The six rights are: Equality (14–18), Freedom (19–22), Against Exploitation (23–24), Freedom of Religion (25–28), Cultural & Educational (29–30), and Constitutional Remedies (32). Dr B R Ambedkar called Article 32 — the right to move the Supreme Court directly — the "heart and soul" of the Constitution. Key land laws and judgments that shaped these rights include Maneka Gandhi v. Union of India (1978), which read Article 21 expansively.',
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'INTERMEDIATE',
      scope: 'COUNTRY',
      topicSlug: 'fundamental-rights',
      orderIndex: 1,
    },
    {
      slug: 'right-to-constitutional-remedies-article-32',
      canonicalName: 'Right to Constitutional Remedies — Article 32',
      canonicalSummary:
        'Article 32 lets citizens move the Supreme Court directly to enforce Fundamental Rights; Ambedkar called it the heart and soul of the Constitution.',
      canonicalBody:
        'Article 32 of the Constitution provides the right to move the Supreme Court by appropriate proceedings for the enforcement of Fundamental Rights, making those rights justiciable rather than declaratory. The Supreme Court may issue writs of habeas corpus, mandamus, prohibition, certiorari and quo warranto. Dr B R Ambedkar described Article 32 as "the very soul of the Constitution and the very heart of it" because a right without a remedy is meaningless. The Article cannot be suspended except during a Emergency as provided by the Constitution (Article 359).',
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'ADVANCED',
      scope: 'COUNTRY',
      topicSlug: 'fundamental-rights',
      orderIndex: 2,
    },
    {
      slug: 'ashoka-kalinga-war-261-bce',
      canonicalName: "Ashoka's Kalinga War — 261 BCE",
      canonicalSummary:
        'The Kalinga War (c. 261 BCE) turned Emperor Ashoka from conquest to Dhamma; its death toll is recorded in his 13th Rock Edict.',
      canonicalBody:
        'The Kalinga War, fought c. 261 BCE in the third year of Ashoka\'s reign, was the decisive turning point of Mauryan history. Ashoka\'s 13th Rock Edict records that 100,000 were killed, 150,000 deported and many more died afterwards. The remorse Ashoka expressed led him to embrace Buddhism and pursue "conquest by Dhamma" (Dhamma Vijaya) instead of war. Kalinga corresponds to present-day coastal Odisha. The war is a favourite exam anchor for Mauryan history questions.',
      type: 'FACT',
      status: 'VERIFIED',
      difficulty: 'BASIC',
      scope: 'COUNTRY',
      topicSlug: 'mauryan-empire',
      orderIndex: 1,
    },
    {
      slug: 'un-security-council-permanent-members',
      canonicalName: 'UN Security Council — Permanent Members',
      canonicalSummary:
        'The P5 — China, France, Russia, the UK and the US — hold permanent seats and veto power on the 15-member Security Council.',
      canonicalBody:
        'The United Nations Security Council has 15 members: five permanent (the P5 — China, France, Russia, the United Kingdom and the United States, the victors of the Second World War institutionalised in 1945) and ten non-permanent members elected for two-year terms without immediate re-election. Decisions on substantive matters require nine affirmative votes including no veto from any permanent member (Chapter V of the UN Charter). Reform of the Council — including India\'s long-standing bid for a permanent seat — is debated under the Intergovernmental Negotiations process.',
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'BASIC',
      scope: 'GLOBAL',
      topicSlug: 'united-nations',
      orderIndex: 1,
    },
    {
      slug: 'fall-of-the-berlin-wall-1989',
      canonicalName: 'Fall of the Berlin Wall — 1989',
      canonicalSummary:
        'On 9 November 1989 the Berlin Wall fell after 28 years, catalysing German reunification (1990) and the collapse of the Eastern Bloc.',
      canonicalBody:
        'The Berlin Wall, erected on 13 August 1961 by the German Democratic Republic to stop the exodus to West Berlin, fell on the night of 9 November 1989 after a botched press conference by Günter Schabowski opened the crossings. The Wall had stood for 28 years. Its fall catalysed the reunification of Germany on 3 October 1990 and accelerated the collapse of communist regimes across the Eastern Bloc. Timeline anchors for exams: construction 1961, Kennedy\'s "Ich bin ein Berliner" 1963, fall 1989, reunification 1990.',
      type: 'TIMELINE',
      status: 'VERIFIED',
      difficulty: 'INTERMEDIATE',
      scope: 'GLOBAL',
      topicSlug: 'world-history',
      orderIndex: 1,
    },
    {
      slug: 'chandrayaan-3-landing-2023',
      canonicalName: 'Chandrayaan-3 Landing — 23 August 2023',
      canonicalSummary:
        'Chandrayaan-3 made India the fourth country to soft-land on the Moon and the first near the lunar south pole.',
      canonicalBody:
        'ISRO\'s Chandrayaan-3 mission soft-landed its Vikram lander near the lunar south pole on 23 August 2023, making India the fourth country to achieve a Moon soft landing (after the USSR, USA and China) and the first to land in the southern polar region. The mission was launched on 14 July 2023 aboard LVM3-M4. The Pragyan rover conducted in-situ experiments before lunar night. The landing site was named "Shiv Shakti Point", and 23 August is now observed as National Space Day in India.',
      type: 'FACT',
      status: 'VERIFIED',
      difficulty: 'INTERMEDIATE',
      scope: 'COUNTRY',
      topicSlug: 'isro-programmes',
      validFrom: new Date('2023-08-23T00:00:00Z'),
      orderIndex: 1,
    },
    {
      slug: 'attorney-general-of-india',
      canonicalName: 'Attorney General of India',
      canonicalSummary:
        'Article 76 creates the Attorney General, the Union\'s chief legal adviser and senior advocate; a DRAFT seed unit for the lifecycle demo.',
      canonicalBody:
        'The Attorney General for India is the Government of India\'s chief legal adviser, appointed by the President under Article 76 of the Constitution. The appointee must be qualified to be a Supreme Court judge. The Attorney General has the right of audience in all courts in India and takes part in parliamentary proceedings (without a vote). This seed unit starts in DRAFT to exercise the lifecycle transitions (submit_review → verify) end-to-end.',
      type: 'CONCEPT',
      status: 'DRAFT',
      difficulty: 'ADVANCED',
      scope: 'COUNTRY',
      topicSlug: 'constitutional-framework',
      orderIndex: 1,
    },
  ]

  let knowledgeSeeded = 0
  for (const seed of knowledgeUnits) {
    const topicId = topicIdBySlug.get(seed.topicSlug)
    if (!topicId) {
      console.warn(`[seed] skipping knowledge unit "${seed.slug}": topic "${seed.topicSlug}" not found`)
      continue
    }
    await prisma.knowledgeUnit.upsert({
      where: { slug: seed.slug },
      update: {},
      create: {
        slug: seed.slug,
        canonicalName: seed.canonicalName,
        canonicalSummary: seed.canonicalSummary,
        canonicalBody: seed.canonicalBody,
        type: seed.type,
        status: seed.status,
        difficulty: seed.difficulty,
        scope: seed.scope,
        countryId: seed.scope === 'COUNTRY' ? india.id : null,
        topicId,
        validFrom: seed.validFrom ?? null,
        orderIndex: seed.orderIndex ?? 0,
        createdById: admin.id,
      },
    })
    knowledgeSeeded += 1
  }

  // ---------- P2-S2: ContentItems + revisions (Master Plan §45) ----------
  // Structurally rich representations (§7): multiple formats (§23), languages
  // (§35 — Hindi demo), statuses, and one two-revision correction (§36 — the
  // previous version is preserved with provenance). Seed writes never
  // overwrite live edits made through the CRUD APIs (§36).

  interface RevisionSeed {
    title: string
    body: string
    changeSummary?: string
    publishedAt?: Date
  }

  interface ContentSeed {
    unitSlug: string
    languageCode: string
    format:
      | 'FACT_CARD'
      | 'EXPLAINER'
      | 'REVISION_NOTE'
      | 'CURRENT_EVENT_UPDATE'
      | 'TIMELINE'
      | 'PROFILE'
      | 'COMPARISON'
    status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
    /** §19 step 7: required when status = SCHEDULED (future release time). */
    scheduledForAt?: Date
    /** Working-copy overrides for items without revisions. */
    title?: string
    body?: string
    revisions: RevisionSeed[] // empty for never-published items
  }

  const contentItems: ContentSeed[] = [
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'EXPLAINER',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Fundamental Rights (Articles 12–35) — Complete Explainer',
          body: 'Fundamental Rights, enshrined in Part III of the Constitution of India (Articles 12–35), are justiciable guarantees available against the State as defined by Article 12. Article 13 adds teeth: any law inconsistent with these rights is void. The six rights — Equality (14–18), Freedom (19–22), Against Exploitation (23–24), Freedom of Religion (25–28), Cultural & Educational (29–30) and Constitutional Remedies (32) — are enforceable through the writ jurisdiction of the Supreme Court and the High Courts. Landmark expansions include Maneka Gandhi v. Union of India (1978), which read Article 21\'s "right to life and personal liberty" expansively to include dignity and due process. For exams, anchor on the article ranges, the writs (habeas corpus, mandamus, prohibition, certiorari, quo warranto), and the distinction between Fundamental Rights and Directive Principles.',
          publishedAt: new Date('2025-06-10T09:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'FACT_CARD',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Fundamental Rights — Quick Facts',
          body: 'Part III, Articles 12–35: six Fundamental Rights — Equality, Freedom, Against Exploitation, Religion, Cultural & Educational, Constitutional Remedies. Article 32 (writ jurisdiction) was called the "heart and soul" of the Constitution by Dr B R Ambedkar.',
          publishedAt: new Date('2025-06-10T09:30:00Z'),
        },
      ],
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'hi',
      format: 'EXPLAINER',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'मौलिक अधिकार (अनुच्छेद 12–35) — व्याख्या',
          body: 'भारतीय संविधान के भाग III (अनुच्छेद 12–35) में अंतर्निहित मौलिक अधिकार न्यायोचित गारंटियाँ हैं, जो अनुच्छेद 12 में परिभाषित "राज्य" के विरुद्ध प्राप्त करने योग्य हैं। छह अधिकार हैं: समता (14–18), स्वतंत्रता (19–22), शोषण के विरुद्ध (23–24), धार्मिक स्वतंत्रता (25–28), सांस्कृतिक और शैक्षिक (29–30), तथा संवैधानिक उपचार (32)। डॉ. बी. आर. अंबेडकर ने अनुच्छेद 32 को संविधान का "हृदय और आत्मा" कहा, क्योंकि बिना उपचार के अधिकार अर्थहीन हैं। मनेका गांधी बनाम भारत संघ (1978) ने अनुच्छेद 21 को व्यापक रूप से पढ़ा। परीक्षा के लिए अनुच्छेद सीमाएँ, रिट (बंदी प्रत्यक्षीकरण, परमादेश, निषेध, प्रतिकूल आदेश, अधिकार पृच्छा) और मौलिक अधिकार बनाम नीति निदेशक तत्वों का अंतर याद रखें।',
          publishedAt: new Date('2025-07-01T10:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'EXPLAINER',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'The UN Security Council and the P5 — Explainer',
          body: 'The United Nations Security Council (UNSC) is the UN organ with primary responsibility for international peace and security, established by Chapter V of the UN Charter in 1945. It has 15 members: the five permanent members (P5 — China, France, Russia, the United Kingdom and the United States), holding veto power over substantive resolutions, and ten non-permanent members elected for two-year terms without immediate re-election. Substantive decisions need nine affirmative votes including no P5 veto. Reform debates — including India\'s long-standing claim to a permanent seat, supported by the G4 (Brazil, Germany, India, Japan) — run through the Intergovernmental Negotiations (IGN) process. For exams, remember: 15 members, 5 permanent, 10 elected, 9 votes needed, one veto blocks.',
          publishedAt: new Date('2025-06-15T08:00:00Z'),
        },
      ],
    },
    {
      // P2-S5 (§23/§45): the PROFILE format — structured "key: value" fields
      // rendered by the canonical reading page's format-aware renderer.
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'PROFILE',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'UN Security Council — Profile',
          body: 'Established: 1945 (Chapter V, UN Charter)\nHeadquarters: United Nations, New York\nTotal members: 15 (5 permanent, 10 non-permanent)\nPermanent members (P5): China, France, Russia, United Kingdom, United States\nNon-permanent members: elected by the General Assembly for two-year terms, no immediate re-election\nVoting on substantive matters: 9 of 15 affirmative votes, including no P5 veto\nPresident: rotates monthly in alphabetical order of member names\nSubsidiary bodies: sanctions committees, peacekeeping mandates, working groups on documentation and counter-terrorism\nReform track: Intergovernmental Negotiations (IGN); India\'s permanent-seat claim is backed by the G4',
          publishedAt: new Date('2025-06-15T08:30:00Z'),
        },
      ],
    },
    {
      // P2-S5 (§23/§45): the COMPARISON format — "axis | left | right" rows,
      // the classic FR-vs-DPSP exam distinction on the same canonical record.
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'COMPARISON',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Fundamental Rights vs Directive Principles — Comparison',
          body: 'Enshrined in | Part III (Articles 12–35) | Part IV (Articles 36–51)\nNature | Justiciable — enforceable by courts | Non-justiciable — not enforceable by courts\nAim | Political democracy and individual liberty | Social and economic welfare\nSource | Bill of Rights tradition (US) | Irish Constitution (1937)\nConflict doctrine | prevail if a law is irreconcilable with both | must yield to Fundamental Rights; harmonious construction preferred otherwise\nBorrowed features | largely colonial-era rights recast | Directive Principles of State Policy\nLandmark reading | Minerva Mills (1980): balance is part of the basic structure | Champakam Dorairajan (1951) framed the harmony rule',
          publishedAt: new Date('2025-06-11T09:00:00Z'),
        },
      ],
    },
    {
      // P2-S5 (§23/§45): the TIMELINE format on its natural unit — the Berlin
      // Wall record (type TIMELINE), "date — event" lines per §23 convention.
      unitSlug: 'fall-of-the-berlin-wall-1989',
      languageCode: 'en',
      format: 'TIMELINE',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'The Berlin Wall — Key Milestones',
          body: '13 August 1961 — The German Democratic Republic seals the border and begins building the Wall, stopping the exodus to West Berlin.\n26 June 1963 — President John F. Kennedy declares "Ich bin ein Berliner" at Rudolph Wilde Platz.\n1961–1989 — The Wall divides Berlin for 28 years; at least 140 people die trying to cross.\n9 November 1989 — After a botched Schabowski press conference, the crossings open; the Wall falls.\n3 October 1990 — Germany is formally reunified.\n1990 — East and West Germany sign the Unification Treaty; Soviet troops begin withdrawal.',
          publishedAt: new Date('2025-06-18T14:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'FACT_CARD',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Chandrayaan-3 Landing — Fact Card',
          // Rev 1 carries a deliberate factual slip, corrected in rev 2 — the
          // §25/§36 correction demo (previous version preserved with provenance).
          body: 'Chandrayaan-3 soft-landed near the lunar south pole on 23 August 2023, making India the third country to land on the Moon. The landing site is named "Shiv Shakti Point", and 23 August is observed as National Space Day.',
          publishedAt: new Date('2025-06-20T12:00:00Z'),
        },
        {
          title: 'Chandrayaan-3 Landing — Fact Card',
          body: 'Chandrayaan-3 soft-landed its Vikram lander near the lunar south pole on 23 August 2023, making India the FOURTH country to achieve a Moon soft landing (after the USSR, USA and China) and the first near the south pole. Launched 14 July 2023 on LVM3-M4, the landing site is "Shiv Shakti Point", and 23 August is observed as National Space Day.',
          changeSummary: 'Corrected: India was the fourth country to soft-land on the Moon (after USSR, USA, China), not the third. Added launch date and vehicle.',
          publishedAt: new Date('2025-09-15T11:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'ashoka-kalinga-war-261-bce',
      languageCode: 'en',
      format: 'REVISION_NOTE',
      status: 'DRAFT', // lifecycle demo — publish through the admin console
      revisions: [],
    },
    {
      // P2-S4 §19 step 7: a reviewed item approved for a FUTURE release —
      // demonstrates the SCHEDULED state (locked working copy, goes-live
      // badge, publish-now / send-back affordances, lazy materialization).
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'TIMELINE',
      status: 'SCHEDULED',
      scheduledForAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // +2 days
      title: 'Chandrayaan programme — key milestones',
      body: '22 October 2008 — Chandrayaan-1 launches; the Moon Impact Probe strikes near Shackleton crater.\n15 July 2019 — Chandrayaan-2 launches; its orbiter continues high-resolution mapping.\n14 July 2023 — Chandrayaan-3 launches on LVM3-M4.\n23 August 2023 — Vikram soft-lands near the lunar south pole (Shiv Shakti Point); India becomes the fourth country to soft-land on the Moon.\n23 August 2024 — the first National Space Day commemorates the landing anniversary.',
      revisions: [],
    },
  ]

  let contentSeeded = 0
  for (const seed of contentItems) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!unit || !languageId) {
      console.warn(`[seed] skipping content for "${seed.unitSlug}/${seed.languageCode}": unit or language missing`)
      continue
    }

    // Never overwrite live edits (§36) — only create when absent.
    const existing = await prisma.contentItem.findUnique({
      where: { knowledgeUnitId_languageId_format: { knowledgeUnitId: unit.id, languageId, format: seed.format } },
      select: { id: true },
    })
    if (existing) continue

    const lastRevision = seed.revisions[seed.revisions.length - 1]
    const item = await prisma.contentItem.create({
      data: {
        knowledgeUnitId: unit.id,
        languageId,
        format: seed.format,
        status: seed.status,
        ...(seed.scheduledForAt ? { scheduledForAt: seed.scheduledForAt } : {}),
        title: lastRevision?.title ?? seed.title ?? 'Untitled draft',
        body:
          lastRevision?.body ??
          seed.body ??
          'Draft revision notes for the Kalinga War: 261 BCE, third regnal year of Ashoka; 13th Rock Edict records 100,000 killed and 150,000 deported; the remorse led to Dhamma Vijaya; Kalinga = present-day coastal Odisha. Editable draft — publish through the admin console.',
        createdById: admin.id,
      },
    })

    let lastRevisionId: string | null = null
    for (const [index, revision] of seed.revisions.entries()) {
      const created = await prisma.contentRevision.create({
        data: {
          contentItemId: item.id,
          revisionNumber: index + 1,
          title: revision.title,
          body: revision.body,
          changeSummary: revision.changeSummary ?? null,
          publishedById: admin.id,
          publishedAt: revision.publishedAt ?? new Date(),
        },
      })
      lastRevisionId = created.id
    }
    if (seed.status === 'PUBLISHED' && lastRevisionId) {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { publishedRevisionId: lastRevisionId },
      })
    }
    contentSeeded += 1
  }

  // ---------- P2-S3: Sources + provenance links (Master Plan §24/§26/§45) ----------
  // Structurally rich evidence: categories (OFFICIAL/NEWS_MEDIA/INSTITUTIONAL),
  // verification states (VERIFIED + one UNVERIFIED + one UNRELIABLE trust-revoked
  // demo), claim-level AND content-level attribution (§24), and one AI-assisted
  // DRAFT CURRENT_EVENT_UPDATE (§26 flag + the source-backed-update format).
  // Seed writes never overwrite live edits (§36); sources dedup by URL.

  interface SourceSeed {
    title: string
    publisher: string
    url: string
    type: 'OFFICIAL' | 'NEWS_MEDIA' | 'INSTITUTIONAL' | 'ACADEMIC' | 'DATA' | 'OTHER'
    verification: 'UNVERIFIED' | 'VERIFIED' | 'UNRELIABLE'
    publishedAt?: Date
    retrievedAt?: Date
    verifiedAt?: Date
    notes?: string
  }

  const sources: SourceSeed[] = [
    {
      title: 'ISRO — Chandrayaan-3 soft-landing announcement',
      publisher: 'ISRO',
      url: 'https://www.isro.gov.in/Chandrayaan3.html',
      type: 'OFFICIAL',
      verification: 'VERIFIED',
      publishedAt: new Date('2023-08-23T00:00:00Z'),
      retrievedAt: new Date('2025-06-18T00:00:00Z'),
      verifiedAt: new Date('2025-06-18T00:00:00Z'),
      notes: 'Primary official record of the Vikram landing — the canonical evidence for the mission facts.',
    },
    {
      title: 'Chandrayaan-3 lands near lunar south pole, making India fourth nation to soft-land on Moon',
      publisher: 'The Hindu',
      url: 'https://www.thehindu.com/science/chandrayaan-3-soft-lands-on-moon/',
      type: 'NEWS_MEDIA',
      verification: 'VERIFIED',
      publishedAt: new Date('2023-08-23T00:00:00Z'),
      retrievedAt: new Date('2025-06-18T00:00:00Z'),
      verifiedAt: new Date('2025-06-19T00:00:00Z'),
    },
    {
      title: 'Charter of the United Nations — Chapter V (Security Council)',
      publisher: 'United Nations',
      url: 'https://www.un.org/en/about-us/un-charter/chapter-5',
      type: 'INSTITUTIONAL',
      verification: 'VERIFIED',
      publishedAt: new Date('1945-06-26T00:00:00Z'),
      retrievedAt: new Date('2025-06-14T00:00:00Z'),
      verifiedAt: new Date('2025-06-14T00:00:00Z'),
      notes: 'The primary source for UNSC composition and voting rules.',
    },
    {
      title: 'Constitution of India — Part III (Fundamental Rights)',
      publisher: 'Government of India',
      url: 'https://www.india.gov.in/my-government/constitution-india',
      type: 'OFFICIAL',
      verification: 'VERIFIED',
      publishedAt: new Date('1950-01-26T00:00:00Z'),
      retrievedAt: new Date('2025-06-08T00:00:00Z'),
      verifiedAt: new Date('2025-06-08T00:00:00Z'),
    },
    {
      title: 'ISRO — Gaganyaan G1 uncrewed test flight mission page',
      publisher: 'ISRO',
      url: 'https://www.isro.gov.in/Gaganyaan_G1.html',
      type: 'OFFICIAL',
      verification: 'VERIFIED',
      publishedAt: new Date('2026-09-26T00:00:00Z'),
      retrievedAt: new Date('2026-09-27T00:00:00Z'),
      verifiedAt: new Date('2026-09-27T00:00:00Z'),
      notes: 'Primary official record of the G1 flight — objectives, sequence and recovery result.',
    },
    {
      title: 'PIB release — National Space Day notification',
      publisher: 'Press Information Bureau',
      url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1950000',
      type: 'OFFICIAL',
      verification: 'UNVERIFIED', // recent record — awaiting the editorial verification pass (§24)
      publishedAt: new Date('2025-10-04T00:00:00Z'),
      retrievedAt: new Date('2025-11-20T00:00:00Z'),
      notes: 'Registered but not yet editor-checked — demonstrates the UNVERIFIED state and the verify workflow.',
    },
    {
      title: '“India becomes THIRD country to land on Moon” (retracted)',
      publisher: 'Space Insider Daily',
      url: 'https://spaceinsider-daily.example.com/india-third-country-moon-landing',
      type: 'NEWS_MEDIA',
      verification: 'UNRELIABLE', // trust revoked (§24) — factual error, retracted by the publisher
      publishedAt: new Date('2023-08-23T00:00:00Z'),
      retrievedAt: new Date('2025-06-18T00:00:00Z'),
      verifiedAt: new Date('2025-06-18T00:00:00Z'),
      notes: 'Trust-revoked demo: the “third country” error this outlet published is exactly what revision 1 of the Chandrayaan-3 fact card corrected (§36). Kept as preserved provenance history — never deleted, never attachable to new content.',
    },
  ]

  const sourceIdByUrl = new Map<string, string>()
  for (const seed of sources) {
    const created = await prisma.source.upsert({
      where: { url: seed.url },
      update: {}, // never overwrite live editorial edits on re-seed (§36)
      create: {
        title: seed.title,
        publisher: seed.publisher,
        url: seed.url,
        type: seed.type,
        verification: seed.verification,
        publishedAt: seed.publishedAt ?? null,
        retrievedAt: seed.retrievedAt ?? new Date(),
        verifiedAt: seed.verifiedAt ?? null,
        notes: seed.notes ?? null,
        createdById: admin.id,
      },
    })
    sourceIdByUrl.set(seed.url, created.id)
  }

  // One AI-assisted DRAFT CURRENT_EVENT_UPDATE (§26 + the P2-S2 handoff's
  // source-backed-update rendering) — staged provenance on an unpublished item.
  const chandrayaanUnit = await prisma.knowledgeUnit.findUnique({
    where: { slug: 'chandrayaan-3-landing-2023' },
  })
  let aiDraftSeeded = false
  if (chandrayaanUnit) {
    const existingUpdate = await prisma.contentItem.findUnique({
      where: {
        knowledgeUnitId_languageId_format: {
          knowledgeUnitId: chandrayaanUnit.id,
          languageId: en.id,
          format: 'CURRENT_EVENT_UPDATE',
        },
      },
      select: { id: true },
    })
    if (!existingUpdate) {
      await prisma.contentItem.create({
        data: {
          knowledgeUnitId: chandrayaanUnit.id,
          languageId: en.id,
          format: 'CURRENT_EVENT_UPDATE',
          status: 'DRAFT',
          title: 'National Space Day — update on Chandrayaan-3 legacy',
          body: 'Update: Following the Chandrayaan-3 soft landing on 23 August 2023, the Government of India notified 23 August as National Space Day. The landing site — “Shiv Shakti Point” — and the mission’s south-polar first have become standard exam anchors. This update summarizes the notification and links it to the canonical mission record. (AI-assisted draft: compiled by the AI layer from the cited PIB release and the ISRO record, pending editorial review — §26.)',
          aiAssisted: true,
          createdById: admin.id,
        },
      })
      aiDraftSeeded = true
    }
  }

  // Provenance links (§24): content-level and claim-level attribution.
  interface LinkSeed {
    unitSlug: string
    languageCode: string
    format:
      | 'FACT_CARD'
      | 'EXPLAINER'
      | 'REVISION_NOTE'
      | 'CURRENT_EVENT_UPDATE'
      | 'TIMELINE'
      | 'PROFILE'
      | 'COMPARISON'
    sourceUrl: string
    claim?: string
  }

  const provenanceLinks: LinkSeed[] = [
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'FACT_CARD',
      sourceUrl: 'https://www.isro.gov.in/Chandrayaan3.html',
      // content-level: the official record backs the whole card
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'FACT_CARD',
      sourceUrl: 'https://www.thehindu.com/science/chandrayaan-3-soft-lands-on-moon/',
      claim: 'India is the FOURTH country to soft-land on the Moon (after USSR, USA, China) and the first near the south pole — the claim corrected in revision 2 (§36).',
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'EXPLAINER',
      sourceUrl: 'https://www.un.org/en/about-us/un-charter/chapter-5',
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'EXPLAINER',
      sourceUrl: 'https://www.india.gov.in/my-government/constitution-india',
    },
    {
      // Staged provenance on the AI-assisted DRAFT (§26): visible in the admin
      // link manager, public only once the item passes review + publish.
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      sourceUrl: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1950000',
      claim: 'The National Space Day notification (23 August).',
    },
  ]

  let linksSeeded = 0
  for (const seed of provenanceLinks) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    const sourceId = sourceIdByUrl.get(seed.sourceUrl)
    if (!unit || !languageId || !sourceId) {
      console.warn(`[seed] skipping source link for "${seed.unitSlug}/${seed.languageCode}/${seed.format}": prerequisite missing`)
      continue
    }
    const item = await prisma.contentItem.findUnique({
      where: { knowledgeUnitId_languageId_format: { knowledgeUnitId: unit.id, languageId, format: seed.format } },
      select: { id: true },
    })
    if (!item) continue
    const existing = await prisma.contentSourceLink.findUnique({
      where: { contentItemId_sourceId: { contentItemId: item.id, sourceId } },
      select: { id: true },
    })
    if (existing) continue
    await prisma.contentSourceLink.create({
      data: {
        contentItemId: item.id,
        sourceId,
        claim: seed.claim ?? null,
      },
    })
    linksSeeded += 1
  }

  // ---------- P2-S4: Editorial workspace (Master Plan §6/§19/§45) ----------
  // A representative board: an unclaimed localisation review (claimable by the
  // Hindi-scoped writer), an in-progress fact check, a §25 correction request
  // on GLOBAL-unit content (ADMIN-only board — §38 parity), and one resolved
  // item for board variety. Seed never overwrites live task edits (§36).
  interface TaskSeed {
    type: 'EDITORIAL_REVIEW' | 'FACT_CHECK' | 'LOCALISATION_REVIEW' | 'SEO_REVIEW' | 'CORRECTION'
    unitSlug: string
    languageCode: string
    format: string
    title: string
    notes?: string
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
    assignee?: 'writer-in' | 'writer-hi' | 'in-admin'
    dueInHours?: number
    resolutionNote?: string
  }

  const editorialTasks: TaskSeed[] = [
    {
      type: 'LOCALISATION_REVIEW',
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'hi',
      format: 'EXPLAINER',
      title: 'Review the Hindi Fundamental Rights explainer',
      notes: 'Check terminology consistency (मौलिक अधिकार) against the taxonomy labels and tighten the intro.',
      priority: 'HIGH',
      // unassigned — the unclaimed pool (claimable by writer-hi, §20 scope)
    },
    {
      type: 'FACT_CHECK',
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      title: 'Fact-check the National Space Day update',
      notes: 'Verify the 23 August notification against the PIB release before the next revision.',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      assignee: 'writer-in',
      dueInHours: 48,
    },
    {
      type: 'CORRECTION',
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'EXPLAINER',
      title: 'Correction report — UNSC membership phrasing',
      notes: 'Reader-flagged: the phrasing on permanent membership vs veto powers needs a precise correction cycle (§25 — public feedback wiring lands P8-S3).',
      priority: 'URGENT',
      // GLOBAL unit → countryId null → platform task (ADMIN-only board, §38)
    },
    {
      type: 'SEO_REVIEW',
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'FACT_CARD',
      title: 'SEO pass on the Fundamental Rights fact card',
      notes: 'Title length + internal links to the explainer.',
      priority: 'LOW',
      status: 'RESOLVED',
      assignee: 'in-admin',
      resolutionNote: 'Titles within bounds; cross-links added with the explainer revision.',
    },
  ]

  const assigneesById: Record<string, string> = {
    'writer-in': writerIn.id,
    'writer-hi': writerHi.id,
    'in-admin': inAdmin.id,
  }

  let tasksSeeded = 0
  for (const seed of editorialTasks) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!unit || !languageId) {
      console.warn(`[seed] skipping task for "${seed.unitSlug}/${seed.languageCode}": prerequisite missing`)
      continue
    }
    const item = await prisma.contentItem.findUnique({
      where: {
        knowledgeUnitId_languageId_format: {
          knowledgeUnitId: unit.id,
          languageId,
          format: seed.format as
            | 'FACT_CARD'
            | 'EXPLAINER'
            | 'REVISION_NOTE'
            | 'CURRENT_EVENT_UPDATE'
            | 'TIMELINE'
            | 'PROFILE'
            | 'COMPARISON',
        },
      },
      select: { id: true },
    })
    if (!item) {
      console.warn(`[seed] skipping task "${seed.title}": content item missing`)
      continue
    }
    const existing = await prisma.editorialTask.findFirst({
      where: { objectType: 'ContentItem', objectId: item.id, type: seed.type, title: seed.title },
      select: { id: true },
    })
    if (existing) continue

    const status = seed.status ?? 'OPEN'
    await prisma.editorialTask.create({
      data: {
        type: seed.type,
        status,
        priority: seed.priority ?? 'MEDIUM',
        // §6/§14: the task inherits the work object's scope — GLOBAL units
        // produce platform (global) tasks visible on the ADMIN board only.
        countryId: unit.scope === 'COUNTRY' ? unit.countryId : null,
        languageId,
        objectType: 'ContentItem',
        objectId: item.id,
        objectLabel: `${unit.slug}/${seed.languageCode}/${seed.format}`,
        title: seed.title,
        notes: seed.notes ?? null,
        assigneeId: seed.assignee ? assigneesById[seed.assignee] : null,
        createdById: admin.id,
        ...(seed.dueInHours ? { dueAt: new Date(Date.now() + seed.dueInHours * 60 * 60 * 1000) } : {}),
        ...(status === 'IN_PROGRESS' ? { startedAt: new Date() } : {}),
        ...(status === 'RESOLVED'
          ? {
              resolvedAt: new Date(),
              resolvedById: seed.assignee ? assigneesById[seed.assignee] : null,
              resolutionNote: seed.resolutionNote ?? null,
            }
          : {}),
      },
    })
    tasksSeeded += 1
  }

  // ---------- P3-S1: Exams + versions (§45 structurally rich, §6/§14/§36) ----------
  // India (ACTIVE) gets the full demo matrix: lifecycle statuses, levels
  // (NATIONAL/STATE), version windows (historical superseded + current +
  // upcoming future-dated), and one DRAFT exam with no versions yet. UK
  // (COMING_SOON) carries one DRAFT exam to exercise §14 country scoping —
  // it is invisible publicly and untouchable by the IN country admin.
  const now = new Date()
  const year = now.getUTCFullYear()
  const jan1 = (y: number): Date => new Date(Date.UTC(y, 0, 1))
  const dec31 = (y: number): Date => new Date(Date.UTC(y, 11, 31))

  interface ExamSeed {
    slug: string
    code: string
    name: string
    organiser: string
    level: 'NATIONAL' | 'STATE' | 'REGIONAL'
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
    countryId: string
    description: string
    versions: Array<{
      label: string
      effectiveFrom: Date
      effectiveTo?: Date | null
      source: string
      notes?: string
    }>
  }

  const examSeeds: ExamSeed[] = [
    {
      slug: 'upsc-civil-services',
      code: 'UPSC-CSE',
      name: 'UPSC Civil Services Examination',
      organiser: 'Union Public Service Commission',
      level: 'NATIONAL',
      status: 'ACTIVE',
      countryId: india.id,
      description:
        'India\'s premier national recruitment examination for the Indian Administrative Service (IAS), Indian Foreign Service (IFS), Indian Police Service (IPS) and other Group A central services — Prelims, Mains and Personality Test.',
      versions: [
        {
          label: `${year - 1} syllabus (superseded)`,
          effectiveFrom: jan1(year - 1),
          effectiveTo: new Date(Date.UTC(year, 5 - 1, 31)), // closed by the current version (§36 auto-close)
          source: `UPSC ${year - 1} Examination Notification — https://upsc.gov.in`,
          notes: 'Historical window preserved for old mappings (§36 old versions stay queryable).',
        },
        {
          label: `${year} syllabus`,
          effectiveFrom: new Date(Date.UTC(year, 5, 1)), // Jun 1 this year
          effectiveTo: null,
          source: `UPSC ${year} Examination Notification — https://upsc.gov.in`,
        },
      ],
    },
    {
      slug: 'ssc-cgl',
      code: 'SSC-CGL',
      name: 'SSC Combined Graduate Level Examination',
      organiser: 'Staff Selection Commission',
      level: 'NATIONAL',
      status: 'ACTIVE',
      countryId: india.id,
      description:
        'Nationwide graduate-level recruitment examination for Group B and Group C posts in ministries, departments and organisations of the Government of India.',
      versions: [
        {
          label: `${year} syllabus`,
          effectiveFrom: jan1(year),
          effectiveTo: dec31(year), // auto-closed by the upcoming version
          source: `SSC ${year} Calendar & Notification — https://ssc.gov.in`,
        },
        {
          label: `${year + 1} syllabus (upcoming)`,
          effectiveFrom: jan1(year + 1),
          effectiveTo: null,
          source: `SSC ${year + 1} Examination Calendar — https://ssc.gov.in`,
          notes: 'Future-dated: demonstrates the UPCOMING state and the pre-effective correction path.',
        },
      ],
    },
    {
      slug: 'mp-police-constable',
      code: 'MP-POLICE-CONSTABLE',
      name: 'MP Police Constable Recruitment Examination',
      organiser: 'Madhya Pradesh Employees Selection Board',
      level: 'STATE',
      status: 'ACTIVE',
      countryId: india.id,
      description:
        'State-level police constable recruitment examination conducted by MP ESB (formerly Vyapam) for the Madhya Pradesh Police Department.',
      versions: [
        {
          label: `${year - 1} recruitment syllabus`,
          effectiveFrom: new Date(Date.UTC(year - 1, 6, 1)), // Jul 1 last year
          effectiveTo: null,
          source: `MP ESB Police Constable Recruitment Rules ${year - 1} — https://esb.mp.gov.in`,
        },
      ],
    },
    {
      slug: 'upsc-engineering-services',
      code: 'UPSC-ESE',
      name: 'UPSC Engineering Services Examination',
      organiser: 'Union Public Service Commission',
      level: 'NATIONAL',
      status: 'DRAFT',
      countryId: india.id,
      description:
        'Recruitment examination for engineering services under the Government of India (preparation in progress — no syllabus version published yet).',
      versions: [], // DRAFT demo: no version yet (P3-S2 attaches SyllabusNodes to versions)
    },
    {
      slug: 'uk-civil-service-fast-stream',
      code: 'UK-FAST-STREAM',
      name: 'Civil Service Fast Stream',
      organiser: 'Cabinet Office (UK Government)',
      level: 'NATIONAL',
      status: 'DRAFT',
      countryId: uk.id,
      description:
        'UK graduate leadership development programme (market not launched yet — exercises §14 country scoping: invisible publicly, untouchable by IN staff).',
      versions: [],
    },
  ]

  let examsSeeded = 0
  let examVersionsSeeded = 0
  for (const seed of examSeeds) {
    const existing = await prisma.exam.findUnique({ where: { slug: seed.slug }, select: { id: true } })
    if (existing) continue
    await prisma.exam.create({
      data: {
        slug: seed.slug,
        code: seed.code,
        name: seed.name,
        organiser: seed.organiser,
        level: seed.level,
        status: seed.status,
        countryId: seed.countryId,
        description: seed.description,
        createdById: admin.id,
        versions: {
          create: seed.versions.map((version) => ({
            label: version.label,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo ?? null,
            source: version.source,
            notes: version.notes ?? null,
            createdById: admin.id,
          })),
        },
      },
    })
    examsSeeded += 1
    examVersionsSeeded += seed.versions.length
  }

  // ---------- P3-S2: SyllabusNode trees (Master Plan §6, §13, §45) ----------
  // §45: "Sample exams with versioned syllabus nodes (at least two exams
  // sharing overlapping syllabus, to exercise the combination engine)" — the
  // trees below deliberately link the SAME canonical topics (constitutional-
  // framework, current-affairs, history, science-technology) across UPSC CSE,
  // SSC CGL and MP Police Constable, so P3-S3 mappings and the §11 union
  // engine have real overlap to deduplicate. Trees are pinned to their
  // version (§36): the seeded current versions are already in effect → their
  // trees are frozen history; the SSC upcoming version stays empty staging.
  interface SyllabusSeedNode {
    name: string
    topic?: string // canonical taxonomy slug (§13 — the only exam→taxonomy bridge)
    children?: SyllabusSeedNode[]
  }

  const syllabusSeeds: Array<{ examSlug: string; versionLabel: string; nodes: SyllabusSeedNode[] }> = [
    {
      examSlug: 'upsc-civil-services',
      versionLabel: `${year} syllabus`,
      nodes: [
        {
          name: 'Prelims — Paper I (General Studies)',
          children: [
            { name: 'Current events of national and international importance', topic: 'current-affairs' },
            { name: 'History of India and Indian National Movement', topic: 'history' },
            { name: 'Indian and World Geography — physical, social, economic' },
            { name: 'Indian Polity and Governance — Constitution, political system, rights issues', topic: 'constitutional-framework' },
            { name: 'General Science', topic: 'science-technology' },
          ],
        },
        {
          name: 'Prelims — Paper II (CSAT)',
          children: [
            { name: 'Comprehension' },
            { name: 'Logical reasoning and analytical ability' },
            { name: 'Decision-making and problem-solving' },
          ],
        },
        {
          name: 'Mains — GS Paper II (Governance, Constitution, Polity, Social Justice, IR)',
          children: [
            { name: 'Indian Constitution — historical underpinnings, evolution and features', topic: 'constitutional-framework' },
            { name: 'Fundamental Rights and Fundamental Duties', topic: 'fundamental-rights' },
            { name: 'India and its neighbourhood — relations' },
            { name: 'Important international institutions and agencies', topic: 'international-organisations' },
          ],
        },
      ],
    },
    {
      // §36 historical tree: the superseded window keeps its own structure
      // queryable (old mappings remain historically readable).
      examSlug: 'upsc-civil-services',
      versionLabel: `${year - 1} syllabus (superseded)`,
      nodes: [
        {
          name: 'Prelims — Paper I (General Studies)',
          children: [
            { name: 'Current events of national and international importance', topic: 'current-affairs' },
            { name: 'Indian Polity and Governance', topic: 'constitutional-framework' },
          ],
        },
        {
          name: 'Prelims — Paper II (CSAT)',
          children: [{ name: 'Comprehension' }, { name: 'Interpersonal skills including communication' }],
        },
      ],
    },
    {
      examSlug: 'ssc-cgl',
      versionLabel: `${year} syllabus`,
      nodes: [
        { name: 'Tier-I — General Intelligence and Reasoning' },
        {
          name: 'Tier-I — General Awareness',
          children: [
            { name: 'Indian Polity and Constitution', topic: 'constitutional-framework' },
            { name: 'History of India', topic: 'history' },
            { name: 'Current affairs', topic: 'current-affairs' },
          ],
        },
        { name: 'Tier-I — Quantitative Aptitude' },
        { name: 'Tier-I — English Comprehension' },
      ],
    },
    {
      examSlug: 'mp-police-constable',
      versionLabel: `${year - 1} recruitment syllabus`,
      nodes: [
        {
          name: 'Part A — General Knowledge and Current Affairs',
          children: [
            { name: 'Indian Constitution', topic: 'constitutional-framework' },
            { name: 'Current affairs', topic: 'current-affairs' },
            { name: 'General Science', topic: 'science-technology' },
          ],
        },
        { name: 'Part B — Intellectual Ability and Mental Ability' },
        { name: 'Part C — Simple Arithmetic' },
      ],
    },
  ]

  let syllabusNodesSeeded = 0
  for (const seed of syllabusSeeds) {
    const exam = await prisma.exam.findUnique({
      where: { slug: seed.examSlug },
      include: { versions: true },
    })
    if (!exam) continue
    const version = exam.versions.find((row) => row.label === seed.versionLabel)
    if (!version) continue
    // Idempotent: never re-seed over a live admin-edited tree (§36 spirit).
    const existing = await prisma.syllabusNode.count({ where: { examVersionId: version.id } })
    if (existing > 0) continue

    const createNodes = async (
      nodes: SyllabusSeedNode[],
      parentId: string | null,
      depth: number
    ): Promise<number> => {
      let created = 0
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]
        const row = await prisma.syllabusNode.create({
          data: {
            examVersionId: version.id,
            parentId,
            name: node.name,
            topicId: node.topic ? (topicIdBySlug.get(node.topic) ?? null) : null,
            depth,
            priority: index,
          },
        })
        created += 1
        if (node.children?.length) {
          created += await createNodes(node.children, row.id, depth + 1)
        }
      }
      return created
    }
    syllabusNodesSeeded += await createNodes(seed.nodes, null, 0)
  }

  // ---------- P3-S3: ExamMapping seeds (Master Plan §6, §8, §45, Appendix A) ----------
  // §45: "Sample mappings where two exams share one Knowledge Unit at different
  // depths (mirroring Appendix A)" — the Fundamental Rights unit maps to UPSC
  // (ANALYTICAL), SSC (FACT) and MP Police (ONE_LINE): the exact Appendix A
  // demo the §11 union engine (P3-S4) will deduplicate. Current trees are
  // frozen §36 history, so seed rows are inserted directly (the console can
  // still edit them — mappings stay writable on the CURRENT version, §12);
  // one mapping rides the superseded UPSC window to demo "old mappings remain
  // historically queryable".
  interface MappingSeed {
    unitSlug: string
    examSlug: string
    versionLabel: string
    nodeName: string
    relevance: 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
    priority: 'CORE' | 'SUPPORTING' | 'LOW'
    requiredDepth: 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
    questionLikelihood: 'HIGH' | 'MEDIUM' | 'LOW'
    expectedScope?: string
    sourceBasis?: string
    notes?: string
    effectiveFrom?: Date
  }

  const mappingSeeds: MappingSeed[] = [
    {
      // Appendix A anchor: the same canonical unit at three depths.
      unitSlug: 'fundamental-rights-articles-12-35',
      examSlug: 'upsc-civil-services',
      versionLabel: `${year} syllabus`,
      nodeName: 'Fundamental Rights and Fundamental Duties',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'ANALYTICAL',
      questionLikelihood: 'HIGH',
      expectedScope:
        'Full Part III framework — the six rights, Articles 12–35, enforcement under Article 32 and the landmark judgments (Maneka Gandhi).',
      sourceBasis: 'Named in the Mains GS-II syllabus (Fundamental Rights and Fundamental Duties).',
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      examSlug: 'ssc-cgl',
      versionLabel: `${year} syllabus`,
      nodeName: 'Indian Polity and Constitution',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'FACT',
      questionLikelihood: 'HIGH',
      expectedScope: 'One-line facts — article numbers and the six rights by name.',
      sourceBasis: 'SSC CGL Tier-I General Awareness: Indian Polity and Constitution.',
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      examSlug: 'mp-police-constable',
      versionLabel: `${year - 1} recruitment syllabus`,
      nodeName: 'Indian Constitution',
      relevance: 'DIRECT',
      priority: 'SUPPORTING',
      requiredDepth: 'ONE_LINE',
      questionLikelihood: 'MEDIUM',
      expectedScope: 'Article numbers only — which right lives in which Article.',
      sourceBasis: 'MP Police Constable Part A: Indian Constitution basics.',
    },
    {
      unitSlug: 'right-to-constitutional-remedies-article-32',
      examSlug: 'upsc-civil-services',
      versionLabel: `${year} syllabus`,
      nodeName: 'Fundamental Rights and Fundamental Duties',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'DETAILED',
      questionLikelihood: 'HIGH',
      expectedScope: 'The five writs and the "heart and soul" framing; Article 359 suspension context.',
      sourceBasis: 'Prelims + Mains pattern: writs under Article 32 recur every cycle.',
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      examSlug: 'upsc-civil-services',
      versionLabel: `${year} syllabus`,
      nodeName: 'Important international institutions and agencies',
      relevance: 'DIRECT',
      priority: 'SUPPORTING',
      requiredDepth: 'CONCEPT',
      questionLikelihood: 'MEDIUM',
      expectedScope: 'P5 membership, veto mechanics and the reform debate (India\'s bid).',
      sourceBasis: 'GS-II syllabus: important international institutions, agencies and fora.',
    },
    {
      unitSlug: 'ashoka-kalinga-war-261-bce',
      examSlug: 'upsc-civil-services',
      versionLabel: `${year} syllabus`,
      nodeName: 'History of India and Indian National Movement',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'FACT',
      questionLikelihood: 'HIGH',
      expectedScope: 'Date, 13th Rock Edict casualties and the Dhamma Vijaya turn.',
      sourceBasis: 'Ancient India is a Prelims staple; Mauryan history recurs in PYQs.',
    },
    {
      unitSlug: 'ashoka-kalinga-war-261-bce',
      examSlug: 'ssc-cgl',
      versionLabel: `${year} syllabus`,
      nodeName: 'History of India',
      relevance: 'PARTIAL',
      priority: 'SUPPORTING',
      requiredDepth: 'ONE_LINE',
      questionLikelihood: 'MEDIUM',
      expectedScope: 'The 13th Rock Edict death toll and the Dhamma turn only.',
      sourceBasis: 'SSC CGL Tier-I General Awareness: History of India.',
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      examSlug: 'upsc-civil-services',
      versionLabel: `${year} syllabus`,
      nodeName: 'Current events of national and international importance',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'FACT',
      questionLikelihood: 'HIGH',
      expectedScope: 'Landing date, south-pole first, Shiv Shakti Point, National Space Day.',
      sourceBasis: 'Current affairs — National Space Day (23 August) anchors.',
      effectiveFrom: new Date('2023-08-23T00:00:00Z'), // §8 effective_period demo: valid from the landing
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      examSlug: 'mp-police-constable',
      versionLabel: `${year - 1} recruitment syllabus`,
      nodeName: 'Current affairs',
      relevance: 'DIRECT',
      priority: 'SUPPORTING',
      requiredDepth: 'ONE_LINE',
      questionLikelihood: 'MEDIUM',
      expectedScope: 'First country near the lunar south pole.',
      sourceBasis: 'MP Police Part A: current affairs.',
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      examSlug: 'ssc-cgl',
      versionLabel: `${year} syllabus`,
      nodeName: 'Current affairs',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'FACT',
      questionLikelihood: 'HIGH',
      expectedScope: 'Landing date and the south-pole first.',
      sourceBasis: 'SSC CGL Tier-I: recent current affairs.',
    },
    {
      // §36 historical demo: mappings on the superseded window stay queryable.
      unitSlug: 'fundamental-rights-articles-12-35',
      examSlug: 'upsc-civil-services',
      versionLabel: `${year - 1} syllabus (superseded)`,
      nodeName: 'Indian Polity and Governance',
      relevance: 'DIRECT',
      priority: 'CORE',
      requiredDepth: 'CONCEPT',
      questionLikelihood: 'HIGH',
      expectedScope: 'Part III overview at Prelims depth as the old window required.',
      sourceBasis: 'Previous-cycle syllabus wording — kept as §36 history.',
      notes: 'Historical mapping preserved on the superseded window (§36 old mappings remain queryable).',
    },
  ]

  let mappingsSeeded = 0
  for (const seed of mappingSeeds) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug }, select: { id: true } })
    if (!unit) continue
    const exam = await prisma.exam.findUnique({
      where: { slug: seed.examSlug },
      include: { versions: true },
    })
    if (!exam) continue
    const version = exam.versions.find((row) => row.label === seed.versionLabel)
    if (!version) continue
    const node = await prisma.syllabusNode.findFirst({
      where: { examVersionId: version.id, name: seed.nodeName },
      select: { id: true },
    })
    if (!node) continue
    // Idempotent: never duplicate or overwrite a live-edited mapping (§36 spirit).
    const existing = await prisma.examMapping.findUnique({
      where: { knowledgeUnitId_syllabusNodeId: { knowledgeUnitId: unit.id, syllabusNodeId: node.id } },
      select: { id: true },
    })
    if (existing) continue

    await prisma.examMapping.create({
      data: {
        knowledgeUnitId: unit.id,
        examVersionId: version.id,
        syllabusNodeId: node.id,
        relevance: seed.relevance,
        priority: seed.priority,
        requiredDepth: seed.requiredDepth,
        questionLikelihood: seed.questionLikelihood,
        expectedScope: seed.expectedScope ?? null,
        sourceBasis: seed.sourceBasis ?? null,
        notes: seed.notes ?? null,
        effectiveFrom: seed.effectiveFrom ?? null,
        createdById: admin.id,
      },
    })
    mappingsSeeded += 1
  }

  // ---------- P6-S1: Current events + source aggregation (Master Plan §12/§45) ----------
  // Structurally rich event-centric records: all four §12 lifecycle states
  // (emerging → developing → stable → archived), GLOBAL + COUNTRY/IN scopes,
  // primary-topic anchoring on seeded taxonomy, §12 step 2 source aggregation
  // (the §45 "sample current event with multiple sources" — evidence REUSES
  // the shared P2-S3 registry by URL so the dedup philosophy is visible in
  // seed data), and §12 step 3 canonical KnowledgeUnit links (VERIFIED units
  // only, §7). Seed writes never overwrite live editorial edits (§36).

  // Extra evidence records the events aggregate (deduped by URL; the rest of
  // the aggregated evidence reuses the shared P2-S3 registry rows).
  const eventOnlySources = [
    {
      title: 'UN General Assembly — IGN statement on Security Council reform',
      publisher: 'United Nations',
      url: 'https://www.un.org/en/ga/ign/sc-reform-note-2025',
      type: 'OFFICIAL' as const,
      verification: 'UNVERIFIED' as const, // fresh record — awaiting the §24 verification pass
      publishedAt: new Date('2025-11-14T00:00:00Z'),
      notes: 'Registered during the emerging-event demo — the §12 step 1→2 flow (create the event, aggregate the first source).',
    },
    {
      title: 'PIB release — G20 New Delhi Leaders\u2019 Declaration adopted',
      publisher: 'Press Information Bureau',
      url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1961500',
      type: 'OFFICIAL' as const,
      verification: 'VERIFIED' as const,
      publishedAt: new Date('2023-09-09T00:00:00Z'),
      verifiedAt: new Date('2025-06-20T00:00:00Z'),
    },
    {
      title: 'G20 New Delhi summit closes with consensus on the leaders\u2019 declaration',
      publisher: 'The Hindu',
      url: 'https://www.thehindu.com/news/national/g20-new-delhi-leaders-declaration/',
      type: 'NEWS_MEDIA' as const,
      verification: 'VERIFIED' as const,
      publishedAt: new Date('2023-09-10T00:00:00Z'),
      verifiedAt: new Date('2025-06-20T00:00:00Z'),
    },
  ]
  for (const seed of eventOnlySources) {
    const created = await prisma.source.upsert({
      where: { url: seed.url },
      update: {},
      create: {
        title: seed.title,
        publisher: seed.publisher,
        url: seed.url,
        type: seed.type,
        verification: seed.verification,
        publishedAt: seed.publishedAt ?? null,
        retrievedAt: new Date(),
        verifiedAt: seed.verifiedAt ?? null,
        notes: seed.notes ?? null,
        createdById: admin.id,
      },
    })
    sourceIdByUrl.set(created.url, created.id)
  }

  // ---------- P6-S3: Entity registry — the canonical reference records (Master
  // Plan §6 Entity row, §12 step 3, §13, §14, §36, §45) ----------
  // Persons/places/organisations/concepts as canonical records (the
  // Topic/Source precedent): one row per real-world entity, aliases for §17
  // search matching, §14 GLOBAL/COUNTRY scope, §36 soft delete. Seed writes
  // never overwrite live editorial edits.

  interface EntitySeed {
    slug: string
    canonicalName: string
    type: 'PERSON' | 'PLACE' | 'ORGANISATION' | 'CONCEPT'
    status?: 'ACTIVE' | 'RETIRED'
    scope: 'GLOBAL' | 'COUNTRY'
    description?: string
    notes?: string
    aliases: Array<{ value: string; language?: string }>
  }

  const entitySeeds: EntitySeed[] = [
    {
      slug: 'isro',
      canonicalName: 'Indian Space Research Organisation',
      type: 'ORGANISATION',
      scope: 'GLOBAL',
      description: "India's national space agency (est. 1969), operator of the Chandrayaan lunar programme.",
      aliases: [{ value: 'ISRO' }, { value: 'Indian Space Research Organisation' }],
    },
    {
      slug: 'chandrayaan-3',
      canonicalName: 'Chandrayaan-3',
      type: 'CONCEPT',
      scope: 'GLOBAL',
      description: "ISRO's third lunar mission (2023) — the Vikram lander's south-polar soft landing.",
      aliases: [{ value: 'Chandrayaan 3' }, { value: 'चंद्रयान-3', language: 'hi' }],
    },
    {
      slug: 'united-nations-security-council',
      canonicalName: 'United Nations Security Council',
      type: 'ORGANISATION',
      scope: 'GLOBAL',
      description: "The UN's 15-member organ for international peace and security, with five permanent veto-holding members.",
      aliases: [{ value: 'UNSC' }, { value: 'Security Council' }],
    },
    {
      slug: 'g20',
      canonicalName: 'G20',
      type: 'ORGANISATION',
      scope: 'GLOBAL',
      description: "The Group of Twenty — the forum of the world's major economies, summited annually since 2008.",
      aliases: [{ value: 'Group of Twenty' }, { value: 'G-20' }],
    },
    {
      slug: 'new-delhi',
      canonicalName: 'New Delhi',
      type: 'PLACE',
      scope: 'COUNTRY',
      description: "India's capital and the seat of the Union Government.",
      aliases: [{ value: 'Delhi' }],
    },
    {
      slug: 'gaganyaan',
      canonicalName: 'Gaganyaan programme',
      type: 'CONCEPT',
      scope: 'GLOBAL',
      description: "ISRO's human spaceflight programme — the Gaganyaan missions aim to carry a crew of three to low Earth orbit and recover them safely.",
      aliases: [{ value: 'Gaganyaan' }, { value: 'गगनयान', language: 'hi' }],
    },
    {
      slug: 'planning-commission',
      canonicalName: 'Planning Commission of India',
      type: 'ORGANISATION',
      status: 'RETIRED',
      scope: 'COUNTRY',
      description: "India's central planning body (1950–2014), replaced by NITI Aayog — kept as historical reference (§36).",
      notes: 'Retired seed record — demonstrates §36 soft delete: no new links/follows, history preserved.',
      aliases: [{ value: 'Planning Commission' }],
    },
  ]

  const entityIdBySlug = new Map<string, string>()
  let entitiesSeeded = 0
  let entityAliasesSeeded = 0
  for (const seed of entitySeeds) {
    const languageIdByCode = new Map<string, string>()
    for (const alias of seed.aliases) {
      if (!alias.language) continue
      const language = await prisma.language.findUnique({ where: { code: alias.language }, select: { id: true } })
      if (language) languageIdByCode.set(alias.language, language.id)
    }
    const entity = await prisma.entity.upsert({
      where: { slug: seed.slug },
      update: {}, // never overwrite live editorial edits on re-seed (§36)
      create: {
        slug: seed.slug,
        canonicalName: seed.canonicalName,
        type: seed.type,
        status: seed.status ?? 'ACTIVE',
        scope: seed.scope,
        countryId: seed.scope === 'COUNTRY' ? india.id : null,
        description: seed.description ?? null,
        notes: seed.notes ?? null,
      },
    })
    entityIdBySlug.set(seed.slug, entity.id)
    entitiesSeeded += 1

    for (const alias of seed.aliases) {
      const existing = await prisma.entityAlias.findUnique({
        where: { entityId_value: { entityId: entity.id, value: alias.value } },
        select: { id: true },
      })
      if (existing) continue
      await prisma.entityAlias.create({
        data: {
          entityId: entity.id,
          value: alias.value,
          languageId: alias.language ? (languageIdByCode.get(alias.language) ?? null) : null,
        },
      })
      entityAliasesSeeded += 1
    }
  }
  console.log(`[seed] entity registry: ${entitiesSeeded} records, ${entityAliasesSeeded} aliases`)

  interface EventSeed {
    slug: string
    title: string
    eventDate: Date
    eventEndDate?: Date
    location?: string
    summary: string
    significance?: string
    lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
    scope: 'GLOBAL' | 'COUNTRY'
    topicSlug: string
    sources: Array<{ url: string; isPrimary?: boolean; note?: string }>
    unitLinks?: Array<{ slug: string; note: string }>
    /** P6-S3 §12 step 3 — who/what the event is about (Entity slugs). */
    entityLinks?: Array<{ slug: string; note: string }>
    /** P6-S3 §12 step 3 — additional-topic cross-filings (§13). */
    topicLinks?: Array<{ slug: string; note: string }>
    notes?: string
  }

  const currentEvents: EventSeed[] = [
    {
      slug: 'chandrayaan-3-vikram-landing',
      title: 'Chandrayaan-3 Vikram soft-landing near the lunar south pole',
      eventDate: new Date('2023-08-23T18:04:00Z'),
      location: 'Sriharikota, Andhra Pradesh / lunar south pole region',
      summary:
        'ISRO\u2019s Chandrayaan-3 mission soft-landed the Vikram lander near the lunar south pole, making India the fourth country to land on the Moon and the first in the southern polar region.',
      significance:
        'A first-in-world south-polar landing and the basis for National Space Day (23 August) — a recurring exam favourite across UPSC/SSC/state recruitment current affairs.',
      lifecycleState: 'STABLE',
      scope: 'GLOBAL',
      topicSlug: 'isro-programmes',
      sources: [
        {
          url: 'https://www.isro.gov.in/Chandrayaan3.html',
          isPrimary: true,
          note: 'Primary official record — mission facts, timeline and landing confirmation.',
        },
        { url: 'https://www.thehindu.com/science/chandrayaan-3-soft-lands-on-moon/', note: 'Independent same-day reporting confirming the landing sequence.' },
        {
          url: 'https://spaceinsider-daily.example.com/india-third-country-moon-landing',
          note: 'Trust-revoked coverage kept as preserved provenance history (§36) — the \u201Cthird country\u201D error this outlet published is part of the record, never cited as truth.',
        },
      ],
      unitLinks: [
        { slug: 'chandrayaan-3-landing-2023', note: 'The canonical knowledge this event established — the §7 one-truth link.' },
      ],
      entityLinks: [
        { slug: 'isro', note: 'The landing agency — mission operator and confirmation source.' },
        { slug: 'chandrayaan-3', note: 'The mission itself — the event IS this entity in action.' },
      ],
      topicLinks: [
        { slug: 'space-technology', note: 'The landing pushed India\'s space-technology frontier.' },
        { slug: 'science-technology', note: 'The broader S&T domain the story files under.' },
      ],
    },
    {
      slug: 'national-space-day-notification',
      title: 'National Space Day notification — 23 August observance',
      eventDate: new Date('2025-10-04T00:00:00Z'),
      location: 'New Delhi',
      summary:
        'The Government of India notified 23 August as National Space Day, commemorating the Chandrayaan-3 landing, with the first official observance cycle rolling out across institutions.',
      significance:
        'Commemorative-day questions are one-liner staples in SSC and state recruitment exams; the date anchors back to the Chandrayaan-3 knowledge unit.',
      lifecycleState: 'DEVELOPING',
      scope: 'COUNTRY',
      topicSlug: 'current-affairs',
      sources: [
        {
          url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1950000',
          isPrimary: true,
          note: 'The PIB notification — still UNVERIFIED, awaiting the §24 editorial verification pass.',
        },
      ],
      unitLinks: [
        { slug: 'chandrayaan-3-landing-2023', note: 'The day commemorates this landing — the underlying canonical knowledge.' },
      ],
      entityLinks: [
        { slug: 'isro', note: 'The agency whose 2023 landing the day commemorates.' },
      ],
      topicLinks: [
        { slug: 'space-technology', note: 'The domain the observance celebrates.' },
      ],
    },
    {
      slug: 'un-security-council-reform-ign-round',
      title: 'UN Security Council reform — new IGN negotiation round',
      eventDate: new Date('2025-11-14T00:00:00Z'),
      location: 'UN Headquarters, New York',
      summary:
        'A fresh round of Intergovernmental Negotiations (IGN) on Security Council reform opened at the UN General Assembly, with members tabling new positions on expansion and veto use.',
      significance:
        'UNSC composition and reform is a recurring international-affairs topic; this event is tracked while positions develop.',
      lifecycleState: 'EMERGING',
      scope: 'GLOBAL',
      topicSlug: 'united-nations',
      sources: [
        {
          url: 'https://www.un.org/en/ga/ign/sc-reform-note-2025',
          isPrimary: true,
          note: 'First aggregated source — the §12 emerging flow: the event exists so five publishers never become five objects.',
        },
      ],
      entityLinks: [
        { slug: 'united-nations-security-council', note: 'The body under reform negotiation.' },
      ],
      topicLinks: [
        { slug: 'international-organisations', note: 'The broader org-reform branch the story cross-files under.' },
      ],
    },
    {
      slug: 'g20-new-delhi-leaders-declaration',
      title: 'G20 New Delhi Leaders\u2019 Declaration adopted',
      eventDate: new Date('2023-09-09T00:00:00Z'),
      eventEndDate: new Date('2023-09-10T00:00:00Z'),
      location: 'New Delhi',
      summary:
        'G20 leaders meeting in New Delhi adopted the Leaders\u2019 Declaration by consensus on the summit\u2019s opening day, covering growth, green development and multilateral reform commitments.',
      significance:
        'The first G20 declaration adopted under India\u2019s presidency — archived now, but permanently relevant to international-affairs coverage.',
      lifecycleState: 'ARCHIVED',
      scope: 'COUNTRY',
      topicSlug: 'polity-governance',
      sources: [
        { url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1961500', isPrimary: true, note: 'Official adoption record.' },
        { url: 'https://www.thehindu.com/news/national/g20-new-delhi-leaders-declaration/', note: 'Consensus-day reporting.' },
      ],
      entityLinks: [
        { slug: 'g20', note: 'The forum whose declaration was adopted.' },
        { slug: 'new-delhi', note: 'The summit city — a COUNTRY-scoped entity linked from a COUNTRY/IN event (§14).' },
      ],
      topicLinks: [
        { slug: 'international-organisations', note: 'A multilateral-forum outcome cross-filed here.' },
      ],
    },
    {
      // P6-S5: the FRESH seed — a days-old event whose freshness tier stays
      // FRESH (≤ 3 days) and whose EMERGING state the rules never touch. It
      // keeps the exam feed meaningful after the sweep archives the older
      // seeds (§36 LIVE = emerging/developing/stable), and cross-files under
      // `current-affairs` so the ssc-cgl "Current affairs" syllabus node
      // anchors it (the same §12 step 5 chain as National Space Day).
      slug: 'gaganyaan-g1-uncrewed-test-flight',
      title: 'Gaganyaan G1 — first uncrewed test flight completes orbit and recovery',
      eventDate: new Date('2026-09-26T08:30:00Z'),
      location: 'Sriharikota, Andhra Pradesh / Bay of Bengal recovery zone',
      summary:
        'ISRO flew the first uncrewed Gaganyaan test flight (G1), validating the crew-module launch, orbit operations and sea-recovery sequence that the crewed mission depends on.',
      significance:
        'The human-spaceflight programme is a live exam favourite: G1 is the uncrewed dress rehearsal whose systems (escape, life support, recovery) anchor Gaganyaan questions.',
      lifecycleState: 'EMERGING',
      scope: 'GLOBAL',
      topicSlug: 'isro-programmes',
      sources: [
        {
          url: 'https://www.isro.gov.in/Gaganyaan_G1.html',
          isPrimary: true,
          note: 'Primary official record — flight objectives, sequence and recovery confirmation.',
        },
      ],
      entityLinks: [
        { slug: 'isro', note: 'The agency flying the programme.' },
        { slug: 'gaganyaan', note: 'The programme this flight belongs to — the §7 one-truth link.' },
      ],
      topicLinks: [
        { slug: 'space-technology', note: 'Human spaceflight is the frontier this pushes.' },
        { slug: 'current-affairs', note: 'Filed for current-affairs syllabus nodes (the §12 step 5 anchor).' },
      ],
    },
  ]

  let eventsSeeded = 0
  let eventSourcesSeeded = 0
  let eventUnitsSeeded = 0
  let eventEntitiesSeeded = 0
  let eventTopicsSeeded = 0
  for (const seed of currentEvents) {
    const topicId = topicIdBySlug.get(seed.topicSlug)
    if (!topicId) {
      console.warn(`[seed] skipping current event "${seed.slug}": topic "${seed.topicSlug}" not found`)
      continue
    }
    // Never overwrite live editorial edits (§36) — and never TOUCH an
    // existing row at all: a no-op upsert still bumps @updatedAt, which
    // would make "recently updated" a lie. Create-only, like every seed
    // surface (P6-S5 fix).
    const existingEvent = await prisma.currentEvent.findUnique({
      where: { slug: seed.slug },
      select: { id: true },
    })
    if (existingEvent) continue
    const event = await prisma.currentEvent.create({
      data: {
        slug: seed.slug,
        title: seed.title,
        eventDate: seed.eventDate,
        eventEndDate: seed.eventEndDate ?? null,
        location: seed.location ?? null,
        summary: seed.summary,
        significance: seed.significance ?? null,
        lifecycleState: seed.lifecycleState,
        scope: seed.scope,
        countryId: seed.scope === 'COUNTRY' ? india.id : null,
        topicId,
        notes: seed.notes ?? null,
        createdById: admin.id,
      },
    })
    eventsSeeded += 1

    // §12 step 2 aggregation — reuse the shared registry by URL (§11 dedup).
    for (const link of seed.sources) {
      const sourceId = sourceIdByUrl.get(link.url)
      if (!sourceId) {
        console.warn(`[seed] skipping source link on "${seed.slug}": url not seeded`)
        continue
      }
      const existing = await prisma.currentEventSource.findUnique({
        where: { currentEventId_sourceId: { currentEventId: event.id, sourceId } },
        select: { id: true },
      })
      if (existing) continue
      await prisma.currentEventSource.create({
        data: {
          currentEventId: event.id,
          sourceId,
          isPrimary: link.isPrimary ?? false,
          note: link.note ?? null,
        },
      })
      eventSourcesSeeded += 1
    }

    // §12 step 3 canonical knowledge links (VERIFIED units only, §7).
    for (const unitLink of seed.unitLinks ?? []) {
      const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: unitLink.slug }, select: { id: true, status: true } })
      if (!unit || unit.status !== 'VERIFIED') {
        console.warn(`[seed] skipping unit link on "${seed.slug}": unit "${unitLink.slug}" missing or not VERIFIED`)
        continue
      }
      const existing = await prisma.currentEventKnowledgeUnit.findUnique({
        where: { currentEventId_knowledgeUnitId: { currentEventId: event.id, knowledgeUnitId: unit.id } },
        select: { id: true },
      })
      if (existing) continue
      await prisma.currentEventKnowledgeUnit.create({
        data: {
          currentEventId: event.id,
          knowledgeUnitId: unit.id,
          note: unitLink.note,
        },
      })
      eventUnitsSeeded += 1
    }

    // P6-S3 §12 step 3 — entity links (who/what the event is about). ACTIVE
    // entities only (§36); the link is live editorial metadata — detach never
    // deletes the registry record.
    for (const entityLink of seed.entityLinks ?? []) {
      const entity = await prisma.entity.findUnique({
        where: { slug: entityLink.slug },
        select: { id: true, status: true },
      })
      if (!entity || entity.status !== 'ACTIVE') {
        console.warn(`[seed] skipping entity link on "${seed.slug}": entity "${entityLink.slug}" missing or not ACTIVE`)
        continue
      }
      const existing = await prisma.currentEventEntity.findUnique({
        where: { currentEventId_entityId: { currentEventId: event.id, entityId: entity.id } },
        select: { id: true },
      })
      if (existing) continue
      await prisma.currentEventEntity.create({
        data: { currentEventId: event.id, entityId: entity.id, note: entityLink.note },
      })
      eventEntitiesSeeded += 1
    }

    // P6-S3 §12 step 3 — additional-topic cross-filings (§13 containment:
    // COUNTRY topics only file same-market COUNTRY events).
    for (const topicLink of seed.topicLinks ?? []) {
      const topic = await prisma.topic.findUnique({
        where: { slug: topicLink.slug },
        select: { id: true, status: true },
      })
      if (!topic || topic.status !== 'ACTIVE') {
        console.warn(`[seed] skipping topic link on "${seed.slug}": topic "${topicLink.slug}" missing or not ACTIVE`)
        continue
      }
      const existing = await prisma.currentEventTopic.findUnique({
        where: { currentEventId_topicId: { currentEventId: event.id, topicId: topic.id } },
        select: { id: true },
      })
      if (existing) continue
      await prisma.currentEventTopic.create({
        data: { currentEventId: event.id, topicId: topic.id, note: topicLink.note },
      })
      eventTopicsSeeded += 1
    }
  }
  console.log(
    `[seed] current events: ${eventsSeeded} events, ${eventSourcesSeeded} source links, ${eventUnitsSeeded} unit links, ${eventEntitiesSeeded} entity links, ${eventTopicsSeeded} cross-filings`
  )

  // ---------- P6-S2: Event representations — publishing & revisions (Master
  // Plan §12 step 4, §19, §36, §45) ----------
  // Language-specific explanations for the seeded events, riding the SAME
  // ContentItem machinery: the §19 workflow states, immutable published
  // revisions (corrections carry change summaries — never silent edits), §24
  // item-level provenance, and §35 one-rendering-per-language×format. Seed
  // writes never overwrite live editorial edits (§36).

  interface EventItemSeed {
    eventSlug: string
    languageCode: string
    format: 'CURRENT_EVENT_UPDATE' | 'EXPLAINER' | 'TIMELINE' | 'REVISION_NOTE' | 'FACT_CARD' | 'PROFILE' | 'COMPARISON'
    status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
    title?: string
    body?: string
    scheduledForAt?: Date
    revisions: Array<{
      title: string
      body: string
      changeSummary?: string
      publishedAt?: Date
    }>
    // §24 item-level evidence: reuse the shared registry by URL.
    sourceUrl?: string
  }

  const eventItems: EventItemSeed[] = [
    {
      // The flagship public event page (GLOBAL/STABLE): an English update
      // with a correction cycle — rev 1 published, then a §36 republish with
      // the change summary (the never-silent-edit proof), plus a Hindi
      // rendering (§35 multilingual surface).
      eventSlug: 'chandrayaan-3-vikram-landing',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      status: 'PUBLISHED',
      sourceUrl: 'https://www.isro.gov.in/Chandrayaan3.html',
      revisions: [
        {
          title: 'Chandrayaan-3: Vikram soft-lands near the lunar south pole',
          body: 'ISRO\u2019s Chandrayaan-3 mission achieved a historic soft-landing when the Vikram lander touched down near the lunar south pole at 18:04 IST on 23 August 2023. India became the fourth country to soft-land on the Moon and the first to land in the southern polar region.\n\nThe landing site was later named Shiv Shakti Point. The Pragyan rover deployed and conducted in-situ measurements over one lunar day, while the propulsion module orbited the Moon. The mission validated ISRO\u2019s autonomous landing sequence after the Chandrayaan-2 hard-landing in 2019.\n\nFor exam purposes, anchor the date (23 August), the landing site name (Shiv Shakti Point), the rover (Pragyan) and the \u201Cfourth country, first at the south pole\u201D framing — the last is the favourite one-liner.',
          publishedAt: new Date('2023-08-23T20:00:00Z'),
        },
        {
          title: 'Chandrayaan-3 landing — corrected: fourth country overall, first near the south pole',
          body: 'ISRO\u2019s Chandrayaan-3 mission achieved a historic soft-landing when the Vikram lander touched down near the lunar south pole at 18:04 IST on 23 August 2023. India became the fourth country to soft-land on the Moon (after the USSR, the USA and China) and the first to land in the southern polar region.\n\nThe landing site was later named Shiv Shakti Point, and 23 August is observed as National Space Day. The Pragyan rover deployed and conducted in-situ measurements over one lunar day, while the propulsion module orbited the Moon.\n\nCorrection note: an early version of this update omitted the list of prior soft-landing countries. The expanded paragraph above fixes that; the exam framing stays \u201Cfourth country, first at the south pole\u201D.',
          changeSummary: 'Added the prior soft-landing nations and the National Space Day line (§36 correction — never a silent edit)',
          publishedAt: new Date('2023-08-24T09:30:00Z'),
        },
      ],
    },
    {
      eventSlug: 'chandrayaan-3-vikram-landing',
      languageCode: 'hi',
      format: 'CURRENT_EVENT_UPDATE',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'चंद्रयान-3: विक्रम लैंडर चंद्रमा के दक्षिणी ध्रुव के पास उतरा',
          body: '23 अगस्त 2023 को शाम लगभग 6:04 बजे इसरो के चंद्रयान-3 मिशन ने विक्रम लैंडर को चंद्रमा के दक्षिणी ध्रुव क्षेत्र के पास सुरक्षित रूप से उतारा। इस सफलता के साथ भारत चंद्रमा पर सॉफ्ट-लैंडिंग करने वाला चौथा देश और दक्षिणी ध्रुव क्षेत्र में उतरने वाला पहला देश बन गया।\n\nलैंडिंग स्थल को बाद में शिव शक्ति बिंदु नाम दिया गया। प्रज्ञान रोवर ने एक चंद्रमा-दिवस के दौरान इन-सीटू माप किए।\n\nपरीक्षा की दृष्टि से याद रखें: 23 अगस्त, शिव शक्ति बिंदु, प्रज्ञान रोवर, और \'चौथा देश, दक्षिणी ध्रुव पर पहला\' की तस्वीर।',
          publishedAt: new Date('2023-08-24T06:00:00Z'),
        },
      ],
    },
    {
      // A COUNTRY/IN market event with a published update — visible on the
      // IN homepage discovery list and its §16 event page.
      eventSlug: 'national-space-day-notification',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      status: 'PUBLISHED',
      sourceUrl: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1950000',
      revisions: [
        {
          title: 'National Space Day notified — 23 August commemorates the Chandrayaan-3 landing',
          body: 'The Government of India notified 23 August as National Space Day, commemorating the Chandrayaan-3 Vikram soft-landing near the lunar south pole. The first official observance cycle rolled out across institutions with outreach programmes, exhibitions and student engagements.\n\nThe day anchors directly to the Chandrayaan-3 knowledge unit: commemorative-date questions are one-liner staples in SSC and state recruitment exams, so fix the pair \u201423 August \u2194 National Space Day \u2194 Chandrayaan-3 landing (2023).',
          publishedAt: new Date('2025-10-05T10:00:00Z'),
        },
      ],
    },
    {
      // The §19 workflow demo on an event representation: a Hindi update in
      // DRAFT — visible in the workspace, NOT on the public page (§35: the
      // event is public via its English update; the Hindi one publishes later).
      eventSlug: 'national-space-day-notification',
      languageCode: 'hi',
      format: 'CURRENT_EVENT_UPDATE',
      status: 'DRAFT',
      title: 'राष्ट्रीय स्पेस डिवस — अधिसूचना की दृष्टि में',
      body: 'भारत सरकार ने 23 अगस्त को राष्ट्रीय स्पेस डिवस घोषित किया, जो चंद्रयान-3 की सॉफ्ट-लैंडिंग की याद में है। पहला आधिकारिक निर्देशन चक्र संस्थानों में आउटरीच कार्यक्रमों के साथ शुरू हुआ। यह ड्राफ्ट प्रकाशित होने से पहले संपादकीय समीक्षा से गुजरता है (§19)।',
      revisions: [],
    },
    {
      // The ARCHIVED event keeps a published page — §36 stable identity:
      // archiving ends updates, never the historical reference.
      eventSlug: 'g20-new-delhi-leaders-declaration',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      status: 'PUBLISHED',
      sourceUrl: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1961500',
      revisions: [
        {
          title: 'G20 New Delhi Leaders\u2019 Declaration adopted by consensus',
          body: 'G20 leaders meeting in New Delhi adopted the Leaders\u2019 Declaration by consensus on the summit\u2019s opening day, 9 September 2023, covering inclusive growth, green development and multilateral reform commitments under India\u2019s presidency.\n\nIt was the first G20 declaration adopted under India\u2019s presidency and the consensus came after intense negotiation over the Ukraine language. The event is now archived (§36) — updates have ended, but the reference stays permanently relevant for international-affairs coverage.',
          publishedAt: new Date('2023-09-09T18:30:00Z'),
        },
      ],
    },
    {
      // The P6-S5 FRESH event's published update — the §35 public gate that
      // puts the days-old Gaganyaan flight into the exam feed.
      eventSlug: 'gaganyaan-g1-uncrewed-test-flight',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      status: 'PUBLISHED',
      sourceUrl: 'https://www.isro.gov.in/Gaganyaan_G1.html',
      revisions: [
        {
          title: 'Gaganyaan G1: first uncrewed test flight validates the human-spaceflight path',
          body: 'ISRO flew the first uncrewed test flight of the Gaganyaan programme — G1 — launching the crew module on 26 September 2026 and recovering it from the Bay of Bengal after the planned orbit sequence.\n\nThe flight exercised the systems a crewed mission depends on: the crew escape system in abort mode, environmental control and life support in the module, orbital manoeuvring, and the sea-recovery drill with Indian Navy support.\n\nFor exam purposes, fix the chain: Gaganyaan = India\u2019s human spaceflight programme; G1 = its first UNCREWED rehearsal; the crewed mission follows only after the remaining uncrewed and abort-test milestones.',
          publishedAt: new Date('2026-09-26T14:00:00Z'),
        },
      ],
    },
    // Deliberately NO representation for un-security-council-reform-ign-round:
    // the EMERGING no-publication state — the event exists for editors (§12
    // step 1+2), its public page 404s until the first update publishes (§19/§35).
  ]

  let eventItemsSeeded = 0
  for (const seed of eventItems) {
    const event = await prisma.currentEvent.findUnique({ where: { slug: seed.eventSlug }, select: { id: true } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!event || !languageId) {
      console.warn(`[seed] skipping event content for "${seed.eventSlug}/${seed.languageCode}": event or language missing`)
      continue
    }

    // Never overwrite live edits (§36) — only create when absent (the
    // event-anchor uniqueness is (event, language, format); Postgres NULLs
    // are distinct, so the check is explicit).
    const existing = await prisma.contentItem.findFirst({
      where: { currentEventId: event.id, languageId, format: seed.format },
      select: { id: true },
    })
    if (existing) continue

    const lastRevision = seed.revisions[seed.revisions.length - 1]
    const item = await prisma.contentItem.create({
      data: {
        currentEventId: event.id,
        languageId,
        format: seed.format,
        status: seed.status,
        ...(seed.scheduledForAt ? { scheduledForAt: seed.scheduledForAt } : {}),
        title: lastRevision?.title ?? seed.title ?? 'Untitled draft',
        body: lastRevision?.body ?? seed.body ?? 'Draft event update — publish through the content workspace.',
        createdById: admin.id,
      },
    })

    let lastRevisionId: string | null = null
    for (const [index, revision] of seed.revisions.entries()) {
      const created = await prisma.contentRevision.create({
        data: {
          contentItemId: item.id,
          revisionNumber: index + 1,
          title: revision.title,
          body: revision.body,
          changeSummary: revision.changeSummary ?? null,
          publishedById: admin.id,
          publishedAt: revision.publishedAt ?? new Date(),
        },
      })
      lastRevisionId = created.id
    }
    if (seed.status === 'PUBLISHED' && lastRevisionId) {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { publishedRevisionId: lastRevisionId },
      })
    }

    // §24 item-level provenance: the representation cites the same shared
    // registry evidence the event aggregated (one record per URL).
    if (seed.sourceUrl) {
      const sourceId = sourceIdByUrl.get(seed.sourceUrl)
      if (sourceId) {
        const existingLink = await prisma.contentSourceLink.findUnique({
          where: { contentItemId_sourceId: { contentItemId: item.id, sourceId } },
          select: { id: true },
        })
        if (!existingLink) {
          await prisma.contentSourceLink.create({
            data: { contentItemId: item.id, sourceId, claim: null },
          })
        }
      }
    }
    eventItemsSeeded += 1
  }

  // ---------- P7-S1: QnA — explanatory question-and-answer learning entries (Master Plan §6/§7/§22/§23/§45) ----------
  // §45: "Sample QnA … tied to the same Knowledge Unit" — several questions
  // per unit (the §22 knowledge-page Q&A layer lists MANY entries), EN + HI
  // (§35), one §36 two-revision correction (changeSummary provenance), one
  // DRAFT (lifecycle demo — publish through the QnA workspace) and one
  // RETIRED (the §10/§36 tombstone demo). Identity is (unit, language,
  // question) — the §11 canonical-identity rule; findFirst-then-create is
  // idempotent and never overwrites live edits (§36).
  interface QnaRevisionSeed {
    answerBody: string
    changeSummary?: string
    publishedAt?: Date
  }

  interface QnaSeed {
    unitSlug: string
    languageCode: string
    status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
    questionText: string
    /** Working-copy fallback for entries without revisions (DRAFT). */
    answerBody?: string
    /** §24/§26 AI-provenance — one seeded entry is AI-assisted (the §26 QnA-candidate demo). */
    aiAssisted?: boolean
    revisions: QnaRevisionSeed[] // empty for never-published entries
  }

  const qnaSeeds: QnaSeed[] = [
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      status: 'PUBLISHED',
      questionText: 'What are the six Fundamental Rights guaranteed by Articles 12–35 of the Indian Constitution?',
      revisions: [
        {
          answerBody:
            'Part III of the Constitution (Articles 12–35) guarantees six Fundamental Rights: (1) Right to Equality (Articles 14–18), (2) Right to Freedom (Articles 19–22), (3) Right against Exploitation (Articles 23–24), (4) Right to Freedom of Religion (Articles 25–28), (5) Cultural and Educational Rights (Articles 29–30), and (6) Right to Constitutional Remedies (Article 32). They are justiciable — enforceable against the State (Article 12) through the writ jurisdiction of the Supreme Court and the High Courts, and any law inconsistent with them is void under Article 13.',
          publishedAt: new Date('2025-06-11T09:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      status: 'PUBLISHED',
      questionText: 'Which article did Dr B R Ambedkar call the “heart and soul” of the Constitution, and why?',
      revisions: [
        {
          answerBody:
            'Article 32 — the Right to Constitutional Remedies. Ambedkar called it the heart and soul because a right without a remedy is meaningless: Article 32 lets a citizen move the Supreme Court directly for the enforcement of Fundamental Rights through five writs — habeas corpus, mandamus, prohibition, certiorari and quo warranto. The right to move the Court cannot be suspended except as provided by the Constitution (Article 359, during an Emergency).',
          publishedAt: new Date('2025-06-11T09:10:00Z'),
        },
      ],
    },
    {
      // §36 correction demo: the first published answer under-counted the
      // writs; the correction publishes revision 2 with a changeSummary —
      // never a silent edit, previous versions preserved forever.
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      status: 'PUBLISHED',
      questionText: 'How many writs can the Supreme Court issue under Article 32, and what are they?',
      revisions: [
        {
          answerBody:
            'The Supreme Court issues four writs under Article 32: habeas corpus, mandamus, prohibition and certiorari.',
          publishedAt: new Date('2025-06-11T09:20:00Z'),
        },
        {
          answerBody:
            'The Supreme Court issues five writs under Article 32: habeas corpus (“you may have the body” — against unlawful detention), mandamus (“we command” — orders a public authority to perform its duty), prohibition (stops a lower court exceeding jurisdiction), certiorari (quashes an order passed without jurisdiction) and quo warranto (questions the legality of a person holding public office).',
          changeSummary: 'Corrected the writ count: five writs, not four — quo warranto was missing from the first answer (§25/§36).',
          publishedAt: new Date('2025-06-12T09:00:00Z'),
        },
      ],
    },
    {
      // §35 translation demo — the same unit carries a Hindi Q&A entry.
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'hi',
      status: 'PUBLISHED',
      questionText: 'अनुच्छेद 32 को संविधान का “हृदय और आत्मा” क्यों कहा गया?',
      revisions: [
        {
          answerBody:
            'डॉ. बी. आर. अंबेडकर ने अनुच्छेद 32 (संवैधानिक उपचारों का अधिकार) को संविधान का हृदय और आत्मा कहा, क्योंकि उपचार के बिना अधिकार अर्थहीन हैं। इसके अंतर्गत नागरिक मौलिक अधिकारों के प्रवर्तन के लिए सीधे सर्वोच्च न्यायालय का दरवाजा खटखटा सकता है और पाँच रिट — बंदी प्रत्यक्षीकरण, परमादेश, निषेध, प्रतिकूल आदेश तथा अधिकार पृच्छा — जारी करवा सकता है।',
          publishedAt: new Date('2025-07-02T10:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      status: 'PUBLISHED',
      questionText: 'Why does India seek a permanent seat on the UN Security Council?',
      revisions: [
        {
          answerBody:
            'India argues it is a natural candidate for permanent UNSC membership: the world\'s most populous democracy, a top-five global economy, a founding UN member and a major troop contributor to UN peacekeeping, plus a responsible nuclear power. Its bid is part of the G4 initiative (Brazil, Germany, India, Japan), each mutually supporting the others\' candidacies, and is backed by key statements at the Intergovernmental Negotiations (IGN) process. The counter-positions — the Uniting for Consensus group preferring longer-term non-permanent seats, and the P5\'s veto over Charter amendment (Article 108) — are the recurring exam angles.',
          publishedAt: new Date('2025-06-16T08:00:00Z'),
        },
      ],
    },
    {
      // §10/§36 tombstone demo: published once, then withdrawn — existing
      // saves keep it listed as an honest RETIRED row; new saves reject.
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      status: 'RETIRED',
      questionText: 'How many non-permanent members does the UN Security Council have?',
      revisions: [
        {
          answerBody:
            'The UNSC has ten non-permanent members, elected for two-year terms by the General Assembly without immediate re-election, distributed regionally: three from Africa, two from Asia-Pacific, two from Latin America and the Caribbean, two from Western Europe and Others, and one from Eastern Europe. This entry was retired to demonstrate the §36 withdrawal path — the preserved revision stays queryable forever.',
          publishedAt: new Date('2025-06-16T08:10:00Z'),
        },
      ],
    },
    {
      // §24/§26 AI-provenance demo: an AI-drafted Q&A candidate that went
      // through the §19 review gate — the flag freezes onto the revision.
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      status: 'PUBLISHED',
      aiAssisted: true,
      questionText: 'Which country became the fourth to soft-land on the Moon, and when did it happen?',
      revisions: [
        {
          answerBody:
            'India became the fourth country to soft-land on the Moon, after the Soviet Union, the United States and China. The Vikram lander of Chandrayaan-3 touched down near the lunar south pole on 23 August 2023 (IST), at a site later named Shiv Shakti Point. India was also the FIRST country ever to land in the Moon\'s south-polar region — the distinction exams love. The date is now commemorated annually as National Space Day.',
          publishedAt: new Date('2025-06-20T12:00:00Z'),
        },
      ],
    },
    {
      // Lifecycle demo — a drafted question awaiting review, publishable
      // through the QnA workspace (submit → review → publish).
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      status: 'DRAFT',
      questionText: 'What is Shiv Shakti Point, and why is the name significant?',
      answerBody:
        'Shiv Shakti Point is the International Astronomical Union\'s name for the Chandrayaan-3 Vikram lander\'s touchdown site near the lunar south pole. Draft answer awaiting editorial review — the “Shiv” derives from the mission\'s rover name (Pragyan\'s lander Vikram honours Vikram Sarabhai), and “Shakti” signals the strength of the landing. Publish through the QnA workspace to complete this entry.',
      revisions: [],
    },
    {
      unitSlug: 'ashoka-kalinga-war-261-bce',
      languageCode: 'en',
      status: 'PUBLISHED',
      questionText: 'What does the 13th Rock Edict of Ashoka record about the Kalinga War?',
      revisions: [
        {
          answerBody:
            'The 13th Major Rock Edict records Ashoka\'s remorse after the Kalinga War (261 BCE, his eighth–ninth regnal year): 100,000 killed, 150,000 deported and many more perished in the aftermath. The grief of the slaughter moved him to abandon military conquest (bheri-ghosha, the drum of war) in favour of Dhamma conquest (dhamma-ghosha) — the pivotal turn toward Buddhism and his policy of Dhamma Vijaya. Kalinga corresponds to present-day coastal Odisha.',
          publishedAt: new Date('2025-06-18T09:00:00Z'),
        },
      ],
    },
  ]

  let qnasSeeded = 0
  for (const seed of qnaSeeds) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!unit || !languageId) {
      console.warn(`[seed] skipping QnA for "${seed.unitSlug}/${seed.languageCode}": unit or language missing`)
      continue
    }

    // Never overwrite live edits (§36) — identity is (unit, language, question).
    const existing = await prisma.qnA.findFirst({
      where: { knowledgeUnitId: unit.id, languageId, questionText: seed.questionText },
      select: { id: true },
    })
    if (existing) continue

    const lastRevision = seed.revisions[seed.revisions.length - 1]
    const qna = await prisma.qnA.create({
      data: {
        knowledgeUnitId: unit.id,
        languageId,
        status: seed.status,
        questionText: seed.questionText,
        answerBody: lastRevision?.answerBody ?? seed.answerBody ?? 'Draft answer — publish through the QnA workspace.',
        aiAssisted: seed.aiAssisted ?? false,
        createdById: admin.id,
      },
    })

    let lastRevisionId: string | null = null
    for (const [index, revision] of seed.revisions.entries()) {
      const created = await prisma.qnARevision.create({
        data: {
          qnaId: qna.id,
          revisionNumber: index + 1,
          questionText: seed.questionText,
          answerBody: revision.answerBody,
          changeSummary: revision.changeSummary ?? null,
          aiAssisted: seed.aiAssisted ?? false,
          publishedById: admin.id,
          publishedAt: revision.publishedAt ?? new Date(),
        },
      })
      lastRevisionId = created.id
    }
    if ((seed.status === 'PUBLISHED' || seed.status === 'RETIRED') && lastRevisionId) {
      await prisma.qnA.update({
        where: { id: qna.id },
        data: { publishedRevisionId: lastRevisionId },
      })
    }
    qnasSeeded += 1
  }

  // ---------- P7-S2: Question — the scored MCQ practice layer (Master Plan §6 Question row, §7, §22, §23, §45) ----------
  // §45: "Sample QnA and Question objects tied to the same Knowledge Unit" —
  // questions on the SAME units as the QnA seeds (the §22 page shows learn →
  // practice in one flow), EN + HI (§35), difficulty spread (BASIC →
  // ADVANCED), the §6 optional ExamVersion anchor (UPSC CSE + SSC CGL; the
  // Kalinga question is deliberately unanchored — the §8 routing is
  // ExamMapping's job), one §36 two-revision correction, one DRAFT
  // (lifecycle demo — publish through the Questions workspace) and one
  // RETIRED (the §10/§36 tombstone demo). Identity is (unit, language,
  // question) — the §11 discipline; findFirst-then-create is idempotent and
  // never overwrites live edits (§36).
  interface QuestionRevisionSeed {
    options: string[]
    correctIndex: number
    explanation: string
    changeSummary?: string
    publishedAt?: Date
  }

  interface QuestionSeed {
    unitSlug: string
    languageCode: string
    status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
    difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
    questionText: string
    /** §6 optional exam anchor (exam slug + version label — authoring context, never identity). */
    examSlug?: string
    examVersionLabel?: string
    /** §24/§26 AI-provenance — one seeded entry is AI-assisted (the §26 candidate demo). */
    aiAssisted?: boolean
    revisions: QuestionRevisionSeed[] // empty for never-published entries
  }

  const questionSeeds: QuestionSeed[] = [
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      status: 'PUBLISHED',
      difficulty: 'INTERMEDIATE',
      examSlug: 'upsc-civil-services',
      examVersionLabel: `${year} syllabus`,
      questionText: 'Which Article of the Indian Constitution did Dr B R Ambedkar call its “heart and soul”?',
      revisions: [
        {
          options: ['Article 14 — Right to Equality', 'Article 19 — Right to Freedom', 'Article 32 — Right to Constitutional Remedies', 'Article 356 — President’s Rule'],
          correctIndex: 2,
          explanation:
            'Article 32 — the Right to Constitutional Remedies. Ambedkar called it the heart and soul of the Constitution because a right without a remedy is meaningless: Article 32 lets a citizen move the Supreme Court directly for the enforcement of Fundamental Rights through five writs — habeas corpus, mandamus, prohibition, certiorari and quo warranto. The right to move the Court cannot be suspended except as provided by the Constitution (Article 359, during an Emergency).',
          publishedAt: new Date('2025-06-11T10:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      status: 'PUBLISHED',
      difficulty: 'BASIC',
      examSlug: 'ssc-cgl',
      examVersionLabel: `${year} syllabus`,
      questionText: 'How many Fundamental Rights does Part III (Articles 12–35) of the Constitution guarantee?',
      revisions: [
        {
          options: ['Five', 'Six', 'Seven', 'Ten'],
          correctIndex: 1,
          explanation:
            'Six: (1) Right to Equality (Articles 14–18), (2) Right to Freedom (Articles 19–22), (3) Right against Exploitation (Articles 23–24), (4) Right to Freedom of Religion (Articles 25–28), (5) Cultural and Educational Rights (Articles 29–30), and (6) Right to Constitutional Remedies (Article 32). They are justiciable — enforceable against the State through the writ jurisdiction of the Supreme Court and the High Courts.',
          publishedAt: new Date('2025-06-11T10:10:00Z'),
        },
      ],
    },
    {
      // §36 correction demo: the first published explanation implied only the
      // Supreme Court issues habeas corpus; the correction publishes revision 2
      // with a changeSummary — never a silent edit, previous versions
      // preserved forever.
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      status: 'PUBLISHED',
      difficulty: 'INTERMEDIATE',
      questionText: 'Which writ is issued to release a person from unlawful detention?',
      revisions: [
        {
          options: ['Mandamus', 'Habeas corpus', 'Certiorari', 'Quo warranto'],
          correctIndex: 1,
          explanation:
            'Habeas corpus (“you may have the body”) — the Supreme Court issues it under Article 32 to release a person from unlawful detention.',
          publishedAt: new Date('2025-06-11T10:20:00Z'),
        },
        {
          options: ['Mandamus', 'Habeas corpus', 'Certiorari', 'Quo warranto'],
          correctIndex: 1,
          explanation:
            'Habeas corpus (“you may have the body”) — the court orders the detaining authority to produce the detainee and releases them if the detention is unlawful. BOTH the Supreme Court (Article 32) and the High Courts (Article 226) can issue it — the High Courts’ writ power is even wider, extending beyond Fundamental Rights to other legal rights.',
          changeSummary: 'Corrected the explanation: High Courts also issue habeas corpus (Article 226) — the first explanation implied only the Supreme Court (§25/§36).',
          publishedAt: new Date('2025-06-12T10:00:00Z'),
        },
      ],
    },
    {
      // §35 translation demo — the same unit carries a Hindi practice question.
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'hi',
      status: 'PUBLISHED',
      difficulty: 'BASIC',
      questionText: 'मौलिक अधिकारों के प्रवर्तन के लिए सीधे सर्वोच्च न्यायालय जा सकता है — यह अधिकार किस अनुच्छेद में है?',
      revisions: [
        {
          options: ['अनुच्छेद 32', 'अनुच्छेद 226', 'अनुच्छेद 356', 'अनुच्छेद 360'],
          correctIndex: 0,
          explanation:
            'अनुच्छेद 32 — संवैधानिक उपचारों का अधिकार — किसी भी नागरिक को मौलिक अधिकारों के प्रवर्तन के लिए सीधे सर्वोच्च न्यायालय का दरवाजा खटखटाने का अधिकार देता है। डॉ. अंबेडकर ने इसे संविधान का “हृदय और आत्मा” कहा, क्योंकि उपचार के बिना अधिकार अर्थहीन है।',
          publishedAt: new Date('2025-07-02T10:30:00Z'),
        },
      ],
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      status: 'PUBLISHED',
      difficulty: 'ADVANCED',
      examSlug: 'upsc-civil-services',
      examVersionLabel: `${year} syllabus`,
      questionText: 'Which of the following is NOT a permanent member of the UN Security Council?',
      revisions: [
        {
          options: ['France', 'Germany', 'Russia', 'the United Kingdom'],
          correctIndex: 1,
          explanation:
            'Germany. The five permanent members (P5) are China, France, Russia, the United Kingdom and the United States — the victors of the Second World War written into the UN Charter. Germany is a G4 aspirant (with Brazil, India and Japan), seeking permanent membership through the IGN reform process. The exam trap: Germany is a frequent UN contributor and a G4 member, but it has never held a permanent seat.',
          publishedAt: new Date('2025-06-16T09:00:00Z'),
        },
      ],
    },
    {
      // §10/§36 tombstone demo: published once, then withdrawn — existing
      // saves keep it listed as an honest RETIRED row; new saves reject.
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      status: 'RETIRED',
      difficulty: 'BASIC',
      questionText: 'How many members does the UN Security Council have in total?',
      revisions: [
        {
          options: ['10', '15', '20', '25'],
          correctIndex: 1,
          explanation:
            'Fifteen: the five permanent members (P5) with veto power, plus ten non-permanent members elected for two-year terms by the General Assembly without immediate re-election, distributed regionally. This question was retired to demonstrate the §36 withdrawal path — the preserved revision stays queryable forever.',
          publishedAt: new Date('2025-06-16T09:10:00Z'),
        },
      ],
    },
    {
      // §24/§26 AI-provenance demo: an AI-drafted question candidate that
      // went through the §19 review gate — the flag freezes onto the revision.
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      status: 'PUBLISHED',
      difficulty: 'BASIC',
      aiAssisted: true,
      questionText: 'In which year did India become the fourth country to soft-land on the Moon?',
      revisions: [
        {
          options: ['2019', '2023', '2014', '2008'],
          correctIndex: 1,
          explanation:
            '2023 — the Vikram lander of Chandrayaan-3 touched down near the lunar south pole on 23 August 2023 (IST), making India the fourth country to soft-land on the Moon after the Soviet Union, the United States and China, and the FIRST ever in the south-polar region. The date is now commemorated annually as National Space Day. (Chandrayaan-2 in 2019 attempted but failed the landing; 2014 was the Mars Orbiter Mission; 2008 was Chandrayaan-1, an orbiter with an intentional impact probe.)',
          publishedAt: new Date('2025-06-20T12:30:00Z'),
        },
      ],
    },
    {
      // Lifecycle demo — a drafted question awaiting review, publishable
      // through the Questions workspace (submit → review → publish).
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      status: 'DRAFT',
      difficulty: 'INTERMEDIATE',
      questionText: 'What is the official name of the Chandrayaan-3 Vikram lander’s touchdown site?',
      revisions: [],
    },
    {
      // The §6 optional-anchor demo: NO exam anchor — the question serves
      // every exam whose syllabus maps this unit (§8 routing is ExamMapping's
      // job, never a copy).
      unitSlug: 'ashoka-kalinga-war-261-bce',
      languageCode: 'en',
      status: 'PUBLISHED',
      difficulty: 'BASIC',
      questionText: 'The Kalinga War, which transformed Ashoka towards Dhamma, was fought in which year?',
      revisions: [
        {
          options: ['261 BCE', '232 BCE', '323 BCE', '185 BCE'],
          correctIndex: 0,
          explanation:
            '261 BCE, in Ashoka’s eighth–ninth regnal year. The 13th Major Rock Edict records his remorse — 100,000 killed, 150,000 deported — and the turn from military conquest (bheri-ghosha) to Dhamma conquest (dhamma-ghosha). Kalinga corresponds to present-day coastal Odisha. (232 BCE is Ashoka’s death year; 323 BCE Alexander’s death; 185 BCE the fall of the Mauryan dynasty.)',
          publishedAt: new Date('2025-06-18T09:30:00Z'),
        },
      ],
    },
  ]

  let questionsSeeded = 0
  for (const seed of questionSeeds) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!unit || !languageId) {
      console.warn(`[seed] skipping Question for "${seed.unitSlug}/${seed.languageCode}": unit or language missing`)
      continue
    }

    // Never overwrite live edits (§36) — identity is (unit, language, question).
    const existing = await prisma.question.findFirst({
      where: { knowledgeUnitId: unit.id, languageId, questionText: seed.questionText },
      select: { id: true },
    })
    if (existing) continue

    // The §6 optional exam anchor — resolved like the syllabus seeds (exam
    // slug → version label). A missing anchor never drops the question; it
    // seeds without one (the anchor is context, not identity).
    let examVersionId: string | null = null
    if (seed.examSlug && seed.examVersionLabel) {
      const exam = await prisma.exam.findUnique({
        where: { slug: seed.examSlug },
        include: { versions: { select: { id: true, label: true } } },
      })
      const version = exam?.versions.find((row) => row.label === seed.examVersionLabel)
      if (version) {
        examVersionId = version.id
      } else {
        console.warn(`[seed] Question exam anchor "${seed.examSlug}/${seed.examVersionLabel}" not found — seeding without anchor`)
      }
    }

    const lastRevision = seed.revisions[seed.revisions.length - 1]
    const question = await prisma.question.create({
      data: {
        knowledgeUnitId: unit.id,
        examVersionId,
        languageId,
        status: seed.status,
        type: 'MCQ',
        difficulty: seed.difficulty,
        questionText: seed.questionText,
        optionsJson: JSON.stringify(
          (lastRevision?.options ?? []).map((text, index) => ({
            key: ['A', 'B', 'C', 'D', 'E', 'F'][index] ?? String(index),
            text,
          }))
        ),
        correctAnswer: lastRevision ? String.fromCharCode(65 + lastRevision.correctIndex) : 'A',
        explanation: lastRevision?.explanation ?? 'Draft explanation — publish through the Questions workspace.',
        aiAssisted: seed.aiAssisted ?? false,
        createdById: admin.id,
      },
    })

    let lastRevisionId: string | null = null
    for (const [index, revision] of seed.revisions.entries()) {
      const created = await prisma.questionRevision.create({
        data: {
          questionId: question.id,
          revisionNumber: index + 1,
          questionText: seed.questionText,
          optionsJson: JSON.stringify(
            revision.options.map((text, optionIndex) => ({
              key: ['A', 'B', 'C', 'D', 'E', 'F'][optionIndex] ?? String(optionIndex),
              text,
            }))
          ),
          correctAnswer: String.fromCharCode(65 + revision.correctIndex),
          explanation: revision.explanation,
          difficulty: seed.difficulty,
          changeSummary: revision.changeSummary ?? null,
          aiAssisted: seed.aiAssisted ?? false,
          publishedById: admin.id,
          publishedAt: revision.publishedAt ?? new Date(),
        },
      })
      lastRevisionId = created.id
    }
    if ((seed.status === 'PUBLISHED' || seed.status === 'RETIRED') && lastRevisionId) {
      await prisma.question.update({
        where: { id: question.id },
        data: { publishedRevisionId: lastRevisionId },
      })
    }
    questionsSeeded += 1
  }

  // ---------- P4-S1: build the search index over the seeded public surface ----------
  // §17 indexing pipeline: project every public object (VERIFIED units with
  // published representations, ACTIVE topics, ACTIVE exams) into the
  // vendor-neutral SearchDocument store. The printed stats prove the
  // pipeline ran; re-running the seed is idempotent (upserts).
  const reindex = await reindexAll()
  const searchStats = await getIndexStats()

  console.log(
    `Seed complete → languages: ${[en.code, hi.code, fr.code].join(', ')} | countries: ${[
      `${india.isoCode} (default)`,
      `${uk.isoCode} (coming soon)`,
      `${france.isoCode} (coming soon)`,
    ].join(', ')} | dev admin: ${admin.email} (ADMIN) | dev IN admin: ${inAdmin.email} (COUNTRY_ADMIN) | dev writers: ${writerIn.email} + ${writerHi.email} (Hindi-scoped) | taxonomy: ${topicIdBySlug.size} nodes | knowledge units: ${knowledgeSeeded} | content items: ${contentSeeded} | sources: ${sourceIdByUrl.size} (${linksSeeded} links${aiDraftSeeded ? ', +1 AI-assisted draft update' : ''}) | editorial tasks: ${tasksSeeded} | exams: ${examsSeeded} (${examVersionsSeeded} versions${syllabusNodesSeeded > 0 ? `, ${syllabusNodesSeeded} syllabus nodes` : ''}${mappingsSeeded > 0 ? `, ${mappingsSeeded} exam mappings` : ''}) | current events: ${eventsSeeded} (${eventSourcesSeeded} aggregated sources, ${eventUnitsSeeded} unit links, ${eventEntitiesSeeded} entity links, ${eventTopicsSeeded} cross-filings) | entity registry: ${entitiesSeeded} records (${entityAliasesSeeded} aliases, P6-S3) | event representations: ${eventItemsSeeded} (P6-S2 §12 step 4) | Q&A entries: ${qnasSeeded} (P7-S1 §22/§45) | practice questions: ${questionsSeeded} (P7-S2 §22/§45) | search index: ${searchStats.documents} documents (${reindex.unitsIndexed} units, ${reindex.topicsIndexed} topics, ${reindex.examsIndexed} exams, ${reindex.eventsIndexed} events; engine ${searchStats.engine}, configs ${searchStats.ftsConfigs.map((config) => `${config.languageCode}→${config.config}`).join('/')})`
  )
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
