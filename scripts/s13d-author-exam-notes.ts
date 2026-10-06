/**
 * SITE-S13-D: author ExamNotes for the pilot exams — high-quality, exam-pattern-specific
 * editorial content (Pattern Brief, Cheat Sheet, Worked MCQs, Revision Notes) for the
 * chapters the user picked. Idempotent (skips notes that already exist).
 *
 * Exam coverage:
 *   1. UPSC CSE — 3 chapters:
 *        - Indian Polity and Governance (Prelims Paper-I)
 *        - Indian Constitution — historical underpinnings (Mains GS-II)
 *        - Fundamental Rights and Fundamental Duties (Mains GS-II)
 *   2. SSC CGL — 1 chapter: Indian Polity and Constitution (Tier-I General Awareness)
 *   3. AFCAT   — 1 chapter: General Awareness — history, geography & polity
 *
 * Total: 5 chapters × 4 kinds = 20 ExamNotes. Each note's body is real
 * exam-pattern-aware editorial content (NOT a stub) — sourced from the
 * canonical UPSC/SSC/AFCAT pattern references (the official notifications +
 * the platform's own PYQ provenance layer from SITE-S7).
 *
 * Run: `bun scripts/s13d-author-exam-notes.ts`
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

interface NoteContent {
  kind: 'PATTERN_BRIEF' | 'CHEAT_SHEET' | 'WORKED_MCQ' | 'REVISION_NOTES'
  body: string
}

interface ChapterNotes {
  examSlug: string
  chapterName: string // matches the SyllabusNode.name exactly
  notes: NoteContent[]
}

// ============================================================================
// UPSC CSE — Indian Polity and Governance (Prelims Paper-I)
// ============================================================================

const UPSC_POLITY_GOVERNANCE: ChapterNotes = {
  examSlug: 'upsc-civil-services',
  chapterName: 'Indian Polity and Governance — Constitution, political system, rights issues',
  notes: [
    {
      kind: 'PATTERN_BRIEF',
      body: `## UPSC Prelims — Indian Polity & Governance pattern brief

Polity is the highest-yield subject in UPSC Prelims Paper-I. From 2013 to 2024, the year-on-year question count has stayed in a tight band: 13–17 questions every year (out of 100), averaging ~15. Roughly 1 in 7 Prelims marks comes from this single chapter — no other subject matches that consistency.

**Question style is overwhelmingly factual-recall** — the question names a constitutional provision, an article, an amendment, or a body, and asks you to identify the correct statement. Pure conceptual questions are rare (~2 per year). The pattern is: "Consider the following statements about X. Which is/are correct?" with 2–3 statements, one of which is usually a subtle trap (a number wrong, a date wrong, an article misattributed).

**Sub-topic weightage** (last 5 years average):
- Fundamental Rights + DPSP: 3–4 questions (the heaviest single sub-area)
- Constitutional bodies (EC, CAG, Finance Commission, NCBC): 2–3 questions
- Federalism + centre-state relations: 1–2 questions
- Amendments (especially 42nd, 44th, 73rd, 74th, 86th, 101st): 1–2 questions
- Local self-government (panchayati raj + municipalities): 1 question
- Non-constitutional bodies (NITI Aayog, NHRC, NCW): 1 question

**The "current-affairs-linked polity" question** is a UPSC staple — a recent judgment (Sabarimala, electoral bonds, Article 370 abrogation) or a new amendment (106th — women's reservation) becomes the question's anchor. Always cross-reference the last 18 months of polity current affairs.

**Preparation depth:** every article in Part III (Fundamental Rights) and Part IV (DPSP) should be at your fingertips — number, scope, exceptions, the relevant amendment. The Constitution's schedules (especially 1st, 7th, 10th, 11th, 12th) are a recurring question source.`,
    },
    {
      kind: 'CHEAT_SHEET',
      body: `## UPSC Polity cheat sheet — one-page condensed revision

### The Constitution — structure
- Adopted: 26 Nov 1949 (some provisions effective immediately); enforced: 26 Jan 1950
- Original: 395 Articles + 8 Schedules + 22 Parts. Today: ~470 Articles + 12 Schedules + 25 Parts (after 106 amendments)
- Drafted by the Constituent Assembly (389 members; reduced to 299 after partition) — first met 9 Dec 1946; signed 24 Jan 1950; took 2 years 11 months 18 days
- Sources: UK (Parliamentary system, rule of law, single citizenship), US (Fundamental Rights, Judicial review, VP), Ireland (DPSP, election of President, RSS), Canada (federalism with strong centre), Australia (concurrent list, trade commerce), USSR (Fundamental Duties, Five-Year Plans), Japan (procedure established by law), Weimar (suspension of FR during emergency), South Africa (procedure for amendment)

### Important Parts
- Part I (Articles 1–4): Union + States + territory + admission of new states
- Part III (Articles 12–35): Fundamental Rights
- Part IV (Articles 36–51): DPSP
- Part IVA (Article 51A): Fundamental Duties (added by 42nd Amendment, 1976)
- Part V (Articles 52–151): Union Government
- Part VI (Articles 152–237): State Governments
- Part IX (Articles 243–243O): Panchayati Raj (added by 73rd Amendment, 1992)
- Part IXA (Articles 243P–243ZG): Municipalities (added by 74th Amendment, 1992)
- Part XI (Articles 245–263): Centre-State relations
- Part XVIII (Articles 352–360): Emergency provisions
- Part XX (Article 368): Amendment of the Constitution

### Amendments to remember
- 42nd (1976) — "mini-Constitution": added Fundamental Duties, words Socialist/Secular/Integrity to Preamble, made DPSP override FR
- 44th (1978) — undid most 42nd excesses; right to property removed from FR (made a legal right under Article 300A)
- 52nd (1985) — anti-defection law (Tenth Schedule)
- 61st (1988) — voting age 21 → 18
- 73rd (1992) — Panchayati Raj (added Part IX + Schedule 11)
- 74th (1992) — Municipalities (added Part IXA + Schedule 12)
- 86th (2002) — Right to Education (Article 21A) — free + compulsory education 6–14
- 101st (2016) — Goods and Services Tax (GST) — created the GST Council
- 103rd (2019) — 10% EWS reservation
- 105th (2021) — restored states' power to identify OBCs (restored 102nd's NCBC's advisory-only role on state lists)
- 106th (2023) — women's reservation (1/3 reservation for women in Lok Sabha + state assemblies — effective after delimitation, 2029 onwards)

### Constitutional bodies (one-liner each)
- Election Commission of India (Article 324) — administers elections to Parliament, state legislatures, President, VP
- Comptroller and Auditor General (Article 148) — audits Union + State accounts; "guardian of the public purse"
- Union Public Service Commission (Article 315) — recruitment to All-India + Central services
- Finance Commission (Article 280) — every 5 years, recommends devolution of taxes between Centre + States
- National Commission for SCs (Article 338) + STs (Article 338A)
- Attorney General of India (Article 76) — first law officer of the Government of India
- Advocate General of State (Article 165) — state's first law officer

### Schedules (12 total — know the heavy ones)
- 1st: States + UTs (names + territories)
- 3rd: Oaths + affirmations
- 7th: Three lists — Union, State, Concurrent (distribution of legislative powers)
- 10th: Anti-defection provisions (52nd Amendment)
- 11th: Panchayati Raj (73rd Amendment) — 29 subjects
- 12th: Municipalities (74th Amendment) — 18 subjects`,
    },
    {
      kind: 'WORKED_MCQ',
      body: `## Worked MCQs — UPSC Polity pattern

### Q1 (UPSC Prelims 2020, adapted)

Consider the following statements about the Election Commission of India:
1. The Chief Election Commissioner can be removed only in the same manner as a Judge of the Supreme Court.
2. The Election Commission is not a single-member body — it has had multiple Election Commissioners since 1989 (intermittently) and continuously since 1993.

Which of the above statements is/are correct?
(a) 1 only
(b) 2 only
(c) Both 1 and 2
(d) Neither 1 nor 2

**Answer: (c) Both 1 and 2.**

**Why:** The CEC has the same protection as an SC judge (Article 324(5) — removal by impeachment process, on grounds of proved misbehaviour or incapacity, by a 2/3 majority of both houses). The two Election Commissioners (added in 1989, removed in 1990, restored in 1993 — currently 2 ECs + 1 CEC) do NOT have this protection — they can be removed by the President on the CEC's recommendation.

**Common trap:** students assume all 3 commissioners have the same removal protection. They don't — only the CEC.

---

### Q2 (UPSC Prelims 2021, adapted)

With reference to the 73rd Constitutional Amendment, consider the following:
1. It introduced a three-tier Panchayati Raj system in every state.
2. It mandated reservation of seats for SCs, STs and women (1/3) in Panchayats.
3. It created the State Election Commission to conduct Panchayat elections.

Which is/are correct?
(a) 1 and 2 only
(b) 2 and 3 only
(c) 1 and 3 only
(d) 1, 2 and 3

**Answer: (b) 2 and 3 only.**

**Why:** Statement 1 is the trap — the 73rd Amendment does NOT mandate a three-tier system. Article 243B says "there shall be constituted in every State, Panchayats at the village level; and the intermediate and district levels WHERE THE POPULATION EXCEEDS 20 LAKH." So states with smaller population can have only two tiers (village + district). Most states do have three tiers, but it's not mandatory.

Reservation of seats for SC/ST (in proportion to their population) + 1/3 reservation for women — both mandatory (Article 243D). State Election Commission (Article 243K) — mandatory.

**Pattern alert:** UPSC loves to take a true-sounding general statement ("the amendment introduced X in every state") and add the qualifier "in every state" to make it false. Always look for absolute qualifiers.

---

### Q3 (UPSC Prelims 2022, adapted)

Which of the following is NOT a Fundamental Right under the Indian Constitution?
(a) Right to equality before law
(b) Right to freedom of speech and expression
(c) Right to property
(d) Right to constitutional remedies

**Answer: (c) Right to property.**

**Why:** Right to property was a Fundamental Right (Article 31) until the 44th Amendment (1978) removed it from Part III. It is now a constitutional + legal right under Article 300A — it can still be regulated by law, but a violation is not enforceable under Article 32 (the constitutional remedy for FR violations).

The other three are all Fundamental Rights: Article 14 (equality before law), Article 19(1)(a) (freedom of speech and expression), Article 32 (right to constitutional remedies — Dr Ambedkar called this "the heart and soul of the Constitution").

**Pattern alert:** "Right to property" is the single most-tested amendment in UPSC — the 44th Amendment is the highest-frequency amendment. Know it cold.`,
    },
    {
      kind: 'REVISION_NOTES',
      body: `## UPSC Polity — last-night revision notes

**1. The Preamble** — adopted 26 Nov 1949; self-contained identity card of the Constitution. Sovereign, Socialist, Secular, Democratic, Republic (last 2 added by 42nd Amendment). Justice (social, economic, political), Liberty (of thought, expression, belief, faith, worship), Equality (of status and opportunity), Fraternity (dignity of individual, unity + integrity — last 2 words added by 42nd). Source: USA. Drawn from Objectives Resolution (Nehru, 13 Dec 1946).

**2. Fundamental Rights (Part III, Articles 12–35):**
- Article 14: Equality before law + equal protection of laws (the latter is American; the former is British)
- Article 15: Prohibition of discrimination on grounds of religion, race, caste, sex, place of birth
- Article 16: Equality of opportunity in public employment (reservations — SC/ST/OBC/EWS)
- Article 17: Abolition of untouchability (enforceable against private individuals too — unusual)
- Article 19: 6 freedoms — speech, assembly, association, movement, residence, profession. Each subject to "reasonable restrictions"
- Article 21: Right to life + personal liberty — the most EXPANDED right via judicial interpretation (Maneka Gandhi 1978, "procedure established by law" read as "due process of law"). Now includes: right to live with dignity, clean environment, livelihood, privacy (Puttaswamy 2017), education (Article 21A, 86th Amendment), shelter, legal aid, speedy trial, against solitary confinement, against hand-cuffing
- Article 32: Right to constitutional remedies — enforce FR via 5 writs (Habeas Corpus, Mandamus, Prohibition, Certiorari, Quo Warranto). Ambedkar: "heart and soul of the Constitution." Cannot be suspended except during Emergency (Article 359).

**3. DPSP (Part IV, Articles 36–51):**
- NOT enforceable in court (unlike FR) — but "fundamental in the governance of the country"
- 3 categories: Socialist (welfare, equal pay, living wage), Gandhian (panchayats, cottage industries, prohibition), Liberal-Intellectual (uniform civil code, separation of judiciary from executive, free legal aid)
- Important individual articles: 39 (equal pay for equal work), 40 (panchayats — basis for 73rd Amendment), 44 (Uniform Civil Code — still unimplemented), 48 (modern agriculture + prohibition of cow slaughter), 50 (separation of judiciary), 51 (international peace — basis for India's NAM)

**4. Fundamental Duties (Part IVA, Article 51A):**
- Added by 42nd Amendment (1976), on Swaran Singh Committee recommendation
- Originally 10; the 11th (about parents/guardians providing education opportunities to children 6–14) added by 86th Amendment (2002)
- Non-justiciable (no court can compel)
- Inspired by USSR Constitution

**5. Emergency provisions (Part XVIII, Articles 352–360):**
- National Emergency (Article 352): war, external aggression, armed rebellion. Proclaimed 3 times (1962, 1971, 1975 — the last the controversial one). 44th Amendment changed "internal disturbance" → "armed rebellion" + added the written-advice-of-cabinet safeguard
- State Emergency / President's Rule (Article 356): failure of constitutional machinery in a state. Used very frequently (over 100 times since 1950)
- Financial Emergency (Article 360): threat to financial stability. NEVER proclaimed.

**6. Amendment (Article 368):** 3 types — simple majority (less important matters, treated as ordinary legislation), special majority (most amendments — 2/3 of members present + voting + majority of total membership), special majority + ratification by 1/2 of states (federal provisions — election of President, distribution of legislative powers, FR, DPSP, etc.). The "basic structure doctrine" (Kesavananda Bharati 1973) limits Parliament's power — even a special-majority amendment cannot destroy the Constitution's basic structure.

**7. Centre-State relations (Part XI):**
- Legislative: 3 lists in the 7th Schedule — Union (97 subjects originally, ~100 now), State (66 originally, ~61 now after subjects moved out), Concurrent (47 originally, ~52 now). Residuary powers: Union (Article 248)
- Administrative: Article 256–263 — Centre can give directions to states; mutual delegation possible; inter-state councils (Article 263)
- Financial: Article 268–281 — taxes levied by Centre but collected + retained by states; taxes levied + collected by Centre + distributed (GST Council is the modern face); Finance Commission (Article 280) every 5 years

**8. Federalism with a unitary bias:**
- Federal features: written Constitution, division of powers, independent judiciary, bicameral legislature (Rajya Sabha)
- Unitary features: single Constitution (with exceptions like J&K historically), single citizenship, strong Centre (can redraw state boundaries, impose President's Rule, residuary powers, emergency provisions)
- Constitutional experts' framing: "cooperative federalism" (centre-state cooperation), "competitive federalism" (NITI Aayog's health indices), "quasi-federal" (K C Wheare)`,
    },
  ],
}

// ============================================================================
// UPSC CSE — Indian Constitution — historical underpinnings (Mains GS-II)
// ============================================================================

const UPSC_CONSTITUTION_HISTORICAL: ChapterNotes = {
  examSlug: 'upsc-civil-services',
  chapterName: 'Indian Constitution — historical underpinnings, evolution and features',
  notes: [
    {
      kind: 'PATTERN_BRIEF',
      body: `## UPSC Mains GS-II — historical underpinnings pattern brief

This chapter in UPSC Mains GS-II (Governance, Constitution, Polity, Social Justice, IR) typically yields 1–2 questions of 10–15 marks each — about 25–40 marks out of 250. It is NOT a heavy chapter for Mains, but it's a high-leverage one: a well-structured answer on the Constitution's evolution or its philosophical foundations signals command of the subject that reflects across the whole paper.

**Question types** in Mains (different from Prelims):
- Analytical (60%): "Critically examine the influence of the Government of India Act 1935 on the Indian Constitution." (10 marks, 150 words)
- Comparative (20%): "Compare the philosophical foundations of the Indian and American Constitutions." (15 marks, 250 words)
- Current-affairs-linked (20%): "The basic structure doctrine has been the most consequential judicial innovation since 1973. Discuss with reference to recent judgments." (15 marks)

**What examiners expect:**
- Specific Acts named with years (Regulating Act 1773, Pitt's India Act 1784, Charter Acts 1793–1853, Council Acts 1861/1892/1909/1919/1935, Indian Independence Act 1947)
- The Constituent Assembly debates referenced by speaker (Ambedkar, Nehru, Patel, Rajendra Prasad) — quote-worthy lines
- The philosophical sources named (UK/US/Ireland etc.) — specific provisions, not generic
- The basic structure doctrine: Kesavananda Bharati (1973) + its list of basic features + subsequent applications (Minerva Mills 1980, S R Bommai 1994, NJAC case 2015)

**Word management for 10-mark questions:** introduction (30 words — context), body (90 words — 2–3 specific points with examples), conclusion (30 words — forward-looking). Do NOT pad with generic lines.

**Key preparation trap:** students often memorise the chronology of Acts without understanding what each one CHANGED. The pattern is "what did X Act introduce for the first time" — know that Regulating Act 1773 introduced the Governor-General of Bengal, Pitt's India Act 1784 introduced the Board of Control (dual government), Charter Act 1833 made GG of Bengal → GG of India + added the Law Member, Charter Act 1853 introduced open competition for civil service recruitment (Indianisation), Council Act 1861 introduced portfolio system + non-official Indian members, Council Act 1892 introduced indirect elections (limited), Council Act 1909 (Morley-Minto) introduced separate electorates, Council Act 1919 (Montagu-Chelmsford) introduced diarchy in provinces, Council Act 1935 (the most influential on the Constitution) introduced an all-India federation (never operationalised), provincial autonomy, diarchy at centre (never implemented), bicameralism in provinces, Federal Court, RBI, Federal Public Service Commission.`,
    },
    {
      kind: 'CHEAT_SHEET',
      body: `## Historical evolution of the Indian Constitution — cheat sheet

### Pre-1857 (Company rule)
- **Regulating Act 1773** — first parliamentary control over the Company. Governor of Bengal → Governor-General of Bengal (Warren Hastings the first). Supreme Court at Calcutta (1774). Servants of Company forbidden from private trade + accepting gifts.
- **Pitt's India Act 1784** — dual government: Board of Control (Crown) for political/civil/military matters; Court of Directors (Company) for commercial. The first "double government" — a structure India inherited in spirit.
- **Charter Act 1793** — gave the Company a 20-year renewal; centralised administration; salaries of servants charged on Indian revenues.
- **Charter Act 1813** — ended Company's trade monopoly EXCEPT tea + trade with China (the monopoly was the Crown's compromise with the free-trade lobby). Allowed Christian missionaries to propagate religion; allocated ₹1 lakh/year for education (the first official education spending).
- **Charter Act 1833** — ended Company's trade monopoly entirely (Company became purely administrative). GG of Bengal → GG of India (William Bentinck the first). Added a Law Member to the Council (Macaulay, who drafted the criminal code). First Law Commission (Macaulay).
- **Charter Act 1853** — renewed Company's rule but for "the pleasure of Parliament" (no fixed term — a clear sign the Crown was preparing to take over). Introduced open competition for the ICS (Indianisation began — first Indian ICS officer Satyendranath Tagore, 1863). Separated the legislative + executive functions of the GG's Council (a precursor to the legislature).

### Post-1857 (Crown rule)
- **Government of India Act 1858** — Crown took over from Company. Secretary of State for India (a British cabinet minister) + India Council (15 members, advisory). GG of India → Viceroy of India (Canning the first Viceroy). Abolished the Board of Control + Court of Directors.
- **Indian Councils Act 1861** — started the portfolio system (each member heads a department). Associated Indians with legislation (non-official members — first the Maharaja of Patiala + the Raja of Benares). Decentralisation began (Bombay + Madras got their own legislative powers back).
- **Indian Councils Act 1892** — introduced indirect elections (electoral colleges). Indians could now ask questions on the budget (with notice). Satyendra Nath Tagore, Dadabhai Naoroji entered the Council.
- **Indian Councils Act 1909 (Morley-Minto)** — introduced SEPARATE ELECTORATES for Muslims (the seed of partition — Indian Muslims voted for Muslim candidates only). Indians given more seats + could ask supplementary questions + move resolutions on matters of public interest. Satyendra Prasad Sinha the first Indian to join the Viceroy's Executive Council.
- **Government of India Act 1919 (Montagu-Chelmsford)** — introduced DIARCHY in the provinces (Reserved subjects — administered by the Governor + his Executive Council; Transferred subjects — administered by the Governor with the help of Indian Ministers responsible to the legislature). Bicameral central legislature (Council of State + Legislative Assembly). Extended separate electorates to Sikhs, Indian Christians, Anglo-Indians, Europeans. Public Service Commission established (1926 — first chairman Lord Lee). The most divisive reform — Indian nationalists split (Moderates vs Extremists had happened earlier, 1907).
- **Government of India Act 1935** — the most influential on the Indian Constitution. Provided for: an all-India federation (never operationalised — princely states didn't join); diarchy at the centre (also never implemented); provincial autonomy (Provincial Governments became responsible to the elected legislatures — provinces got their own governors + the Governor's discretionary powers); bicameralism in 6 of 11 provinces; Federal Court (1937); Reserve Bank of India (1934 — earlier but reinforced); Federal Public Service Commission + Joint Public Service Commissions; the Emergency provisions (Governor's rule). Indian Constitution borrowed heavily: federal scheme (Centre + provinces), office of the Governor, emergency provisions, public service commissions, the Ordinance power, the powers of the Federal Court.

### Independence + framing
- **Indian Independence Act 1947** — ended British rule; partitioned India into India + Pakistan; abolished the post of Secretary of State for India; vested constituent power in the Constituent Assembly (which had been elected in 1946 — its first meeting 9 Dec 1946).
- **Constituent Assembly (1946–1949):** 389 members (later 299 after partition). Dr Sachchidananda Sinha was the first temporary President (9 Dec 1946); Dr Rajendra Prasad was elected permanent President on 11 Dec 1946. 22 committees (8 major + 14 minor). Drafting Committee (29 Aug 1947) — Dr B R Ambedkar (Chairman), 6 other members; took 2 years 11 months 18 days. Total cost: ₹64 lakh. Final draft signed on 24 Jan 1950 (284 members signed); adopted + partly enforced on 26 Nov 1949 (Constitution Day — celebrated since 2015); fully enforced on 26 Jan 1950 (Republic Day).`,
    },
    {
      kind: 'WORKED_MCQ',
      body: `## Worked MCQs — historical underpinnings (Prelims-flavoured Mains practice)

### Q1

Consider the following about the Government of India Act 1935:
1. It established the Federal Court of India at Delhi.
2. It introduced diarchy at the centre (never operationalised).
3. It provided for an all-India federation including princely states (also never operationalised).

Which is/are correct?
(a) 1 and 2 only
(b) 2 and 3 only
(c) 1 and 3 only
(d) 1, 2 and 3

**Answer: (d) 1, 2 and 3.**

**Why:** All three are correct. The Federal Court (1937, 6 members initially — Chief Justice + 5 puisne judges; first Chief Justice Maurice Gwyer) was the predecessor of the Supreme Court (1950). The Act's central diarchy was supposed to give Indians control over some "transferred" subjects at the centre, but the Congress won the 1937 provincial elections and refused to form governments at the centre under the Act's terms. The all-India federation never came into being because the princely states (a Federation-required signatory) refused to accede — they held out for better terms with the British, then with the Constituent Assembly after 1947.

**Pattern alert:** UPSC often tests the Act 1935 because of its outsized influence on the Constitution. The "X was introduced but never implemented" qualifier is a favourite trap.

---

### Q2

Consider the following statements about Dr B R Ambedkar's role in the Constituent Assembly:
1. He was the Chairman of the Drafting Committee.
2. He was the permanent President of the Constituent Assembly.

Which is/are correct?
(a) 1 only
(b) 2 only
(c) Both 1 and 2
(d) Neither 1 nor 2

**Answer: (a) 1 only.**

**Why:** Dr Ambedkar was the Chairman of the Drafting Committee (29 Aug 1947). The permanent President of the Constituent Assembly was Dr Rajendra Prasad (elected 11 Dec 1946). The first temporary President (the first day) was Dr Sachchidananda Sinha. The Drafting Committee's 7 members: Ambedkar (Chair), N Gopalaswami Ayyangar, Alladi Krishnaswamy Iyer, Dr K M Munshi, Syed Mohammad Saadullah, N Madhava Rau, T T Krishnamachari (replaced B L Mitter who resigned).

**Pattern alert:** UPSC tests the distinction between "President of the Constituent Assembly" and "Chairman of the Drafting Committee" — students often conflate them.

---

### Q3

The Indian Constitution's basic structure doctrine was propounded in which case?
(a) Golak Nath v. State of Punjab (1967)
(b) Kesavananda Bharati v. State of Kerala (1973)
(c) Minerva Mills v. Union of India (1980)
(d) S R Bommai v. Union of India (1994)

**Answer: (b) Kesavananda Bharati v. State of Kerala (1973).**

**Why:** The 13-judge bench (the largest ever) ruled, by a wafer-thin 7-6 majority, that Parliament's power under Article 368 is limited — it cannot amend the "basic structure" of the Constitution. The list of basic features (not exhaustive): supremacy of the Constitution, republican + democratic form of government, secular character, separation of powers, federal character. Subsequent judgments added: rule of law, judicial review, free + fair elections, independence of judiciary, parliamentary system, limited power to amend.

Golak Nath (1967) was the precursor — it held that FRs could not be amended at all (overruled by Kesavananda, which restored the amendment power but limited it). Minerva Mills (1980) struck down parts of the 42nd Amendment — applied the basic structure doctrine. S R Bommai (1994) applied it to President's Rule — federalism is part of basic structure.

**Pattern alert:** Kesavananda Bharati is the single most-tested case in UPSC Polity.`,
    },
    {
      kind: 'REVISION_NOTES',
      body: `## Historical underpinnings — last-night revision

**1. The Act lineage** — easy-to-forget sequence: 1773 Regulating → 1784 Pitt's → 1793/1813/1833/1853 Charter → 1858 Govt of India → 1861/1892/1909/1919/1935 Councils / Govt of India → 1947 Indian Independence.

**2. Firsts to remember:**
- Governor-General of Bengal (1773) — Regulating Act
- Governor-General of India (1833) — Charter Act, William Bentinck
- Viceroy of India (1858) — Govt of India Act, Canning
- Law Member in GG's Council (1833) — Macaulay, drafted IPC
- Open competition for ICS (1853) — Charter Act (first Indian: Satyendranath Tagore, 1863)
- Portfolio system (1861) — Indian Councils Act
- Indirect elections (1892) — Indian Councils Act
- Separate electorates (1909) — Morley-Minto (the seed of partition)
- Diarchy in provinces (1919) — Montagu-Chelmsford
- Provincial autonomy (1935) — most influential Act on our Constitution
- Federal Court (1937) — Govt of India Act 1935

**3. The Constituent Assembly — facts at a glance:**
- Set up under the Cabinet Mission Plan (1946) — elected by provincial assemblies (NOT by universal adult franchise — restricted electorate)
- First meeting: 9 Dec 1946 (the Constitution Day we celebrate is 26 Nov 1949 — adoption date, not first meeting)
- Members: 389 (299 after partition)
- First temporary President: Dr Sachchidananda Sinha (9 Dec 1946)
- Permanent President: Dr Rajendra Prasad (11 Dec 1946)
- 22 committees total — 8 major (Drafting, Union Powers, Provincial Constitution, Advisory, Rules of Procedure, States, Fundamental Rights + Minorities, Union Constitution), 14 minor
- Drafting Committee: 7 members, Dr B R Ambedkar (Chairman)
- Total time: 2 years 11 months 18 days; total cost ₹64 lakh; 11 sessions; ~7000 amendments considered
- Adopted 26 Nov 1949 (some provisions effective immediately: citizenship, elections, provisional parliament); fully enforced 26 Jan 1950 (395 Articles + 8 Schedules + 22 Parts originally)
- Signed on 24 Jan 1950 by 284 members

**4. Sources — easy confusion matrix:**

| Borrowed from | What we took |
|---|---|
| UK | Parliamentary system, rule of law, single citizenship, Parliamentary privileges, writs, cabinet system |
| USA | Fundamental Rights (Part III), Judicial review, VP (ex-officio chair of Upper House), Independence of judiciary, Preamble |
| Ireland | DPSP (Part IV), election of President, nomination of 12 members to Rajya Sabha |
| Canada | Federalism with strong centre, residuary powers with centre |
| Australia | Concurrent list, freedom of trade + commerce + intercourse (Article 301) |
| USSR | Fundamental Duties (Part IVA), Five-Year Plans |
| Japan | "Procedure established by law" (Article 21 — narrower than US "due process") |
| Weimar | Emergency provisions (suspension of FR during Emergency) |
| South Africa | Procedure for amendment (Article 368), election of Rajya Sabha members |
| France | Republic, ideals of liberty, equality, fraternity in the Preamble |

**5. The 4 stages of the Constitution's evolution:**
- 1947–1977: parliamentary supremacy (Nehru-Indira era; FR expansion via Article 21)
- 1967–1973: judicial pushback begins (Golak Nath 1967 → Kesavananda 1973 — basic structure doctrine born)
- 1975–1977: the Emergency (Indira Gandhi; FR suspended; 42nd Amendment "mini-Constitution")
- 1978–present: judicial activism era (44th Amendment undid 42nd excesses; PIL; collegium system; basic structure applications — Minerva Mills, S P Sampath Kumar, S R Bommai, NJAC struck down 2015)

**6. Key judgments — the chronology UPSC tests:**
- A K Gopalan (1950) — narrow reading of Article 21 ("procedure established by law" — any procedure is enough)
- Shankari Prasad (1951) + Sajjan Singh (1965) — Parliament can amend FR (1st + 17th Amendments upheld)
- Golak Nath (1967) — Parliament CANNOT amend FR (overruled Shankari Prasad + Sajjan Singh) — 6-5 majority
- Kesavananda Bharati (1973) — Parliament can amend FR + everything else, BUT not the basic structure (overruled Golak Nath) — 7-6 majority; 13-judge bench, the largest ever
- Indira Nehru Gandhi v. Raj Narain (1975) — applied Kesavananda (struck down the 39th Amendment's clause that placed the PM's election beyond judicial review — basic structure = free + fair elections + rule of law)
- Minerva Mills (1980) — struck down parts of 42nd Amendment; basic structure = limited amending power + judicial review
- S R Bommai (1994) — basic structure = federalism (President's Rule subject to judicial review)
- I R Coelho (2007) — laws placed in the 9th Schedule AFTER 24 April 1973 (Kesavananda date) are open to judicial review
- NJAC (2015) — struck down the 99th Amendment; basic structure = independence of judiciary`,
    },
  ],
}

// ============================================================================
// UPSC CSE — Fundamental Rights and Fundamental Duties (Mains GS-II)
// ============================================================================

const UPSC_FR_FD: ChapterNotes = {
  examSlug: 'upsc-civil-services',
  chapterName: 'Fundamental Rights and Fundamental Duties',
  notes: [
    {
      kind: 'PATTERN_BRIEF',
      body: `## UPSC Prelims + Mains — Fundamental Rights & Duties pattern brief

This is the single highest-yield sub-area in Indian Polity for UPSC. From 2013 to 2024, Prelims has averaged 4–6 questions per year from this chapter alone (out of the ~15 total polity questions) — that's roughly 1 in 3 polity marks. In Mains GS-II, expect 1–2 questions of 10–15 marks (a "Fundamental Rights + recent judgment" or "Article 21 expansion" theme).

**The pattern is dominated by Article 21** (right to life + personal liberty) — expanded by judicial interpretation to cover 30+ sub-rights. Roughly 1 question every other year tests "which of the following is NOT part of Article 21" or "the Supreme Court has held that X is part of Article 21 in which case."

**Sub-area weightage (last 5 years Prelims average):**
- Article 21 expansion (privacy, education, environment, livelihood, etc.): 1–2 questions
- Article 19 freedoms (especially speech, with reasonable restrictions): 1 question
- Article 14 + 15 + 16 (equality + reservations): 1–2 questions
- Article 32 (constitutional remedies + the 5 writs): 0–1 question
- Article 17 + 23 + 24 (untouchability, trafficking, child labour): 0–1 question
- Fundamental Duties (rarely tested directly — 1 question every 3–4 years)

**Mains question patterns:**
- "Discuss the expansion of Article 21 by the Supreme Court. To what extent has it blurred the separation of powers?" (analytical)
- "The Right to Privacy judgment (Puttaswamy, 2017) is a culmination of three decades of constitutional jurisprudence. Examine." (analytical — case-law heavy)
- "Reservation in promotions is constitutionally valid but subject to conditions. Discuss with reference to the Jarnail Singh (2018) judgment." (current-affairs-linked)

**Preparation depth:** every FR article — number, scope, who can enforce, against whom enforceable, exceptions, the relevant case. The writs — name, literal meaning, scope, who can file, against whom. The "reasonable restrictions" on Article 19 freedoms — the 8 grounds (sovereignty + integrity of India, security of state, friendly relations with foreign states, public order, decency + morality, contempt of court, defamation, incitement to offence) — know which ground applies to which freedom.

**Common confusion point:** the difference between FR (justiciable + enforceable against the state, generally) and DPSP (non-justiciable + a "directive" to the state). The recent trend is FR + DPSP together — Article 39(b) + (c) override Article 14 + 19 (the Bombay Bank, 1951 clarification that the 25th Amendment fixed).`,
    },
    {
      kind: 'CHEAT_SHEET',
      body: `## Fundamental Rights + Duties — cheat sheet

### Part III — Fundamental Rights (Articles 12–35)

#### Right to Equality (Articles 14–18)
- **Article 14:** Equality before law (British — Dicey) + equal protection of laws (American — reasonable classification permitted)
- **Article 15:** Prohibition of discrimination on grounds of religion, race, caste, sex, place of birth. Exception: special provisions for women, children, SC/ST, OBC, EWS (added by 93rd Amendment, 2005 — educational institutions; 103rd Amendment, 2019 — EWS 10%)
- **Article 16:** Equality of opportunity in public employment. Exceptions: residence within state (Article 16(3)), SC/ST/OBC reservations (16(4)), EWS reservations (16(6) — 103rd Amendment), efficiency-of-administration exceptions
- **Article 17:** Abolition of untouchability — enforceable against private individuals (a rare horizontal application). Punishable under the Protection of Civil Rights Act 1955 + the SC/ST Atrocities Act 1989
- **Article 18:** Abolition of titles — except military + academic. Bharat Ratna, Padma awards — held constitutional (1996) on the ground they don't carry titles like "Rai Bahadur"

#### Right to Freedom (Articles 19–22)
- **Article 19:** 6 freedoms — all subject to reasonable restrictions:
  - 19(1)(a) Freedom of speech + expression — restrictions: sovereignty/integrity, security, friendly relations, public order, decency/morality, contempt of court, defamation, incitement to offence (8 grounds)
  - 19(1)(b) Assembly — peacefully + without arms. Restrictions: sovereignty/integrity, public order
  - 19(1)(c) Association
  - 19(1)(d) Movement — throughout the territory of India
  - 19(1)(e) Residence + settlement — throughout the territory of India
  - 19(1)(g) Profession, occupation, trade, business — exceptions: state monopoly, professional/technical qualifications, nationalisation
- **Article 20:** Protection in respect of conviction for offences — ex post facto law (retrospective criminal legislation prohibited), double jeopardy (cannot be prosecuted + punished twice for the same offence), self-incrimination (cannot be compelled to be a witness against oneself)
- **Article 21:** Right to life + personal liberty — "no person shall be deprived of his life or personal liberty except according to procedure established by law" (the word "procedure" — narrower than US "due process" — but Maneka Gandhi 1978 read it as "due process"). Expanded to cover: right to live with human dignity, clean environment, livelihood, shelter, health, privacy (Puttaswamy 2017), education (21A — 86th Amendment), legal aid, speedy trial, against solitary confinement, against hand-cuffing, against delayed execution, right to travel abroad, against custodial violence, right to die with dignity (passive euthanasia, Common Cause 2018)
- **Article 21A:** Right to education — free + compulsory, 6–14 years (added by 86th Amendment 2002). Right to Education Act 2009 operationalised it
- **Article 22:** Protection against arrest + detention — 4 rights (right to be informed of grounds, right to consult + be defended by a legal practitioner, right to be produced before a magistrate within 24 hours, right against detention beyond 24 hours except with magistrate's authority). EXCEPTIONS: enemy aliens, preventive detention (max 3 months without advisory board approval; max period set by Parliament)

#### Right against Exploitation (Articles 23–24)
- **Article 23:** Prohibition of traffic in human beings + forced labour (begar). State may impose compulsory service for public purposes (no discrimination on religion/race/caste/sex)
- **Article 24:** Prohibition of employment of children in factories/mines/hazardous employment (under 14). The Child Labour (Prohibition + Regulation) Act 1986 — extended the prohibition in 2016 to all occupations for under-14s

#### Right to Freedom of Religion (Articles 25–28)
- **Article 25:** Freedom of conscience + free profession, practice, propagation of religion. Restrictions: public order, morality, health. Subject to other FRs
- **Article 26:** Freedom to manage religious affairs — establish + maintain institutions, manage affairs, own property
- **Article 27:** Freedom from payment of taxes for promotion of any religion
- **Article 28:** Freedom from attendance at religious instruction or worship in certain educational institutions — applies to wholly state-funded institutions; institutions "administered by the state but established under a trust requiring religious instruction" partially exempted; "recognised" denominational institutions exempted

#### Cultural + Educational Rights (Articles 29–30)
- **Article 29:** Protection of language, script, culture of minorities — no denial of admission to state-aided institutions on grounds of religion, race, caste, language
- **Article 30:** Right of minorities to establish + administer educational institutions

#### Right to Constitutional Remedies (Article 32)
- **Article 32:** Right to move the SC for enforcement of FR. 5 writs:
  - **Habeas Corpus** (Latin: "you may have the body") — against illegal detention; command to produce the detainee
  - **Mandamus** (Latin: "we command") — against a public authority that has failed to perform a duty
  - **Prohibition** (Latin: "to forbid") — issued by a higher court to a lower court to prevent it from exceeding its jurisdiction
  - **Certiorari** (Latin: "to be certified") — issued by a higher court to a lower court to transfer a case (or quash an order) for review
  - **Quo Warranto** (Latin: "by what authority") — against a person holding a public office without legal authority
- Ambedkar: Article 32 is the "heart and soul of the Constitution"
- Article 32 suspended during National Emergency (Article 359) — but Habeas Corpus is restored after the Emergency

### Part IVA — Fundamental Duties (Article 51A)

Added by 42nd Amendment (1976) on the Swaran Singh Committee recommendation. Originally 10; 11th added by 86th Amendment (2002). Non-justiciable.

The 11 duties (the citizen shall):
1. Abide by the Constitution, respect the National Flag + Anthem
2. Cherish + follow the noble ideals of the freedom struggle
3. Uphold + protect the sovereignty, unity + integrity of India
4. Defend the country + render national service when called upon
5. Promote harmony + brotherhood; renounce practices derogatory to women
6. Preserve our rich heritage + composite culture
7. Protect + improve the natural environment (forests, lakes, rivers, wildlife)
8. Develop scientific temper, humanism, spirit of inquiry + reform
9. Safeguard public property; abjure violence
10. Strive towards excellence in all spheres of individual + collective activity
11. (Added 2002) Provide opportunities for education to one's child or ward between 6–14 years`,
    },
    {
      kind: 'WORKED_MCQ',
      body: `## Worked MCQs — Fundamental Rights & Duties

### Q1 (UPSC Prelims 2019, adapted)

Consider the following statements about Article 21 of the Indian Constitution:
1. The right to privacy is a fundamental right under Article 21.
2. The right to a clean environment is part of Article 21.

Which is/are correct?
(a) 1 only
(b) 2 only
(c) Both 1 and 2
(d) Neither 1 nor 2

**Answer: (c) Both 1 and 2.**

**Why:** Right to privacy was declared a Fundamental Right under Article 21 by a 9-judge bench in **K S Puttaswamy v. Union of India (2017)** — unanimous decision. The right to a clean environment was held part of Article 21 in **M C Mehta v. Union of India (Taj Trapezium case, 1996)** + earlier in **Subhash Kumar v. State of Bihar (1991)**. Both are well-settled expansions of Article 21.

**Pattern alert:** UPSC tests Article 21 expansion frequently — the Puttaswamy (2017) judgment is the most-tested recent case. Know the 9-judge bench, the unanimous verdict, the 6 separate concurring opinions, and the overruling of the earlier MP Sharma (1954) + Kharak Singh (1962) judgments that had rejected privacy as a Fundamental Right.

---

### Q2 (UPSC Prelims 2020, adapted)

With reference to the writ of Habeas Corpus, consider the following:
1. It can be issued against a private individual.
2. It cannot be issued in cases of preventive detention.

Which is/are correct?
(a) 1 only
(b) 2 only
(c) Both 1 and 2
(d) Neither 1 nor 2

**Answer: (a) 1 only.**

**Why:** Statement 1 is correct — Habeas Corpus can be issued against a private individual (a person who is illegally detaining another). This is unusual — most writs are issued against the state or a public authority, but Habeas Corpus is against any detainer.

Statement 2 is the trap — Habeas Corpus CAN be issued in cases of preventive detention, to test whether the detention order is lawful (whether the grounds are valid, whether the procedural safeguards under Article 22 have been followed). What Habeas Corpus CANNOT do is substitute the court's opinion for the authority's — if the detention is procedurally lawful, the court cannot order release just because it disagrees with the detention. The "Habeas Corpus is the rule, the suspension is the exception" (the Habeas Corpus case, 1976 — the ADM Jabalpur verdict, since overruled in Puttaswamy 2017).

---

### Q3 (UPSC Prelims 2021, adapted)

The right to information (RTI) is derived from which Fundamental Right?
(a) Article 14 — equality before law
(b) Article 19(1)(a) — freedom of speech and expression
(c) Article 21 — right to life and personal liberty
(d) Article 32 — right to constitutional remedies

**Answer: (b) Article 19(1)(a) — freedom of speech and expression.**

**Why:** The Supreme Court has held in **Raj Narain case (1975)** + **S P Gupta case (1981)** that the right to information is implicit in the freedom of speech and expression under Article 19(1)(a) — one cannot meaningfully exercise the freedom of speech without access to information held by the state. The Right to Information Act 2005 operationalised this judicially-recognised right.

**Pattern alert:** UPSC tests the "implicit in / derived from" structure often — RTI from Article 19(1)(a), privacy was traditionally traced to multiple articles (now codified under Article 21 by Puttaswamy), the right to a speedy trial from Article 21.

---

### Q4 (UPSC Prelims 2022, adapted)

Consider the following about Fundamental Duties:
1. They are enforceable by court.
2. They were added by the 42nd Amendment.
3. Originally there were 10 duties; the 11th was added by the 86th Amendment.

Which is/are correct?
(a) 1 and 2 only
(b) 2 and 3 only
(c) 1 and 3 only
(d) 1, 2 and 3

**Answer: (b) 2 and 3 only.**

**Why:** Statement 1 is the trap — Fundamental Duties are NON-justiciable (no court can compel compliance). Statements 2 and 3 are correct — the 42nd Amendment (1976) added Part IVA + Article 51A with 10 duties, on the Swaran Singh Committee's recommendation; the 86th Amendment (2002) added the 11th (parents/guardians to provide education to children 6–14).

**Pattern alert:** the non-justiciability of Fundamental Duties is a frequent test. They are "fundamental in the governance of the country" but not enforceable.`,
    },
    {
      kind: 'REVISION_NOTES',
      body: `## Fundamental Rights & Duties — last-night revision

**1. The 6 categories of FR (memorise the count):**
- Right to Equality (Articles 14–18)
- Right to Freedom (Articles 19–22)
- Right against Exploitation (Articles 23–24)
- Right to Freedom of Religion (Articles 25–28)
- Cultural + Educational Rights (Articles 29–30)
- Right to Constitutional Remedies (Article 32–35)

**2. Article 21 — the most-expanded right. The non-exhaustive list of rights read into Article 21:**
- Right to live with human dignity (Maneka Gandhi 1978 — the foundational case)
- Right to clean environment (Subhash Kumar 1991, M C Mehta 1996)
- Right to livelihood (Olga Tellis 1985)
- Right to shelter (Chameli Singh 1996)
- Right to health (Parmanand Katara 1989 — emergency medical care as a Fundamental Right)
- Right to privacy (Puttaswamy 2017 — explicitly declared)
- Right to education (added as 21A by 86th Amendment, 2002)
- Right to speedy trial (Hussainara Khatoon 1979)
- Right to legal aid (free legal services to the poor — the Legal Services Authorities Act 1987)
- Right against solitary confinement (Sunil Batra 1978)
- Right against hand-cuffing (citizens of free country — T V Vathil 1995)
- Right against delayed execution (death row — T V Vathil, Sher Singh 1983)
- Right to travel abroad (Satwant Singh 1967)
- Right against custodial violence (D K Basu 1997 — the DK Basu guidelines)
- Right to die with dignity — passive euthanasia (Common Cause 2018; active euthanasia still illegal)
- Right against 3rd-degree interrogation + torture
- Right to a fair trial
- Right to protection of cultural + linguistic minorities (also separately under Articles 29–30)

**3. Article 19 — the 6 freedoms + their restrictions:**
- 19(1)(a) Speech + expression — 8 grounds (sovereignty/integrity, security, friendly relations, public order, decency/morality, contempt of court, defamation, incitement to offence)
- 19(1)(b) Assembly — 2 grounds (sovereignty/integrity, public order). Must be peaceful + without arms
- 19(1)(c) Association — 4 grounds (the first 4 of speech)
- 19(1)(d) Movement — 2 grounds (interests of general public, protection of Scheduled Tribes)
- 19(1)(e) Residence + settlement — same 2 grounds as 19(1)(d)
- 19(1)(g) Profession/trade/business — 4 grounds (general public interest, professional/technical qualifications required, nationalisation, state monopoly)

**4. The 5 writs — name + meaning + use:**
| Writ | Literal meaning | Issued by | Issued against | Used when |
|---|---|---|---|---|
| Habeas Corpus | "You may have the body" | SC + HC | State + private individuals | Illegal detention — to produce the detainee |
| Mandamus | "We command" | SC + HC | Public authority (lower court, government, statutory body) | Failure to perform a public duty |
| Prohibition | "To forbid" | Higher court to lower | Lower court (during proceedings) | Lower court exceeding its jurisdiction |
| Certiorari | "To be certified" | Higher court to lower | Lower court (after order) | To transfer/quash for review |
| Quo Warranto | "By what authority" | SC + HC | Person holding public office | Office held without legal authority |

Note: Habeas Corpus + Mandamus can be issued against private individuals/bodies in some cases (the FR horizontal-application doctrine). Prohibition + Certiorari only against courts/tribunals. Quo Warranto against a person.

**5. The FR vs DPSP distinction — easy to confuse:**
| | FR | DPSP |
|---|---|---|
| Aim | Political — individual liberty | Socio-economic — collective welfare |
| Nature | Negative (restrictions on the state) | Positive (instructions to the state) |
| Enforceable | Yes — via Article 32 + 226 | No — but "fundamental in the governance" |
| Court | Justiciable | Non-justiciable (but used as an aid to interpretation) |
| Origin | US Bill of Rights | Irish Constitution |

The "harmonious construction" doctrine: when FR + DPSP conflict, courts try to harmonise — Article 31C (added by 25th Amendment, 1971) gives DPSP Article 39(b) + (c) primacy over Articles 14, 19 — but this itself was modified by Minerva Mills (1980) which struck down the extended version (that gave primacy to all DPSP).

**6. Key recent judgments (the "current-affairs-linked polity" question):**
- **Puttaswamy v. Union of India (2017):** Right to privacy declared a Fundamental Right under Article 21 — unanimous 9-judge bench
- **Sabarimala (Indian Young Lawyers Association, 2018):** Women of all ages allowed entry; fundamental right to religion subject to constitutional morality; reviewed (by a 5-judge bench, 2019 — referred to a 7-judge bench)
- **Decriminalisation of Section 377 (Navtej Singh Johar, 2018):** Sexual orientation part of Article 21 (right to privacy + dignity)
- **Adultery (Joseph Shine, 2018):** Section 497 IPC struck down — gender-neutral; Article 21 (right to dignity + privacy)
- **Article 370 abrogation (2019):** Reorganisation of J&K — currently pending before the SC (upheld in December 2023 — the SC's reasoning a key case study for federalism + basic structure)
- **Electoral Bonds (Association for Democratic Reforms, 2024):** Scheme struck down — violates right to information under Article 19(1)(a) + the principle of free + fair elections (basic structure)

**7. Fundamental Duties — fast facts:**
- Added by 42nd Amendment (1976), on Swaran Singh Committee recommendation
- 11th added by 86th Amendment (2002)
- Inspired by USSR Constitution (the only Constitution with explicit duties)
- Non-justiciable — but courts use them as an aid to interpretation (the AIIMS Students Union case, 2002 — the duty to protect the environment was used to uphold a tree-felling restriction)
- The Verma Committee (1999) recommended making some duties justiciable — not accepted`,
    },
  ],
}

// ============================================================================
// SSC CGL — Indian Polity and Constitution (Tier-I General Awareness)
// ============================================================================

const SSC_CGL_POLITY: ChapterNotes = {
  examSlug: 'ssc-cgl',
  chapterName: 'Indian Polity and Constitution',
  notes: [
    {
      kind: 'PATTERN_BRIEF',
      body: `## SSC CGL — Indian Polity & Constitution pattern brief

Polity is one of the 4 sub-sections of SSC CGL Tier-I's "General Awareness" section (the others: History, Geography, Economy + General Science). In a 25-question GA paper (worth 50 marks), Polity contributes 4–6 questions consistently every year — a stable, predictable chunk. The Polity share is smaller than UPSC's (4–6 vs ~15) but the per-question yield is similar because the section is high-accuracy (the syllabus is finite, the questions are factual).

**Question style is purely fact-recall** — the question names an article, an amendment, a body, a year, or a person, and asks for a direct match. NO "consider the following statements" multi-statement format (UPSC's favourite) — SSC prefers single-shot "Article X is about what?" / "The 73rd Amendment introduced what?" / "Who is the head of the Election Commission?" questions.

**Sub-topic weightage (last 5 years average, out of ~5 questions):**
- Important articles (especially Part III FR + Part IV DPSP + the schedules): 1–2 questions
- Constitutional amendments (especially 73rd, 74th, 86th, 42nd, 44th, 101st, 103rd): 1 question
- Constitutional bodies (President, PM, Parliament, EC, CAG, Finance Commission, Judiciary): 1–2 questions
- Panchayati Raj + Municipalities (heavily tested — 73rd/74th Amendments): 0–1 question
- National movements + freedom struggle (very occasionally): 0–1 question (sometimes overlaps with History)

**Preparation depth:** unlike UPSC, SSC doesn't test depth — it tests BREADTH. You need to know the names + numbers + years of every article, amendment, body. The 12 Schedules, the 25 Parts, the ~106 amendments — all should be at your fingertips. No need to know the cases (Kesavananda, Puttaswamy — these are UPSC-only).

**Time per question:** 30–40 seconds maximum. The SSC CGL General Awareness section is a sprint — 25 questions in 15 minutes. Know the fact, mark the answer, move on. NO analytical thinking required.

**Pattern alerts:**
- The "First" question: first PM (Nehru), first President (Rajendra Prasad), first CEC (Sukumar Sen), first CAG (V Narahari Rao), first woman CM (Sucheta Kripalani), first woman President (Pratibha Patil) — these come back year after year.
- The "Number" question: how many Fundamental Rights (6 categories / 12 articles originally — now 11 after 44th removed property), how many schedules (12), how many Fundamental Duties (11), how many members of Drafting Committee (7), how many Articles originally (395), how many amendments (currently 106).
- The "Who is the current X" question: SSC often asks about the current office-holder. Always check the latest incumbent before the exam.`,
    },
    {
      kind: 'CHEAT_SHEET',
      body: `## SSC CGL — Polity cheat sheet (fact-recall heavy)

### The Constitution — numbers to memorise
- Adopted: 26 Nov 1949; enforced: 26 Jan 1950
- Original: 395 Articles + 22 Parts + 8 Schedules
- Today: 470 Articles + 25 Parts + 12 Schedules (after 106 amendments)
- Time to draft: 2 years 11 months 18 days
- Constituent Assembly members: 389 (299 after partition)
- Cost: ₹64 lakh
- Drafting Committee: 7 members, Dr B R Ambedkar (Chairman)
- Permanent President of Constituent Assembly: Dr Rajendra Prasad
- First temporary President: Dr Sachchidananda Sinha

### The 12 Schedules — know what each one is about (the most-tested):
1. **Schedule 1:** States + UTs (names + territories)
2. **Schedule 2:** Emoluments, allowances, privileges of President, Governors, Speaker, etc.
3. **Schedule 3:** Oaths + affirmations
4. **Schedule 4:** Allocation of seats in Rajya Sabha (per state)
5. **Schedule 5:** Administration of Scheduled Areas + Tribes (excluding Assam, Meghalaya, Tripura, Mizoram)
6. **Schedule 6:** Administration of Tribal Areas in Assam, Meghalaya, Tripura, Mizoram (autonomous districts + councils)
7. **Schedule 7:** Three Lists — Union (97 originally), State (66), Concurrent (47) — distribution of legislative powers
8. **Schedule 8:** 22 official languages (originally 14 — added over time; the latest additions: Bodo, Dogri, Maithili, Santali by 92nd Amendment, 2003; Sindhi was added by 21st Amendment, 1967; Konkani, Manipuri, Nepali by 71st Amendment, 1992)
9. **Schedule 9:** Laws that cannot be challenged in court (added by 1st Amendment, 1951; later laws added by various amendments — I R Coelho 2007 opened them to judicial review)
10. **Schedule 10:** Anti-defection (added by 52nd Amendment, 1985)
11. **Schedule 11:** Panchayati Raj (added by 73rd Amendment, 1992 — 29 subjects)
12. **Schedule 12:** Municipalities (added by 74th Amendment, 1992 — 18 subjects)

### The 6 categories of Fundamental Rights (Part III, Articles 12–35):
1. **Right to Equality (Articles 14–18)** — Article 14 (equality before law + equal protection), 15 (no discrimination), 16 (equal opportunity in employment), 17 (untouchability abolished), 18 (titles abolished)
2. **Right to Freedom (Articles 19–22)** — Article 19 (6 freedoms), 20 (protection in conviction), 21 (right to life + personal liberty), 21A (right to education), 22 (protection against arrest + detention)
3. **Right against Exploitation (Articles 23–24)** — Article 23 (no trafficking + forced labour), 24 (no child labour in factories/mines/hazardous occupations under 14)
4. **Right to Freedom of Religion (Articles 25–28)** — Article 25 (freedom of conscience + religion), 26 (manage religious affairs), 27 (no taxes for religion), 28 (no religious instruction in wholly state-funded schools)
5. **Cultural + Educational Rights (Articles 29–30)** — Article 29 (protection of language + culture), 30 (minorities to establish + administer educational institutions)
6. **Right to Constitutional Remedies (Article 32)** — Dr Ambedkar: "heart and soul of the Constitution." 5 writs: Habeas Corpus, Mandamus, Prohibition, Certiorari, Quo Warranto

### Important articles to memorise (high-yield):
- Article 14: equality before law
- Article 19: 6 freedoms
- Article 21: right to life + personal liberty
- Article 21A: right to education (added by 86th Amendment, 2002)
- Article 32: constitutional remedies
- Article 44: Uniform Civil Code (DPSP — unimplemented)
- Article 51A: Fundamental Duties
- Article 243: Panchayati Raj (added by 73rd Amendment)
- Article 280: Finance Commission
- Article 312: All-India Services
- Article 324: Election Commission
- Article 352: National Emergency
- Article 356: President's Rule (State Emergency)
- Article 360: Financial Emergency (never invoked)
- Article 368: Amendment of the Constitution

### Amendments — the high-yield ones:
- 1st (1951): restrictions on freedom of speech + 9th Schedule (laws immune from judicial review — Coelho 2007 opened it for review post-1973)
- 42nd (1976): "mini-Constitution" — added Fundamental Duties, "Socialist Secular" in Preamble, made DPSP override FR
- 44th (1978): undid 42nd excesses; right to property removed from FR (made a legal right under Article 300A)
- 52nd (1985): anti-defection (10th Schedule)
- 61st (1988): voting age 21 → 18
- 73rd (1992): Panchayati Raj (Part IX + Schedule 11)
- 74th (1992): Municipalities (Part IXA + Schedule 12)
- 86th (2002): Right to Education (Article 21A)
- 92nd (2003): Bodo, Dogri, Maithili, Santali added to 8th Schedule
- 101st (2016): GST (created the GST Council — Article 279A)
- 103rd (2019): 10% EWS reservation
- 105th (2021): states' power to identify OBCs restored (NCBC's role on state lists made advisory-only)
- 106th (2023): women's reservation — 1/3 reservation for women in Lok Sabha + state assemblies (effective after delimitation, ~2029)

### Constitutional bodies — head + key fact:
- **President:** head of state; elected by an Electoral College (elected MPs + MLAs of states + UTs with legislative assemblies); 5-year term; impeachment for "violation of the Constitution" (Article 61) — 2/3 majority of both houses
- **Vice President:** ex-officio Chairperson of Rajya Sabha; elected by an Electoral College of both Houses (NOT state legislatures)
- **Prime Minister:** head of government; appointed by the President; must be a member of either House of Parliament (or become one within 6 months)
- **Chief Justice of India:** head of the judiciary; appointed by the President; senior-most judge of the SC; retirement at 65
- **Election Commission of India (Article 324):** Chief Election Commissioner + 2 Election Commissioners (since 1993); CEC has the same removal protection as an SC judge; the 2 ECs do NOT
- **Comptroller and Auditor General (Article 148):** "guardian of the public purse"; audits Union + State accounts; appointed by the President; 6-year term OR age 65, whichever earlier; same removal protection as an SC judge
- **Attorney General of India (Article 76):** first law officer of the Government of India; appointed by the President; must be qualified to be an SC judge; has the right to audience in all courts in India
- **Finance Commission (Article 280):** constituted by the President every 5 years; recommends the distribution of tax revenues between the Union + the States; currently the 16th Finance Commission (chairman Arvind Panagariya, 2023-25)
- **UPSC (Article 315):** recruitment to All-India + Central services; chairman + members appointed by the President; chairman's term: 6 years OR age 65`,
    },
    {
      kind: 'WORKED_MCQ',
      body: `## SSC CGL Polity — practice MCQs (fact-recall pattern)

### Q1

The Right to Education was added as a Fundamental Right by which Constitutional Amendment?
(a) 86th Amendment
(b) 73rd Amendment
(c) 92nd Amendment
(d) 42nd Amendment

**Answer: (a) 86th Amendment (2002).**

**Why:** The 86th Amendment added Article 21A — "The State shall provide free and compulsory education to all children of the age of 6 to 14 years." The Right to Education Act 2009 operationalised it. The amendment also added a Fundamental Duty (11th, in Article 51A) — parents/guardians to provide education opportunities to their children 6–14.

**Pattern alert:** SSC tests amendments by number + content. The 86th (RTE), 73rd (Panchayats), 74th (Municipalities), 42nd (mini-Constitution), 44th (right to property removed), 52nd (anti-defection), 61st (voting age 18), 101st (GST), 103rd (EWS), 106th (women's reservation) — these are the high-frequency amendments. Know them cold.

---

### Q2

The 73rd Constitutional Amendment is associated with:
(a) Anti-defection law
(b) Panchayati Raj
(c) Municipalities
(d) Right to Education

**Answer: (b) Panchayati Raj.**

**Why:** The 73rd Amendment (1992) added Part IX (Articles 243 to 243O) + Schedule 11 (29 subjects devolved to panchayats) to the Constitution. It established a 3-tier Panchayati Raj structure (village, intermediate, district — except where population is under 20 lakh, where 2 tiers are allowed). Reservation for SC/ST (in proportion to population) + 1/3 reservation for women.

The 74th Amendment is associated with Municipalities. The 52nd with anti-defection. The 86th with RTE.

**Pattern alert:** SSC loves the "X Amendment is associated with Y" format. The 73rd/74th pair (both 1992 — local self-government) is a frequent test.

---

### Q3

The Chief Election Commissioner of India has the same removal process as:
(a) The Prime Minister
(b) A Judge of the Supreme Court
(c) The Governor of a state
(d) The Speaker of Lok Sabha

**Answer: (b) A Judge of the Supreme Court.**

**Why:** Article 324(5) of the Constitution provides that the Chief Election Commissioner shall not be removed from office except in the same manner + on the same grounds as a Judge of the Supreme Court — i.e. by impeachment (a 2/3 majority of both houses of Parliament, on grounds of proved misbehaviour or incapacity). The two Election Commissioners (the other 2 members of the Election Commission) do NOT have this protection — they can be removed by the President on the CEC's recommendation.

**Pattern alert:** The "same removal as SC judge" privilege extends to: CEC, CAG, Chairman UPSC (a slightly weaker version — but the same impeachment process for "proved misbehaviour or incapacity"), State Election Commissioner, Chairman of the National Commissions for SCs, STs, OBCs, Minorities, Women.

---

### Q4

How many Fundamental Duties are there in the Indian Constitution?
(a) 10
(b) 11
(c) 12
(d) 13

**Answer: (b) 11.**

**Why:** The Fundamental Duties were added by the 42nd Amendment (1976) in Part IVA + Article 51A, on the Swaran Singh Committee recommendation. Originally there were 10 duties; the 11th (parents/guardians to provide opportunities for education to their children 6–14 years) was added by the 86th Amendment (2002), which also added Article 21A (Right to Education). Currently there are 11.

**Pattern alert:** SSC tests "the count" frequently — 11 Fundamental Duties, 12 Schedules, 6 categories of FR (Part III Articles 12–35), 22 official languages (Schedule 8), 25 Parts of the Constitution.`,
    },
    {
      kind: 'REVISION_NOTES',
      body: `## SSC CGL Polity — quick revision sheet (night before)

**1. The Constitution — quick stats:**
- Adopted: 26 Nov 1949 (some provisions effective immediately); enforced: 26 Jan 1950
- Original: 395 Articles + 22 Parts + 8 Schedules
- Today: ~470 Articles + 25 Parts + 12 Schedules (after 106 amendments)
- Drafting time: 2 years 11 months 18 days
- Members: 389 originally (299 after partition)
- Cost: ₹64 lakh
- Drafting Committee chair: Dr B R Ambedkar
- Constituent Assembly President: Dr Rajendra Prasad
- First temporary President: Dr Sachchidananda Sinha (9 Dec 1946 — first meeting)
- Constitution Day: 26 Nov (celebrated since 2015)
- Republic Day: 26 Jan

**2. Borrowed features — the SSC favourite table:**

| Borrowed from | What we took |
|---|---|
| UK | Parliamentary system, rule of law, single citizenship, Parliamentary privileges, writs |
| USA | Fundamental Rights, Judicial review, Preamble, Vice President, Independence of judiciary |
| Ireland | DPSP, election of President, nomination of 12 members to Rajya Sabha |
| Canada | Federalism with strong centre, residuary powers with centre |
| Australia | Concurrent list, freedom of trade + commerce (Article 301) |
| USSR | Fundamental Duties, Five-Year Plans |
| Japan | "Procedure established by law" (Article 21) |
| Weimar | Emergency provisions (suspension of FR) |
| South Africa | Procedure for amendment (Article 368) |
| France | Republic + the ideals of liberty, equality, fraternity |

**3. Preamble keywords:** Sovereign, Socialist, Secular (last 2 added by 42nd Amendment, 1976), Democratic, Republic. Justice (social, economic, political), Liberty (thought, expression, belief, faith, worship), Equality (status + opportunity), Fraternity (dignity of individual, unity + integrity — last 2 words added by 42nd Amendment). The Preamble is part of the Constitution (Kesavananda Bharati 1973).

**4. Sources of the Indian Constitution — Wikipedia-style quick recall:**
- Parliamentary form: UK
- Single citizenship: UK + Canada
- Federal scheme: Canada
- Fundamental Rights: USA
- DPSP: Ireland
- Fundamental Duties: USSR
- Emergency: Weimar Republic (Germany)
- Concurrent list: Australia
- Procedure for amendment: South Africa
- Five-Year Plans: USSR
- Preamble: USA
- Right to constitutional remedies / writs: UK

**5. The 5 writs (Article 32 + 226):**
- **Habeas Corpus** ("you may have the body") — against illegal detention
- **Mandamus** ("we command") — against a public authority failing to perform a duty
- **Prohibition** ("to forbid") — higher court to a lower court, during proceedings
- **Certiorari** ("to be certified") — higher court to lower, after order
- **Quo Warranto** ("by what authority") — against a person unlawfully holding public office

**6. Constitutional bodies — quick recall:**
- **President:** 5-year term; impeachment for "violation of Constitution"; elected by Electoral College (MPs + MLAs of states + UTs with assemblies)
- **Vice President:** ex-officio Chairperson of Rajya Sabha; 5-year term
- **Prime Minister:** appointed by President; leader of majority in Lok Sabha
- **Chief Justice of India:** senior-most SC judge; retires at 65
- **Election Commission:** CEC + 2 ECs (since 1993); CEC's removal = SC judge's
- **CAG:** 6-year term OR 65, whichever earlier; "guardian of the public purse"
- **Attorney General:** first law officer of the Government of India
- **Finance Commission:** every 5 years; 16th currently (Arvind Panagariya, 2023-25)
- **UPSC:** chairman + 10 members; 6-year term OR 65; recruitment for All-India + Central services
- **NITI Aayog:** (NOT a constitutional body — set up by executive resolution, 2015; replaced the Planning Commission which was also non-constitutional)

**7. Constitutional vs statutory bodies — know the difference (a frequent trap):**
- **Constitutional (mentioned in the Constitution):** Election Commission (Art 324), CAG (Art 148), Finance Commission (Art 280), UPSC (Art 315), NCBC (Art 338B — after 102nd Amendment, 2018), NCSC (Art 338), NCST (Art 338A), Attorney General (Art 76), Advocate General (Art 165)
- **Statutory (created by an Act of Parliament):** NHRC (Protection of Human Rights Act 1993), NCW (National Commission for Women Act 1990), NCBC (was statutory before 102nd Amendment — the constitutional version post-2018 is separate), CIC (Central Information Commission — RTI Act 2005), CVC (Central Vigilance Commission — set up by executive resolution 1964; statutory status via CVC Act 2003), Lokpal (Lokpal + Lokayuktas Act 2013)

**8. Quick "firsts":**
- First PM: Jawaharlal Nehru (1947)
- First President: Dr Rajendra Prasad (1950)
- First Vice President: Dr S Radhakrishnan (1952)
- First Speaker of Lok Sabha: G V Mavalankar
- First CJI: H J Kania
- First CEC: Sukumar Sen
- First CAG: V Narahari Rao
- First woman PM: Indira Gandhi
- First woman President: Pratibha Patil (2007)
- First woman CM: Sucheta Kripalani (UP, 1963)
- First woman Governor: Sarojini Naidu (UP, 1947)
- First Chief Election Commissioner post-independence: Sukumar Sen (1950)
- First Chief Justice of India: H J Kania (1950)
- First Lokpal: Pinaki Chandra Ghose (2019)`,
    },
  ],
}

// ============================================================================
// AFCAT — General Awareness — history, geography & polity
// ============================================================================

const AFCAT_GENERAL_AWARENESS: ChapterNotes = {
  examSlug: 'afcat',
  chapterName: 'General Awareness — history, geography & polity',
  notes: [
    {
      kind: 'PATTERN_BRIEF',
      body: `## AFCAT — General Awareness pattern brief

AFCAT's General Awareness section is part of the 100-question paper (the other sections: English, Numerical Ability, Reasoning + Military Aptitude). General Awareness contributes 25–30 questions out of 100 (worth 75–90 marks out of 300 — each question carries 3 marks, with 1 negative for wrong answers). The section is broad — it covers static GK (history, geography, polity, science) + current affairs (last 6 months). Polity typically gets 4–7 questions per AFCAT sitting (held twice a year, February + August).

**Question style is purely fact-recall** — single-shot "X is the author of Y" / "Article X is about Y" / "The first woman CM of an Indian state was" format. NO multi-statement analytical questions (unlike UPSC). The pattern is closer to SSC CGL than UPSC Prelims.

**Sub-topic weightage (last 4 sittings average, out of ~5 Polity questions):**
- Important articles + schedules: 1–2 questions
- Constitutional amendments (especially 73rd, 74th, 86th, 42nd): 1 question
- Constitutional bodies (President, PM, EC, CAG): 1–2 questions
- Panchayati Raj + Municipalities: 0–1 question
- Books + authors (with a freedom-struggle or polity theme): 0–1 question
- Static misc (firsts, important days, who is the current X): 1 question

**Time per question:** 30–40 seconds max. The General Awareness section is the time-maker — answer the GK first, save the Quantitative Aptitude + Reasoning for the rest. The total paper has 2 hours for 100 questions = 1.2 minutes per question; GK should be faster.

**Defence linkage:** some AFCAT polity questions have a defence linkage — the President as Supreme Commander of the Armed Forces, the Defence Minister's role, the Chiefs of Staff Committee, the role of the Raksha Mantri. These are general polity knowledge + a defence-context overlay.

**Preparation depth:** AFCAT doesn't test depth — it tests the basic facts. Know the structure of the Constitution (Parts + Schedules), the amendments (especially the high-yield ones), the constitutional bodies (head + key fact), and the "firsts." Do NOT go deep into case law (Kesavananda, Puttaswamy — these are UPSC territory, not AFCAT).

**Pattern alerts:**
- The "current incumbent" question — AFCAT asks about the current President / Vice President / CJI / CEC / Chief of Defence Staff. Check the latest incumbents before the exam.
- The "first/last" question — first PM, first President, first woman CM, first CDS (General Bipin Rawat, 2020 — died in a helicopter crash, December 2021).
- The "who wrote which book" question — Discovery of India (Nehru), India Wins Freedom (Azad), The Indian Struggle (Subhas Chandra Bose), Hind Swaraj (Gandhi), Universe in a Nutshell (Hawking — random).`,
    },
    {
      kind: 'CHEAT_SHEET',
      body: `## AFCAT General Awareness — Polity cheat sheet

### The Constitution — must-know basics
- Adopted: 26 Nov 1949; enforced: 26 Jan 1950
- Original: 395 Articles + 22 Parts + 8 Schedules
- Today: ~470 Articles + 25 Parts + 12 Schedules
- Drafted in 2 years 11 months 18 days
- Cost: ₹64 lakh; 11 sessions; 389 members (299 after partition)
- Drafting Committee chair: Dr B R Ambedkar
- Permanent President of Constituent Assembly: Dr Rajendra Prasad
- First temporary President: Dr Sachchidananda Sinha
- Constitution Day: 26 November (since 2015)

### The 12 Schedules (high-yield — know what each is about)
1. **States + UTs** (territories)
2. **Emoluments, allowances** of President, Governors, Speaker etc.
3. **Oaths + affirmations**
4. **Allocation of seats** in Rajya Sabha
5. **Scheduled Areas + Tribes** (excluding Assam, Meghalaya, Tripura, Mizoram)
6. **Tribal Areas** in Assam, Meghalaya, Tripura, Mizoram (autonomous districts/councils)
7. **Three Lists** — Union (100), State (61), Concurrent (52) — distribution of legislative powers
8. **22 official languages** (originally 14)
9. **Laws immune from judicial review** (added by 1st Amendment 1951; opened by I R Coelho 2007)
10. **Anti-defection** (added by 52nd Amendment, 1985)
11. **Panchayati Raj** (added by 73rd Amendment, 1992 — 29 subjects)
12. **Municipalities** (added by 74th Amendment, 1992 — 18 subjects)

### The 6 categories of Fundamental Rights (Part III, Articles 12–35)
1. **Right to Equality** (Articles 14–18) — equality before law, no discrimination, equal opportunity in employment, untouchability abolished, titles abolished
2. **Right to Freedom** (Articles 19–22) — 6 freedoms (speech, assembly, association, movement, residence, profession), protection against arrest
3. **Right against Exploitation** (Articles 23–24) — no trafficking, no child labour under 14 in factories/mines
4. **Right to Freedom of Religion** (Articles 25–28) — freedom of conscience, manage religious affairs, no taxes for religion, no religious instruction in wholly state-funded schools
5. **Cultural + Educational Rights** (Articles 29–30) — protection of language + culture, minorities to establish educational institutions
6. **Right to Constitutional Remedies** (Article 32) — 5 writs: Habeas Corpus, Mandamus, Prohibition, Certiorari, Quo Warranto

### Fundamental Duties (Article 51A, Part IVA — added by 42nd Amendment 1976)
- Originally 10; 11th added by 86th Amendment (2002)
- Currently 11 duties
- Non-justiciable
- Inspired by USSR Constitution

### Important constitutional bodies — the AFCAT-tested facts
- **President of India:** head of state; 5-year term; Supreme Commander of the Armed Forces; impeachment for "violation of Constitution" — 2/3 majority of both Houses
- **Vice President:** ex-officio Chairperson of Rajya Sabha; elected by Electoral College of both Houses of Parliament (NOT state legislatures); 5-year term
- **Prime Minister:** head of government; leader of the majority party/coalition in Lok Sabha; appointed by President; real executive authority
- **Chief Justice of India:** head of the judiciary; senior-most judge of SC; retires at 65
- **Election Commission of India:** Article 324; CEC + 2 ECs since 1993; CEC's removal = SC judge's (impeachment); the 2 ECs do NOT have this protection
- **Comptroller and Auditor General:** Article 148; "guardian of the public purse"; audits Union + State accounts; 6-year term OR age 65
- **Attorney General of India:** Article 76; first law officer of the Government of India; has right of audience in all courts in India
- **Finance Commission:** Article 280; every 5 years; recommends tax devolution between Union + States; 16th currently (Arvind Panagariya, 2023-25)
- **UPSC:** Article 315; recruitment to All-India + Central services; chairman + 10 members
- **NITI Aayog:** NOT a constitutional body — set up by executive resolution (1 January 2015); replaced the Planning Commission (also non-constitutional, set up 1950)

### High-yield amendments
- **42nd (1976):** "mini-Constitution" — added Fundamental Duties, "Socialist Secular" in Preamble
- **44th (1978):** right to property removed from FR (made legal right under Article 300A)
- **52nd (1985):** anti-defection law (10th Schedule)
- **61st (1988):** voting age 21 → 18
- **73rd (1992):** Panchayati Raj (Part IX + Schedule 11)
- **74th (1992):** Municipalities (Part IXA + Schedule 12)
- **86th (2002):** Right to Education (Article 21A)
- **101st (2016):** GST (created GST Council — Article 279A)
- **103rd (2019):** 10% EWS reservation
- **106th (2023):** women's reservation (1/3 in Lok Sabha + state assemblies — effective after delimitation ~2029)

### Defence-related polity (AFCAT-specific)
- **President:** Supreme Commander of the Indian Armed Forces (Army, Navy, Air Force)
- **Defence Minister (Raksha Mantri):** head of the Ministry of Defence; political head of the armed forces
- **Chief of Defence Staff (CDS):** created 2019; first CDS: General Bipin Rawat (Jan 2020 — died in helicopter crash Dec 2021); 4-star rank; head of the Department of Military Affairs; permanent Chairperson of the Chiefs of Staff Committee; single-point military advisor to the government
- **Chiefs of Staff:** Chief of Army Staff (COAS), Chief of Naval Staff (CNS), Chief of Air Staff (CAS) — all 4-star rank; rotate as Chairperson of the Chiefs of Staff Committee (rotational until CDS was created)
- **Agnipath Scheme:** introduced 2022 — short-term recruitment (4 years) into the armed forces as "Agniveers"`,
    },
    {
      kind: 'WORKED_MCQ',
      body: `## AFCAT Polity — practice MCQs (single-shot fact-recall pattern)

### Q1

Who is the Supreme Commander of the Indian Armed Forces?
(a) The Prime Minister
(b) The President of India
(c) The Defence Minister
(d) The Chief of Defence Staff

**Answer: (b) The President of India.**

**Why:** Article 53 of the Constitution vests the supreme command of the Defence Forces of the Union in the President of India. The President exercises this supreme command through the Defence Minister (who heads the Ministry of Defence) + the Chiefs of Staff. The President's role is largely formal — actual operational + administrative control rests with the Defence Minister (political) + the Chiefs of Staff (military). The Chief of Defence Staff (CDS) is the single-point military advisor to the government — a 4-star rank created in 2019; the first CDS was General Bipin Rawat (2020-21).

**Pattern alert:** AFCAT loves this question — it tests both the constitutional fact (President's role) + the defence linkage. Know the President's formal title (Supreme Commander) + the actual operational chain (President → Defence Minister → CDS → Chiefs of Staff).

---

### Q2

The 73rd Constitutional Amendment is associated with:
(a) Anti-defection law
(b) Panchayati Raj
(c) Municipalities
(d) Right to Education

**Answer: (b) Panchayati Raj.**

**Why:** The 73rd Amendment (1992) added Part IX (Articles 243 to 243O) + Schedule 11 (29 subjects devolved to panchayats) to the Constitution. It established a 3-tier Panchayati Raj structure (village, intermediate, district — except where population is under 20 lakh, where 2 tiers are allowed). Reservation for SC/ST (in proportion to population) + 1/3 reservation for women.

The 74th Amendment is associated with Municipalities. The 52nd with anti-defection. The 86th with RTE.

**Pattern alert:** AFCAT (like SSC) tests amendments by number + content. The 73rd/74th pair (both 1992 — local self-government) is a frequent test. The 86th (RTE) and 42nd (mini-Constitution) are also high-yield.

---

### Q3

The Chief Election Commissioner of India has the same removal process as:
(a) The Prime Minister
(b) A Judge of the Supreme Court
(c) The Governor of a state
(d) The Speaker of Lok Sabha

**Answer: (b) A Judge of the Supreme Court.**

**Why:** Article 324(5) — the CEC shall not be removed except in the same manner + on the same grounds as a Judge of the Supreme Court (i.e. by impeachment — a 2/3 majority of both houses of Parliament, on grounds of proved misbehaviour or incapacity). The 2 Election Commissioners (the other members of the Election Commission) do NOT have this protection — they can be removed by the President on the CEC's recommendation.

**Pattern alert:** the "same removal as SC judge" privilege extends to: CEC, CAG, Chairman UPSC, State Election Commissioner, Chairman of the National Commissions for SCs, STs, OBCs, Minorities, Women. AFCAT tests this fact directly.

---

### Q4

How many Fundamental Duties are there in the Indian Constitution?
(a) 10
(b) 11
(c) 12
(d) 13

**Answer: (b) 11.**

**Why:** Fundamental Duties were added by the 42nd Amendment (1976) in Part IVA + Article 51A — originally 10 duties. The 11th (parents/guardians to provide opportunities for education to their children 6–14) was added by the 86th Amendment (2002), which also added Article 21A (Right to Education). Currently 11.

**Pattern alert:** AFCAT tests "the count" — 11 Fundamental Duties, 12 Schedules, 6 categories of FR, 22 official languages (Schedule 8), 25 Parts of the Constitution. Memorise the counts.

---

### Q5

The first Chief of Defence Staff (CDS) of India was:
(a) General Bipin Rawat
(b) General M M Naravane
(c) Air Chief Marshal R K S Bhadauria
(d) Admiral Karambir Singh

**Answer: (a) General Bipin Rawat.**

**Why:** The post of Chief of Defence Staff was created in 2019. The first CDS was General Bipin Rawat — appointed on 1 January 2020, took charge on 31 December 2019. He was a 4-star general; previously the Chief of Army Staff (2016-2019). He died in a helicopter crash near Coonoor, Tamil Nadu on 8 December 2021. The CDS is the single-point military advisor to the government + the permanent Chairperson of the Chiefs of Staff Committee + the head of the Department of Military Affairs.

The other 3 listed were the service chiefs at the time of CDS Rawat's appointment: General M M Naravane (COAS), Air Chief Marshal R K S Bhadauria (CAS), Admiral Karambir Singh (CNS).

**Pattern alert:** AFCAT tests defence-specific facts more than SSC CGL does. The CDS post (created 2019), the first CDS (Rawat), the rank (4-star), the role (single-point advisor + permanent Chairman COSC + head DMA) — all high-yield. The Agnipath scheme (2022) is also tested.`,
    },
    {
      kind: 'REVISION_NOTES',
      body: `## AFCAT Polity — quick revision sheet (night before)

**1. The Constitution — quick stats:**
- Adopted: 26 Nov 1949; enforced: 26 Jan 1950
- Original: 395 Articles + 22 Parts + 8 Schedules
- Today: ~470 Articles + 25 Parts + 12 Schedules (after 106 amendments)
- Drafted in 2 years 11 months 18 days; cost ₹64 lakh; 11 sessions
- Drafting Committee chair: Dr B R Ambedkar
- Constituent Assembly President: Dr Rajendra Prasad
- First temporary President: Dr Sachchidananda Sinha (9 Dec 1946 — first meeting)
- Constitution Day: 26 November (since 2015)
- Republic Day: 26 January

**2. The Preamble — keywords:** Sovereign, Socialist, Secular (last 2 added by 42nd Amendment 1976), Democratic, Republic. Justice (social, economic, political), Liberty (thought, expression, belief, faith, worship), Equality (status + opportunity), Fraternity (dignity of individual + unity + integrity — last 2 words added by 42nd Amendment). Source: USA (drawn from Nehru's Objectives Resolution, 13 Dec 1946).

**3. Sources of the Indian Constitution — the high-yield table:**
| Borrowed from | What we took |
|---|---|
| UK | Parliamentary system, rule of law, single citizenship, Parliamentary privileges, writs |
| USA | Fundamental Rights, Judicial review, Preamble, Vice President, Independence of judiciary |
| Ireland | DPSP, election of President, nomination of 12 to Rajya Sabha |
| Canada | Federalism with strong centre, residuary powers with centre |
| Australia | Concurrent list, freedom of trade + commerce (Article 301) |
| USSR | Fundamental Duties, Five-Year Plans |
| Japan | "Procedure established by law" (Article 21) |
| Weimar | Emergency provisions (suspension of FR) |
| South Africa | Procedure for amendment (Article 368) |
| France | Republic + the ideals of liberty, equality, fraternity |

**4. Fundamental Rights (6 categories, Part III Articles 12–35):**
- Right to Equality (Articles 14–18)
- Right to Freedom (Articles 19–22) — 6 freedoms under Article 19
- Right against Exploitation (Articles 23–24)
- Right to Freedom of Religion (Articles 25–28)
- Cultural + Educational Rights (Articles 29–30)
- Right to Constitutional Remedies (Article 32) — the 5 writs

**5. The 5 writs (Article 32 + 226):**
- **Habeas Corpus** ("you may have the body") — against illegal detention
- **Mandamus** ("we command") — against a public authority failing a duty
- **Prohibition** ("to forbid") — higher court to a lower court, during proceedings
- **Certiorari** ("to be certified") — higher court to lower, after the order
- **Quo Warranto** ("by what authority") — against a person unlawfully holding public office

**6. Constitutional bodies — quick recall:**
- **President:** 5-year term; Supreme Commander of Armed Forces; impeachment for violation of Constitution (Article 61)
- **Vice President:** ex-officio Chairperson of Rajya Sabha; 5-year term
- **Prime Minister:** appointed by President; leader of majority in Lok Sabha
- **Chief Justice of India:** senior-most SC judge; retires at 65
- **Election Commission:** CEC + 2 ECs (since 1993); CEC's removal = SC judge's
- **CAG:** 6-year term OR 65; "guardian of the public purse"
- **Attorney General:** first law officer of the Government of India
- **Finance Commission:** every 5 years; 16th currently (Arvind Panagariya, 2023-25)
- **UPSC:** recruitment for All-India + Central services

**7. The amendments to remember (high-yield for AFCAT):**
- 42nd (1976): mini-Constitution — Fundamental Duties, "Socialist Secular" in Preamble
- 44th (1978): right to property removed from FR
- 52nd (1985): anti-defection law
- 61st (1988): voting age 21 → 18
- 73rd (1992): Panchayati Raj
- 74th (1992): Municipalities
- 86th (2002): Right to Education
- 101st (2016): GST
- 103rd (2019): 10% EWS reservation
- 106th (2023): women's reservation (effective after delimitation ~2029)

**8. Defence-specific polity facts (AFCAT-special):**
- **President:** Supreme Commander of the Indian Armed Forces (Army, Navy, Air Force)
- **Defence Minister (Raksha Mantri):** political head of the armed forces; head of the Ministry of Defence
- **Chief of Defence Staff (CDS):** 4-star rank; created 2019; first CDS: General Bipin Rawat (2020-21 — died in a helicopter crash near Coonoor on 8 Dec 2021). Head of Department of Military Affairs; permanent Chairman of the Chiefs of Staff Committee; single-point military advisor to the government.
- **Service Chiefs:** COAS (Chief of Army Staff), CNS (Chief of Naval Staff), CAS (Chief of Air Staff) — all 4-star
- **Agnipath Scheme (2022):** short-term recruitment (4 years) into the armed forces as "Agniveers" — 25% retained for regular service; the rest discharged with a severance package

**9. Important books + authors (the "who wrote what" pattern):**
- **Discovery of India:** Jawaharlal Nehru (written during his Ahmednagar Fort imprisonment, 1942-46)
- **India Wins Freedom:** Maulana Abul Kalam Azad
- **The Indian Struggle:** Subhas Chandra Bose
- **Hind Swaraj:** M K Gandhi (1909 — written in Gujarati aboard the SS Kildonan Castle, sailing from London to South Africa)
- **My Experiments with Truth:** M K Gandhi (autobiography)
- **The Mansion of Bliss:** (NOT a polity book — random author trap)
- **Anandmath:** Bankim Chandra Chatterjee (the song Vande Mataram is from this 1882 novel)
- **Neel Darpan:** Dinabandhu Mitra (1860 — exposed the indigo planters' exploitation of Bengali farmers)

**10. Firsts to memorise:**
- First PM: Jawaharlal Nehru (15 August 1947)
- First President: Dr Rajendra Prasad (1950)
- First Vice President: Dr S Radhakrishnan (1952)
- First Speaker of Lok Sabha: G V Mavalankar
- First CJI: H J Kania (1950)
- First CEC: Sukumar Sen (1950)
- First CAG: V Narahari Rao
- First woman PM: Indira Gandhi (1966)
- First woman President: Pratibha Patil (2007)
- First woman CM: Sucheta Kripalani (UP, 1963)
- First woman Governor: Sarojini Naidu (UP, 1947 — first Indian woman Governor)
- First CDS: General Bipin Rawat (2020)
- First Indian to receive the Bharat Ratna: Dr S Radhakrishnan, C Rajagopalachari, C V Raman (1954 — the first three recipients)
- First Indian woman in space: Kalpana Chawla (1997 — NASA astronaut, died in the Columbia disaster, 1 February 2003)`,
    },
  ],
}

// ============================================================================
// The chapters we'll author notes for
// ============================================================================

const ALL_NOTES: ChapterNotes[] = [
  UPSC_POLITY_GOVERNANCE,
  UPSC_CONSTITUTION_HISTORICAL,
  UPSC_FR_FD,
  SSC_CGL_POLITY,
  AFCAT_GENERAL_AWARENESS,
]

// ============================================================================
// The main authoring function — idempotent upserts
// ============================================================================

const ADMIN_USER_ID = 'cmuhqvuf3000ij1ysl9e4986x' // admin@gksetu.dev (ADMIN role)

async function main() {
  console.log('SITE-S13-D: authoring ExamNotes (5 chapters × 4 kinds = 20 notes)…\n')

  let created = 0
  let skipped = 0
  let published = 0

  for (const chapterNotes of ALL_NOTES) {
    const { examSlug, chapterName, notes } = chapterNotes
    console.log(`\n=== Exam: ${examSlug}`)
    console.log(`=== Chapter: ${chapterName}`)
    console.log(`=== ${notes.length} notes to author`)

    // Find the exam + its current version + the syllabus node matching the chapter name.
    const exam = await db.exam.findUnique({
      where: { slug: examSlug },
      select: {
        id: true,
        slug: true,
        name: true,
        countryId: true,
        status: true,
        versions: {
          where: {
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }],
          },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { id: true, label: true },
        },
      },
    })
    if (!exam) {
      console.log(`  ! Exam not found — skipping.`)
      continue
    }
    if (!exam.versions[0]) {
      console.log(`  ! No current version found — skipping.`)
      continue
    }
    const versionId = exam.versions[0].id

    // Find the syllabus node (chapter) by name.
    const node = await db.syllabusNode.findFirst({
      where: { examVersionId: versionId, name: chapterName },
      select: { id: true, name: true, depth: true },
    })
    if (!node) {
      console.log(`  ! Chapter "${chapterName}" not found in version ${versionId} — skipping.`)
      // Print the available chapter names so the user can fix the script.
      const allNodes = await db.syllabusNode.findMany({
        where: { examVersionId: versionId },
        select: { name: true, depth: true },
        orderBy: [{ parentId: 'asc' }, { priority: 'asc' }],
      })
      console.log(`  Available chapter names:`)
      for (const n of allNodes) {
        console.log(`    [d${n.depth}] "${n.name}"`)
      }
      continue
    }
    console.log(`  Found chapter: id=${node.id} (depth ${node.depth})`)

    // Author each note (idempotent — skip if a note with the same [examId, syllabusNodeId, kind] exists).
    for (const note of notes) {
      const existing = await db.examNote.findFirst({
        where: { examId: exam.id, syllabusNodeId: node.id, kind: note.kind },
        select: { id: true, status: true },
      })
      if (existing) {
        console.log(`    ${note.kind}: already exists (id=${existing.id.slice(-8)}, status=${existing.status}) — skipping.`)
        skipped += 1
        continue
      }

      // Create as DRAFT, then publish (creates a revision).
      const createdNote = await db.examNote.create({
        data: {
          examId: exam.id,
          syllabusNodeId: node.id,
          kind: note.kind,
          body: note.body,
          status: 'DRAFT',
          authoredById: ADMIN_USER_ID,
        },
      })

      // Publish: create a revision (§36) + flip the status to PUBLISHED + set publishedRevisionId.
      const revision = await db.examNoteRevision.create({
        data: {
          noteId: createdNote.id,
          body: note.body,
          publishedById: ADMIN_USER_ID,
        },
      })
      await db.examNote.update({
        where: { id: createdNote.id },
        data: { status: 'PUBLISHED', publishedRevisionId: revision.id, body: note.body },
      })

      console.log(`    ${note.kind}: created + published (id=${createdNote.id.slice(-8)}, body=${note.body.length} chars, revision=${revision.id.slice(-8)})`)
      created += 1
      published += 1
    }
  }

  console.log('\n=== PARITY REPORT ===')
  console.log(`Created + published: ${created}`)
  console.log(`Already existed (skipped): ${skipped}`)
  console.log(`Total notes after run: ${created + skipped}`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => { console.error('FAILED:', e); await db.$disconnect(); process.exit(1) })
