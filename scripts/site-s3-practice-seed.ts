/**
 * GKSetu — SITE-S3-A seed: the practice-content corpus (MCQ + Q&A).
 * docs/site-overhaul-plan.md §3 Task 7 — "Seeded practice content so the
 * pages launch with substance". Three steps:
 *
 *   1. ONE VERIFIED overview knowledge unit per subject (all 20 grid
 *      subjects, so every /{subject}/ page has ≥1 knowledge page; the 17
 *      SITE-S2 subjects had zero units, and BOTH the Question and QnA
 *      models REQUIRE a knowledgeUnitId anchor — the units come first).
 *      slug `{subject}-overview`, type CONCEPT, status VERIFIED, scope
 *      GLOBAL, topicId = the subject's root topic.
 *   2. 70 practice MCQs — 3 English per subject × 20 (a BASIC /
 *      INTERMEDIATE / ADVANCED mix) + 10 Hindi MCQs for the six biggest
 *      subjects (polity-governance, history, geography, economy,
 *      science-technology, static-gk — 2/2/2/1/2/1). One question per
 *      subject carries the §6 optional exam-version anchor (upsc-civil-
 *      services, ssc-cgl, ibps-po, ibps-clerk, upsc-cds, uppsc-pcs — all
 *      their "2026 syllabus" versions are the CURRENT windows), so the
 *      /mcq/ ?exam= filter launches with real content.
 *   3. 30 explanatory QnAs — English, 1–2 per subject (2 for the ten
 *      biggest subjects), anchored to the same overview units.
 *
 * All content is REAL exam-prep GK (Indian competitive exams — UPSC, SSC,
 * banking, railways, defence, state PCS): every fact below is a
 * well-established, textbook-grade anchor (constitution articles and
 * amendments, dates, article numbers, committee names) deliberately
 * chosen for stability; volatile facts (current office-holders, changing
 * counts) are avoided.
 *
 * Published-with-revision discipline (the §19/§36 publish transition,
 * replicated from the assessment services — see transitionQuestion's
 * publish arm): each PUBLISHED Question/QnA is created together with its
 * immutable revision-1 snapshot and publishedRevisionId pointer. Text on
 * the Question/QnA row is the WORKING COPY; the public APIs serve the
 * revision snapshot.
 *
 * Idempotency contract (safe to re-run):
 *   - Units upsert by slug; the update arm re-asserts only the seed-owned
 *     content fields (canonicalName, canonicalSummary, canonicalBody) —
 *     status/scope/type/topic of an existing unit are never touched (§36:
 *     live console edits and lifecycle states stay).
 *   - Questions/QnAs: identity is (unit, language, questionText) — the
 *     prisma/seed.ts discipline. findFirst-then-create: an existing row is
 *     NEVER overwritten (a live edit always wins); re-runs only add what
 *     is missing.
 *   - Exam anchors resolve by slug + version label; a missing anchor never
 *     drops a question — it seeds without one (the anchor is authoring
 *     context, not identity).
 *
 * Run: bun scripts/site-s3-practice-seed.ts
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

/** The current version label the exam anchors resolve to (verified live). */
const EXAM_VERSION_LABEL = '2026 syllabus'

// ---------- Step 1: the 20 overview knowledge units ----------

interface UnitSeed {
  /** The subject's root-topic slug (the unit anchors to it). */
  subjectSlug: string
  canonicalName: string
  canonicalSummary: string
  canonicalBody: string
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
}

const UNITS: UnitSeed[] = [
  {
    subjectSlug: 'polity-governance',
    canonicalName: 'Polity and Governance of India — an overview',
    canonicalSummary:
      'The Constitution of India (in force 26 January 1950) establishes a sovereign, socialist, secular, democratic republic with a parliamentary system; Part III rights, Part IV directives and Part IVA duties form its value core.',
    canonicalBody:
      "The Constitution of India was adopted by the Constituent Assembly on 26 November 1949 and came into force on 26 January 1950. It is the world's longest written constitution, framing a sovereign, socialist, secular, democratic republic with a parliamentary system of government. The Preamble, Fundamental Rights (Part III, Articles 12–35), Directive Principles of State Policy (Part IV) and Fundamental Duties (Part IVA, Article 51A) form its core value framework.\n\nThe Union government has three branches: the executive (the President as head of state and a Prime Minister-led Council of Ministers), the legislature (bicameral Parliament — Lok Sabha and Rajya Sabha) and the judiciary, with the Supreme Court at its apex. India is a federal system with a strong unitary bias: legislative power is divided between the Union and the states through three lists in the Seventh Schedule, while the emergency provisions (Articles 352, 356 and 360) allow the Centre to assume greater control.\n\nFor competitive exams the high-yield anchors are the constitutional amendments (especially the 42nd, 44th, 73rd and 74th), the articles governing rights and duties, the President, Parliament and the judiciary, and the constitutional and statutory bodies — the Election Commission, UPSC, CAG and Finance Commission.",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'history',
    canonicalName: 'Indian History — an overview',
    canonicalSummary:
      'Indian history divides into ancient (to c. 1206 CE), medieval (c. 1206–1707) and modern periods — from the Indus Valley Civilisation through the Mauryas and Guptas, the Sultanate and Mughals, to British rule and the freedom struggle.',
    canonicalBody:
      'Indian history is conventionally divided into ancient (to c. 1206 CE), medieval (c. 1206–1707) and modern (from the mid-eighteenth century) periods. Ancient India spans the Indus Valley Civilisation (mature phase c. 2600–1900 BCE), the Vedic age, the sixteen Mahajanapadas, the Mauryan and Gupta empires, and the southern kingdoms of the Cholas, Cheras and Pandyas.\n\nMedieval India opens with the Delhi Sultanate (1206–1526) and reaches its imperial peak under the Mughals after Babur\'s 1526 victory at Panipat, declining after Aurangzeb\'s death in 1707. The modern period covers the European trading companies, British expansion from the Battle of Plassey (1757), the Revolt of 1857, and the national movement from the Indian National Congress\'s founding in 1885 to independence on 15 August 1947.\n\nExam anchors: Ashoka\'s edicts, the Gupta golden age, the Bhakti and Sufi movements, the three battles of Panipat (1526, 1556, 1761), the 1857 revolt, and the freedom struggle\'s phases — Moderates, Extremists, the Gandhi era and the road to Partition.',
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'geography',
    canonicalName: 'Geography of India — an overview',
    canonicalSummary:
      'India (about 3.28 million sq km, seventh-largest country) divides into the Himalayas, Northern Plains, Peninsular Plateau, desert, coasts and islands; the Ganga is its longest river and the southwest monsoon its climatic lifeline.',
    canonicalBody:
      "India lies entirely in the northern hemisphere between roughly 8°4′ and 37°6′ north latitude. With an area of about 3.28 million square kilometres — 2.4 per cent of the world's land — it is the seventh-largest country. It shares land borders with seven neighbours: Afghanistan, Pakistan, China, Nepal, Bhutan, Bangladesh and Myanmar, and has a coastline of about 7,500 km.\n\nPhysiographically, India divides into the Himalayan ranges, the Indo-Gangetic plains, the Peninsular plateau (the oldest, most stable landmass), the coastal plains, the Thar desert and the island groups. The Ganga (about 2,525 km) is the longest river of India; the Brahmaputra and Indus systems drain the north, the peninsular Godavari, Krishna and Kaveri flow east into the Bay of Bengal, and the Narmada and Tapi flow west. The southwest monsoon (June–September) delivers about three-quarters of the annual rainfall, making it the lifeline of Indian agriculture.\n\nExam anchors: the Tropic of Cancer's passage through eight states, the states and capitals, the river systems and deltas, and the protected-area network.",
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'economy',
    canonicalName: 'Indian Economy — an overview',
    canonicalSummary:
      'A mixed economy reformed open in 1991: the RBI (est. 1935) runs monetary policy through a six-member MPC targeting 4% CPI inflation, while GST (2017), the Budget and NITI Aayog frame the fiscal architecture.',
    canonicalBody:
      'India is a mixed economy in which the private sector, public enterprises and government coexist. Since the 1991 reforms — deregulation, trade liberalisation and opening to foreign investment — it has grown into one of the world\'s largest economies. The Reserve Bank of India (RBI), established on 1 April 1935, is the monetary authority: its six-member Monetary Policy Committee sets the policy repo rate to hold Consumer Price Index inflation near the 4 per cent target, within a 2–6 per cent band.\n\nKey institutions and concepts exams test: the Union Budget, fiscal deficit, the Goods and Services Tax (launched 1 July 2017 by the 101st Constitutional Amendment) and the GST Council, the banking system and SEBI, the five-year-plan era (1951–2017) and NITI Aayog (2015), and the three sectors — agriculture, industry and services, with services the largest share of GDP.\n\nStructural facts worth mastering: national income accounting, types of unemployment and poverty measures, the balance of payments, and the composition of India\'s external trade.',
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'environment-ecology',
    canonicalName: 'Environment and Ecology — an overview',
    canonicalSummary:
      'Ecology studies organisms and their environment; India is megadiverse with four biodiversity hotspots, a protected-area network under the Wildlife (Protection) Act 1972, and a full set of global treaty commitments.',
    canonicalBody:
      "Ecology studies the relationships between organisms and their environment — ecosystems, food chains, energy flow and biodiversity. India is one of the world's seventeen megadiverse countries and hosts four biodiversity hotspots: the Himalaya, Indo-Burma, the Western Ghats–Sri Lanka region and Sundaland (the Nicobar Islands).\n\nIndia's conservation architecture rests on protected areas — national parks, wildlife sanctuaries, and conservation and community reserves — under the Wildlife (Protection) Act, 1972, together with flagship programmes such as Project Tiger (1973) and Project Elephant (1992). The National Green Tribunal (2010) adjudicates environmental disputes; the National Action Plan on Climate Change (2008) coordinates mitigation and adaptation.\n\nGlobal frameworks exams test: the Ramsar Convention on wetlands (1971), CITES (1975), the Montreal Protocol on ozone-depleting substances (1987), the Convention on Biological Diversity and the UNFCCC (both Rio de Janeiro, 1992), the Kyoto Protocol (1997) and the Paris Agreement (2015).",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'biology',
    canonicalName: 'Biology — an overview',
    canonicalSummary:
      'The study of life from cells to ecosystems: cell organelles, genetics, the human body\'s systems, nutrition and deficiency diseases, and the five-kingdom classification of life.',
    canonicalBody:
      'Biology is the study of life, from molecules and cells to organisms and ecosystems. The cell is the basic unit: prokaryotic cells lack a true nucleus, eukaryotic cells have one; the mitochondrion is the "powerhouse of the cell", the nucleus stores genetic material, and chloroplasts drive photosynthesis in plants. Genetic information flows from DNA to RNA to protein, with Mendel\'s laws governing inheritance.\n\nThe human body\'s systems — digestive, circulatory, respiratory, nervous, endocrine, excretory, reproductive and immune — plus nutrition and deficiency diseases are recurring exam themes: scurvy from vitamin C deficiency, rickets from vitamin D, anaemia from iron deficiency and goitre from iodine deficiency.\n\nPlant biology covers photosynthesis, transpiration and the taxonomy of the plant kingdom; Whittaker\'s five-kingdom classification (Monera, Protista, Fungi, Plantae, Animalia) organises life for exam purposes.',
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'physics',
    canonicalName: 'Physics — an overview',
    canonicalSummary:
      'From Newton\'s laws and SI units to relativity and quantum theory — the exam core of mechanics, heat, optics, electricity and modern physics, with India\'s Nobel anchors (Raman, Chandrasekhar).',
    canonicalBody:
      "Physics studies matter, energy and their interactions. Classical mechanics (Newton's three laws of motion), gravitation, thermodynamics, optics, and electricity and magnetism form the school-and-exam core; the SI system standardises measurement — the newton for force, the joule for energy, the watt for power and the ampere for current.\n\nModern physics opens with relativity (Einstein's special theory 1905, general 1915) and quantum theory (Planck 1900, Einstein's photon 1905, Bohr's atom 1913). Exam staples include the electromagnetic spectrum, sound waves, the speed of light (about 3 × 10⁸ m/s), and the behaviour of mirrors and lenses.\n\nIndian anchors that exams ask repeatedly: C. V. Raman's scattering of light (the Raman Effect, 1928; Nobel Prize 1930; 28 February is National Science Day) and S. Chandrasekhar's work on stellar structure (Nobel Prize 1983).",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'chemistry',
    canonicalName: 'Chemistry — an overview',
    canonicalSummary:
      'The study of matter: the periodic table (Mendeleev 1869, perfected by atomic number), bonding, acids and bases on the pH scale, and the everyday chemistry of metals, fuels and fertilisers.',
    canonicalBody:
      'Chemistry studies the composition, structure and properties of matter. The periodic table — Mendeleev\'s 1869 arrangement perfected by Moseley\'s atomic-number ordering — organises the 118 known elements into groups and periods; the s, p, d and f blocks classify them by the orbital being filled. Bonding (ionic, covalent, metallic), the mole concept, acids, bases and salts, and the pH scale (0–14, neutral at 7) are the exam core.\n\nCommon chemical facts recur every year: gold is Au and silver Ag from their Latin names (aurum, argentum); the behaviour of the halogens, noble gases and alkali metals; oxidation and reduction; and everyday chemistry — soaps and detergents, NPK fertilisers and LPG cooking gas.\n\nNuclear chemistry distinguishes fission (heavy nuclei split, the reactor principle) from fusion (light nuclei combine, the Sun\'s energy source) — the distinction that anchors both energy questions and disarmament GK.',
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'science-technology',
    canonicalName: 'Science and Technology in India — an overview',
    canonicalSummary:
      'ISRO (1969) from Aryabhata (1975) to Chandrayaan-3\'s 2023 south-pole landing, the nuclear programme from 1974 to Pokhran-II (1998), and the DRDO-CSIR research network — the institutional GK of Indian science.',
    canonicalBody:
      "India's scientific enterprise is organised under the Department of Space (ISRO, founded 1969), the Department of Atomic Energy, the Council of Scientific and Industrial Research (CSIR) and the defence research network (DRDO, 1958). ISRO's landmarks: Aryabhata (1975, first Indian satellite), the Chandrayaan lunar missions — Chandrayaan-3's Vikram lander made the historic first soft landing near the Moon's south pole on 23 August 2023 — the Mars Orbiter Mission 'Mangalyaan' (2013–14, the first to reach Mars orbit on its first attempt), and the NavIC navigation constellation.\n\nThe nuclear programme, anchored by the Atomic Energy Commission (1948) and the Bhabha Atomic Research Centre, progressed from the 1974 peaceful nuclear experiment ('Smiling Buddha') to the 1998 Pokhran-II tests (Operation Shakti), making India a nuclear-weapon state.\n\nExam anchors: the institutions and their founding years and headquarters, the Science and Technology Policy line (Scientific Policy Resolution 1958 onward), and the flagship missions — Gaganyaan human spaceflight, the semiconductor mission and the Deep Ocean Mission.",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'computer-it',
    canonicalName: 'Computers and Information Technology — an overview',
    canonicalSummary:
      'Hardware (CPU, memory, I/O) plus system and application software; networking protocols and the World Wide Web (Tim Berners-Lee, 1989–91); security fundamentals and India\'s digital public infrastructure.',
    canonicalBody:
      "A computer processes data through input, processing, storage and output: the CPU (arithmetic-logic unit plus control unit), memory — volatile RAM against non-volatile storage — and input-output devices form the hardware triad. Software divides into system software (operating systems such as Windows, macOS, Linux and Android) and application software, with programming languages layered from machine code upward.\n\nNetworking and the internet are the modern exam core: the TCP/IP and HTTP protocols, email and file transfer, the World Wide Web invented by Tim Berners-Lee at CERN (1989–91), and the generations of computing from vacuum tubes through transistors and integrated circuits to microprocessors and artificial intelligence.\n\nSecurity essentials — viruses and other malware, phishing, firewalls and encryption — plus India's digital public infrastructure (Aadhaar, UPI, DigiLocker) complete the high-yield set.",
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'sports',
    canonicalName: 'Sports — an overview',
    canonicalSummary:
      'From India\'s Olympic story (first hockey gold 1928; Bindra and Chopra\'s individual golds) through cricket\'s World Cup wins to the trophies, venues and awards that fill the sports-GK section.',
    canonicalBody:
      "India's Olympic story began at Paris 1900, when Norman Pritchard — credited to India — won two athletics silver medals; the first team followed at Antwerp 1920, and the first gold came with the hockey team at Amsterdam 1928, opening the run of six consecutive Olympic titles. Abhinav Bindra (shooting, Beijing 2008) won India's first individual gold and Neeraj Chopra (javelin, Tokyo 2020) its first athletics gold.\n\nCricket is the most-followed game: India won the ODI World Cup in 1983 and 2011 and the inaugural T20 World Cup in 2007; Sachin Tendulkar's 100 international centuries is a stock exam fact, and the Khelo India programme (2018) develops grassroots talent.\n\nThe static set: trophies and their sports — Ranji and Duleep (cricket), Santosh Trophy (football), Durand Cup (Asia's oldest football tournament, 1888) — and the awards: the Major Dhyan Chand Khel Ratna, Arjuna and Dronacharya.",
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'art-culture',
    canonicalName: 'Indian Art and Culture — an overview',
    canonicalSummary:
      'Eight classical dances, architecture from stupas and cave paintings to the Nagara–Dravida–Vesara temple styles and Mughal monuments, two classical music traditions, and the classical literature canon.',
    canonicalBody:
      'Indian art and culture integrate architecture, sculpture, painting, music, dance, theatre and literature across more than four millennia. The Sangeet Natak Akademi recognises eight classical dances: Bharatanatyam (Tamil Nadu), Kathak (the storytelling tradition of north India), Kathakali and Mohiniyattam (Kerala), Kuchipudi (Andhra Pradesh), Manipuri (Manipur), Odissi (Odisha) and Sattriya (Assam, recognised 2000).\n\nArchitecture progresses from the Buddhist stupas (Sanchi) and rock-cut caves (Ajanta, Ellora, Elephanta) through the temple styles — Nagara in the north, Dravida in the south, Vesara in the Deccan — to Indo-Islamic and Mughal monuments such as the Taj Mahal (1632–53) and Delhi\'s Red Fort. Music divides into the Hindustani (north) and Carnatic (south) traditions.\n\nLiterary anchors: the Vedas, the Ramayana and Mahabharata, Kalidasa\'s Sanskrit drama (Abhijnana Shakuntalam), Bharata\'s Natya Shastra — the foundational treatise of dramaturgy — and the medieval Bhakti and Sufi literatures in the regional languages.',
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'books-authors',
    canonicalName: 'Books and Authors — an overview',
    canonicalSummary:
      'From the Vedas, Arthashastra and Kalidasa through the freedom movement\'s classics (Vande Mataram, Discovery of India, Gitanjali) to the modern Booker winners — the canon exams quote.',
    canonicalBody:
      "Indian writing is examined from the ancient to the contemporary: the Rig Veda, Kautilya's Arthashastra on statecraft, Kalidasa's plays, and the Tamil classic Tirukkural of Thiruvalluvar. The national movement produced Bankim Chandra Chatterjee's 'Vande Mataram' (in the 1882 novel Anandamath), Nehru's Discovery of India, Gandhi's My Experiments with Truth, and Tagore's Gitanjali — the collection behind the 1913 Nobel Prize in Literature, the first non-European laureate.\n\nModern classics recur too: R. K. Narayan's Malgudi Days, Munshi Premchand's Godaan, Khushwant Singh's Train to Pakistan, Salman Rushdie's Midnight's Children (Booker Prize 1981), Arundhati Roy's The God of Small Things (Booker 1997) and Vikram Seth's A Suitable Boy.\n\nExams also ask world literature (Shakespeare, Dickens, Tolstoy), the prize lists — Booker, Pulitzer and the Jnanpith, India's highest literary award — and famous first lines.",
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'awards-honours',
    canonicalName: 'Awards and Honours — an overview',
    canonicalSummary:
      'The Bharat Ratna above the Padma hierarchy; the gallantry ladder from Param Vir Chakra (wartime) to Ashoka Chakra (peacetime); the Jnanpith, Dadasaheb Phalke and Khel Ratna; and the international set led by the Nobels.',
    canonicalBody:
      "India's honours system is led by the Bharat Ratna (instituted 1954), the highest civilian award for exceptional service of the highest order in any field of human endeavour, followed by the Padma Vibhushan, Padma Bhushan and Padma Shri, announced annually on the eve of Republic Day.\n\nGallantry awards divide by context: the Param Vir Chakra is the highest wartime decoration, followed by the Maha Vir Chakra and Vir Chakra; the Ashoka Chakra heads the peacetime ladder. The sectoral set: the Jnanpith for literature, the Dadasaheb Phalke Award (since 1969) for cinema, the Shanti Swarup Bhatnagar Prize for science, and in sport the Major Dhyan Chand Khel Ratna (renamed in 2021), Arjuna and Dronacharya awards.\n\nThe international set: the Nobel Prizes (1901; all presented in Stockholm except the Peace Prize, awarded in Oslo), and for Asia the Ramon Magsaysay Award (1958).",
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'schemes',
    canonicalName: 'Government Schemes and Policies — an overview',
    canonicalSummary:
      'The welfare core — MGNREGA\'s 100-day job guarantee, PM-JAY\'s ₹5-lakh health cover, Jan Dhan\'s bank accounts, PM-KISAN\'s income support — plus the launch years, ministries and beneficiaries exams test.',
    canonicalBody:
      'Flagship welfare schemes anchor the governance-GK section. MGNREGA (2005) guarantees 100 days of unskilled wage employment per rural household per year — a legal right, not a relief programme. The Pradhan Mantri Awas Yojana (housing), the Jal Jeevan Mission (tap water), the Swachh Bharat Mission (2014, sanitation) and Ayushman Bharat PM-JAY (2018, health cover of ₹5 lakh per family per year) form the welfare core.\n\nFinancial inclusion and support: the Pradhan Mantri Jan Dhan Yojana (2014) drove universal bank access, MUDRA funds micro-enterprises, the Atal Pension Yojana provides old-age security, and PM-KISAN (2019) pays landholding farmer families ₹6,000 a year in three instalments.\n\nExams test the launching year, the ministry, the beneficiary class and the target of each scheme — plus the framing policies (National Education Policy 2020, National Health Policy 2017) and the institutions that implement them.',
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'defence-security',
    canonicalName: 'Defence and Security — an overview',
    canonicalSummary:
      'The President is Supreme Commander; the Army, Navy and Air Force under the Ministry of Defence with the CDS (2019); DRDO\'s indigenous systems; the nuclear no-first-use doctrine; and the forces, exercises and operations exams ask.',
    canonicalBody:
      "The President of India is the Supreme Commander of the Armed Forces (Article 53(2)). The Army, the Navy and the Air Force (established 8 October 1932) are headed by their Chiefs under the Ministry of Defence, with the Chief of Defence Staff (created 2019) providing single-point military advice.\n\nThe Defence Research and Development Organisation (1958) develops indigenous systems — the Agni and Prithvi missiles, the Tejas light combat aircraft and the Arjun tank — alongside Hindustan Aeronautics and the shipyards. India's nuclear deterrent rests on the no-first-use doctrine declared after the 1998 Pokhran-II tests, delivered across the triad of aircraft, land-based missiles and submarine-launched systems.\n\nBeyond the services: the central armed police forces (CRPF, BSF, ITBP, CISF, SSB) and the Assam Rifles (raised 1835, the oldest paramilitary force). Named operations recur in exams — Meghdoot (Siachen, 1984), Vijay (Kargil, 1999) — as do the joint exercises.",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'international-relations',
    canonicalName: 'International Relations — an overview',
    canonicalSummary:
      'Panchsheel (1954) and non-alignment to today\'s G20, BRICS, SCO and Quad membership; the neighbourhood and its disputes; and the organisations-with-headquarters list every exam sets.',
    canonicalBody:
      "India's foreign policy rests on the Panchsheel principles of peaceful coexistence (1954), the non-alignment tradition (a founding member of the Non-Aligned Movement, Belgrade 1961) and strategic autonomy. India was a founding member of the United Nations (1945) and belongs to the G20, BRICS (first summit 2009), the Shanghai Cooperation Organisation (member since 2017) and the revived Quad; it co-founded SAARC (Dhaka, 1985 — secretariat in Kathmandu) and leads BIMSTEC cooperation around the Bay of Bengal (1997).\n\nThe neighbourhood policy manages complex relationships — the boundary question with China along the Line of Actual Control, and the long-standing disputes and dialogues with Pakistan — alongside connectivity and diaspora partnerships.\n\nExam anchors: international organisations and their headquarters (the UN in New York, UNESCO in Paris, the WHO in Geneva, the IMF and World Bank in Washington), the Security Council's P5 and the reform debate, and the summits India hosts and joins.",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'static-gk',
    canonicalName: 'Static General Knowledge — an overview',
    canonicalSummary:
      'The stable fact base: national symbols, political firsts (Rajendra Prasad to Pratibha Patil), geography superlatives (Kangchenjunga, Ganga, Rajasthan) and the national dates and days every exam expects.',
    canonicalBody:
      "Static GK is the stable fact base — firsts, superlatives, national symbols and landmarks. The national symbols: the Bengal tiger (national animal), the Indian peacock (national bird), the lotus (national flower), the banyan (national tree) and the mango (national fruit); the anthem is Rabindranath Tagore's 'Jana Gana Mana' (adopted 24 January 1950) and the song is Bankim Chandra Chatterjee's 'Vande Mataram'. The state emblem is the Lion Capital of Sarnath and the national calendar the Saka era.\n\nPolitical firsts: Dr Rajendra Prasad (first President), Jawaharlal Nehru (first Prime Minister), Dr B. R. Ambedkar (chairman of the Constitution's Drafting Committee), Sarojini Naidu (first woman president of the Congress, 1925), Indira Gandhi (first woman Prime Minister, 1966) and Pratibha Patil (first woman President, 2007).\n\nGeography superlatives — Kangchenjunga as the highest peak within India, the Ganga as the longest river, Rajasthan the largest state and Goa the smallest — and the dates (Republic Day 26 January, Independence Day 15 August, Constitution Day 26 November) round out the set.",
    difficulty: 'BASIC',
  },
  {
    subjectSlug: 'agriculture',
    canonicalName: 'Agriculture — an overview',
    canonicalSummary:
      'The largest employer and a leading producer of milk, pulses and jute; the Green and White Revolutions, the kharif–rabi–zaid calendar, MSP and the institutions (ICAR, FCI, e-NAM) that frame farm GK.',
    canonicalBody:
      "Agriculture employs the largest share of India's workforce and contributes roughly a sixth of GDP. India is the world's largest producer of milk, pulses and jute, and among the largest producers of rice, wheat, sugarcane, cotton and tea. The Green Revolution of the mid-1960s — the science led by M. S. Swaminathan with Norman Borlaug's high-yielding wheats — made India self-sufficient in foodgrains; Operation Flood (1970–96), led by Verghese Kurien, made it the largest milk producer.\n\nThe cropping calendar divides into kharif (June–October: rice, maize, cotton), rabi (October–March: wheat, mustard) and the short zaid season between. The Commission for Agricultural Costs and Prices recommends the Minimum Support Prices the government announces for major crops, at which the Food Corporation of India (1965) procures.\n\nInstitutions exams ask: the Indian Council of Agricultural Research (1929), the FCI and the electronic National Agriculture Market, e-NAM (2016).",
    difficulty: 'INTERMEDIATE',
  },
  {
    subjectSlug: 'disaster-management',
    canonicalName: 'Disaster Management — an overview',
    canonicalSummary:
      'The Disaster Management Act 2005 architecture — NDMA under the Prime Minister, state and district authorities, the NDRF (2006) — against India\'s multi-hazard profile, with the Sendai Framework globally.',
    canonicalBody:
      "A disaster is a catastrophic event that overwhelms a community's coping capacity — natural (earthquake, cyclone, flood, drought, landslide) or human-induced. India is multi-hazard prone: nearly 60 per cent of the landmass is earthquake-prone, the long coastline is cyclone-prone, and millions of hectares are flood-prone.\n\nThe institutional framework is the Disaster Management Act, 2005: the National Disaster Management Authority, chaired by the Prime Minister; state authorities chaired by chief ministers; and district authorities. The National Executive Committee (headed by the Cabinet Secretary) coordinates, and the National Disaster Response Force (2006) — battalions drawn from the central armed police forces — carries out rescue and relief.\n\nExam anchors: the early-warning systems — the Indian Ocean Tsunami Warning System established after the 26 December 2004 tsunami, with Hyderabad's INCOIS a regional service provider — the do's and don'ts for each hazard, and the global Sendai Framework for Disaster Risk Reduction (2015–2030).",
    difficulty: 'INTERMEDIATE',
  },
]

// ---------- Step 2: the 70 practice MCQs (60 EN + 10 HI) ----------
// Each: accurate questionText, exactly one correct option, a teaching
// explanation, a difficulty spread. `examSlug` marks the one question per
// subject that carries the §6 optional exam anchor.

interface QuestionSeed {
  subjectSlug: string
  languageCode: 'en' | 'hi'
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  questionText: string
  options: [string, string, string, string]
  correctIndex: number
  explanation: string
  examSlug?: string
}

const QUESTIONS: QuestionSeed[] = [
  // ---------- polity-governance ----------
  {
    subjectSlug: 'polity-governance',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'The Fundamental Duties of citizens were added to the Constitution on the recommendation of which committee?',
    options: ['Sarkaria Commission', 'Swaran Singh Committee', 'Balwant Rai Mehta Committee', 'Ashok Mehta Committee'],
    correctIndex: 1,
    explanation:
      'The Swaran Singh Committee recommended Fundamental Duties, added as Part IVA (Article 51A) by the 42nd Constitutional Amendment in 1976. Originally ten, the list grew to eleven when the 86th Amendment (2002) added the duty of parents to provide education opportunities to children aged six to fourteen. (The Sarkaria Commission studied Centre–state relations; the Balwant Rai Mehta and Ashok Mehta committees examined Panchayati Raj.)',
  },
  {
    subjectSlug: 'polity-governance',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: "The words 'Socialist' and 'Secular' were added to the Preamble by which constitutional amendment?",
    options: ['24th Amendment', '42nd Amendment', '44th Amendment', '52nd Amendment'],
    correctIndex: 1,
    explanation:
      "The 42nd Amendment (1976) added 'Socialist', 'Secular' and 'Integrity' to the Preamble. The 44th Amendment (1978) reversed several 42nd-Amendment changes — restoring property as an ordinary legal right, for example — but left the Preamble words untouched.",
  },
  {
    subjectSlug: 'polity-governance',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'Under which Article of the Constitution can the President proclaim a Financial Emergency?',
    options: ['Article 352', 'Article 356', 'Article 360', 'Article 365'],
    correctIndex: 2,
    explanation:
      'Article 360 permits a Financial Emergency when the financial stability or credit of India is threatened — it has never been proclaimed. Article 352 covers National Emergency (proclaimed in 1962, 1971 and 1975) and Article 356 President\'s Rule on the failure of constitutional machinery in a state.',
  },
  {
    subjectSlug: 'polity-governance',
    languageCode: 'hi',
    difficulty: 'BASIC',
    questionText: 'मौलिक कर्तव्यों को संविधान में किस संशोधन द्वारा जोड़ा गया था?',
    options: ['42वाँ संशोधन', '44वाँ संशोधन', '52वाँ संशोधन', '24वाँ संशोधन'],
    correctIndex: 0,
    explanation:
      'मौलिक कर्तव्य 42वें संशोधन (1976) द्वारा स्वर्ण सिंह समिति की सिफारिश पर भाग 4क (अनुच्छेद 51क) में जोड़े गए थे। प्रारंभ में दस कर्तव्य थे; 86वें संशोधन (2002) से ग्यारहवाँ कर्तव्य जुड़ा।',
  },
  {
    subjectSlug: 'polity-governance',
    languageCode: 'hi',
    difficulty: 'INTERMEDIATE',
    questionText: 'संविधान सभा के स्थायी अध्यक्ष कौन थे?',
    options: ['डॉ. बी. आर. अंबेडकर', 'डॉ. राजेंद्र प्रसाद', 'डॉ. सच्चिदानंद सिन्हा', 'पं. जवाहरलाल नेहरू'],
    correctIndex: 1,
    explanation:
      'डॉ. राजेंद्र प्रसाद संविधान सभा के स्थायी अध्यक्ष चुने गए थे (डॉ. सच्चिदानंद सिन्हा अस्थायी अध्यक्ष थे)। डॉ. अंबेडकर प्रारूप समिति के अध्यक्ष थे — परीक्षाओं में यही भ्रम का बिंदु है।',
  },
  // ---------- history ----------
  {
    subjectSlug: 'history',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'The Quit India Movement was launched by the Indian National Congress in which year?',
    options: ['1930', '1935', '1942', '1945'],
    correctIndex: 2,
    explanation:
      "Launched on 8 August 1942 at the Bombay session with Gandhi's 'Do or Die' call, after the failure of the Cripps Mission. (1930 was the Dandi March and Civil Disobedience; 1935 the Government of India Act; 1945 the end of the Second World War.)",
  },
  {
    subjectSlug: 'history',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'The Battle of Plassey (1757) was fought between the British East India Company and which Nawab?',
    options: ['Siraj-ud-Daulah', 'Shuja-ud-Daula', 'Alivardi Khan', 'Mir Qasim'],
    correctIndex: 0,
    explanation:
      "Robert Clive defeated Siraj-ud-Daulah, the Nawab of Bengal, on 23 June 1757 — the battle that laid the foundation of British rule in India, decided by Mir Jafar's betrayal. (Alivardi Khan was Siraj's grandfather and predecessor; Mir Qasim fell later, at Buxar in 1764.)",
  },
  {
    subjectSlug: 'history',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Third Battle of Panipat (1761) was fought between the Marathas and which invading ruler?',
    options: ['Ahmad Shah Abdali', 'Nadir Shah', 'Babur', 'Sher Shah Suri'],
    correctIndex: 0,
    explanation:
      'Ahmad Shah Abdali of Afghanistan crushed the Marathas under Sadashivrao Bhau at Panipat on 14 January 1761. (Nadir Shah had invaded in 1739, carrying off the Peacock Throne and the Koh-i-Noor; Babur won the First Battle of Panipat in 1526.)',
  },
  {
    subjectSlug: 'history',
    languageCode: 'hi',
    difficulty: 'BASIC',
    questionText: '1857 के विद्रोह की शुरुआत 10 मई को किस स्थान से हुई थी?',
    options: ['मेरठ', 'बैरकपुर', 'झाँसी', 'कानपुर'],
    correctIndex: 0,
    explanation:
      '10 मई 1857 को मेरठ छावनी में भारतीय सैनिकों का विद्रोह शुरू हुआ, जो अगले ही दिन दिल्ली पहुँचा। (मार्च 1857 में बैरकपुर में मंगल पांडे की घटना इस विद्रोह की पृष्ठभूमि थी।)',
  },
  {
    subjectSlug: 'history',
    languageCode: 'hi',
    difficulty: 'INTERMEDIATE',
    questionText: "'दिल्ली चलो' का नारा किसने दिया था?",
    options: ['महात्मा गांधी', 'जवाहरलाल नेहरू', 'सुभाष चंद्र बोस', 'भगत सिंह'],
    correctIndex: 2,
    explanation:
      "सुभाष चंद्र बोस ने आज़ाद हिंद फ़ौज (INA) को 'दिल्ली चलो' का नारा दिया था — 'तुम मुझे खून दो, मैं तुम्हें आज़ादी दूँगा' उनका प्रसिद्ध वाक्य इसी दौर का है।",
  },
  // ---------- geography ----------
  {
    subjectSlug: 'geography',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'Which is the longest river of India?',
    options: ['Brahmaputra', 'Ganga', 'Godavari', 'Yamuna'],
    correctIndex: 1,
    explanation:
      'The Ganga, about 2,525 km long, is the longest river of India, rising at Gaumukh (the Gangotri glacier) and reaching the Bay of Bengal through the Sundarbans delta. The Brahmaputra is longer overall but most of its course lies in China (as the Yarlung Tsangpo) and Bangladesh; the Godavari, about 1,465 km, is the longest peninsular river.',
  },
  {
    subjectSlug: 'geography',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'The Sundarbans delta is formed mainly by which two rivers?',
    options: ['Ganga and Brahmaputra', 'Krishna and Kaveri', 'Narmada and Tapi', 'Mahanadi and Godavari'],
    correctIndex: 0,
    explanation:
      'The Ganga–Brahmaputra delta — the Sundarbans, shared by India and Bangladesh — is the world\'s largest delta. The Narmada and Tapi flow west through rift valleys and form estuaries, not deltas.',
  },
  {
    subjectSlug: 'geography',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'Among Indian states, which has the longest coastline?',
    options: ['Tamil Nadu', 'Andhra Pradesh', 'Gujarat', 'Maharashtra'],
    correctIndex: 2,
    explanation:
      'Gujarat has the longest coastline among Indian states (about 1,200–1,600 km by measurement convention) — the Kathiawar peninsula juts into the Arabian Sea. Andhra Pradesh and Tamil Nadu follow among states; among union territories the Andaman & Nicobar Islands exceed them all.',
  },
  {
    subjectSlug: 'geography',
    languageCode: 'hi',
    difficulty: 'BASIC',
    questionText: 'भारत की सबसे लंबी नदी कौन-सी है?',
    options: ['यमुना', 'गंगा', 'गोदावरी', 'ब्रह्मपुत्र'],
    correctIndex: 1,
    explanation:
      'लगभग 2,525 किलोमीटर लंबी गंगा भारत की सबसे लंबी नदी है। यह गंगोत्री हिमनद (गौमुख) से निकलकर सुंदरबन डेल्टा के रास्ते बंगाल की खाड़ी में गिरती है। गोदावरी प्रायद्वीपीय भारत की सबसे लंबी नदी है।',
  },
  {
    subjectSlug: 'geography',
    languageCode: 'hi',
    difficulty: 'INTERMEDIATE',
    questionText: 'कर्क रेखा (Tropic of Cancer) भारत के कितने राज्यों से होकर गुजरती है?',
    options: ['6', '8', '9', '10'],
    correctIndex: 1,
    explanation:
      'कर्क रेखा आठ राज्यों से होकर गुजरती है: गुजरात, राजस्थान, मध्य प्रदेश, छत्तीसगढ़, झारखंड, पश्चिम बंगाल, त्रिपुरा और मिज़ोरम।',
  },
  // ---------- economy ----------
  {
    subjectSlug: 'economy',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ibps-po',
    questionText: 'How many members does the Reserve Bank of India’s Monetary Policy Committee (MPC) have?',
    options: ['Four', 'Five', 'Six', 'Eight'],
    correctIndex: 2,
    explanation:
      'The MPC has six members — three nominated by the central government and three from the RBI, including the Governor, who chairs it and holds a casting vote. Constituted in 2016, it sets the policy repo rate to achieve the 4 per cent CPI inflation target within a 2–6 per cent band.',
  },
  {
    subjectSlug: 'economy',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'The headquarters of the World Trade Organization (WTO) is located in?',
    options: ['New York', 'Geneva', 'Vienna', 'Brussels'],
    correctIndex: 1,
    explanation:
      'The WTO, established on 1 January 1995 as the successor to the GATT (1948), is headquartered in Geneva, Switzerland. India, a GATT signatory, has been a member since the WTO’s foundation.',
  },
  {
    subjectSlug: 'economy',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Reserve Bank of India was established in which year?',
    options: ['1935', '1947', '1949', '1951'],
    correctIndex: 0,
    explanation:
      'The RBI was established on 1 April 1935 under the Reserve Bank of India Act, 1934, its share capital then privately held. It was nationalised in 1949 — the classic trap year; 1947 is independence and 1951 the First Five-Year Plan.',
  },
  {
    subjectSlug: 'economy',
    languageCode: 'hi',
    difficulty: 'BASIC',
    questionText: 'भारतीय रिज़र्व बैंक की स्थापना किस वर्ष हुई थी?',
    options: ['1935', '1949', '1947', '1951'],
    correctIndex: 0,
    explanation:
      'RBI की स्थापना 1 अप्रैल 1935 को RBI Act, 1934 के तहत हुई थी। 1949 में इसका राष्ट्रीयकरण हुआ — परीक्षाओं में यही वर्ष भ्रम का सामान्य कारण है।',
  },
  // ---------- environment-ecology ----------
  {
    subjectSlug: 'environment-ecology',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'The Montreal Protocol (1987) is concerned with the protection of?',
    options: ['The ozone layer', 'The climate', 'Wetlands', 'Migratory birds'],
    correctIndex: 0,
    explanation:
      'The Montreal Protocol phases out ozone-depleting substances such as CFCs under the Vienna Convention, and was the first treaty to achieve universal ratification. Climate is the UNFCCC–Kyoto–Paris track, wetlands the Ramsar Convention and migratory birds the Bonn Convention.',
  },
  {
    subjectSlug: 'environment-ecology',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'Project Tiger was launched by the Government of India in which year?',
    options: ['1969', '1972', '1973', '1980'],
    correctIndex: 2,
    explanation:
      'Launched in 1973 from Jim Corbett National Park, Project Tiger is India’s flagship tiger-conservation programme, administered today by the National Tiger Conservation Authority. (1972 is the Wildlife (Protection) Act.)',
  },
  {
    subjectSlug: 'environment-ecology',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Convention on Biological Diversity was opened for signature at?',
    options: ['Stockholm', 'Rio de Janeiro', 'Kyoto', 'Montreal'],
    correctIndex: 1,
    explanation:
      'The CBD was opened for signature at the 1992 Rio Earth Summit (UNCED), alongside the UN Framework Convention on Climate Change. (Stockholm hosted the 1972 UN environment conference; Kyoto 1997 is the climate protocol; Montreal 1987 the ozone protocol.)',
  },
  // ---------- biology ----------
  {
    subjectSlug: 'biology',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'Which cell organelle is known as the “powerhouse of the cell”?',
    options: ['Nucleus', 'Ribosome', 'Mitochondrion', 'Golgi apparatus'],
    correctIndex: 2,
    explanation:
      'Mitochondria generate ATP — the cell’s energy currency — through cellular respiration, hence “powerhouse of the cell”. They carry their own DNA, inherited maternally, evidence of their endosymbiotic origin.',
  },
  {
    subjectSlug: 'biology',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'Deficiency of which vitamin causes scurvy?',
    options: ['Vitamin A', 'Vitamin C', 'Vitamin D', 'Vitamin K'],
    correctIndex: 1,
    explanation:
      'Scurvy — bleeding gums, weakness, poor wound healing — results from deficiency of vitamin C (ascorbic acid); British sailors’ lime rations gave us the word “limey”. Night blindness follows vitamin A deficiency, rickets vitamin D and bleeding disorders vitamin K.',
  },
  {
    subjectSlug: 'biology',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'In a chloroplast, the Calvin cycle (the dark reaction) takes place in the?',
    options: ['Thylakoid membranes', 'Stroma', 'Grana', 'Matrix'],
    correctIndex: 1,
    explanation:
      'The Calvin cycle fixes carbon dioxide into sugars using ATP and NADPH in the stroma, the fluid surrounding the thylakoids; the light reactions occur on the thylakoid membranes (the grana stacks). “Matrix” is the corresponding inner space of a mitochondrion — the deliberate trap.',
  },
  // ---------- physics ----------
  {
    subjectSlug: 'physics',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'What is the SI unit of force?',
    options: ['Joule', 'Newton', 'Watt', 'Pascal'],
    correctIndex: 1,
    explanation:
      'One newton accelerates a one-kilogram mass at one metre per second squared (1 N = 1 kg·m/s²), named after Isaac Newton. The joule measures energy, the watt power and the pascal pressure.',
  },
  {
    subjectSlug: 'physics',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'C. V. Raman won the 1930 Nobel Prize in Physics for his discovery of?',
    options: ['The neutron', 'The Raman Effect', 'Cosmic rays', 'The positron'],
    correctIndex: 1,
    explanation:
      'Sir C. V. Raman discovered the inelastic scattering of light — the Raman Effect — in 1928, winning the 1930 Nobel Prize in Physics as the first Indian Nobel laureate in science. 28 February, the discovery day, is observed as National Science Day.',
  },
  {
    subjectSlug: 'physics',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'A light-year is a unit of?',
    options: ['Time', 'Distance', 'Speed', 'Light intensity'],
    correctIndex: 1,
    explanation:
      'A light-year is the distance light travels in a vacuum in one year — about 9.46 × 10¹² km — a unit of length, not time. The nearest star system, Alpha Centauri, lies about 4.3 light-years away.',
  },
  // ---------- chemistry ----------
  {
    subjectSlug: 'chemistry',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'What is the chemical symbol for gold?',
    options: ['Ag', 'Au', 'Gd', 'Go'],
    correctIndex: 1,
    explanation:
      'Gold’s symbol Au comes from its Latin name aurum. Silver is Ag (argentum), potassium K (kalium) and sodium Na (natrium) — the Latin-derived symbols exams love.',
  },
  {
    subjectSlug: 'chemistry',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'At 25 °C, the pH of a neutral aqueous solution is?',
    options: ['0', '7', '10', '14'],
    correctIndex: 1,
    explanation:
      'At 25 °C pure water has equal hydrogen and hydroxide ion concentrations (10⁻⁷ M each), giving pH 7. Below 7 a solution is acidic, above 7 basic or alkaline; the scale commonly runs 0–14.',
  },
  {
    subjectSlug: 'chemistry',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'Which allotrope of carbon consists of a single layer of atoms arranged in a hexagonal lattice?',
    options: ['Graphite', 'Graphene', 'Fullerene', 'Diamond'],
    correctIndex: 1,
    explanation:
      'Graphene — a one-atom-thick sheet of carbon atoms in a honeycomb lattice — won the 2010 Nobel Prize in Physics for Andre Geim and Konstantin Novoselov. Graphite stacks such layers; fullerenes form closed cages; diamond is tetrahedral.',
  },
  // ---------- science-technology ----------
  {
    subjectSlug: 'science-technology',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'Chandrayaan-3 made India the first country to soft-land where?',
    options: ['In the Moon’s Sea of Tranquility', 'Near the Moon’s south pole', 'On the Moon’s far side', 'On an asteroid'],
    correctIndex: 1,
    explanation:
      'On 23 August 2023 the Vikram lander touched down near the lunar south pole — a first for any country — making India the fourth nation to soft-land on the Moon after the USSR, the USA and China. The site was named Shiv Shakti Point, and 23 August is now National Space Day.',
  },
  {
    subjectSlug: 'science-technology',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'Aryabhata, India’s first satellite, was launched in which year?',
    options: ['1969', '1975', '1980', '1984'],
    correctIndex: 1,
    explanation:
      'Aryabhata, named after the ancient mathematician-astronomer, was launched on 19 April 1975 aboard a Soviet rocket. 1980 brought Rohini (RS-1) — the first satellite orbited by India’s own SLV-3 — and 1984 Rakesh Sharma’s flight to the Salyut 7 station.',
  },
  {
    subjectSlug: 'science-technology',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The May 1998 nuclear tests that made India a nuclear-weapon state were code-named?',
    options: ['Operation Smiling Buddha', 'Operation Shakti', 'Operation Meghdoot', 'Operation Vijay'],
    correctIndex: 1,
    explanation:
      'Pokhran-II — Operation Shakti, 11 and 13 May 1998 — followed the 1974 “Smiling Buddha” peaceful nuclear experiment. Operation Meghdoot secured Siachen in 1984, and Operation Vijay names the 1999 Kargil conflict (and the 1961 Goa liberation).',
  },
  {
    subjectSlug: 'science-technology',
    languageCode: 'hi',
    difficulty: 'BASIC',
    questionText: 'भारत का पहला उपग्रह (satellite) कौन-सा था?',
    options: ['आर्यभट्ट', 'भास्कर', 'रोहिणी', 'इनसैट-1ए'],
    correctIndex: 0,
    explanation:
      'भारत का पहला उपग्रह आर्यभट्ट था, जिसका प्रक्षेपण 19 अप्रैल 1975 को हुआ था। इसका नाम प्राचीन भारतीय गणितज्ञ आर्यभट्ट के नाम पर रखा गया।',
  },
  {
    subjectSlug: 'science-technology',
    languageCode: 'hi',
    difficulty: 'INTERMEDIATE',
    questionText: "'मिसाइल मैन ऑफ इंडिया' के नाम से किस वैज्ञानिक को जाना जाता है?",
    options: ['डॉ. होमी भाभा', 'डॉ. ए. पी. जे. अब्दुल कलाम', 'डॉ. विक्रम साराभाई', 'डॉ. सतीश धवन'],
    correctIndex: 1,
    explanation:
      'मिसाइल कार्यक्रम में योगदान के लिए डॉ. ए. पी. जे. अब्दुल कलाम को ‘मिसाइल मैन ऑफ इंडिया’ कहा जाता है। वे भारत के 11वें राष्ट्रपति (2002–2007) भी रहे। (डॉ. भाभा परमाणु कार्यक्रम और डॉ. साराभाई अंतरिक्ष कार्यक्रम से जुड़े हैं।)',
  },
  // ---------- computer-it ----------
  {
    subjectSlug: 'computer-it',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ibps-clerk',
    questionText: 'In computing, what does “CPU” stand for?',
    options: ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Control Processing Unit'],
    correctIndex: 0,
    explanation:
      'The central processing unit — the arithmetic-logic unit plus the control unit — executes a program’s instructions; it is the computer’s brain. RAM feeds it data, and storage persists it.',
  },
  {
    subjectSlug: 'computer-it',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'Who is regarded as the “father of the computer”?',
    options: ['Alan Turing', 'Charles Babbage', 'John von Neumann', 'Tim Berners-Lee'],
    correctIndex: 1,
    explanation:
      'Charles Babbage designed the Analytical Engine, the concept of the first general-purpose computing machine, in the 1830s; Ada Lovelace wrote what is regarded as the first algorithm for it. Turing founded computing theory; Tim Berners-Lee invented the Web.',
  },
  {
    subjectSlug: 'computer-it',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'ENIAC, one of the first general-purpose electronic computers, was completed in which decade?',
    options: ['1930s', '1940s', '1950s', '1960s'],
    correctIndex: 1,
    explanation:
      'ENIAC (Electronic Numerical Integrator and Computer), completed in 1945 at the University of Pennsylvania, used roughly 17,468 vacuum tubes — the first-generation technology. Transistors define the second generation, integrated circuits the third and microprocessors the fourth.',
  },
  // ---------- sports ----------
  {
    subjectSlug: 'sports',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'How many players of one team are on the field in a standard cricket match?',
    options: ['Nine', 'Ten', 'Eleven', 'Twelve'],
    correctIndex: 2,
    explanation:
      'A cricket team fields eleven players — the number fixed by the Laws of the Cricket. The batting side sends its eleven in pairs, one at each end; injuries may reduce the fielding side but the nominal strength is always eleven.',
  },
  {
    subjectSlug: 'sports',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'Which country hosted the 2016 Summer Olympic Games?',
    options: ['China', 'Brazil', 'Japan', 'Russia'],
    correctIndex: 1,
    explanation:
      'Rio de Janeiro hosted the 2016 Games — the first Olympics in South America. Beijing 2008 preceded them and Tokyo 2020 (held in 2021) followed; Russia hosted the 2014 Winter Games at Sochi.',
  },
  {
    subjectSlug: 'sports',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'Sachin Tendulkar scored his 100th international century (March 2012) against which team?',
    options: ['Pakistan', 'Sri Lanka', 'Bangladesh', 'Australia'],
    correctIndex: 2,
    explanation:
      'Tendulkar’s 100th international century came in the Asia Cup against Bangladesh at Mirpur on 16 March 2012 — his 51st in Tests and 49th in ODIs. He retired the next year with exactly 100 international hundreds.',
  },
  // ---------- art-culture ----------
  {
    subjectSlug: 'art-culture',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'Kathakali, the classical dance-drama with elaborate costumes and green-painted faces, originated in which state?',
    options: ['Kerala', 'Karnataka', 'Tamil Nadu', 'Odisha'],
    correctIndex: 0,
    explanation:
      'Kathakali is Kerala’s dance-drama, rooted in temple theatre, its green (pacha) makeup denoting noble characters. Kerala also gave Mohiniyattam; Karnataka yields Yakshagana, Tamil Nadu Bharatanatyam and Odisha Odissi.',
  },
  {
    subjectSlug: 'art-culture',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'The Ajanta Caves, famous for their Buddhist paintings, are located in which state?',
    options: ['Madhya Pradesh', 'Maharashtra', 'Karnataka', 'Andhra Pradesh'],
    correctIndex: 1,
    explanation:
      'The Ajanta caves (2nd century BCE to about 480 CE), with their celebrated Jataka murals, lie near Aurangabad in Maharashtra — as do the Ellora caves. Madhya Pradesh hosts Sanchi and Bhimbetka; Badami is in Karnataka.',
  },
  {
    subjectSlug: 'art-culture',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Natya Shastra, the foundational treatise of Indian dramaturgy, is ascribed to?',
    options: ['Bharata', 'Panini', 'Kalidasa', 'Valmiki'],
    correctIndex: 0,
    explanation:
      'The Natya Shastra, attributed to the sage Bharata (dated broadly c. 200 BCE–200 CE), is called the “fifth Veda” of drama, dance and music — it codifies rasa theory. Panini systematised Sanskrit grammar, and Kalidasa wrote classical drama and poetry.',
  },
  // ---------- books-authors ----------
  {
    subjectSlug: 'books-authors',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'The song “Vande Mataram”, India’s national song, was written by?',
    options: ['Rabindranath Tagore', 'Bankim Chandra Chatterjee', 'Sarojini Naidu', 'Munshi Premchand'],
    correctIndex: 1,
    explanation:
      'Bankim Chandra Chatterjee composed Vande Mataram, which appears in his 1882 novel Anandamath. Tagore wrote the national anthem, Jana Gana Mana — the deliberate confusion pair of this question.',
  },
  {
    subjectSlug: 'books-authors',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: '“The Discovery of India” was written by?',
    options: ['Mahatma Gandhi', 'Jawaharlal Nehru', 'Rabindranath Tagore', 'Maulana Abul Kalam Azad'],
    correctIndex: 1,
    explanation:
      'Nehru wrote The Discovery of India (1944–46) while imprisoned in Ahmednagar Fort. Gandhi’s My Experiments with Truth and Azad’s India Wins Freedom are the companion exam titles.',
  },
  {
    subjectSlug: 'books-authors',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: '“Gitanjali”, the poetry collection behind a Nobel Prize in Literature, was composed by?',
    options: ['Sarojini Naidu', 'Rabindranath Tagore', 'Sri Aurobindo', 'Muhammad Iqbal'],
    correctIndex: 1,
    explanation:
      'Tagore’s Gitanjali (Song Offerings) won the 1913 Nobel Prize in Literature, making him the first non-European laureate. He also wrote the national anthems of both India and Bangladesh.',
  },
  // ---------- awards-honours ----------
  {
    subjectSlug: 'awards-honours',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'Which is India’s highest civilian award?',
    options: ['Padma Vibhushan', 'Bharat Ratna', 'Param Vir Chakra', 'Padma Bhushan'],
    correctIndex: 1,
    explanation:
      'The Bharat Ratna (instituted 1954) is India’s highest civilian honour, for exceptional service of the highest order in any field of human endeavour. The Param Vir Chakra is the highest wartime gallantry award — the pair exams love to swap.',
  },
  {
    subjectSlug: 'awards-honours',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'The Nobel Peace Prize is awarded in which city?',
    options: ['Stockholm', 'Oslo', 'Geneva', 'The Hague'],
    correctIndex: 1,
    explanation:
      'All Nobel Prizes are presented in Stockholm under Alfred Nobel’s will — except the Peace Prize, awarded in Oslo, Norway, per Nobel’s own specification when Norway and Sweden were still in union. The laureates are announced each October.',
  },
  {
    subjectSlug: 'awards-honours',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'India’s highest wartime gallantry award is the?',
    options: ['Ashoka Chakra', 'Param Vir Chakra', 'Maha Vir Chakra', 'Vir Chakra'],
    correctIndex: 1,
    explanation:
      'The Param Vir Chakra, instituted in 1950, is India’s highest wartime gallantry award; its first recipient was Major Somnath Sharma (1947, posthumous) and Captain Vikram Batra earned it in the Kargil conflict. The Ashoka Chakra is its peacetime equivalent, with the Maha Vir Chakra and Vir Chakra ranking second and third in wartime.',
  },
  // ---------- schemes ----------
  {
    subjectSlug: 'schemes',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'MGNREGA guarantees how many days of wage employment per rural household in a financial year?',
    options: ['60 days', '90 days', '100 days', '150 days'],
    correctIndex: 2,
    explanation:
      'The Mahatma Gandhi National Rural Employment Guarantee Act (2005) guarantees 100 days of unskilled wage employment per rural household per financial year — a legal right, unlike earlier employment programmes.',
  },
  {
    subjectSlug: 'schemes',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'Ayushman Bharat PM-JAY provides health cover of up to how much per family per year?',
    options: ['₹1 lakh', '₹2 lakh', '₹5 lakh', '₹10 lakh'],
    correctIndex: 2,
    explanation:
      'Launched on 23 September 2018, PM-JAY offers cashless secondary and tertiary hospitalisation cover of ₹5 lakh per family per year — with no cap on family size or age — for poor and vulnerable families identified through the Socio-Economic Caste Census.',
  },
  {
    subjectSlug: 'schemes',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Pradhan Mantri Jan Dhan Yojana was launched in which year?',
    options: ['2012', '2014', '2016', '2018'],
    correctIndex: 1,
    explanation:
      'PMJDY was launched on 28 August 2014 to give every household access to a bank account, with a RuPay debit card and add-on accident cover. (2016 is demonetisation; 2018 is PM-JAY.)',
  },
  // ---------- defence-security ----------
  {
    subjectSlug: 'defence-security',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-cds',
    questionText: 'Who is the Supreme Commander of India’s Armed Forces?',
    options: ['The Prime Minister', 'The President', 'The Defence Minister', 'The Chief of Defence Staff'],
    correctIndex: 1,
    explanation:
      'Article 53(2) vests the supreme command of the armed forces in the President, exercised through the government. The Chief of Defence Staff (created 2019) is the senior-most military adviser, not the commander.',
  },
  {
    subjectSlug: 'defence-security',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'INS Arihant, India’s first nuclear-powered ballistic missile submarine, was commissioned in?',
    options: ['2013', '2016', '2018', '2020'],
    correctIndex: 1,
    explanation:
      'INS Arihant was commissioned in 2016, completing India’s nuclear triad — the ability to deliver nuclear weapons from land, aircraft and sea. Its successor INS Arighaat joined the fleet in 2024.',
  },
  {
    subjectSlug: 'defence-security',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'In modern exam usage, Operation Vijay refers to?',
    options: ['The 1971 war operations', 'The Siachen Glacier operation', 'The 1999 Kargil conflict', 'The 1962 war'],
    correctIndex: 2,
    explanation:
      'Operation Vijay (May–July 1999) recaptured the Kargil heights infiltrated from Pakistan; 26 July is observed as Kargil Vijay Diwas. Operation Meghdoot took Siachen in 1984 — and note the 1961 liberation of Goa also carried the name Operation Vijay.',
  },
  // ---------- international-relations ----------
  {
    subjectSlug: 'international-relations',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'The headquarters of the United Nations is located in?',
    options: ['Geneva', 'New York', 'Paris', 'Vienna'],
    correctIndex: 1,
    explanation:
      'The UN headquarters stands in New York City, on international territory since 1952. Geneva hosts the UN Office at Geneva (the Palais des Nations), Paris UNESCO and Vienna the IAEA and UNODC.',
  },
  {
    subjectSlug: 'international-relations',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'SAARC, the South Asian Association for Regional Cooperation, was established in?',
    options: ['1975', '1985', '1995', '2005'],
    correctIndex: 1,
    explanation:
      'SAARC was founded at the first summit in Dhaka in December 1985 by seven members — India, Pakistan, Bangladesh, Sri Lanka, Nepal, Bhutan and the Maldives; Afghanistan joined in 2007. Its secretariat is in Kathmandu.',
  },
  {
    subjectSlug: 'international-relations',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Warsaw Pact of 1955 was a military alliance led by?',
    options: ['The United States', 'The Soviet Union', 'China', 'France'],
    correctIndex: 1,
    explanation:
      'The Warsaw Treaty Organisation — the Soviet Union and its East European allies, formed in 1955 in response to West Germany’s entry into NATO — dissolved in 1991. NATO (1949) was its Western counterpart.',
  },
  // ---------- static-gk ----------
  {
    subjectSlug: 'static-gk',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'ssc-cgl',
    questionText: 'Who was the first President of India?',
    options: ['Dr Rajendra Prasad', 'Dr S. Radhakrishnan', 'Dr B. R. Ambedkar', 'Jawaharlal Nehru'],
    correctIndex: 0,
    explanation:
      'Dr Rajendra Prasad served as the first President (1950–62) and remains the only one re-elected — in 1952, 1957 and 1962. Dr Radhakrishnan succeeded him in 1962; Nehru was the first Prime Minister.',
  },
  {
    subjectSlug: 'static-gk',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'After the reorganisations of 2014 and 2019, how many states does India have?',
    options: ['27', '28', '29', '30'],
    correctIndex: 1,
    explanation:
      'India has 28 states and 8 union territories: Telangana became the 28th state in 2014, and in 2019 Jammu & Kashmir was reorganised into two union territories. “29 states” was correct only before 31 October 2019 — the standard trap.',
  },
  {
    subjectSlug: 'static-gk',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The headquarters of UNESCO is located in?',
    options: ['New York', 'Geneva', 'Paris', 'Rome'],
    correctIndex: 2,
    explanation:
      'UNESCO — the United Nations Educational, Scientific and Cultural Organization — is headquartered in Paris and known for the World Heritage Sites list. New York hosts the UN itself, Geneva the WHO and ILO, and Rome the FAO.',
  },
  {
    subjectSlug: 'static-gk',
    languageCode: 'hi',
    difficulty: 'BASIC',
    questionText: 'भारत के पहले राष्ट्रपति कौन थे?',
    options: ['डॉ. राजेंद्र प्रसाद', 'डॉ. सर्वपल्ली राधाकृष्णन', 'पं. जवाहरलाल नेहरू', 'डॉ. बी. आर. अंबेडकर'],
    correctIndex: 0,
    explanation:
      'डॉ. राजेंद्र प्रसाद भारत के पहले राष्ट्रपति (1950–62) थे। वे एकमात्र राष्ट्रपति हैं जिन्हें तीन बार (1952, 1957, 1962) चुना गया। डॉ. राधाकृष्णन 1962 में उनके उत्तराधिकारी बने।',
  },
  // ---------- agriculture ----------
  {
    subjectSlug: 'agriculture',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'uppsc-pcs',
    questionText: 'Who is regarded as the architect of India’s Green Revolution?',
    options: ['Norman Borlaug', 'M. S. Swaminathan', 'Verghese Kurien', 'C. Subramaniam'],
    correctIndex: 1,
    explanation:
      'Dr M. S. Swaminathan led the scientific programme that combined Borlaug’s high-yielding dwarf wheat varieties with irrigation, fertiliser and procurement policy — making India self-sufficient in foodgrains. C. Subramaniam drove the policy as food minister; Kurien led the White (milk) Revolution.',
  },
  {
    subjectSlug: 'agriculture',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: '“Operation Flood” is associated with the production of?',
    options: ['Milk', 'Fish', 'Oilseeds', 'Foodgrains'],
    correctIndex: 0,
    explanation:
      'Operation Flood (1970–96), led by Verghese Kurien at the National Dairy Development Board, built the Amul-pattern cooperative network and made India the world’s largest milk producer — the White Revolution. (The Yellow Revolution is oilseeds; the Blue Revolution, fisheries.)',
  },
  {
    subjectSlug: 'agriculture',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Minimum Support Price (MSP) for crops is announced by the Government of India on the recommendation of?',
    options: ['NITI Aayog', 'The Commission for Agricultural Costs and Prices (CACP)', 'The Reserve Bank of India', 'The Food Corporation of India'],
    correctIndex: 1,
    explanation:
      'The CACP recommends MSPs ahead of each kharif and rabi season, and the Union Cabinet announces them; the Food Corporation of India then procures at those prices. Recommendation, decision and implementation are three different bodies — the distinction exams test.',
  },
  // ---------- disaster-management ----------
  {
    subjectSlug: 'disaster-management',
    languageCode: 'en',
    difficulty: 'BASIC',
    examSlug: 'upsc-civil-services',
    questionText: 'The National Disaster Management Authority (NDMA) is chaired by?',
    options: ['The President', 'The Prime Minister', 'The Home Minister', 'The Cabinet Secretary'],
    correctIndex: 1,
    explanation:
      'Under the Disaster Management Act, 2005, the NDMA is chaired by the Prime Minister (the state authorities by chief ministers); its National Executive Committee is headed by the Cabinet Secretary, and the National Disaster Response Force (2006) carries out rescue and relief.',
  },
  {
    subjectSlug: 'disaster-management',
    languageCode: 'en',
    difficulty: 'INTERMEDIATE',
    questionText: 'The Sendai Framework (2015) is a global agreement about?',
    options: ['Climate change mitigation', 'Disaster risk reduction', 'Biodiversity conservation', 'Ozone protection'],
    correctIndex: 1,
    explanation:
      'The Sendai Framework for Disaster Risk Reduction 2015–2030, adopted at Sendai in Japan (March 2015), succeeded the Hyogo Framework. Climate is the Paris Agreement (2015); biodiversity and ozone follow their own conventions.',
  },
  {
    subjectSlug: 'disaster-management',
    languageCode: 'en',
    difficulty: 'ADVANCED',
    questionText: 'The Indian Ocean Tsunami Warning System was established following the tsunami of?',
    options: ['26 December 2004', '26 January 2001', '11 May 1998', '12 June 2013'],
    correctIndex: 0,
    explanation:
      'The Sumatra–Andaman earthquake and tsunami of 26 December 2004 claimed more than two lakh lives around the Indian Ocean, including thousands in India, and led to the UNESCO-coordinated Indian Ocean Tsunami Warning System (operational from 2006), with Hyderabad’s INCOIS a regional service provider.',
  },
]

// ---------- Step 3: the 30 explanatory QnAs (English) ----------

interface QnaSeed {
  subjectSlug: string
  questionText: string
  answerBody: string
}

const QNAS: QnaSeed[] = [
  // polity-governance (2)
  {
    subjectSlug: 'polity-governance',
    questionText: 'What are the Fundamental Duties and where are they listed in the Constitution?',
    answerBody:
      'The Fundamental Duties are the obligations of every citizen of India, listed in Part IVA, Article 51A. They were added by the 42nd Constitutional Amendment (1976) on the recommendation of the Swaran Singh Committee and originally numbered ten; the 86th Amendment (2002) added an eleventh — the duty of parents and guardians to provide education opportunities to children aged six to fourteen. Unlike Fundamental Rights they are not directly enforceable by the courts, but they guide the interpretation of laws and the making of new ones.',
  },
  {
    subjectSlug: 'polity-governance',
    questionText: 'What is the difference between a National Emergency and President’s Rule?',
    answerBody:
      'A National Emergency (Article 352) is proclaimed for war, external aggression or armed rebellion and may cover the whole of India or a part of it; it has been proclaimed three times — 1962, 1971 and 1975. President\'s Rule (Article 356) is imposed in a state when its constitutional machinery fails: the President assumes the functions of the state government, normally on the Governor\'s report. Both must be approved by Parliament within a month by a special majority, but they answer different failures — a security crisis versus a breakdown of state governance.',
  },
  // history (2)
  {
    subjectSlug: 'history',
    questionText: 'What was the significance of the Dandi March of 1930?',
    answerBody:
      'The Dandi March (12 March to 6 April 1930) was Gandhi\'s 385-kilometre walk from Sabarmati Ashram to the coastal village of Dandi with 78 followers. By picking up a handful of natural salt, Gandhi broke the British salt law, launching the Civil Disobedience Movement and showing that a tax on an everyday necessity could mobilise the masses against colonial rule. The march made the freedom struggle a genuinely mass movement and is the standard exam anchor for 1930.',
  },
  {
    subjectSlug: 'history',
    questionText: 'Why is the Battle of Buxar (1764) considered a turning point for British rule in India?',
    answerBody:
      'At Buxar (22 October 1764) the East India Company under Hector Munro defeated the combined armies of Mir Qasim of Bengal, Shuja-ud-Daula of Awadh and the Mughal Emperor Shah Alam II. Following Plassey (1757), the victory completed the Company\'s military dominance over eastern India. The Treaty of Allahabad (1765) then granted the Company the diwani — the revenue rights of Bengal, Bihar and Orissa — giving it the financial and administrative foundation on which its empire was built.',
  },
  // geography (2)
  {
    subjectSlug: 'geography',
    questionText: 'What are the main physiographic divisions of India?',
    answerBody:
      'India is conventionally divided into six physiographic divisions: the Himalayan mountains (the northern barrier), the Northern Plains (the Indus–Ganga–Brahmaputra alluvium), the Peninsular Plateau (the oldest and most stable landmass of ancient rocks), the Indian Desert (the Thar), the Coastal Plains (western and eastern) and the Islands — the Andaman and Nicobar Islands in the Bay of Bengal and Lakshadweep in the Arabian Sea. This six-fold scheme is the NCERT standard that most competitive exams follow.',
  },
  {
    subjectSlug: 'geography',
    questionText: 'Why does the southwest monsoon matter so much to Indian agriculture?',
    answerBody:
      'The southwest monsoon (June to September) delivers about three-quarters of India\'s annual rainfall, and agriculture — still the country\'s largest employer — depends on it both for kharif sowing and for the reservoir storage that carries into the rabi season. A deficient or delayed monsoon brings drought, falling rural incomes and food inflation, while an excess causes floods. That is why the India Meteorological Department\'s forecasts and the El Niño–Southern Oscillation patterns are recurring exam themes.',
  },
  // economy (2)
  {
    subjectSlug: 'economy',
    questionText: 'What is the Monetary Policy Committee (MPC) of the RBI?',
    answerBody:
      'The MPC is the six-member committee that sets India\'s policy interest rate: three members are nominated by the central government and three come from the RBI, including the Governor, who chairs it and holds a casting vote. Constituted in 2016 under the amended RBI Act, it is charged with holding Consumer Price Index inflation at 4 per cent within a 2–6 per cent tolerance band, meeting roughly every two months to review the stance. Before it, the Governor alone decided the policy rate.',
  },
  {
    subjectSlug: 'economy',
    questionText: 'What is GST and why was it introduced?',
    answerBody:
      'The Goods and Services Tax, launched on 1 July 2017 through the 101st Constitutional Amendment, replaced a web of central and state indirect taxes — excise duty, service tax, VAT, octroi and more — with a single destination-based tax levied at multiple slabs. It is administered through the GST Council, a constitutional body chaired by the Union Finance Minister with the state finance ministers as members, an embodiment of cooperative federalism. The aims were one national market, simpler compliance and the removal of the cascading of taxes.',
  },
  // science-technology (2)
  {
    subjectSlug: 'science-technology',
    questionText: 'What made Chandrayaan-3 historically significant?',
    answerBody:
      'Chandrayaan-3 soft-landed its Vikram lander near the Moon\'s south pole on 23 August 2023, making India the fourth country to land on the Moon — after the USSR, the USA and China — and the first ever in the southern polar region, where permanently shadowed craters may hold water ice. The Pragyan rover then conducted in-situ experiments on the lunar surface. The landing site was named Shiv Shakti Point, and 23 August is now observed as National Space Day.',
  },
  {
    subjectSlug: 'science-technology',
    questionText: 'What is the difference between ISRO’s PSLV and GSLV launch vehicles?',
    answerBody:
      'The Polar Satellite Launch Vehicle (PSLV), first flown successfully in 1994, is ISRO\'s four-stage workhorse for remote-sensing satellites and small payloads into polar and Sun-synchronous orbits — including the record launch of 104 satellites on a single flight in 2017. The Geosynchronous Satellite Launch Vehicle (GSLV) is the larger vehicle with a cryogenic upper stage, built to place communication satellites into geostationary transfer orbits; the LVM3 heavy-lift class launched both Chandrayaan-2 (2019) and Chandrayaan-3 (2023).',
  },
  // static-gk (2)
  {
    subjectSlug: 'static-gk',
    questionText: 'Who was the first woman President and the first woman Prime Minister of India?',
    answerBody:
      'Pratibha Patil became India\'s first woman President in 2007 — the twelfth President, serving until 2012. Indira Gandhi became the first — and so far only — woman Prime Minister in 1966 and remains the second-longest-serving Prime Minister after Jawaharlal Nehru. Other firsts worth pairing: Sarojini Naidu was the first Indian woman president of the Congress (1925) and the first woman Governor of a state.',
  },
  {
    subjectSlug: 'static-gk',
    questionText: 'What are the national symbols of India?',
    answerBody:
      'India\'s national symbols include the Bengal tiger (national animal), the Indian peacock (national bird), the lotus (national flower), the banyan (national tree) and the mango (national fruit). The national anthem is Rabindranath Tagore\'s Jana Gana Mana (adopted 24 January 1950) and the national song is Bankim Chandra Chatterjee\'s Vande Mataram; the state emblem is the Lion Capital of Sarnath and the national calendar follows the Saka era. A favourite trick fact: the government has clarified that India has no officially declared national game.',
  },
  // environment-ecology (2)
  {
    subjectSlug: 'environment-ecology',
    questionText: 'What are biodiversity hotspots and which ones lie in India?',
    answerBody:
      'A biodiversity hotspot is a region with exceptionally high species endemism — especially of plants — that has lost at least 70 per cent of its original natural vegetation; the concept was pioneered by the ecologist Norman Myers. Of the 36 hotspots recognised worldwide, four lie (wholly or partly) in India: the Himalaya, Indo-Burma, the Western Ghats–Sri Lanka region and Sundaland (the Nicobar Islands). Together with its species richness, they make India one of the world\'s seventeen megadiverse countries.',
  },
  {
    subjectSlug: 'environment-ecology',
    questionText: 'What is the difference between a national park and a wildlife sanctuary?',
    answerBody:
      'Both are protected areas under the Wildlife (Protection) Act, 1972, but a national park enjoys the highest statutory protection: no rights such as grazing are allowed inside (except where a settlement specifically provides), and its boundaries can be altered only by a resolution of the state legislature. In a wildlife sanctuary, limited human activities and rights may be permitted, and boundaries can be changed by notification. India\'s first national park was Hailey National Park (1936), renamed Jim Corbett National Park.',
  },
  // biology (2)
  {
    subjectSlug: 'biology',
    questionText: 'What is photosynthesis and where in the leaf does it occur?',
    answerBody:
      'Photosynthesis is the process by which green plants use light energy captured by chlorophyll to convert carbon dioxide and water into glucose, releasing oxygen as a by-product (6CO₂ + 6H₂O + light energy → C₆H₁₂O₆ + 6O₂). It occurs in the chloroplasts: the light reactions take place on the thylakoid membranes, and the Calvin cycle that fixes carbon dioxide into sugar runs in the surrounding stroma. The process underpins nearly every food chain and supplies the oxygen we breathe.',
  },
  {
    subjectSlug: 'biology',
    questionText: 'Why is the mitochondrion called the powerhouse of the cell?',
    answerBody:
      'Mitochondria carry out aerobic respiration, oxidising the products of digestion to generate ATP — the energy currency that powers everything from muscle contraction to nerve signalling. They are semi-autonomous organelles with their own DNA (inherited maternally) and their own ribosomes, which is the basis of the endosymbiotic theory that they descend from once free-living bacteria. Cells with high energy demand, such as muscle and liver cells, contain large numbers of mitochondria.',
  },
  // sports (2)
  {
    subjectSlug: 'sports',
    questionText: 'When did India first participate in the Olympic Games?',
    answerBody:
      'India first appeared at the Paris Olympics of 1900, when Norman Pritchard — credited to India by the IOC — won two silver medals in athletics (the 200 metres and the 200 metres hurdles). The first team delegation followed at Antwerp in 1920, and India\'s first gold came with the field hockey team at Amsterdam in 1928, opening the run of six consecutive Olympic hockey titles through 1956.',
  },
  {
    subjectSlug: 'sports',
    questionText: 'Which are India’s major national sports awards?',
    answerBody:
      'The Major Dhyan Chand Khel Ratna — renamed from the Rajiv Gandhi Khel Ratna in 2021 — is India\'s highest sporting honour, awarded for the most spectacular and outstanding performance over a period of four years. The Arjuna Award recognises consistent outstanding performance; the Dronacharya Award honours coaches; and the Rashtriya Khel Protsahan Puraskar recognises institutions and corporates that promote sport. They are conferred annually by the Ministry of Youth Affairs and Sports.',
  },
  // computer-it (2)
  {
    subjectSlug: 'computer-it',
    questionText: 'What are the main components of a computer system?',
    answerBody:
      'A computer system is built from hardware and software. The hardware is the CPU (the arithmetic-logic unit and control unit that execute instructions), the memory — volatile RAM for working data and non-volatile storage such as SSDs for persistence — and the input and output devices like the keyboard, screen and network card. The software layer comprises the operating system (Windows, Linux, Android, macOS) that manages the hardware and the application programs that do the user\'s work; data flows input → processing → output, with storage retaining both programs and data.',
  },
  {
    subjectSlug: 'computer-it',
    questionText: 'What is the difference between the internet and the World Wide Web?',
    answerBody:
      'The internet is the global network of interconnected computers that communicate using the TCP/IP protocol family; it carries many services — email (SMTP), file transfer (FTP), remote access and more. The World Wide Web is just one of those services: a system of interlinked hypertext documents accessed through browsers over HTTP(S), invented by Tim Berners-Lee at CERN in 1989–91. In short, the Web runs over the internet, but the internet is much more than the Web.',
  },
  // physics (1)
  {
    subjectSlug: 'physics',
    questionText: 'What are Newton’s three laws of motion?',
    answerBody:
      'The first law — the law of inertia — states that a body remains at rest or in uniform motion in a straight line unless acted upon by an external force. The second law gives the quantitative rule: the force on a body equals its mass times its acceleration (F = ma). The third law states that for every action there is an equal and opposite reaction. Together they underpin classical mechanics and countless exam illustrations, from passengers lurching when a bus brakes to how a rocket propels itself.',
  },
  // chemistry (1)
  {
    subjectSlug: 'chemistry',
    questionText: 'How is the modern periodic table organised?',
    answerBody:
      'The modern periodic table arranges the 118 known elements in order of increasing atomic number — the basis Henry Moseley established experimentally in 1913, correcting Mendeleev\'s 1869 arrangement by atomic mass. Horizontal rows are periods (seven of them); vertical columns are groups whose members share valence electron configurations and therefore chemical behaviour — the alkali metals (group 1), halogens (group 17) and noble gases (group 18) being the classic families. The s, p, d and f blocks classify elements by the type of orbital being filled.',
  },
  // art-culture (1)
  {
    subjectSlug: 'art-culture',
    questionText: 'Which are the eight classical dances of India?',
    answerBody:
      'The Sangeet Natak Akademi recognises eight classical dance forms: Bharatanatyam (Tamil Nadu), Kathak (the storytelling tradition of north India), Kathakali and Mohiniyattam (Kerala), Kuchipudi (Andhra Pradesh), Manipuri (Manipur), Odissi (Odisha) and Sattriya (Assam, recognised in 2000). All are rooted in the grammar of Bharata\'s Natya Shastra, yet each developed its own regional vocabulary of technique, costume and music — the state-form pairing is the classic exam question.',
  },
  // books-authors (1)
  {
    subjectSlug: 'books-authors',
    questionText: 'Why is Rabindranath Tagore’s Nobel Prize significant?',
    answerBody:
      'Tagore won the 1913 Nobel Prize in Literature, awarded primarily for Gitanjali (Song Offerings) — making him the first non-European to receive a Nobel Prize. He wrote the national anthems of two nations, India\'s Jana Gana Mana and Bangladesh\'s Amar Shonar Bangla, and reshaped Bengali poetry, fiction and music (Rabindra Sangeet). At Santiniketan he founded the school that grew into Visva-Bharati University.',
  },
  // awards-honours (1)
  {
    subjectSlug: 'awards-honours',
    questionText: 'What is the hierarchy of India’s civilian awards?',
    answerBody:
      'The Bharat Ratna, instituted in 1954, is the highest civilian award, given for exceptional service of the highest order in any field of human endeavour — without distinction of race, occupation, position or sex. Below it stand, in descending order, the Padma Vibhushan (exceptional and distinguished service), the Padma Bhushan (distinguished service of a high order) and the Padma Shri (distinguished service). The Padma awards are announced annually on the eve of Republic Day, and since 2017 any citizen can nominate candidates online.',
  },
  // schemes (1)
  {
    subjectSlug: 'schemes',
    questionText: 'What is MGNREGA and what does it guarantee?',
    answerBody:
      'The Mahatma Gandhi National Rural Employment Guarantee Act (2005) is the world\'s largest employment-guarantee programme. It gives every rural household whose adult members volunteer for unskilled manual work a legal right to 100 days of wage employment in a financial year. If work is not provided within fifteen days of applying, the household becomes entitled to an unemployment allowance; wages must be paid within fifteen days of the work, and at least one-third of the beneficiaries are to be women.',
  },
  // defence-security (1)
  {
    subjectSlug: 'defence-security',
    questionText: 'What is India’s nuclear doctrine?',
    answerBody:
      'After the May 1998 Pokhran-II tests (Operation Shakti), India declared a doctrine of credible minimum deterrence with a no-first-use commitment: India will not be the first to use nuclear weapons, but any first strike against it would invite massive retaliation. The arsenal stays under civilian control — the Political Council of the National Command Authority authorises any use — and India maintains a triad of delivery systems (aircraft, land-based missiles and submarine-launched missiles) to guarantee a survivable second-strike capability.',
  },
  // international-relations (1)
  {
    subjectSlug: 'international-relations',
    questionText: 'What are the Panchsheel principles?',
    answerBody:
      'The Five Principles of Peaceful Coexistence — mutual respect for each other\'s territorial integrity and sovereignty, mutual non-aggression, non-interference in each other\'s internal affairs, equality and mutual benefit, and peaceful coexistence — were enunciated in the 1954 agreement between India and China on trade and intercourse with Tibet. They became the foundation of the Bandung spirit (1955) and of the Non-Aligned Movement\'s approach to world affairs, and they remain the classic international-relations answer for India\'s foreign-policy principles.',
  },
  // agriculture (1)
  {
    subjectSlug: 'agriculture',
    questionText: 'What was the Green Revolution and what did it achieve?',
    answerBody:
      'The Green Revolution, launched in the mid-1960s with Lal Bahadur Shastri as Prime Minister, C. Subramaniam as food minister and M. S. Swaminathan leading the science, combined high-yielding dwarf varieties of wheat and rice (from Norman Borlaug\'s CIMMYT and from IRRI) with expanded irrigation, fertiliser use and assured procurement at minimum support prices. Foodgrain output — wheat above all in Punjab, Haryana and western Uttar Pradesh — rose sharply, ending India\'s dependence on PL-480 food imports by the mid-1970s. Its costs (regional concentration, falling water tables, soil health) are the standard discussion points at the mains level.',
  },
  // disaster-management (1)
  {
    subjectSlug: 'disaster-management',
    questionText: 'What is the institutional framework for disaster management in India?',
    answerBody:
      'The Disaster Management Act, 2005 created a three-tier structure: the National Disaster Management Authority (NDMA), chaired by the Prime Minister; the State Disaster Management Authorities, chaired by the respective chief ministers; and District Disaster Management Authorities. The National Executive Committee, headed by the Cabinet Secretary, coordinates between them, while the National Disaster Response Force (raised in 2006 from central armed police battalions) conducts rescue and relief operations. The National Institute of Disaster Management trains personnel, and the national policy follows the priorities of the Sendai Framework (2015–2030).',
  },
]

// ---------- Seed ----------

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

function serializeOptions(options: string[]): string {
  return JSON.stringify(options.map((text, index) => ({ key: OPTION_KEYS[index] ?? String(index), text })))
}

async function main() {
  // ---------- Resolutions (never hard-coded ids) ----------
  const languageRows = await prisma.language.findMany({ where: { code: { in: ['en', 'hi'] } } })
  const languageIdByCode = new Map(languageRows.map((row) => [row.code, row.id]))
  const enId = languageIdByCode.get('en')
  const hiId = languageIdByCode.get('hi')
  if (!enId || !hiId) throw new Error('Languages "en"/"hi" not found — run the base seed first')

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, email: true } })
  if (!admin) throw new Error('No ADMIN user found — run the base seed first')

  const subjectSlugs = [...new Set(UNITS.map((unit) => unit.subjectSlug))]
  const topicRows = await prisma.topic.findMany({
    where: { slug: { in: subjectSlugs } },
    select: { id: true, slug: true, type: true, status: true },
  })
  const topicIdBySlug = new Map(topicRows.map((row) => [row.slug, row.id]))
  for (const slug of subjectSlugs) {
    if (!topicIdBySlug.has(slug)) {
      throw new Error(`Subject topic "${slug}" not found — run site-s2-subjects-seed first`)
    }
  }

  // Exam anchors: exam slug → CURRENT version id ("2026 syllabus", verified).
  const examSlugs = [...new Set(QUESTIONS.filter((q) => q.examSlug).map((q) => q.examSlug!))]
  const examVersionIdBySlug = new Map<string, string>()
  for (const examSlug of examSlugs) {
    const exam = await prisma.exam.findUnique({
      where: { slug: examSlug },
      include: { versions: { select: { id: true, label: true } } },
    })
    if (!exam || exam.status !== 'ACTIVE') {
      console.warn(`  ! exam "${examSlug}" missing/inactive — its questions seed WITHOUT the anchor`)
      continue
    }
    const version = exam.versions.find((row) => row.label === EXAM_VERSION_LABEL)
    if (!version) {
      console.warn(`  ! exam "${examSlug}" has no "${EXAM_VERSION_LABEL}" version — questions seed WITHOUT the anchor`)
      continue
    }
    examVersionIdBySlug.set(examSlug, version.id)
  }

  // ---------- 1. The 20 overview units ----------
  console.log(`\n=== Step 1: overview knowledge units (${UNITS.length} subjects) ===`)
  let unitsCreated = 0
  let unitsTouched = 0
  for (const seed of UNITS) {
    const topicId = topicIdBySlug.get(seed.subjectSlug)!
    const slug = `${seed.subjectSlug}-overview`
    const existing = await prisma.knowledgeUnit.findUnique({ where: { slug } })
    await prisma.knowledgeUnit.upsert({
      where: { slug },
      // §36: the update arm re-asserts only the seed-owned content fields —
      // status/scope/type/topic of a live unit are never touched.
      update: {
        canonicalName: seed.canonicalName,
        canonicalSummary: seed.canonicalSummary,
        canonicalBody: seed.canonicalBody,
      },
      create: {
        slug,
        canonicalName: seed.canonicalName,
        canonicalSummary: seed.canonicalSummary,
        canonicalBody: seed.canonicalBody,
        type: 'CONCEPT',
        status: 'VERIFIED',
        difficulty: seed.difficulty,
        scope: 'GLOBAL',
        countryId: null,
        topicId,
        orderIndex: 0,
        createdById: admin.id,
      },
    })
    if (existing) {
      unitsTouched++
    } else {
      unitsCreated++
      console.log(`  + ${slug} — ${seed.canonicalName}`)
    }
  }
  console.log(`Units: ${unitsCreated} created, ${unitsTouched} re-asserted.`)

  // ---------- 2. The 70 practice MCQs ----------
  console.log(`\n=== Step 2: practice MCQs (${QUESTIONS.length}: ${QUESTIONS.filter((q) => q.languageCode === 'en').length} en + ${QUESTIONS.filter((q) => q.languageCode === 'hi').length} hi) ===`)
  let questionsCreated = 0
  let questionsSkipped = 0
  for (const seed of QUESTIONS) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: `${seed.subjectSlug}-overview` } })
    const languageId = seed.languageCode === 'hi' ? hiId : enId
    if (!unit || !languageId) {
      console.warn(`  ! unit/language missing for "${seed.subjectSlug}/${seed.languageCode}" — skipped`)
      continue
    }

    // Never overwrite live edits (§36) — identity is (unit, language, question).
    const existing = await prisma.question.findFirst({
      where: { knowledgeUnitId: unit.id, languageId, questionText: seed.questionText },
      select: { id: true },
    })
    if (existing) {
      questionsSkipped++
      continue
    }

    // The §6 optional exam anchor (authoring context, never identity).
    const examVersionId = seed.examSlug ? examVersionIdBySlug.get(seed.examSlug) ?? null : null

    // The publish transition (assessment question-service, publish arm):
    // create the row, snapshot revision 1, point the live pointer — the
    // public surface always serves the revision snapshot.
    const question = await prisma.question.create({
      data: {
        knowledgeUnitId: unit.id,
        examVersionId,
        languageId,
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
    })
    const revision = await prisma.questionRevision.create({
      data: {
        questionId: question.id,
        revisionNumber: 1,
        questionText: seed.questionText,
        optionsJson: serializeOptions(seed.options),
        correctAnswer: OPTION_KEYS[seed.correctIndex] ?? String(seed.correctIndex),
        explanation: seed.explanation,
        difficulty: seed.difficulty,
        changeSummary: 'SITE-S3 practice seed — initial publication',
        aiAssisted: false,
        publishedById: admin.id,
        publishedAt: new Date(),
      },
    })
    await prisma.question.update({
      where: { id: question.id },
      data: { publishedRevisionId: revision.id },
    })
    questionsCreated++
  }
  console.log(`Questions: ${questionsCreated} created, ${questionsSkipped} already present (kept).`)

  // ---------- 3. The 30 QnAs ----------
  console.log(`\n=== Step 3: explanatory QnAs (${QNAS.length}) ===`)
  let qnasCreated = 0
  let qnasSkipped = 0
  for (const seed of QNAS) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: `${seed.subjectSlug}-overview` } })
    if (!unit) {
      console.warn(`  ! unit missing for "${seed.subjectSlug}" — skipped`)
      continue
    }

    const existing = await prisma.qnA.findFirst({
      where: { knowledgeUnitId: unit.id, languageId: enId, questionText: seed.questionText },
      select: { id: true },
    })
    if (existing) {
      qnasSkipped++
      continue
    }

    const qna = await prisma.qnA.create({
      data: {
        knowledgeUnitId: unit.id,
        languageId: enId,
        status: 'PUBLISHED',
        questionText: seed.questionText,
        answerBody: seed.answerBody,
        aiAssisted: false,
        createdById: admin.id,
      },
    })
    const revision = await prisma.qnARevision.create({
      data: {
        qnaId: qna.id,
        revisionNumber: 1,
        questionText: seed.questionText,
        answerBody: seed.answerBody,
        changeSummary: 'SITE-S3 practice seed — initial publication',
        aiAssisted: false,
        publishedById: admin.id,
        publishedAt: new Date(),
      },
    })
    await prisma.qnA.update({
      where: { id: qna.id },
      data: { publishedRevisionId: revision.id },
    })
    qnasCreated++
  }
  console.log(`QnAs: ${qnasCreated} created, ${qnasSkipped} already present (kept).`)

  // ---------- Verification ----------
  console.log('\n=== Verification ===')

  const unitCount = await prisma.knowledgeUnit.count({
    where: { slug: { endsWith: '-overview' }, status: 'VERIFIED', scope: 'GLOBAL' },
  })
  console.log(`VERIFIED GLOBAL *-overview units: ${unitCount} (expected ${UNITS.length})`)

  const questionByLanguage = await prisma.question.groupBy({
    by: ['languageId'],
    where: { knowledgeUnit: { slug: { endsWith: '-overview' } } },
    _count: { _all: true },
  })
  for (const group of questionByLanguage) {
    const code = group.languageId === enId ? 'en' : group.languageId === hiId ? 'hi' : group.languageId
    console.log(`  questions on overview units, language=${code}: ${group._count._all}`)
  }

  const qnaTotal = await prisma.qnA.count({ where: { knowledgeUnit: { slug: { endsWith: '-overview' } } } })
  console.log(`  qnas on overview units [en]: ${qnaTotal}`)

  const perSubject = await prisma.knowledgeUnit.findMany({
    where: { slug: { endsWith: '-overview' } },
    select: {
      slug: true,
      _count: { select: { questions: { where: { status: 'PUBLISHED' } }, qnas: { where: { status: 'PUBLISHED' } } } },
    },
    orderBy: { slug: 'asc' },
  })
  console.log('\nPer subject (published MCQ / published QnA):')
  for (const unit of perSubject) {
    console.log(`  ${unit.slug.padEnd(30)} ${unit._count.questions} MCQ · ${unit._count.qnas} QnA`)
  }

  const problems: string[] = []
  if (unitCount !== UNITS.length) problems.push(`expected ${UNITS.length} overview units, found ${unitCount}`)
  const seededQuestionTotal = questionByLanguage.reduce((sum, g) => sum + g._count._all, 0)
  const expectedQuestionTotal = questionsCreated + questionsSkipped
  if (seededQuestionTotal < expectedQuestionTotal) {
    problems.push(`expected ≥${expectedQuestionTotal} questions on overview units, found ${seededQuestionTotal}`)
  }
  if (qnaTotal < qnasCreated + qnasSkipped) {
    problems.push(`expected ≥${qnasCreated + qnasSkipped} qnas on overview units, found ${qnaTotal}`)
  }
  // Every seeded question must be PUBLISHED with a live revision.
  const unpublished = await prisma.question.count({
    where: { knowledgeUnit: { slug: { endsWith: '-overview' } }, OR: [{ status: { not: 'PUBLISHED' } }, { publishedRevisionId: null }] },
  })
  if (unpublished > 0) problems.push(`${unpublished} questions on overview units not PUBLISHED-with-revision`)
  const unpublishedQna = await prisma.qnA.count({
    where: { knowledgeUnit: { slug: { endsWith: '-overview' } }, OR: [{ status: { not: 'PUBLISHED' } }, { publishedRevisionId: null }] },
  })
  if (unpublishedQna > 0) problems.push(`${unpublishedQna} qnas on overview units not PUBLISHED-with-revision`)

  if (problems.length > 0) {
    console.error(`\nSEED PROBLEMS:\n  - ${problems.join('\n  - ')}`)
    process.exitCode = 1
  } else {
    console.log('\nOK — practice corpus seeded and verified.')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
