# INDIA-CORPUS-S1 — The India exam corpus (every GK/Current-Affairs exam)

**Date:** 1 October 2026 · **Repo:** dkzila/gksetu · **Spec:** GKSetu_Master_Plan.md v2.0
**User request (this session's continuation):** पिछली chat में 100+ exams और उनका syllabus जोड़ने के लिए बोला था, वो पूरा करो। हालांकि मुझे सिर्फ 100+ नहीं बल्कि India के ऐसे सभी Exams चाहिए जिनमें GK और Current Affairs आता है — जितना कर सको करो।

## What shipped

**132 NEW exams published + 1 DRAFT activated → 136 ACTIVE exams in India** (was 3), every one
carrying a real General Knowledge / Current Affairs syllabus — 964 new SyllabusNodes across 14
exam families, 909 new ExamMappings on the 7 verified canonical units, 136 exam documents in the
search index, 588 syllabus-topic URLs in the sitemap.

### The corpus (scripts/india-exams-data.ts — 132 blueprints, validated: 0 dupes, all topic links exist)

| Family | Exams |
|---|---|
| UPSC (6) | NDA, CDS, CAPF-AC, EPFO-EO, IFS, IES |
| SSC (7) | CHSL, MTS, CPO, GD Constable, Stenographer, JE, Selection Post |
| Banking (10) | IBPS PO/Clerk/RRB-PO/RRB-Clerk, SBI PO/Clerk, RBI Grade-B/Assistant, NABARD-A, SIDBI-A |
| Railways (7) | RRB NTPC, Group-D, ALP, JE, Paramedical, RPF Constable, RPF SI |
| Defence (7) | AFCAT, Navy Agniveer SSR/MR, Coast Guard Navik/AC, Army Agniveer GD, Territorial Army |
| State police (25) | UP/Bihar/MP/Rajasthan/Haryana/Delhi(×2)/Maharashtra/WB(×2)/Punjab/UK/Jharkhand/CG/Kerala/TN-USRB/AP/Telangana/Karnataka/Gujarat/Odisha/Assam |
| State PSC (28) | UPPSC PCS+RO/ARO, BPSC CCE+TRE, MPPSC, RPSC RAS, TNPSC Gr-1/2/4, KPSC KAS, Kerala KAS+LDC, APPSC 1/2, TGPSC 1/2, WBPSC WBCS+Clerkship, MPSC RS+Grp-B, OPSC, JPSC, CGPSC, UKPSC, HPSC, HPPSC, JKPSC, GPSC, APSC |
| Subordinate (11) | UPSSSC PET/VDO/JA/Lekhpal, MP-ESB Gr2-SG4, RSMSSB Patwari/VDO, HSSC CET, JSSC CGL, BSSC CGL, UKSSSC Grp-C |
| Teaching (10) | Super-TET, KVS, DSSSB, REET, RSSB Senior Teacher, Bihar STET, BPSC TRE, HTET, MPTET, AWES |
| Law (5) | CLAT, AILET, SLAT, MH-CET Law, DU LLB |
| Insurance (5) | LIC AAO/ADO, NIACL AO, UIIC AO, OICL AO |
| Regulators/PSU (5) | SEBI-A, IRDAI-AM, FCI AG-III, CIL MT, IB ACIO |
| Management (6) | CUET-UG, XAT, IIFT, CMAT, MAT, SNAP |

**+ ESE activated:** the existing DRAFT `upsc-engineering-services` (its Paper I is General Studies &
Engineering Aptitude — the corpus rule) got its missing current version + tree and flipped ACTIVE.

**Inclusion rule (user's):** only exams whose official syllabus contains a GK / Current Affairs
component. Syllabus trees use each family's official section names (SSC "General Awareness",
banking's "General Awareness with special reference to Banking", state-PSC "General Studies"…),
state-specific GK children where the pattern has them, and canonical-topic links wherever the
taxonomy has a matching topic (§13's only exam→knowledge bridge).

### The publisher (scripts/publish-india-exams.ts — idempotent, re-runnable)

Exam (ACTIVE/IN/admin-authored) → current ExamVersion (`{year} syllabus`, official source string) →
recursive SyllabusNode tree → per-topic MAPPING_RULES §8 rows on the 7 VERIFIED units with honest
depth/priority/likelihood per family (e.g. Fundamental Rights DETAILED for PSC mains, FACT for
police constable) → full search reindex. Re-runs skip existing slugs; mappings use skipDuplicates.
Standalone `scripts/reindex-search.ts` for the (idempotent) reindex alone. **Not** part of
prisma/seed.ts — same one-time-migration class as rebrand-to-gksetu.ts, documented here.

### The public exam directory (…/exams/ — the new §16 surface)

The homepage caps at 8 cards; 136 exams needed a directory. New `exam-directory` view:
`/exams/` (and `/{country}/exams/`) — grouped National (62) / State (74), client-side search over
name/code/organiser, level filter chips with live counts, homepage-style cards, honest empty
states (FR: "exams arrive at launch"), SEO head (noindex — no server canonical yet). Router:
`parseRoute` bare `/exams/` branch + `buildPath` `exam-directory` segment; homepage gains
"**All 136 exams →**" (the real DB total — `stats.exams` now counts the market's ACTIVE exams, not
the capped card list); every exam picker (console exam-page/syllabus/mapping/combined sections,
mock-tests, questions, onboarding) raised `pageSize=50→300`; the public list API cap
`50→300` (sized for the corpus).

### The performance work the corpus forced (all §29-pattern, production-correct)

1. **Sitemap N+1 killed:** one batched SyllabusNode query for all 136 current versions (was a
   per-exam findMany — 45s uncached → ~4s). Same-truth output, deterministic order kept.
2. **Payload cache (src/lib/payload-cache.ts):** 60s in-memory TTL on the public, user-independent
   payloads — homepage, exam directory, exam pages (the census-cache precedent, explicitly scoped:
   never auth-dependent, never staff surfaces, errors never cached). Cached hits: 7-34ms.
3. **Context resolver de-duplicated:** `resolveReaderContext`'s live `country.findUnique` (paid 3×
   per exam page) replaced by the snapshot-served `findConfiguredCountryStatusByIso` — config
   data, same §29 truth.
4. **db-url.ts refined — MODE FOLLOWS THE RUNTIME SHAPE:** serverless (VERCEL) keeps the DEPLOY-S2
   transaction-pooler rewrite; a long-running dev server keeps the SESSION pooler as .env.example
   documents it, with `connection_limit=3` (one capped process can never hit the 15-client
   session ceiling). Measured from this sandbox: ~220ms session vs ~657ms transaction per query —
   the homepage walk halved (13.5s→7.4s), exam pages 10.5s→5.6s cold, 20ms warm.
5. **Dev daemon prewarm (scripts/dev-daemon.sh):** every 45s the daemon re-fetches the hot public
   surfaces (< the 60s TTLs) so the sandbox preview stays snappy; failures ignored mid-recompile.
   Plus **scripts/dev-spawn.py** — this sandbox kills every process still attached to a tool
   call's tree between calls (a plain `setsid nohup &` dies); the classic double-fork reparents
   the daemon to init and it survives. That is how the dev server stays up here now.

## Verification (all live, this session)

- **Publisher:** dry-run clean → live run: 132 created + ESE activated; final DB state
  **137 exams total / 136 ACTIVE in India, 138 versions, 1007 syllabus nodes, 920 mappings**;
  reindex completed (136 exam docs + 7 mapped units refreshed with new examRefs; 181 docs total).
- **APIs:** directory 136 (62 NATIONAL / 74 STATE) in one request; homepage stats.exams 136;
  `/api/exams/upsc-nda/page` 200; BPSC-TRE coverage tree with 7 mappings on 6 units;
  `/api/exams/bpsc-tre/syllabus/current-affairs` 200 with §16 canonical; search "lekhpal" →
  UPSSSC Lekhpal EXAM doc; sitemap segments exams=136 / syllabus=588 `<loc>`s; FR honest 0.
- **Browser E2E (agent-browser, zero console/page errors):** homepage → "All 136 exams" →
  `/exams/` directory grouped National/State → search "UPSC" (8 UPSC exams + count line) →
  UPSC NDA exam page (description, "What to study" with mapped units — Kalinga War under History,
  UNSC under Current Events —, syllabus coverage tree, current affairs, other exams) → deep-link
  `/gk/mauryan-empire/ashoka-kalinga-war-261-bce/` → FR `/fr/exams/` honest launch state →
  390px mobile (scrollWidth==clientWidth, no hash) and 1440px desktop. Screenshots:
  docs/screenshots/india-corpus-{homepage,directory,directory-mobile,unit-link}.png.
- **tsc + eslint clean.** Dev server on Supabase session pooler (health 200), daemonized via
  dev-spawn.py, prewarm loop live.

## Honest state / decisions

- The corpus is publisher-owned, not seed-owned (re-runs are no-ops; new exams would extend
  `india-exams-data.ts` and re-run — documented in the publisher header).
- Exam syllabus trees are the GK/CA-bearing sections (maths/language/technical sections are out
  of scope by the user's rule; state-GK children exist on the trees where the family pattern has
  them — the coverage VIEW prunes mapping-less branches by design, so they show on the tree, not
  the coverage list).
- Sitemap/payload caches are 60s TTL: a staff publish reflects on public surfaces within 60s
  (the census precedent; staff surfaces themselves are never cached).
- Vercel behaviour is unchanged where it matters: transaction pooler + per-function caps on
  serverless (DEPLOY-S2), session pooler + capped pool in dev (measured 3× faster per query).
- The syllabus-topic page's "units" listing behaves for new exams exactly as for the seeded ones
  (0 published content items through that listing today — consistent, not a corpus regression).
