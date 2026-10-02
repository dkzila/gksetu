/**
 * CONSOLE-S1 seed — the console's launch state:
 *
 *  1. The three essential site pages (About / Contact / Privacy Policy),
 *     PUBLISHED with real content and footer-linked — the user's "About,
 *     Contact, Privacy Policy जैसे ज़रूरी pages को manage करने के लिए" ask,
 *     ready to edit from Console → Pages.
 *  2. Default (empty) SiteSetting rows for the integration keys, so the
 *     Settings page shows the structured fields from the first visit.
 *
 * Idempotent — safe to re-run (upsert-by-slug / upsert-by-key semantics).
 * Run: bun scripts/console-s1-seed.ts
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

// ---------- Page bodies (staff-editable HTML — the WordPress model) ----------

const ABOUT_BODY = `
<p><strong>GKSetu</strong> (जीके-सेतु — "the GK bridge") is one unified, multilingual knowledge
system for general-knowledge learners and competitive-exam aspirants. We replace the stack of
GK books, monthly magazines and GK-only coaching with a single, always-current platform:</p>
<ul>
  <li><strong>Canonical knowledge units</strong> — every fact explained once, sourced, and versioned.</li>
  <li><strong>Current affairs with exam context</strong> — every event linked to the exams and syllabus topics it matters for.</li>
  <li><strong>Complete exam syllabi</strong> — official, structured and mapped to what to study.</li>
  <li><strong>Practice that adapts</strong> — Q&amp;A, scored questions, full mock tests and a mastery-based revision queue.</li>
  <li><strong>In your language</strong> — a localisation pipeline that brings the same quality to every supported language.</li>
</ul>
<p>We started with India — 137 exams published, from UPSC and SSC to every state PSC, police and
teaching service whose syllabus carries GK and current affairs — and we are building for the world,
one market at a time.</p>
<h2>Why "Setu"?</h2>
<p>Because a bridge is exactly what GK preparation needs: between <em>news</em> and <em>knowledge</em>,
between <em>syllabus</em> and <em>understanding</em>, between <em>studying</em> and <em>clearing the exam</em>.</p>
`

const CONTACT_BODY = `
<p>We read everything — questions, corrections, partnership ideas and feedback on anything we
published.</p>
<h2>Support &amp; feedback</h2>
<p>The fastest route is the in-app <strong>Send feedback</strong> action (the footer's Support
section) — reports land directly in our editorial quality loop and are tracked to resolution.</p>
<h2>Email</h2>
<p>General: <a href="mailto:hello@gksetu.in">hello@gksetu.in</a><br/>
Content corrections: <a href="mailto:corrections@gksetu.in">corrections@gksetu.in</a><br/>
Privacy: <a href="mailto:privacy@gksetu.in">privacy@gksetu.in</a></p>
<h2>Corrections policy</h2>
<p>Every knowledge unit and current-affairs item carries its sources. If you find an error,
report it — verified corrections are published with the item's update history visible.</p>
`

const PRIVACY_BODY = `
<p><em>Last updated: October 2026</em></p>
<p>This policy explains what GKSetu collects, why, and the control you have. The short version:
your study data belongs to you, we collect the minimum needed to run the product, and we never
sell personal data.</p>
<h2>What we collect</h2>
<ul>
  <li><strong>Account data</strong> — email, display name and password (stored only as a
  cryptographic hash) when you create an account.</li>
  <li><strong>Your library</strong> — the topics and exams you follow, saved items, collections,
  goals and study state (mastery, attempts). These power your personalisation and are yours to
  export or reset at any time from Settings.</li>
  <li><strong>Anonymous analytics</strong> — aggregate page views, share events and search
  queries (with personal identifiers removed) so we can measure and improve the product.</li>
  <li><strong>Local choices</strong> — your market (country) choice is stored locally in your
  browser so the right edition loads next time.</li>
</ul>
<h2>What we never do</h2>
<ul>
  <li>We never sell or rent personal data.</li>
  <li>We never share your study activity with third parties for advertising profiling.</li>
  <li>We never require an account to simply read.</li>
</ul>
<h2>Cookies &amp; measurement</h2>
<p>We use a small set of first-party cookies/local storage for sign-in sessions and preferences,
plus measurement tags (such as Google Analytics) configured by our team to understand aggregate
usage. You can block these in your browser without losing access to content.</p>
<h2>Your controls</h2>
<ul>
  <li>Personalisation is explainable and resettable — Settings → Personalisation shows every
  signal we use and a one-tap reset.</li>
  <li>Sessions are listable and revocable — sign out everywhere from Account.</li>
  <li>You may request deletion of your account and library data at
  <a href="mailto:privacy@gksetu.in">privacy@gksetu.in</a>.</li>
</ul>
<h2>Contact</h2>
<p>Privacy questions: <a href="mailto:privacy@gksetu.in">privacy@gksetu.in</a></p>
`

interface PageSeed {
  slug: string
  title: string
  body: string
  seoDescription: string
  sortOrder: number
}

const PAGES: PageSeed[] = [
  {
    slug: 'about',
    title: 'About GKSetu',
    body: ABOUT_BODY,
    seoDescription: 'GKSetu — one unified, multilingual knowledge system for GK, current affairs and exam preparation.',
    sortOrder: 1,
  },
  {
    slug: 'contact',
    title: 'Contact',
    body: CONTACT_BODY,
    seoDescription: 'Reach the GKSetu team — support, corrections and privacy contacts.',
    sortOrder: 2,
  },
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    body: PRIVACY_BODY,
    seoDescription: 'What GKSetu collects, why, and the control you have over your data.',
    sortOrder: 3,
  },
]

const SETTING_KEYS = [
  'integration.ga.measurementId',
  'integration.gtm.containerId',
  'integration.gsc.verificationToken',
  'integration.bing.verificationToken',
  'integration.facebook.pixelId',
  'integration.headCode',
  'integration.bodyStartCode',
  'ads.txt',
  'robots.extraDirectives',
  'secrets.searchEngine.apiKey',
  'secrets.analytics.apiSecret',
]

async function main() {
  console.log('── CONSOLE-S1 seed ──')

  // 1. Pages — upsert by slug (published, footer-linked).
  for (const page of PAGES) {
    await prisma.sitePage.upsert({
      where: { slug: page.slug },
      create: {
        slug: page.slug,
        title: page.title,
        body: page.body,
        status: 'PUBLISHED',
        publishedTitle: page.title,
        publishedBody: page.body,
        publishedAt: new Date(),
        showInFooter: true,
        sortOrder: page.sortOrder,
        seoTitle: page.title,
        seoDescription: page.seoDescription,
      },
      update: {
        // Re-runs refresh the published snapshot (seed-owned pages).
        title: page.title,
        body: page.body,
        status: 'PUBLISHED',
        publishedTitle: page.title,
        publishedBody: page.body,
        publishedAt: new Date(),
        showInFooter: true,
        sortOrder: page.sortOrder,
        seoTitle: page.title,
        seoDescription: page.seoDescription,
      },
    })
    console.log(`  page ✓ ${page.slug} (published)`)
  }

  // 2. Settings defaults — empty values, active (the injector skips empties).
  for (const key of SETTING_KEYS) {
    const existing = await prisma.siteSetting.findFirst({ where: { countryId: null, key } })
    if (!existing) {
      await prisma.siteSetting.create({ data: { countryId: null, key, value: '' } })
      console.log(`  setting ✓ ${key} (default empty)`)
    } else {
      console.log(`  setting • ${key} (kept: ${existing.value === '' ? 'empty' : 'value present'})`)
    }
  }

  const [pages, settings] = await Promise.all([prisma.sitePage.count(), prisma.siteSetting.count()])
  console.log(`── done: ${pages} pages, ${settings} settings ──`)
}

main()
  .catch((error) => {
    console.error('seed failed:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
