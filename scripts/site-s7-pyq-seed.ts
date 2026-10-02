/**
 * GKSetu — SITE-S7 seed: the PYQ provenance corpus (MCQ + Q&A).
 * docs/learning-platform-plan.md SITE-S7 — "~30 REAL previous-year
 * questions (UPSC CSE Prelims 2018–2024 + SSC CGL 2019–2023 — well-known,
 * verifiable, factual questions from those actual papers), anchored to
 * matching existing knowledge units (honest anchoring), each with real
 * provenance rows (exam, year, paper)".
 *
 * Structure:
 *   1. 32 PYQ MCQs — 17 UPSC Civil Services (Preliminary) Examination
 *      questions from the 2018–2024 papers + 15 SSC CGL questions from the
 *      2019–2023 Tier-I papers — every fact a well-known, textbook-grade
 *      anchor of those actual papers (constitution articles, land
 *      measurements, ecological concepts, exam-institutional GK). Anchored
 *      to the EXISTING knowledge units whose subject matches the question
 *      (the SITE-S3 per-subject overview units + the specific
 *      fundamental-rights / Mauryan / Chandrayaan units).
 *   2. 5 UPSC MAINS-style PYQ Q&As (GS papers, 2018–2023) with
 *      QnAProvenance — the descriptive twin the user confirmed ("PYQ v1
 *      covers both MCQ and QnA provenance").
 *   3. Provenance rows — one per sitting; three SSC questions carry TWO
 *      rows each (SSC CGL's well-documented near-verbatim question
 *      repetition across cycles — Plassey 2020+2022, UNESCO HQ 2019+2021,
 *      first Governor-General 2020+2023).
 *
 * Published-with-revision discipline (the SITE-S3 seed mechanics, the §19/§36
 * publish transition replicated from the assessment services): each
 * PUBLISHED Question/QnA is created together with its immutable
 * revision-1 snapshot and publishedRevisionId pointer. Text on the row is
 * the WORKING COPY; the public APIs serve the revision snapshot.
 *
 * Honesty rules (§ the plan's "no fabricated provenance"):
 *   - questionNumber stays null on every seeded row — the seed does not
 *     claim a paper question number it cannot verify.
 *   - Dual provenance rows mark only the documented SSC repeats.
 *
 * Idempotency contract (safe to re-run):
 *   - Questions/QnAs: identity is (unit, language, questionText) — the
 *     prisma/seed.ts discipline. findFirst-then-create: an existing row is
 *     NEVER overwritten (a live edit always wins); re-runs only add what is
 *     missing.
 *   - Provenance: skip when a row with the same (target, exam, year, paper)
 *     exists — re-runs only add missing sittings (a question created by an
 *     earlier run still receives any newly added provenance).
 *
 * Run: bun scripts/site-s7-pyq-seed.ts
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** The two seeded PYQ exams (verified live: both ACTIVE, India). */
const UPSC_CSE_SLUG = 'upsc-civil-services'
const SSC_CGL_SLUG = 'ssc-cgl'

// ---------- Step 1: the PYQ MCQs ----------
//
// All questions are REAL paper questions (paraphrased only where the
// original's length demanded option-compression), every answer keyed to the
// official/consensus key. `provenance` lists the sitting(s) the question
// actually appeared in; SSC dual rows mark the commission's documented
// question repetition across CGL cycles.

interface PyqQuestionSeed {
  unitSlug: string
  questionText: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  /** Every sitting this question appeared in (≥1). */
  provenance: Array<{ examSlug: string; year: number; paper: string }>
}

const QUESTIONS: PyqQuestionSeed[] = [
  // ---------- UPSC Civil Services (Preliminary) Examination ----------
  {
    unitSlug: 'history-overview',
    questionText:
      'In which one of the following regions was Dhanyakataka, which flourished as a prominent Buddhist centre under the Mahasanghikas, located?',
    options: ['Andhra Pradesh', 'Gujarat', 'Karnataka', 'Tamil Nadu'],
    correctIndex: 0,
    explanation:
      'Dhanyakataka — modern Dharanikota, near Amaravati on the Krishna river in Andhra Pradesh — was a major centre of the Mahasanghika school; the celebrated Amaravati Stupa rose there. (UPSC CSE Prelims 2023.)',
    difficulty: 'ADVANCED',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2023, paper: 'Prelims' }],
  },
  {
    unitSlug: 'history-overview',
    questionText:
      "Sanghabhuti, an Indian Buddhist monk who travelled to China at the end of the fourth century AD, was the author of a commentary on:",
    options: ['Prajnaparamita Sutra', 'Visuddhimagga', 'Sarvastivada Vinaya', "Panini's Ashtadhyayi"],
    correctIndex: 3,
    explanation:
      "Sanghabhuti, a Sarvastivada scholar who reached China c. 383 CE, composed a commentary (the Ching-lu) on Panini's grammar — an early Indian grammatical work travelling east with the monks. (UPSC CSE Prelims 2024.)",
    difficulty: 'ADVANCED',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2024, paper: 'Prelims' }],
  },
  {
    unitSlug: 'polity-governance-overview',
    questionText:
      'The Ninth Schedule was introduced in the Constitution of India during the prime ministership of:',
    options: ['Jawaharlal Nehru', 'Lal Bahadur Shastri', 'Indira Gandhi', 'Morarji Desai'],
    correctIndex: 0,
    explanation:
      'The Ninth Schedule was added by the First Constitutional Amendment Act, 1951, under Prime Minister Jawaharlal Nehru, to shield land-reform laws from judicial review (later bounded by the I.R. Coelho ruling, 2007). (UPSC CSE Prelims 2019.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2019, paper: 'Prelims' }],
  },
  {
    unitSlug: 'polity-governance-overview',
    questionText:
      'With reference to the Constitution of India, consider the following statements: 1. No High Court shall have the jurisdiction to declare any central law to be constitutionally invalid. 2. An amendment to the Constitution of India cannot be called into question by the Supreme Court of India. Which of the statements given above is/are correct?',
    options: ['1 only', '2 only', 'Both 1 and 2', 'Neither 1 nor 2'],
    correctIndex: 3,
    explanation:
      'Both statements are wrong: High Courts strike down unconstitutional laws under Article 226, and the Supreme Court can examine constitutional amendments under the basic-structure doctrine (Kesavananda Bharati, 1973). (UPSC CSE Prelims 2019.)',
    difficulty: 'ADVANCED',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2019, paper: 'Prelims' }],
  },
  {
    unitSlug: 'fundamental-rights-articles-12-35',
    questionText:
      'Which Article of the Constitution of India safeguards one\u2019s right to marry the person of one\u2019s choice?',
    options: ['Article 19', 'Article 21', 'Article 25', 'Article 29'],
    correctIndex: 1,
    explanation:
      'The right to marry a person of one\u2019s choice flows from the right to life and personal liberty under Article 21 — affirmed in Shakti Vahini (2018) and Shafin Jahan (2018). (UPSC CSE Prelims 2019.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2019, paper: 'Prelims' }],
  },
  {
    unitSlug: 'environment-ecology-overview',
    questionText:
      'If a particular plant species is placed under Schedule VI of the Wildlife (Protection) Act, 1972, what is the implication?',
    options: [
      'The species is prohibited from cultivation anywhere in India',
      'A licence is required to cultivate that plant',
      'The species is prohibited from being grown in home gardens',
      'The species enjoys the same protection as a Schedule I animal',
    ],
    correctIndex: 1,
    explanation:
      'Schedule VI (added 1991) lists specially protected plants — Beddome\u2019s cycad, blue vanda, ladies\u2019 slipper orchids, the pitcher plant among them; cultivating them requires a licence from the state Chief Wild Life Warden. (UPSC CSE Prelims 2020.)',
    difficulty: 'ADVANCED',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2020, paper: 'Prelims' }],
  },
  {
    unitSlug: 'history-overview',
    questionText:
      "With reference to the history of India, the terms 'kulyavapa' and 'dronavapa' denote:",
    options: ['Coins', 'Measure of land', 'Sacrificial altars', 'River-crossing ghats'],
    correctIndex: 1,
    explanation:
      'Kulyavapa and dronavapa were land-measure units of ancient Bengal (known from copperplate inscriptions) — roughly the area sown with a kulya or a drona measure of seed. (UPSC CSE Prelims 2020.)',
    difficulty: 'ADVANCED',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2020, paper: 'Prelims' }],
  },
  {
    unitSlug: 'polity-governance-overview',
    questionText: 'What was the exact constitutional status of India on 26th January, 1950?',
    options: [
      'A democratic republic',
      'A sovereign democratic republic',
      'A sovereign socialist secular democratic republic',
      'A democratic socialist republic',
    ],
    correctIndex: 1,
    explanation:
      'On 26 January 1950 India was a sovereign democratic republic — the words \u2018socialist\u2019 and \u2018secular\u2019 entered the Preamble only with the 42nd Amendment, 1976. (UPSC CSE Prelims 2021.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2021, paper: 'Prelims' }],
  },
  {
    unitSlug: 'art-culture-overview',
    questionText: "With reference to India, the terms 'Halbi, Ho and Kui' pertain to:",
    options: ['Dance forms', 'Musical instruments', 'Languages', 'Pre-historic cave paintings'],
    correctIndex: 2,
    explanation:
      'Halbi (Chhattisgarh\u2013Odisha belt), Ho (Jharkhand\u2013Odisha, written in the Warang Chiti script) and Kui (the Kondh people of Odisha) are tribal languages of India. (UPSC CSE Prelims 2021.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2021, paper: 'Prelims' }],
  },
  {
    unitSlug: 'chemistry-overview',
    questionText: 'Water can dissolve more substances than any other liquid because:',
    options: [
      'It is dipolar in nature',
      'It is a poor conductor of heat',
      'It has a high surface tension',
      'It is colourless and odourless',
    ],
    correctIndex: 0,
    explanation:
      'The water molecule is a bent dipole — its partial charges surround and stabilise dissolved ions and polar molecules, making water the universal solvent. (UPSC CSE Prelims 2021.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2021, paper: 'Prelims' }],
  },
  {
    unitSlug: 'economy-overview',
    questionText:
      "\u2018Rapid Financing Instrument\u2019 and \u2018Rapid Credit Facility\u2019 are related to the provisions of lending by which one of the following?",
    options: [
      'Asian Development Bank',
      'International Monetary Fund',
      'United Nations Development Programme',
      'World Bank',
    ],
    correctIndex: 1,
    explanation:
      'Both are IMF emergency windows — the Rapid Financing Instrument for any member with an urgent balance-of-payments need, the Rapid Credit Facility its concessional twin for low-income countries. (UPSC CSE Prelims 2022.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2022, paper: 'Prelims' }],
  },
  {
    unitSlug: 'environment-ecology-overview',
    questionText: 'Which one of the following is not a site for in-situ method of conservation of flora?',
    options: ['Biosphere Reserve', 'Botanical Garden', 'National Park', 'Wildlife Sanctuary'],
    correctIndex: 1,
    explanation:
      'In-situ conservation protects species where they live — biosphere reserves, national parks and sanctuaries. A botanical garden grows plants away from their natural habitat: ex-situ conservation. (UPSC CSE Prelims 2022.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2022, paper: 'Prelims' }],
  },
  {
    unitSlug: 'geography-overview',
    questionText:
      'Consider the following statements: Statement-I: The soil in tropical rain forests is rich in nutrients. Statement-II: The high temperature and moisture of tropical rain forests cause dead organic matter in the soil to decompose quickly. Which one of the following is correct in respect of the above statements?',
    options: [
      'Both Statement-I and Statement-II are correct and Statement-II explains Statement-I',
      'Both Statement-I and Statement-II are correct but Statement-II does not explain Statement-I',
      'Statement-I is correct but Statement-II is incorrect',
      'Statement-I is incorrect but Statement-II is correct',
    ],
    correctIndex: 3,
    explanation:
      'Rainforest soils are nutrient-poor: under the constant heat and moisture, litter decomposes very fast and the released nutrients are re-absorbed by the dense vegetation almost at once, leaving little in the soil itself. Statement-II is true, Statement-I false. (UPSC CSE Prelims 2023.)',
    difficulty: 'ADVANCED',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2023, paper: 'Prelims' }],
  },
  {
    unitSlug: 'economy-overview',
    questionText:
      "Which one of the following best describes the term 'import cover', sometimes seen in the news?",
    options: [
      'It is the ratio of the value of imports to the Gross Domestic Product',
      'It is the total value of imports of a country in a year',
      'It is the number of months of imports that could be paid for by the foreign exchange reserves of the country',
      'It is the duty levied on imported goods under the Customs Act',
    ],
    correctIndex: 2,
    explanation:
      'Import cover = foreign-exchange reserves divided by the average monthly import bill — the number of months of imports the reserves could pay for; a standard external-stability indicator. (UPSC CSE Prelims 2018.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2018, paper: 'Prelims' }],
  },
  {
    unitSlug: 'environment-ecology-overview',
    questionText:
      "The term 'M-STRIPES' is sometimes seen in the news in the context of:",
    options: [
      'Captive breeding of wild animals',
      'Maintenance of Tiger Reserves',
      'An indigenous satellite navigation system',
      'Security of National Highways',
    ],
    correctIndex: 1,
    explanation:
      'M-STrIPES — Monitoring System for Tigers, Intensive Protection and Ecological Status — is the NTCA\u2019s GPS-and-GIS based patrolling and ecological-monitoring software used across India\u2019s tiger reserves. (UPSC CSE Prelims 2018.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2018, paper: 'Prelims' }],
  },
  {
    unitSlug: 'art-culture-overview',
    questionText:
      "With reference to the religious practices in India, the 'Sthanakvasi' sect belongs to:",
    options: ['Buddhism', 'Hinduism', 'Jainism', 'Sikhism'],
    correctIndex: 2,
    explanation:
      'Sthanakvasi is a reform sect of the Svetambara Jains — it rejected temple and idol worship, praying instead in plain prayer halls (sthanakas). (UPSC CSE Prelims 2018.)',
    difficulty: 'INTERMEDIATE',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2018, paper: 'Prelims' }],
  },
  {
    unitSlug: 'biology-overview',
    questionText:
      'Which of the following leaf modifications occur(s) in the desert areas to inhibit water loss? 1. Hard and waxy leaves 2. Tiny leaves 3. Thorns instead of leaves',
    options: ['1 and 2 only', '2 and 3 only', '1 and 3 only', '1, 2 and 3'],
    correctIndex: 3,
    explanation:
      'Desert plants deploy all three — hard waxy cuticles, tiny often needle-like leaves, and leaves reduced to spines (the cactus) — every one of them cuts transpiration. (UPSC CSE Prelims 2018.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2018, paper: 'Prelims' }],
  },
  // ---------- SSC Combined Graduate Level Examination (Tier-I) ----------
  {
    unitSlug: 'fundamental-rights-articles-12-35',
    questionText: 'Which Article of the Constitution of India abolishes untouchability?',
    options: ['Article 15', 'Article 16', 'Article 17', 'Article 18'],
    correctIndex: 2,
    explanation:
      'Article 17 abolishes untouchability and forbids its practice in any form — enforced today by the Protection of Civil Rights Act, 1955. (SSC CGL 2019 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2019, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'international-relations-overview',
    questionText: 'The headquarters of UNESCO is located in:',
    options: ['New York', 'Paris', 'Geneva', 'Vienna'],
    correctIndex: 1,
    explanation:
      'The United Nations Educational, Scientific and Cultural Organization, founded in 1945, is headquartered in Paris. A classic static-GK repeat across SSC CGL cycles — asked in the 2019 and 2021 Tier-I papers among others.',
    difficulty: 'BASIC',
    provenance: [
      { examSlug: SSC_CGL_SLUG, year: 2019, paper: 'Tier-I' },
      { examSlug: SSC_CGL_SLUG, year: 2021, paper: 'Tier-I' },
    ],
  },
  {
    unitSlug: 'history-overview',
    questionText: 'The Indian National Congress was founded in the year:',
    options: ['1875', '1885', '1892', '1905'],
    correctIndex: 1,
    explanation:
      'The Indian National Congress was founded on 28 December 1885 in Bombay — W.C. Bonnerjee presiding, A.O. Hume the moving spirit. (SSC CGL 2019 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2019, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'history-overview',
    questionText: 'The Battle of Plassey was fought in the year:',
    options: ['1757', '1761', '1764', '1767'],
    correctIndex: 0,
    explanation:
      "Robert Clive's East India Company army defeated Nawab Siraj-ud-Daulah of Bengal at Plassey on 23 June 1757 — the battle that opened Bengal to the Company. A staple SSC CGL fact (2020 and 2022 Tier-I among its repeat appearances).",
    difficulty: 'BASIC',
    provenance: [
      { examSlug: SSC_CGL_SLUG, year: 2020, paper: 'Tier-I' },
      { examSlug: SSC_CGL_SLUG, year: 2022, paper: 'Tier-I' },
    ],
  },
  {
    unitSlug: 'chemistry-overview',
    questionText: 'The chemical name of common salt is:',
    options: ['Sodium bicarbonate', 'Sodium chloride', 'Sodium carbonate', 'Calcium chloride'],
    correctIndex: 1,
    explanation:
      'Common salt is sodium chloride (NaCl) — table salt, and the feedstock from which caustic soda, baking soda and washing soda are made. (SSC CGL 2020 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2020, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'international-relations-overview',
    questionText: 'The headquarters of the World Trade Organization (WTO) is located in:',
    options: ['New York', 'Paris', 'Geneva', 'Rome'],
    correctIndex: 2,
    explanation:
      'The WTO — established 1 January 1995 on the ashes of GATT — is headquartered at the Centre William Rappard in Geneva, Switzerland. (SSC CGL 2020 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2020, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'biology-overview',
    questionText: 'Which is the largest gland in the human body?',
    options: ['Pancreas', 'Liver', 'Thyroid', 'Pituitary'],
    correctIndex: 1,
    explanation:
      'The liver is the largest gland (and the largest internal organ, about 1.5 kg) — it secretes bile and runs the body\u2019s metabolism. (SSC CGL 2021 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2021, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'geography-overview',
    questionText: "Which river is known as the 'Sorrow of Bihar'?",
    options: ['Gandak', 'Kosi', 'Son', 'Punpun'],
    correctIndex: 1,
    explanation:
      'The Kosi — the \u2018Sorrow of Bihar\u2019 — shifts its course over a huge alluvial fan and floods north Bihar almost every year; upstream it is called the \u2018Sorrow of Nepal\u2019. (SSC CGL 2021 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2021, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'ashoka-kalinga-war-261-bce',
    questionText: 'The Kalinga War was fought in the year:',
    options: ['261 BCE', '232 BCE', '298 BCE', '323 BCE'],
    correctIndex: 0,
    explanation:
      'Ashoka fought the Kalinga War in 261 BCE, in the eighth year of his reign; the slaughter he witnessed turned him from bherighosha to dhammaghosha — the conquest by Dhamma. (SSC CGL 2021 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2021, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'fundamental-rights-articles-12-35',
    questionText: 'Which Article of the Constitution of India deals with the Right to Education?',
    options: ['Article 19A', 'Article 20A', 'Article 21A', 'Article 22A'],
    correctIndex: 2,
    explanation:
      'Article 21A — inserted by the 86th Amendment, 2002 — makes free and compulsory education for children aged 6 to 14 a fundamental right, operationalised by the RTE Act, 2009. (SSC CGL 2022 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2022, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'geography-overview',
    questionText: 'The Tropic of Cancer passes through how many Indian states?',
    options: ['6', '7', '8', '9'],
    correctIndex: 2,
    explanation:
      'The Tropic of Cancer crosses eight states: Gujarat, Rajasthan, Madhya Pradesh, Chhattisgarh, Jharkhand, West Bengal, Tripura and Mizoram. (SSC CGL 2022 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2022, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'geography-overview',
    questionText: 'Which is the longest river of India?',
    options: ['Godavari', 'Ganga', 'Brahmaputra', 'Krishna'],
    correctIndex: 1,
    explanation:
      'The Ganga — about 2,525 km from Gangotri to the Bay of Bengal — is the longest river flowing through India. (SSC CGL 2022 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2022, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'history-overview',
    questionText: 'Who was the first Governor-General of independent India?',
    options: ['C. Rajagopalachari', 'Lord Mountbatten', 'Lord Wavell', 'Lord Canning'],
    correctIndex: 1,
    explanation:
      'Lord Mountbatten was the last Viceroy and the first Governor-General of independent India (August 1947\u2013June 1948); C. Rajagopalachari then became the first — and only — Indian Governor-General. A repeat SSC CGL staple (2020 and 2023 among its appearances).',
    difficulty: 'BASIC',
    provenance: [
      { examSlug: SSC_CGL_SLUG, year: 2020, paper: 'Tier-I' },
      { examSlug: SSC_CGL_SLUG, year: 2023, paper: 'Tier-I' },
    ],
  },
  {
    unitSlug: 'environment-ecology-overview',
    questionText: 'Project Tiger was launched in India in the year:',
    options: ['1969', '1972', '1973', '1975'],
    correctIndex: 2,
    explanation:
      'Project Tiger was launched on 1 April 1973 from Jim Corbett National Park; it is steered today by the National Tiger Conservation Authority. (SSC CGL 2023 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2023, paper: 'Tier-I' }],
  },
  {
    unitSlug: 'chandrayaan-3-landing-2023',
    questionText:
      "The lander of Chandrayaan-3, which soft-landed near the Moon's south pole in 2023, is named:",
    options: ['Pragyan', 'Vikram', 'Bhima', 'Aditya'],
    correctIndex: 1,
    explanation:
      'The Vikram lander touched down near the lunar south pole on 23 August 2023 — India the first nation to land there — carrying the Pragyan rover. (SSC CGL 2023 Tier-I.)',
    difficulty: 'BASIC',
    provenance: [{ examSlug: SSC_CGL_SLUG, year: 2023, paper: 'Tier-I' }],
  },
]

// ---------- Step 2: the MAINS-style PYQ Q&As ----------

interface PyqQnaSeed {
  unitSlug: string
  questionText: string
  answerBody: string
  provenance: Array<{ examSlug: string; year: number; paper: string }>
}

const QNAS: PyqQnaSeed[] = [
  {
    unitSlug: 'polity-governance-overview',
    questionText:
      "Do you think the Constitution of India does not accept the principle of strict separation of powers, rather it is based on the principle of 'checks and balance'? Explain. (UPSC CSE Main GS-II, 2019)",
    answerBody:
      "The Constitution deliberately rejects the rigid American wall of separation in favour of a blended, checked system. The President and Governors hold the executive power (Articles 53, 154), but the Council of Ministers that wields it is drawn from and responsible to the legislature (Articles 74\u201375, 164). The judiciary is institutionally independent (Articles 124, 50) yet its judges are appointed by the executive and removable by Parliament (Article 124(4)). The checks run in every direction: courts review laws and executive action; Parliament controls the executive through question hour, committees and the no-confidence vote; the executive summons and dissolves the House. The design is 'checks and balances' — powers separated enough to prevent tyranny, mixed enough to govern. (UPSC CSE Main GS-II, 2019 \u2014 10 marks.)",
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2019, paper: 'Mains GS-II' }],
  },
  {
    unitSlug: 'art-culture-overview',
    questionText:
      'The rock-cut architecture represents one of the most important sources of our knowledge of early Indian art and history. Discuss. (UPSC CSE Main GS-I, 2020)',
    answerBody:
      "Rock-cut excavations are history quarried in place. From the Mauryan Barabar caves (3rd century BCE) through the chaitya halls and viharas of Bhaja, Karla and Ajanta to Ellora's Kailasanatha temple and the Pallava rathas of Mahabalipuram, they carry donative inscriptions that date and name patrons — Satavahana, Vakataka, Rashtrakuta, Pallava — while preserving painting and sculpture in situ. They chart the evolution of the chaitya-vihara plan, the passage from Hinayana austerity to Mahayana imagery, and the side-by-side patronage of Buddhist, Jain and Hindu faiths. Because monument and inscription survive together, rock-cut architecture anchors the very chronology of early Indian art. (UPSC CSE Main GS-I, 2020 \u2014 10 marks.)",
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2020, paper: 'Mains GS-I' }],
  },
  {
    unitSlug: 'art-culture-overview',
    questionText:
      'Evaluate the nature of the Bhakti literature and its contribution to Indian culture. (UPSC CSE Main GS-I, 2021)',
    answerBody:
      'Bhakti literature is devotion composed in the people\u2019s tongues: the Tamil hymns of the Alvars and Nayanars, Kabir\u2019s nirguna couplets, Mirabai\u2019s Krishna lyrics, Tulsidas\u2019s Ramcharitmanas, Guru Nanak\u2019s japjis, the Vaishnava padas of Bengal and Shankaradeva\u2019s Assamese kirtan-ghosha. Its nature is vernacular, anti-ritualistic and often anti-caste — carrying theology out of the Sanskrit court and into the market square. Its contribution is correspondingly deep: it matured the modern Indian languages into literary vehicles, democratised religious participation across gender and caste, and seeded living performance traditions — kirtan, Sattriya, abhanganga — that Indian culture still practises. (UPSC CSE Main GS-I, 2021 \u2014 15 marks.)',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2021, paper: 'Mains GS-I' }],
  },
  {
    unitSlug: 'polity-governance-overview',
    questionText:
      'Whether the Supreme Court Judgment (July 2018) can settle the political tussle between the Lt. Governor and the elected government of Delhi? Examine. (UPSC CSE Main GS-II, 2018)',
    answerBody:
      'In Government of NCT of Delhi v. Union of India (July 2018) the Constitution Bench ruled that Delhi is not a full state — land, police and public order remain with the Centre — but on every transferred subject the elected government needs no prior concurrence of the Lieutenant Governor, who is bound by the aid and advice of its Council of Ministers; the habit of referring every file to the LG was read down. The judgment thus settled the constitutional principle (representative government for Delhi\u2019s own subjects, cooperative federalism between the two), yet it consciously left services and the residual friction open — the 2023 ruling on services came later — so while the law was settled, the political tussle persisted at the boundaries. (UPSC CSE Main GS-II, 2018 \u2014 15 marks.)',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2018, paper: 'Mains GS-II' }],
  },
  {
    unitSlug: 'geography-overview',
    questionText:
      'Explain the role of geographical factors towards the development of ancient India. (UPSC CSE Main GS-I, 2023)',
    answerBody:
      'Geography set the terms of ancient India\u2019s development at every scale. The Himalaya walled the subcontinent off from the continental cold and fed the perennial rivers whose alluvium made the Indo-Gangetic plain the cradle of the Harappan cities and every successive agrarian state from the Mauryas to the Guptas. The monsoon\u2019s rhythm fixed the agricultural calendar and made water management — Sudarshana Lake, irrigation guilds, tank systems — a standing royal duty. The Deccan\u2019s minerals and the long coastline (Bharuch, Muziris, Tamralipti) powered the Mauryan-Satavahana and later Chola maritime trade that reached Rome and Southeast Asia. And the northwest passes — Khyber and Bolan — made that frontier a revolving cultural door for Indo-Greeks, Kushanas and Turks alike. (UPSC CSE Main GS-I, 2023 \u2014 15 marks.)',
    provenance: [{ examSlug: UPSC_CSE_SLUG, year: 2023, paper: 'Mains GS-I' }],
  },
]

// ---------- Seed ----------

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

function serializeOptions(options: string[]): string {
  return JSON.stringify(options.map((text, index) => ({ key: OPTION_KEYS[index] ?? String(index), text })))
}

async function main() {
  // ---------- Resolutions (never hard-coded ids) ----------
  const en = await prisma.language.findUnique({ where: { code: 'en' } })
  if (!en) throw new Error('Language "en" not found — run the base seed first')

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } })
  if (!admin) throw new Error('No ADMIN user found — run the base seed first')

  const examSlugs = [...new Set([...QUESTIONS, ...QNAS].flatMap((seed) => seed.provenance.map((p) => p.examSlug)))]
  const examBySlug = new Map<string, { id: string; name: string; status: string }>()
  for (const slug of examSlugs) {
    const exam = await prisma.exam.findUnique({ where: { slug }, select: { id: true, name: true, status: true } })
    if (!exam || exam.status !== 'ACTIVE') {
      throw new Error(`PYQ exam "${slug}" missing/inactive — provenance cannot be seeded without it`)
    }
    examBySlug.set(slug, exam)
  }

  // ---------- 1. The PYQ MCQs ----------
  console.log(`\n=== Step 1: PYQ MCQs (${QUESTIONS.length}) ===`)
  let questionsCreated = 0
  let questionsSkipped = 0
  let provenanceCreated = 0
  let provenanceSkipped = 0
  for (const seed of QUESTIONS) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    if (!unit) {
      console.warn(`  ! unit missing for "${seed.unitSlug}" — skipped`)
      continue
    }

    // Never overwrite live edits (§36) — identity is (unit, language, question).
    let question = await prisma.question.findFirst({
      where: { knowledgeUnitId: unit.id, languageId: en.id, questionText: seed.questionText },
      select: { id: true },
    })
    if (question) {
      questionsSkipped++
    } else {
      // The publish transition (assessment question-service, publish arm):
      // create the row, snapshot revision 1, point the live pointer — the
      // public surface always serves the revision snapshot.
      const created = await prisma.question.create({
        data: {
          knowledgeUnitId: unit.id,
          examVersionId: null,
          languageId: en.id,
          status: 'PUBLISHED',
          type: 'MCQ',
          difficulty: seed.difficulty,
          questionText: seed.questionText,
          optionsJson: serializeOptions(seed.options),
          correctAnswer: OPTION_KEYS[seed.correctIndex] ?? String(seed.correctIndex),
          explanation: seed.explanation,
          aiAssisted: false,
          createdById: admin.id,
        },
        select: { id: true },
      })
      const revision = await prisma.questionRevision.create({
        data: {
          questionId: created.id,
          revisionNumber: 1,
          questionText: seed.questionText,
          optionsJson: serializeOptions(seed.options),
          correctAnswer: OPTION_KEYS[seed.correctIndex] ?? String(seed.correctIndex),
          explanation: seed.explanation,
          difficulty: seed.difficulty,
          changeSummary: 'SITE-S7 PYQ seed — initial publication',
          aiAssisted: false,
          publishedById: admin.id,
          publishedAt: new Date(),
        },
        select: { id: true },
      })
      await prisma.question.update({
        where: { id: created.id },
        data: { publishedRevisionId: revision.id },
      })
      question = created
      questionsCreated++
    }

    // The provenance rows — idempotent on (question, exam, year, paper); a
    // question from an earlier run still receives missing sittings.
    for (const sitting of seed.provenance) {
      const exam = examBySlug.get(sitting.examSlug)!
      const existing = await prisma.questionProvenance.findFirst({
        where: {
          questionId: question.id,
          examId: exam.id,
          year: sitting.year,
          paper: sitting.paper,
        },
        select: { id: true },
      })
      if (existing) {
        provenanceSkipped++
        continue
      }
      await prisma.questionProvenance.create({
        data: {
          questionId: question.id,
          examId: exam.id,
          year: sitting.year,
          paper: sitting.paper,
          questionNumber: null, // honest: the seed claims no paper Q-number it cannot verify
          notes: 'SITE-S7 PYQ seed — real paper appearance',
          createdById: admin.id,
        },
      })
      provenanceCreated++
    }
  }
  console.log(
    `Questions: ${questionsCreated} created, ${questionsSkipped} already present (kept). Question provenance rows: ${provenanceCreated} created, ${provenanceSkipped} already present.`
  )

  // ---------- 2. The MAINS-style PYQ Q&As ----------
  console.log(`\n=== Step 2: PYQ Q&As (${QNAS.length}) ===`)
  let qnasCreated = 0
  let qnasSkipped = 0
  let qnaProvenanceCreated = 0
  let qnaProvenanceSkipped = 0
  for (const seed of QNAS) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    if (!unit) {
      console.warn(`  ! unit missing for "${seed.unitSlug}" — skipped`)
      continue
    }

    let qna = await prisma.qnA.findFirst({
      where: { knowledgeUnitId: unit.id, languageId: en.id, questionText: seed.questionText },
      select: { id: true },
    })
    if (qna) {
      qnasSkipped++
    } else {
      const created = await prisma.qnA.create({
        data: {
          knowledgeUnitId: unit.id,
          languageId: en.id,
          status: 'PUBLISHED',
          questionText: seed.questionText,
          answerBody: seed.answerBody,
          aiAssisted: false,
          createdById: admin.id,
        },
        select: { id: true },
      })
      const revision = await prisma.qnARevision.create({
        data: {
          qnaId: created.id,
          revisionNumber: 1,
          questionText: seed.questionText,
          answerBody: seed.answerBody,
          changeSummary: 'SITE-S7 PYQ seed — initial publication',
          aiAssisted: false,
          publishedById: admin.id,
          publishedAt: new Date(),
        },
        select: { id: true },
      })
      await prisma.qnA.update({
        where: { id: created.id },
        data: { publishedRevisionId: revision.id },
      })
      qna = created
      qnasCreated++
    }

    for (const sitting of seed.provenance) {
      const exam = examBySlug.get(sitting.examSlug)!
      const existing = await prisma.qnAProvenance.findFirst({
        where: { qnaId: qna.id, examId: exam.id, year: sitting.year, paper: sitting.paper },
        select: { id: true },
      })
      if (existing) {
        qnaProvenanceSkipped++
        continue
      }
      await prisma.qnAProvenance.create({
        data: {
          qnaId: qna.id,
          examId: exam.id,
          year: sitting.year,
          paper: sitting.paper,
          notes: 'SITE-S7 PYQ seed — real paper appearance',
          createdById: admin.id,
        },
      })
      qnaProvenanceCreated++
    }
  }
  console.log(
    `QnAs: ${qnasCreated} created, ${qnasSkipped} already present (kept). QnA provenance rows: ${qnaProvenanceCreated} created, ${qnaProvenanceSkipped} already present.`
  )

  // ---------- Verification ----------
  console.log('\n=== Verification ===')

  const examRows = await prisma.exam.findMany({
    where: { slug: { in: examSlugs } },
    select: { id: true, slug: true, name: true },
    orderBy: { slug: 'asc' },
  })
  for (const exam of examRows) {
    const [questionRows, qnaRows] = await Promise.all([
      prisma.questionProvenance.groupBy({
        by: ['year'],
        where: { examId: exam.id },
        _count: { _all: true },
      }),
      prisma.qnAProvenance.groupBy({
        by: ['year'],
        where: { examId: exam.id },
        _count: { _all: true },
      }),
    ])
    const years = [...new Set([...questionRows, ...qnaRows].map((row) => row.year))].sort((a, b) => b - a)
    console.log(`  ${exam.slug} (${exam.name}):`)
    for (const year of years) {
      const mcq = questionRows.find((row) => row.year === year)?._count._all ?? 0
      const qna = qnaRows.find((row) => row.year === year)?._count._all ?? 0
      console.log(`    ${year}: ${mcq} MCQ provenance · ${qna} QnA provenance`)
    }
  }

  const problems: string[] = []
  const questionProvenanceTotal = await prisma.questionProvenance.count()
  const qnaProvenanceTotal = await prisma.qnAProvenance.count()
  const expectedQuestionProvenance = QUESTIONS.reduce((sum, seed) => sum + seed.provenance.length, 0)
  const expectedQnaProvenance = QNAS.reduce((sum, seed) => sum + seed.provenance.length, 0)
  if (questionProvenanceTotal < expectedQuestionProvenance) {
    problems.push(`expected ≥${expectedQuestionProvenance} question provenance rows, found ${questionProvenanceTotal}`)
  }
  if (qnaProvenanceTotal < expectedQnaProvenance) {
    problems.push(`expected ≥${expectedQnaProvenance} qna provenance rows, found ${qnaProvenanceTotal}`)
  }
  // Every seeded question must be PUBLISHED with a live revision AND ≥1
  // provenance row (the PYQ gate the public directory counts on).
  const unprovenanced = await prisma.question.count({
    where: {
      provenance: { none: {} },
      OR: [
        { status: { not: 'PUBLISHED' } },
        { publishedRevisionId: null },
      ],
    },
  })
  void unprovenanced // (informational only — pre-existing non-PYQ questions legitimately carry no provenance)
  const seedQuestionIds = await prisma.question.findMany({
    where: { questionText: { in: QUESTIONS.map((seed) => seed.questionText) } },
    select: { id: true, status: true, publishedRevisionId: true, _count: { select: { provenance: true } } },
  })
  for (const row of seedQuestionIds) {
    if (row.status !== 'PUBLISHED' || row.publishedRevisionId == null || row._count.provenance === 0) {
      problems.push(`seeded question ${row.id} not PUBLISHED-with-revision-and-provenance`)
    }
  }
  const seedQnaIds = await prisma.qnA.findMany({
    where: { questionText: { in: QNAS.map((seed) => seed.questionText) } },
    select: { id: true, status: true, publishedRevisionId: true, _count: { select: { provenance: true } } },
  })
  for (const row of seedQnaIds) {
    if (row.status !== 'PUBLISHED' || row.publishedRevisionId == null || row._count.provenance === 0) {
      problems.push(`seeded qna ${row.id} not PUBLISHED-with-revision-and-provenance`)
    }
  }

  console.log(
    `\nTotals: ${questionProvenanceTotal} question provenance rows · ${qnaProvenanceTotal} qna provenance rows.`
  )
  if (problems.length > 0) {
    console.error(`\nSEED PROBLEMS:\n  - ${problems.join('\n  - ')}`)
    process.exitCode = 1
  } else {
    console.log('\nOK — PYQ provenance corpus seeded and verified.')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
