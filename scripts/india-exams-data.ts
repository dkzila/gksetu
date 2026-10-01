/**
 * GKSetu — INDIA EXAM CORPUS (bulk publish dataset)
 *
 * Every exam listed here has a REAL General Knowledge / Current Affairs
 * component in its official syllabus — that was the inclusion rule. The
 * families mirror the official section names of each exam group (SSC-style
 * "General Awareness", banking's "General Awareness with special reference
 * to Banking", state-PSC "General Studies" etc.), and every GK-bearing
 * child is linked to the canonical taxonomy where a topic exists (§13 —
 * exam wording never enters the taxonomy; the link is the only bridge).
 *
 * Sources: the conducting bodies' official notifications/calendars
 * (cross-checked against public syllabus references, Oct 2026). Only
 * official URLs we are confident about are included; others name the body.
 */

export type ExamLevelBlueprint = 'NATIONAL' | 'STATE'

export interface BlueprintNode {
  /** Exam's own syllabus label — official notification wording (§13). */
  name: string
  /** Optional canonical taxonomy link (§13 — the only exam→knowledge bridge). */
  topic?: string
  children?: BlueprintNode[]
}

export interface ExamBlueprint {
  slug: string
  code: string
  name: string
  organiser: string
  level: ExamLevelBlueprint
  description: string
  /** Version `source` — the official notification the structure came from. */
  source: string
  tree: BlueprintNode[]
}

// ---------- Common official sources ----------

const SRC = {
  upsc: (exam: string) => `UPSC ${exam} Examination Notification — https://upsc.gov.in`,
  ssc: (exam: string) => `SSC ${exam} Examination Notification & Calendar — https://ssc.gov.in`,
  ibps: (exam: string) => `IBPS CRP ${exam} Notification — https://www.ibps.in`,
  rrb: (exam: string) => `Railway Recruitment Boards ${exam} CEN Notification — https://indianrailways.gov.in`,
  bodyNotice: (body: string, exam: string) => `${body} ${exam} Recruitment Notification`,
} as const

// ---------- GK/CA syllabus tree families ----------
// Each family returns the GK/CA-bearing sections of that exam group's
// official pattern (other sections — maths, language, technical — are out
// of scope for this corpus by design: GK & Current Affairs is the product).

/** SSC-style "General Awareness" (CHSL/MTS/CPO/GD/Steno/JE/Selection Post). */
const SSC_GA = (): BlueprintNode[] => [
  {
    name: 'General Awareness',
    children: [
      { name: 'Indian History & Freedom Struggle', topic: 'history' },
      { name: 'Indian Polity & Constitution', topic: 'constitutional-framework' },
      { name: 'Geography — India & World' },
      { name: 'Economy & Budget' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      { name: 'Sports, Awards & Honours', topic: 'awards-honours' },
    ],
  },
]

/** Banking "General Awareness (with special reference to Banking)". */
const BANK_GA = (extra?: BlueprintNode): BlueprintNode[] => [
  {
    name: 'General Awareness (with special reference to the Banking & Financial Sector)',
    children: [
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      { name: 'Banking & Financial Awareness' },
      { name: 'Indian Economy & Union Budget' },
      { name: 'Static GK — History, Polity & Geography', topic: 'history' },
      { name: 'Sports, Awards & Honours', topic: 'awards-honours' },
      ...(extra ? [extra] : []),
    ],
  },
]

/** Insurance "General Awareness (with special reference to Insurance)". */
const INSURANCE_GA = (): BlueprintNode[] => [
  {
    name: 'General Awareness (with special reference to the Insurance & Financial Sector)',
    children: [
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      { name: 'Insurance & Financial Awareness' },
      { name: 'Indian Economy & Union Budget' },
      { name: 'Static GK — History, Polity & Geography', topic: 'history' },
    ],
  },
]

/** Railway "General Awareness" (NTPC/Group D/ALP/JE/Paramedical/RPF). */
const RRB_GA = (): BlueprintNode[] => [
  {
    name: 'General Awareness',
    children: [
      { name: 'Current Affairs', topic: 'current-affairs' },
      { name: 'Indian History & Culture', topic: 'history' },
      { name: 'Indian Polity & Constitution', topic: 'constitutional-framework' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Space, Defence & Scientific Achievements', topic: 'space-technology' },
      { name: 'Sports & Awards', topic: 'awards-honours' },
    ],
  },
]

/** State police "General Knowledge & Current Affairs" pattern. */
const POLICE_GK = (state?: string): BlueprintNode[] => [
  {
    name: 'General Knowledge & Current Affairs',
    children: [
      { name: 'Indian Constitution & Polity', topic: 'constitutional-framework' },
      { name: 'Indian History & Culture', topic: 'history' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      ...(state ? [{ name: `${state} — state-specific general knowledge` }] : []),
      { name: 'Sports & Awards', topic: 'awards-honours' },
    ],
  },
]

/** State-PSC Civil Services pattern: Prelims GS-I + the state-specific Mains GS-I. */
const PSC_CCE = (state?: string): BlueprintNode[] => [
  {
    name: 'Prelims — General Studies (Paper I)',
    children: [
      { name: 'Current events of national and international importance', topic: 'current-affairs' },
      { name: 'History of India and Indian National Movement', topic: 'history' },
      { name: 'Indian and World Geography — physical, social, economic' },
      { name: 'Indian Polity and Governance — Constitution, political system, Panchayati Raj, rights issues', topic: 'constitutional-framework' },
      { name: 'Economic and Social Development — sustainable development, poverty, inclusion, demographics' },
      { name: 'General Science', topic: 'science-technology' },
      ...(state ? [{ name: `${state} — history, geography, polity & culture (state-specific questions)` }] : []),
    ],
  },
  {
    name: 'Mains — GS Paper I (Indian Heritage, History & Society)',
    children: [
      { name: 'Indian culture, modern Indian history & freedom struggle', topic: 'history' },
      { name: 'Salient features of world history', topic: 'world-history' },
      ...(state ? [{ name: `${state} — history, culture, geography & society` }] : []),
    ],
  },
]

/** Single-paper state-services / group-exam pattern (Group-2/4, RO/ARO, etc.). */
const PSC_SINGLE = (state?: string): BlueprintNode[] => [
  {
    name: 'General Studies',
    children: [
      { name: 'Current events of national and international importance', topic: 'current-affairs' },
      { name: 'History of India and Indian National Movement', topic: 'history' },
      { name: 'Indian Polity & Constitution', topic: 'constitutional-framework' },
      { name: 'Geography — India & World' },
      { name: 'Economy & Social Development' },
      { name: 'General Science', topic: 'science-technology' },
      ...(state ? [{ name: `${state} — state-specific general knowledge` }] : []),
      { name: 'Sports, Awards & Honours', topic: 'awards-honours' },
    ],
  },
]

/** State subordinate-services "General Knowledge" pattern (PET/VDO/Patwari/CET…). */
const SUBORDINATE_GK = (state: string): BlueprintNode[] => [
  {
    name: 'General Knowledge',
    children: [
      { name: 'Indian History', topic: 'history' },
      { name: 'Indian Polity & Constitution', topic: 'constitutional-framework' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Current Affairs', topic: 'current-affairs' },
      { name: `${state} — state-specific general knowledge` },
      { name: 'Static GK — Geography, Economy, Sports & Awards', topic: 'awards-honours' },
    ],
  },
]

/** Teacher-recruitment "General Knowledge & Current Affairs" pattern. */
const TEACHING_GK = (state?: string): BlueprintNode[] => [
  {
    name: 'General Knowledge & Current Affairs',
    children: [
      { name: 'Current Affairs', topic: 'current-affairs' },
      { name: 'Indian Constitution & Polity', topic: 'constitutional-framework' },
      { name: 'Indian History & Geography', topic: 'history' },
      { name: 'General Science & Environment', topic: 'science-technology' },
      ...(state ? [{ name: `${state} — state-specific general knowledge` }] : []),
    ],
  },
]

/** Law-entrance "General Knowledge & Current Affairs" pattern. */
const LAW_GK = (): BlueprintNode[] => [
  {
    name: 'General Knowledge & Current Affairs',
    children: [
      { name: 'Current Affairs — national & international, including legal developments', topic: 'current-affairs' },
      { name: 'Static GK — History, Polity, Economy & Geography', topic: 'history' },
      { name: 'Legal Awareness & Landmark Judgments', topic: 'constitutional-framework' },
    ],
  },
]

/** Management-entrance GK section (XAT/IIFT/CMAT/MAT/SNAP/CUET General Test). */
const MBA_GK = (): BlueprintNode[] => [
  {
    name: 'General Knowledge & Current Affairs',
    children: [
      { name: 'Current Affairs — business, economy, polity & sports', topic: 'current-affairs' },
      { name: 'Static GK — History, Geography & Polity', topic: 'history' },
      { name: 'Business, Economy & Brands' },
      { name: 'International Organisations & Summits', topic: 'international-organisations' },
    ],
  },
]

// ---------- The corpus ----------

const E = (
  slug: string,
  code: string,
  name: string,
  organiser: string,
  level: ExamLevelBlueprint,
  description: string,
  source: string,
  tree: BlueprintNode[]
): ExamBlueprint => ({ slug, code, name, organiser, level, description, source, tree })

export const INDIA_EXAM_BLUEPRINTS: ExamBlueprint[] = [
  // ===== UPSC (beyond CSE — CSE is already published) =====
  E('upsc-nda', 'UPSC-NDA', 'UPSC National Defence Academy & Naval Academy Examination', 'Union Public Service Commission', 'NATIONAL',
    'National-level entrance examination for admission to the Army, Navy and Air Force wings of the National Defence Academy and the Indian Naval Academy — written General Ability Test followed by the SSB interview.',
    SRC.upsc('NDA & NA'),
    [{ name: 'General Ability Test — General Knowledge (Paper II)', children: [
      { name: 'History & Freedom Movement', topic: 'history' },
      { name: 'Geography' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Current Events — national & international', topic: 'current-affairs' },
    ] }]),
  E('upsc-cds', 'UPSC-CDS', 'UPSC Combined Defence Services Examination', 'Union Public Service Commission', 'NATIONAL',
    'National-level recruitment examination for admission to the Indian Military Academy, Indian Naval Academy, Air Force Academy and Officers\' Training Academy — English, General Knowledge and Elementary Mathematics papers.',
    SRC.upsc('CDS'),
    [{ name: 'General Knowledge (Paper II)', children: [
      { name: 'Indian History & Freedom Movement', topic: 'history' },
      { name: 'Indian & World Geography' },
      { name: 'Indian Polity & Economy', topic: 'constitutional-framework' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Current Events of national and international importance', topic: 'current-affairs' },
      { name: 'Defence-related awareness' },
    ] }]),
  E('upsc-capf-ac', 'UPSC-CAPF-AC', 'UPSC Central Armed Police Forces (Assistant Commandant) Examination', 'Union Public Service Commission', 'NATIONAL',
    'National-level recruitment examination for Assistant Commandant (Group A) officers in the BSF, CRPF, CISF, ITBP and SSB — General Ability & Intelligence paper, essay paper and the medical/physical test.',
    SRC.upsc('CAPF'),
    [{ name: 'General Ability & Intelligence (Paper I)', children: [
      { name: 'General Mental Ability' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Current Events of national and international importance', topic: 'current-affairs' },
      { name: 'Indian Polity & Economy', topic: 'constitutional-framework' },
      { name: 'History of India', topic: 'history' },
      { name: 'Indian & World Geography' },
    ] }]),
  E('upsc-epfo', 'UPSC-EPFO-EO', 'UPSC EPFO Enforcement / Accounts Officer Examination', 'Union Public Service Commission', 'NATIONAL',
    'National-level recruitment examination for Enforcement Officers and Accounts Officers in the Employees\' Provident Fund Organisation — a Recruitment Test covering general studies, industrial relations and accounting.',
    SRC.upsc('EPFO'),
    [{ name: 'General Studies (Recruitment Test)', children: [
      { name: 'Current Events and Developmental Issues', topic: 'current-affairs' },
      { name: 'Indian Polity & Economy', topic: 'constitutional-framework' },
      { name: 'General Science & Knowledge of Computer Applications', topic: 'science-technology' },
      { name: 'Industrial Relations & Labour Laws' },
      { name: 'General Accounting Principles' },
    ] }]),
  E('upsc-ifs', 'UPSC-IFS', 'UPSC Indian Forest Service Examination', 'Union Public Service Commission', 'NATIONAL',
    'National-level recruitment examination for the Indian Forest Service — a General Knowledge and English paper common with Civil Services Prelims, followed by forestry-subject Mains papers and interview.',
    SRC.upsc('IFS'),
    [{ name: 'General Knowledge (Paper I)', children: [
      { name: 'Current events of national and international importance', topic: 'current-affairs' },
      { name: 'Indian Polity & Governance', topic: 'constitutional-framework' },
      { name: 'History of India & Geography', topic: 'history' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Salient features of world history', topic: 'world-history' },
    ] }]),
  E('upsc-ies', 'UPSC-IES', 'UPSC Indian Economic Service Examination', 'Union Public Service Commission', 'NATIONAL',
    'National-level recruitment examination for the Indian Economic Service — General Studies, General English and economics papers, followed by an interview.',
    SRC.upsc('IES'),
    [{ name: 'General Studies (Paper I)', children: [
      { name: 'Current Affairs', topic: 'current-affairs' },
      { name: 'Indian Polity & Constitution', topic: 'constitutional-framework' },
      { name: 'Indian Economy & Planning' },
      { name: 'General Science & Technology', topic: 'science-technology' },
    ] }]),

  // ===== SSC (beyond CGL — already published) =====
  E('ssc-chsl', 'SSC-CHSL', 'SSC Combined Higher Secondary Level (10+2) Examination', 'Staff Selection Commission', 'NATIONAL',
    'Nationwide 10+2-level recruitment examination for Lower Division Clerks, Junior Secretariat Assistants and Data Entry Operators across ministries and departments of the Government of India.',
    SRC.ssc('CHSL'), SSC_GA()),
  E('ssc-mts', 'SSC-MTS', 'SSC Multi Tasking (Non-Technical) Staff & Havaldar Examination', 'Staff Selection Commission', 'NATIONAL',
    'Nationwide matriculation-level recruitment examination for Multi Tasking Staff posts in central government offices and Havaldar posts in CBIC & CBN.',
    SRC.ssc('MTS & Havaldar'), SSC_GA()),
  E('ssc-cpo', 'SSC-CPO', 'SSC Central Police Organisation (SI in Delhi Police & CAPF) Examination', 'Staff Selection Commission', 'NATIONAL',
    'National-level recruitment examination for Sub-Inspector posts in the Delhi Police, Central Armed Police Forces and Assistant Sub-Inspector posts in the CISF.',
    SRC.ssc('CPO'), SSC_GA()),
  E('ssc-gd-constable', 'SSC-GD', 'SSC Constable (GD) in CAPFs, SSF & Rifleman (GD) in Assam Rifles Examination', 'Staff Selection Commission', 'NATIONAL',
    'Nationwide matriculation-level constable recruitment examination for the Central Armed Police Forces (BSF, CISF, CRPF, ITBP, SSB, AR, SSF) — computer-based test, physical efficiency/standard tests and medical.',
    SRC.ssc('Constable GD'), SSC_GA()),
  E('ssc-stenographer', 'SSC-STENO', 'SSC Stenographer Grade C & D Examination', 'Staff Selection Commission', 'NATIONAL',
    'Nationwide 10+2-level recruitment examination for Stenographer Grade C (Group B) and Grade D (Group C) posts across central government ministries and departments.',
    SRC.ssc('Stenographer'), SSC_GA()),
  E('ssc-junior-engineer', 'SSC-JE', 'SSC Junior Engineer (Civil / Electrical / Mechanical) Examination', 'Staff Selection Commission', 'NATIONAL',
    'Nationwide diploma/degree-level recruitment examination for Junior Engineer posts in CPWD, MES, CWC, and other central engineering departments — General Intelligence & Reasoning, General Awareness and the technical paper.',
    SRC.ssc('JE'), SSC_GA()),
  E('ssc-selection-post', 'SSC-SEL-POST', 'SSC Selection Post (Phase) Examination', 'Staff Selection Commission', 'NATIONAL',
    'Recurring nationwide recruitment examination across matriculation, higher-secondary and graduate-level Selection Posts (Phase XI onwards) in central government departments.',
    SRC.ssc('Selection Post'), SSC_GA()),

  // ===== Banking =====
  E('ibps-po', 'IBPS-PO', 'IBPS Probationary Officers / Management Trainees Examination (CRP PO-MT)', 'Institute of Banking Personnel Selection', 'NATIONAL',
    'Nationwide recruitment examination for Probationary Officer and Management Trainee posts in public sector banks — prelims, mains and interview, with a banking-weighted General Awareness section.',
    SRC.ibps('PO/MT'), BANK_GA()),
  E('ibps-clerk', 'IBPS-CLERK', 'IBPS Clerks Examination (CRP Clerks)', 'Institute of Banking Personnel Selection', 'NATIONAL',
    'Nationwide recruitment examination for clerical cadre posts in public sector banks — prelims and mains, with General Awareness (including banking) in the mains.',
    SRC.ibps('Clerks'), BANK_GA()),
  E('ibps-rrb-po', 'IBPS-RRB-PO', 'IBPS RRB Officer Scale-I Examination (CRP RRBs)', 'Institute of Banking Personnel Selection', 'NATIONAL',
    'Nationwide recruitment examination for Officer Scale-I (Assistant Manager) posts in Regional Rural Banks — prelims, mains and interview.',
    SRC.ibps('RRB Officer Scale-I'), BANK_GA()),
  E('ibps-rrb-clerk', 'IBPS-RRB-CLERK', 'IBPS RRB Office Assistant (Multipurpose) Examination', 'Institute of Banking Personnel Selection', 'NATIONAL',
    'Nationwide recruitment examination for Office Assistant (Multipurpose) clerical posts in Regional Rural Banks — prelims and mains.',
    SRC.ibps('RRB Office Assistant'), BANK_GA()),
  E('sbi-po', 'SBI-PO', 'SBI Probationary Officers Examination', 'State Bank of India', 'NATIONAL',
    'State Bank of India\'s own recruitment examination for Probationary Officer posts — prelims, mains (with General/Banking/Economy Awareness) and the group exercise & interview.',
    'SBI PO Recruitment Notification — https://sbi.co.in', BANK_GA()),
  E('sbi-clerk', 'SBI-CLERK', 'SBI Junior Associates (Customer Support & Sales) Examination', 'State Bank of India', 'NATIONAL',
    'State Bank of India\'s own recruitment examination for Junior Associate (clerical) posts — prelims and mains, with General/Financial Awareness in the mains.',
    'SBI Junior Associate Recruitment Notification — https://sbi.co.in', BANK_GA()),
  E('rbi-grade-b', 'RBI-GRADE-B', 'RBI Grade B (DR — General) Officers Examination', 'Reserve Bank of India', 'NATIONAL',
    'The Reserve Bank of India\'s flagship recruitment examination for Grade B officers (Department of Economic & Policy Research, general stream) — phase I, phase II and interview, with General Awareness weighted heavily.',
    'RBI Grade B Recruitment Notification — https://www.rbi.org.in', BANK_GA()),
  E('rbi-assistant', 'RBI-ASSISTANT', 'RBI Assistant Examination', 'Reserve Bank of India', 'NATIONAL',
    'The Reserve Bank of India\'s recruitment examination for Assistant (clerical) posts across its offices — prelims, mains and language proficiency test.',
    'RBI Assistant Recruitment Notification — https://www.rbi.org.in', BANK_GA()),
  E('nabard-grade-a', 'NABARD-GRADE-A', 'NABARD Assistant Manager (Grade A) Examination', 'National Bank for Agriculture and Rural Development', 'NATIONAL',
    'NABARD\'s recruitment examination for Assistant Manager (Grade A) officers — prelims and mains with General Awareness plus the Agriculture & Rural Development section.',
    'NABARD Grade A Recruitment Notification — https://www.nabard.org',
    BANK_GA({ name: 'Agriculture & Rural Development (with current agricultural policy)', topic: 'current-affairs' })),
  E('sidbi-grade-a', 'SIDBI-GRADE-A', 'SIDBI Assistant Manager (Grade A) Examination', 'Small Industries Development Bank of India', 'NATIONAL',
    'SIDBI\'s recruitment examination for Assistant Manager (Grade A) officers — objective online exam and interview, with General/Banking Awareness and MSME-sector awareness.',
    'SIDBI Grade A Recruitment Notification — https://www.sidbi.in', BANK_GA()),

  // ===== Railways =====
  E('rrb-ntp', 'RRB-NTPC', 'RRB Non-Technical Popular Categories (NTPC) Examination', 'Railway Recruitment Boards', 'NATIONAL',
    'Nationwide railway recruitment examination for graduate and undergraduate non-technical posts (Station Master, Goods Guard, Senior Clerk, Commercial Apprentice and others) — CBT 1 and CBT 2.',
    SRC.rrb('NTPC'), RRB_GA()),
  E('rrb-group-d', 'RRB-GROUP-D', 'RRB Group D (Track Maintainer, Pointsman & Other) Examination', 'Railway Recruitment Boards', 'NATIONAL',
    'Nationwide matriculation-level railway recruitment examination for Track Maintainer Grade IV, Pointsman, Assistant and other Level-1 posts — single CBT followed by document verification.',
    SRC.rrb('Group D'), RRB_GA()),
  E('rrb-alp', 'RRB-ALP', 'RRB Assistant Loco Pilot Examination', 'Railway Recruitment Boards', 'NATIONAL',
    'Nationwide railway recruitment examination for Assistant Loco Pilot posts — CBT 1, CBT 2 (Part A + Part B) and the computer-based aptitude test.',
    SRC.rrb('ALP'), RRB_GA()),
  E('rrb-je', 'RRB-JE', 'RRB Junior Engineer (IT, DMS & C&W) Examination', 'Railway Recruitment Boards', 'NATIONAL',
    'Nationwide railway recruitment examination for Junior Engineer, Depot Material Superintendent and Chemical & Metallurgical Assistant posts — CBT 1 and CBT 2.',
    SRC.rrb('JE'), RRB_GA()),
  E('rrb-paramedical', 'RRB-PARAMED', 'RRB Paramedical Categories Examination', 'Railway Recruitment Boards', 'NATIONAL',
    'Nationwide railway recruitment examination for staff nurse, pharmacist, lab technician and other paramedical categories — single CBT with a General Awareness section.',
    SRC.rrb('Paramedical'), RRB_GA()),
  E('rpf-constable', 'RPF-CONSTABLE', 'RPF Constable Examination', 'Railway Protection Force', 'NATIONAL',
    'Nationwide railway-protection recruitment examination for Constable posts — CBT, physical efficiency test, physical measurement test and document verification.',
    'RPF Constable Recruitment Notification — https://rpf.indianrailways.gov.in', RRB_GA()),
  E('rpf-si', 'RPF-SI', 'RPF Sub-Inspector Examination', 'Railway Protection Force', 'NATIONAL',
    'Nationwide railway-protection recruitment examination for Sub-Inspector (Executive) posts — CBT, PET/PMT and document verification.',
    'RPF SI Recruitment Notification — https://rpf.indianrailways.gov.in', RRB_GA()),

  // ===== Defence =====
  E('afcat', 'AFCAT', 'Air Force Common Admission Test', 'Indian Air Force', 'NATIONAL',
    'The Indian Air Force\'s own admission examination for Flying and Ground Duty (Technical & Non-Technical) branches — a single online test with General Awareness, Verbal Ability, Numerical Ability and Reasoning, followed by the AFSB interview.',
    'AFCAT Notification — https://afcat.cdac.in',
    [{ name: 'General Awareness & Reasoning', children: [
      { name: 'General Awareness — history, geography & polity', topic: 'history' },
      { name: 'Current Affairs', topic: 'current-affairs' },
      { name: 'General Science & Technology', topic: 'science-technology' },
      { name: 'Defence & Aviation awareness', topic: 'space-technology' },
    ] }]),
  E('indian-navy-agniveer-ssr', 'NAVY-AGNIVEER-SSR', 'Indian Navy Agniveer SSR Examination', 'Indian Navy', 'NATIONAL',
    'The Indian Navy\'s Agnipath-scheme recruitment examination for Senior Secondary Recruits — a computer-based test in English, Science, Mathematics and General Knowledge & Current Affairs.',
    'Agniveer SSR Notification — https://www.joinindiannavy.gov.in',
    [{ name: 'General Knowledge & Current Affairs (CBT section)', children: [
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      { name: 'Indian History & Polity', topic: 'constitutional-framework' },
      { name: 'General Science (with naval relevance)', topic: 'science-technology' },
    ] }]),
  E('indian-navy-agniveer-mr', 'NAVY-AGNIVEER-MR', 'Indian Navy Agniveer MR (Matric Recruit) Examination', 'Indian Navy', 'NATIONAL',
    'The Indian Navy\'s Agnipath-scheme matriculation-level recruitment examination for Chef, Steward and Hygienist posts — computer-based test in Science & Mathematics and General Knowledge & Current Affairs.',
    'Agniveer MR Notification — https://www.joinindiannavy.gov.in',
    [{ name: 'General Knowledge & Current Affairs (CBT section)', children: [
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Indian History & Culture', topic: 'history' },
    ] }]),
  E('indian-coast-guard-navik', 'ICG-NAVIK-GD', 'Indian Coast Guard Navik (General Duty) Examination', 'Indian Coast Guard', 'NATIONAL',
    'The Indian Coast Guard\'s recruitment examination for Navik (General Duty) posts — a computer-based test in Mathematics, Physics, English and General Knowledge & Current Affairs, followed by physical tests.',
    'ICG Navik GD Notification — https://joinindiancoastguard.cdac.in',
    [{ name: 'General Knowledge & Current Affairs (CBT section)', children: [
      { name: 'Current Affairs — national & international', topic: 'current-affairs' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Indian Polity & Geography', topic: 'constitutional-framework' },
    ] }]),
  E('indian-coast-guard-ac', 'ICG-AC', 'Indian Coast Guard Assistant Commandant Examination', 'Indian Coast Guard', 'NATIONAL',
    'The Indian Coast Guard\'s officer-entry examination for Assistant Commandant (GD, Commercial Pilot, Technical and Law) posts — CGCAT with General Studies & Reasoning, followed by the selection board.',
    'ICG Assistant Commandant Notification — https://joinindiancoastguard.cdac.in',
    [{ name: 'General Studies & Reasoning', children: [
      { name: 'General Knowledge & Current Affairs', topic: 'current-affairs' },
      { name: 'Indian Polity & Constitution', topic: 'constitutional-framework' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Defence & Maritime awareness' },
    ] }]),
  E('indian-army-agniveer-gd', 'ARMY-AGNIVEER-GD', 'Indian Army Agniveer (General Duty) Examination', 'Indian Army', 'NATIONAL',
    'The Indian Army\'s Agnipath-scheme recruitment examination for General Duty soldiers — a computer-based common entrance exam in General Knowledge (including current affairs), General Science and Mathematics, followed by physical and medical tests.',
    'Agniveer GD CEE Notification — https://joinindianarmy.nic.in',
    [{ name: 'General Knowledge (CEE section)', children: [
      { name: 'General Knowledge & Current Affairs', topic: 'current-affairs' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Indian History & Polity', topic: 'history' },
    ] }]),
  E('territorial-army-officer', 'TA-OFFICER', 'Territorial Army Officer Examination', 'Territorial Army Directorate, Ministry of Defence', 'NATIONAL',
    'Part-time commission examination for the Territorial Army — Paper I (Reasoning & Elementary Mathematics) and Paper II (General Knowledge & English), followed by the SSB interview and medical board.',
    'Territorial Army Officer Notification — https://www.territorialarmy.in',
    [{ name: 'General Knowledge & English (Paper II)', children: [
      { name: 'General Knowledge & Current Affairs', topic: 'current-affairs' },
      { name: 'Indian History & Polity', topic: 'history' },
      { name: 'General Science', topic: 'science-technology' },
      { name: 'Defence & National Security awareness' },
    ] }]),

  // ===== State police =====
  E('up-police-si', 'UP-POLICE-SI', 'UP Police Sub-Inspector & Platoon Commander Examination', 'Uttar Pradesh Police Recruitment & Promotion Board', 'STATE',
    'Uttar Pradesh\'s recruitment examination for Sub-Inspector (Civil Police), Platoon Commander and fire-service posts — written test with General Knowledge & Current Affairs, followed by physical tests.',
    SRC.bodyNotice('UPPRPB', 'UP Police SI'), POLICE_GK('Uttar Pradesh')),
  E('up-police-constable', 'UP-POLICE-CONST', 'UP Police Constable Recruitment Examination', 'Uttar Pradesh Police Recruitment & Promotion Board', 'STATE',
    'Uttar Pradesh\'s matriculation-level constable recruitment examination — a written test with General Knowledge & Current Affairs, physical efficiency/standard tests and document verification.',
    SRC.bodyNotice('UPPRPB', 'UP Police Constable'), POLICE_GK('Uttar Pradesh')),
  E('bihar-police-si', 'BPSSC-SI', 'Bihar Police Sub-Inspector Examination', 'Bihar Police Subordinate Service Commission', 'STATE',
    'Bihar\'s recruitment examination for Sub-Inspector, Sergeant and equivalent posts — prelims and mains, both carrying General Knowledge & Current Affairs.',
    SRC.bodyNotice('BPSSC', 'Bihar Police SI'), POLICE_GK('Bihar')),
  E('bihar-police-constable', 'CSBC-CONSTABLE', 'Bihar Police Constable Recruitment Examination', 'Central Selection Board of Constables, Bihar', 'STATE',
    'Bihar\'s matriculation-level constable recruitment examination — a single written test with General Knowledge & Current Affairs, followed by physical and medical tests.',
    SRC.bodyNotice('CSBC', 'Bihar Police Constable'), POLICE_GK('Bihar')),
  E('mp-police-si', 'MP-ESB-SI', 'MP Police Sub-Inspector & Sub-Sub-Inspector Examination', 'Madhya Pradesh Employees Selection Board', 'STATE',
    'Madhya Pradesh\'s recruitment examination for Sub-Inspector and Sub-Sub-Inspector posts — a written test with General Knowledge & Current Affairs, physical tests and a Hindi proficiency paper.',
    SRC.bodyNotice('MP ESB', 'MP Police SI'), POLICE_GK('Madhya Pradesh')),
  E('rajasthan-police-constable', 'RAJ-POLICE-CONST', 'Rajasthan Police Constable Recruitment Examination', 'Rajasthan Staff Selection Board, Jaipur', 'STATE',
    'Rajasthan\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Rajasthan-specific GK), followed by physical standards/efficiency tests.',
    SRC.bodyNotice('RSSB', 'Rajasthan Police Constable'), POLICE_GK('Rajasthan')),
  E('rajasthan-police-si', 'RAJ-POLICE-SI', 'Rajasthan Police Sub-Inspector Examination', 'Rajasthan Public Service Commission', 'STATE',
    'Rajasthan\'s recruitment examination for Sub-Inspector and Platoon Commander posts — a written test with General Knowledge & Current Affairs (Rajasthan-weighted), physical tests and interview.',
    SRC.bodyNotice('RPSC', 'Rajasthan Police SI'), POLICE_GK('Rajasthan')),
  E('haryana-police-constable', 'HRY-POLICE-CONST', 'Haryana Police Constable Examination', 'Haryana Staff Selection Commission', 'STATE',
    'Haryana\'s constable recruitment examination — a written test with General Studies (including Haryana GK), physical screening test and knowledge test.',
    SRC.bodyNotice('HSSC', 'Haryana Police Constable'), POLICE_GK('Haryana')),
  E('delhi-police-constable', 'DP-CONSTABLE', 'Delhi Police Constable (Executive) Examination', 'Staff Selection Commission (for Delhi Police)', 'STATE',
    'Recruitment examination for Constable (Executive) posts in the Delhi Police, conducted by SSC — computer-based test with General Knowledge & Current Affairs, physical efficiency/standard tests and medical.',
    SRC.ssc('Delhi Police Constable'), POLICE_GK('Delhi')),
  E('delhi-police-head-constable', 'DP-HEAD-CONST', 'Delhi Police Head Constable (Ministerial) Examination', 'Staff Selection Commission (for Delhi Police)', 'STATE',
    'Recruitment examination for Head Constable (Ministerial) posts in the Delhi Police — computer-based test with General Awareness, typing test and computer formatting test.',
    SRC.ssc('Delhi Police Head Constable'), POLICE_GK('Delhi')),
  E('maharashtra-police-constable', 'MH-POLICE-CONST', 'Maharashtra Police Constable Examination', 'Maharashtra Police (Directorate General of Police)', 'STATE',
    'Maharashtra\'s constable recruitment examination — a written test with General Knowledge & Current Affairs, Marathi language paper, physical tests and medical.',
    SRC.bodyNotice('Maharashtra Police', 'Police Constable'), POLICE_GK('Maharashtra')),
  E('wb-police-constable', 'WB-POLICE-CONST', 'West Bengal Police Constable Examination', 'West Bengal Police Recruitment Board', 'STATE',
    'West Bengal\'s constable recruitment examination — a preliminary written test with General Knowledge & Current Affairs, physical measurement/efficiency tests and a final written test.',
    SRC.bodyNotice('WBPRB', 'WB Police Constable'), POLICE_GK('West Bengal')),
  E('wb-police-si', 'WB-POLICE-SI', 'West Bengal Police Sub-Inspector Examination', 'West Bengal Police Recruitment Board', 'STATE',
    'West Bengal\'s recruitment examination for Sub-Inspector (Unarmed Branch) posts — preliminary test, physical measurement/efficiency tests, mains with General Studies & Current Affairs and a personality test.',
    SRC.bodyNotice('WBPRB', 'WB Police SI'), POLICE_GK('West Bengal')),
  E('punjab-police-constable', 'PB-POLICE-CONST', 'Punjab Police Constable Examination', 'Government of Punjab (Punjab Police)', 'STATE',
    'Punjab\'s constable recruitment examination — a computer-based test with General Awareness (including Punjab GK & current affairs), physical measurement/efficiency tests and medical.',
    SRC.bodyNotice('Punjab Police', 'Constable'), POLICE_GK('Punjab')),
  E('uttarakhand-police-constable', 'UK-POLICE-CONST', 'Uttarakhand Police Constable (Civil Police) Examination', 'Uttarakhand Subordinate Services Selection Commission', 'STATE',
    'Uttarakhand\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Uttarakhand GK), physical efficiency/standard tests and medical.',
    SRC.bodyNotice('UKSSSC', 'Uttarakhand Police Constable'), POLICE_GK('Uttarakhand')),
  E('jharkhand-police-constable', 'JSSC-CONSTABLE', 'Jharkhand General Police Constable (JGPC) Examination', 'Jharkhand Staff Selection Commission', 'STATE',
    'Jharkhand\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Jharkhand GK), physical standards/efficiency tests and medical.',
    SRC.bodyNotice('JSSC', 'Jharkhand Police Constable'), POLICE_GK('Jharkhand')),
  E('chhattisgarh-police-constable', 'CG-POLICE-CONST', 'Chhattisgarh Police Constable Examination', 'Chhattisgarh Professional Examination Board', 'STATE',
    'Chhattisgarh\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Chhattisgarh GK), physical tests and medical.',
    SRC.bodyNotice('CG Vyapam', 'CG Police Constable'), POLICE_GK('Chhattisgarh')),
  E('kerala-police-constable', 'KER-POLICE-CONST', 'Kerala Police Constable Examination', 'Kerala Public Service Commission', 'STATE',
    'Kerala PSC\'s recruitment examination for Police Constable and equivalent uniformed posts — a written test with General Knowledge, Current Affairs and Kerala GK, followed by physical and medical standards.',
    SRC.bodyNotice('Kerala PSC', 'Police Constable'), POLICE_GK('Kerala')),
  E('tnusrb-si', 'TNUSRB-SI', 'Tamil Nadu Police Sub-Inspector (Taluk & Armed Reserve) Examination', 'Tamil Nadu Uniformed Services Recruitment Board', 'STATE',
    'Tamil Nadu\'s recruitment examination for Sub-Inspector (Taluk & AR) posts — a written test with General Knowledge & Current Affairs (including Tamil Nadu GK), physical measurement/efficiency tests and viva.',
    SRC.bodyNotice('TNUSRB', 'TN Police SI'), POLICE_GK('Tamil Nadu')),
  E('ap-police-constable', 'AP-POLICE-CONST', 'AP Police Constable Examination', 'Andhra Pradesh State Level Police Recruitment Board', 'STATE',
    'Andhra Pradesh\'s constable recruitment examination — a preliminary written test with General Knowledge & Current Affairs, physical measurement/efficiency tests and a final written test.',
    SRC.bodyNotice('APSLPRB', 'AP Police Constable'), POLICE_GK('Andhra Pradesh')),
  E('telangana-police-constable', 'TG-POLICE-CONST', 'Telangana Police Constable Examination', 'Telangana State Level Police Recruitment Board', 'STATE',
    'Telangana\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Telangana GK), physical efficiency/standard tests and medical.',
    SRC.bodyNotice('TSLPRB', 'Telangana Police Constable'), POLICE_GK('Telangana')),
  E('karnataka-police-constable', 'KAR-POLICE-CONST', 'Karnataka Police Constable (Civil) Examination', 'Karnataka State Police (Central Recruitment Committee)', 'STATE',
    'Karnataka\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Karnataka GK), physical endurance/standard tests and medical.',
    SRC.bodyNotice('KSP', 'Karnataka Police Constable'), POLICE_GK('Karnataka')),
  E('gujarat-police-constable', 'GJ-POLICE-CONST', 'Gujarat Police Constable (Lokrakshak) Examination', 'Lokrakshak Recruitment Board, Gujarat', 'STATE',
    'Gujarat\'s Lokrakshak (constable) recruitment examination — a written test with General Knowledge & Current Affairs (including Gujarat GK), physical efficiency/standard tests and medical.',
    SRC.bodyNotice('LRB Gujarat', 'Gujarat Police Constable'), POLICE_GK('Gujarat')),
  E('odisha-police-constable', 'OD-POLICE-CONST', 'Odisha Police Constable (Sepoy) Examination', 'Odisha Police (State Selection Board)', 'STATE',
    'Odisha\'s constable recruitment examination — a computer-based test with General Knowledge, Current Affairs and Odisha GK, physical standards/efficiency tests and medical.',
    SRC.bodyNotice('Odisha Police SSB', 'Constable'), POLICE_GK('Odisha')),
  E('assam-police-constable', 'AS-POLICE-CONST', 'Assam Police Constable (Unarmed & Armed Branch) Examination', 'State Level Police Recruitment Board, Assam', 'STATE',
    'Assam\'s constable recruitment examination — a written test with General Knowledge & Current Affairs (including Assam GK), physical standards/efficiency tests and medical.',
    SRC.bodyNotice('SLPRB Assam', 'Constable'), POLICE_GK('Assam')),

  // ===== State PSCs — civil services =====
  E('uppsc-pcs', 'UPPSC-PCS', 'UPPSC Combined State / Upper Subordinate Services (PCS) Examination', 'Uttar Pradesh Public Service Commission', 'STATE',
    'Uttar Pradesh\'s civil-services examination for SDM, DSP, BDO and other administrative posts — Prelims (GS-I + CSAT), Mains with four GS papers (UP-specific included) and interview.',
    'UPPSC PCS Examination Notification — https://uppsc.up.nic.in', PSC_CCE('Uttar Pradesh')),
  E('uppsc-ro-aro', 'UPPSC-RO-ARO', 'UPPSC Review Officer / Assistant Review Officer Examination', 'Uttar Pradesh Public Service Commission', 'STATE',
    'Uttar Pradesh\'s recruitment examination for Review Officer and Assistant Review Officer (Secretariat) posts — prelims with General Studies, mains with GS papers and a Hindi typing test.',
    'UPPSC RO/ARO Examination Notification — https://uppsc.up.nic.in', PSC_SINGLE('Uttar Pradesh')),
  E('bpsc-cce', 'BPSC-CCE', 'BPSC Combined Competitive Examination', 'Bihar Public Service Commission', 'STATE',
    'Bihar\'s civil-services examination for SDM, DSP, and other administrative posts — Prelims GS (with Bihar-specific questions), Mains GS papers (Bihar history, geography & economy included) and interview.',
    'BPSC Combined Competitive Examination Notification — https://bpsc.bihar.gov.in', PSC_CCE('Bihar')),
  E('mppsc-sse', 'MPPSC-SSE', 'MPPSC State Service Examination', 'Madhya Pradesh Public Service Commission', 'STATE',
    'Madhya Pradesh\'s civil-services examination for SDM, DSP and other state administrative posts — Prelims GS, Mains with GS papers (MP-specific GK included) and interview.',
    'MPPSC State Service Examination Notification — https://mppsc.mp.gov.in', PSC_CCE('Madhya Pradesh')),
  E('rpsc-ras', 'RPSC-RAS', 'RPSC Rajasthan Administrative Service (RAS) Examination', 'Rajasthan Public Service Commission', 'STATE',
    'Rajasthan\'s civil-services examination for RAS and allied administrative posts — Prelims GS (Rajasthan-weighted), Mains with four papers (GK & Hindi, GS-I/II/III) and interview.',
    'RPSC RAS Examination Notification — https://rpsc.rajasthan.gov.in', PSC_CCE('Rajasthan')),
  E('tnpsc-group-1', 'TNPSC-GRP-1', 'TNPSC Group-I (Civil Services) Examination', 'Tamil Nadu Public Service Commission', 'STATE',
    'Tamil Nadu\'s premier civil-services examination for Deputy Collector, Deputy SP and other Group-I posts — Prelims GS, Mains (Tamil eligibility, GS papers) and interview.',
    'TNPSC Group-I Services Notification — https://www.tnpsc.gov.in', PSC_CCE('Tamil Nadu')),
  E('tnpsc-group-2', 'TNPSC-GRP-2', 'TNPSC Group-II (Interview & Non-Interview) Examination', 'Tamil Nadu Public Service Commission', 'STATE',
    'Tamil Nadu\'s Group-II recruitment examination for Municipal Commissioner, Sub-Registrar, Assistant Section Officer and allied posts — Prelims and Mains with General Studies & Tamil eligibility.',
    'TNPSC Group-II Services Notification — https://www.tnpsc.gov.in', PSC_SINGLE('Tamil Nadu')),
  E('tnpsc-group-4', 'TNPSC-GRP-4', 'TNPSC Group-IV (CCSE-IV) Examination', 'Tamil Nadu Public Service Commission', 'STATE',
    'Tamil Nadu\'s high-volume Group-IV recruitment examination for Junior Assistant, Typist, Steno-Typist and Surveyor posts — a single General Studies paper (SSLC level) with General Tamil/English.',
    'TNPSC Group-IV Notification — https://www.tnpsc.gov.in', PSC_SINGLE('Tamil Nadu')),
  E('kpsc-kas', 'KPSC-KAS', 'KPSC Karnataka Administrative Service (KAS) Examination', 'Karnataka Public Service Commission', 'STATE',
    'Karnataka\'s civil-services examination for KAS (Gazetted Probationers) posts — Prelims GS, Mains with Kannada/English eligibility and GS papers (Karnataka-specific GK included) and interview.',
    'KPSC KAS Examination Notification — https://kpsc.kar.nic.in', PSC_CCE('Karnataka')),
  E('kerala-psc-kas', 'Kerala-PSC-KAS', 'Kerala PSC Kerala Administrative Service (KAS) Examination', 'Kerala Public Service Commission', 'STATE',
    'Kerala\'s administrative-service examination for KAS (Stream-1/2/3) officer posts — Prelims, Mains (with Kerala-specific GK) and interview.',
    'Kerala PSC KAS Notification — https://www.keralapsc.gov.in', PSC_CCE('Kerala')),
  E('kerala-psc-ldc', 'Kerala-PSC-LDC', 'Kerala PSC Lower Division Clerk (LDC) Examination', 'Kerala Public Service Commission', 'STATE',
    'Kerala PSC\'s high-volume LDC/Assistant recruitment examination for government departments — a written test with General Knowledge, Current Affairs, Kerala GK and language skills.',
    'Kerala PSC LDC Notification — https://www.keralapsc.gov.in', PSC_SINGLE('Kerala')),
  E('appsc-group-1', 'APPSC-GRP-1', 'APPSC Group-I Services Examination', 'Andhra Pradesh Public Service Commission', 'STATE',
    'Andhra Pradesh\'s premier civil-services examination for Deputy Collector, DSP and other Group-I posts — Prelims GS, Mains GS papers (AP-specific GK included) and interview.',
    'APPSC Group-I Notification — https://psc.ap.gov.in', PSC_CCE('Andhra Pradesh')),
  E('appsc-group-2', 'APPSC-GRP-2', 'APPSC Group-II Services Examination', 'Andhra Pradesh Public Service Commission', 'STATE',
    'Andhra Pradesh\'s Group-II recruitment examination for Assistant Section Officer, Municipal Commissioner Grade-II and allied posts — screening test and mains with General Studies.',
    'APPSC Group-II Notification — https://psc.ap.gov.in', PSC_SINGLE('Andhra Pradesh')),
  E('tgpsc-group-1', 'TGPSC-GRP-1', 'TGPSC Group-I Services Examination', 'Telangana Public Service Commission', 'STATE',
    'Telangana\'s premier civil-services examination for Deputy Collector, DSP and other Group-I posts — Prelims GS, Mains GS papers (Telangana-specific GK included) and interview.',
    'TGPSC Group-I Notification — https://tspsc.gov.in', PSC_CCE('Telangana')),
  E('tgpsc-group-2', 'TGPSC-GRP-2', 'TGPSC Group-II Services Examination', 'Telangana Public Service Commission', 'STATE',
    'Telangana\'s Group-II recruitment examination for Assistant Section Officer, Prohibition & Excise Sub-Inspector and allied posts — Prelims and Mains with General Studies.',
    'TGPSC Group-II Notification — https://tspsc.gov.in', PSC_SINGLE('Telangana')),
  E('wbpsc-wbcs', 'WBPSC-WBCS', 'WBPSC West Bengal Civil Service (Executive) Examination', 'West Bengal Public Service Commission', 'STATE',
    'West Bengal\'s civil-services examination for WBCS (Executive) and allied administrative posts — Prelims GS, Mains with six compulsory papers (Bengali/Hindi eligibility, GS with national & international affairs) and interview.',
    'WBPSC WBCS Examination Notification — https://psc.wb.gov.in', PSC_CCE('West Bengal')),
  E('wbpsc-clerkship', 'WBPSC-CLERKSHIP', 'WBPSC Clerkship Examination', 'West Bengal Public Service Commission', 'STATE',
    'West Bengal\'s clerkship recruitment examination for Lower Division Clerk posts across government offices — Part I (objective General Studies & Current Affairs, English, Arithmetic) and Part II (descriptive).',
    'WBPSC Clerkship Notification — https://psc.wb.gov.in', SUBORDINATE_GK('West Bengal')),
  E('mpsc-rajyaseva', 'MPSC-RS', 'MPSC Maharashtra Civil Services (Rajyaseva) Examination', 'Maharashtra Public Service Commission', 'STATE',
    'Maharashtra\'s civil-services examination for Rajyaseva (Class-A administrative) posts — Prelims GS, Mains with Marathi/English eligibility and GS papers (Maharashtra-specific GK included) and interview.',
    'MPSC Rajyaseva Notification — https://mpsc.gov.in', PSC_CCE('Maharashtra')),
  E('mpsc-combined', 'MPSC-GRP-B', 'MPSC Combined Group-B (PSI / STI / ASO) Examination', 'Maharashtra Public Service Commission', 'STATE',
    'Maharashtra\'s combined recruitment examination for Police Sub-Inspector, Sales Tax Inspector and Assistant Section Officer posts — Prelims, Mains (Marathi & English papers, GS) and interview.',
    'MPSC Group-B Combined Notification — https://mpsc.gov.in', PSC_SINGLE('Maharashtra')),
  E('opsc-ocs', 'OPSC-OCS', 'OPSC Odisha Civil Services Examination', 'Odisha Public Service Commission', 'STATE',
    'Odisha\'s civil-services examination for OCS/ASO and other administrative posts — Prelims GS, Mains with Odia language eligibility and GS papers (Odisha-specific GK included) and interview.',
    'OPSC OCS Notification — https://opsc.gov.in', PSC_CCE('Odisha')),
  E('jpsc-cce', 'JPSC-CCE', 'JPSC Combined Civil Services Examination', 'Jharkhand Public Service Commission', 'STATE',
    'Jharkhand\'s civil-services examination for SDM, DSP and other administrative posts — Prelims GS, Mains with GS papers (Jharkhand-specific GK included) and interview.',
    'JPSC Combined Civil Services Notification — https://jpsc.gov.in', PSC_CCE('Jharkhand')),
  E('cgpsc-sse', 'CGPSC-SSE', 'CGPSC State Service Examination', 'Chhattisgarh Public Service Commission', 'STATE',
    'Chhattisgarh\'s civil-services examination for SDM, DSP and other administrative posts — Prelims GS, Mains with GS papers (Chhattisgarh-specific GK included) and interview.',
    'CGPSC State Service Notification — https://psc.cg.gov.in', PSC_CCE('Chhattisgarh')),
  E('ukpsc-ukas', 'UKPSC-UKAS', 'UKPSC Combined State Civil / Upper Subordinate Services Examination', 'Uttarakhand Public Service Commission', 'STATE',
    'Uttarakhand\'s civil-services examination for Deputy Collector, DSP and allied posts — Prelims GS, Mains with GS papers (Uttarakhand-specific GK included) and interview.',
    'UKPSC Combined State Services Notification — https://ukpsc.gov.in', PSC_CCE('Uttarakhand')),
  E('hpsc-hcs', 'HPSC-HCS', 'HPSC Haryana Civil Services Examination', 'Haryana Public Service Commission', 'STATE',
    'Haryana\'s civil-services examination for HCS (Executive) and allied posts — Prelims GS, Mains with GS papers (Haryana-specific GK included) and interview.',
    'HPSC HCS Notification — https://hpsc.gov.in', PSC_CCE('Haryana')),
  E('hppsc-has', 'HPPSC-HAS', 'HPPSC Himachal Administrative Service (HAS) Examination', 'Himachal Pradesh Public Service Commission', 'STATE',
    'Himachal Pradesh\'s administrative-service examination for HAS and allied posts — Prelims GS, Mains with GS papers (Himachal-specific GK included) and interview.',
    'HPPSC HAS Notification — https://hppsc.hp.gov.in', PSC_CCE('Himachal Pradesh')),
  E('jkpsc-jkcs', 'JKPSC-JKAS', 'JKPSC J&K Combined Competitive Examination', 'Jammu & Kashmir Public Service Commission', 'STATE',
    'Jammu & Kashmir\'s civil-services examination for JKAS and allied posts — Prelims GS, Mains with GS papers (J&K-specific GK included) and interview.',
    'JKPSC Combined Competitive Examination Notification — https://jkpsc.nic.in', PSC_CCE('Jammu & Kashmir')),
  E('gpsc-gcs', 'GPSC-GCS', 'GPSC Gujarat Civil Services (Class 1–2) Examination', 'Gujarat Public Service Commission', 'STATE',
    'Gujarat\'s civil-services examination for Class-1/Class-2 administrative posts — Prelims GS (Gujarat-weighted), Mains with Gujarati language eligibility and GS papers and interview.',
    'GPSC Civil Services Notification — https://gpsc.gujarat.gov.in', PSC_CCE('Gujarat')),
  E('apsc-cce', 'APSC-CCE', 'APSC Combined Competitive Examination', 'Assam Public Service Commission', 'STATE',
    'Assam\'s civil-services examination for ACS, APS and allied posts — Prelims GS, Mains with GS papers (Assam-specific GK included) and interview.',
    'APSC Combined Competitive Examination Notification — https://apsc.nic.in', PSC_CCE('Assam')),

  // ===== State subordinate services =====
  E('upsssc-pet', 'UPSSSC-PET', 'UPSSSC Preliminary Eligibility Test (PET)', 'Uttar Pradesh Subordinate Services Selection Commission', 'STATE',
    'Uttar Pradesh\'s common preliminary eligibility test — the mandatory gateway for UPSSSC Group-C recruitments (VDO, Junior Assistant, Lekhpal and others) — with a heavily General-Knowledge-weighted paper.',
    'UPSSSC PET Notification — https://upsssc.gov.in', SUBORDINATE_GK('Uttar Pradesh')),
  E('upsssc-vdo', 'UPSSSC-VDO', 'UPSSSC Village Development Officer (VDO) Examination', 'Uttar Pradesh Subordinate Services Selection Commission', 'STATE',
    'Uttar Pradesh\'s recruitment examination for Village Development Officer (Gram Vikas Adhikari) posts — PET-qualified mains with General Knowledge, Hindi and UP rural-development awareness.',
    'UPSSSC VDO Notification — https://upsssc.gov.in', SUBORDINATE_GK('Uttar Pradesh')),
  E('upsssc-junior-assistant', 'UPSSSC-JA', 'UPSSSC Junior Assistant & Clerk Examination', 'Uttar Pradesh Subordinate Services Selection Commission', 'STATE',
    'Uttar Pradesh\'s recruitment examination for Junior Assistant and Clerk posts in government offices — PET-qualified mains with General Knowledge, Hindi typing and computer tests.',
    'UPSSSC Junior Assistant Notification — https://upsssc.gov.in', SUBORDINATE_GK('Uttar Pradesh')),
  E('upsssc-lekhpal', 'UPSSSC-LEKHPAL', 'UPSSSC Lekhpal (Patwari) Examination', 'Uttar Pradesh Subordinate Services Selection Commission', 'STATE',
    'Uttar Pradesh\'s revenue-department recruitment examination for Lekhpal (Patwari) posts — PET-qualified mains with General Knowledge, rural development & revenue system (UP-weighted).',
    'UPSSSC Lekhpal Notification — https://upsssc.gov.in', SUBORDINATE_GK('Uttar Pradesh')),
  E('mpesb-group-2-sg-4', 'MP-ESB-GRP2-SG4', 'MP ESB Group-2 (Sub-Group-4) Combined Recruitment Examination', 'Madhya Pradesh Employees Selection Board', 'STATE',
    'Madhya Pradesh\'s combined recruitment examination for Assistant Grade-3, Typist, Stenographer and equivalent Group-2 (Sub-Group-4) posts — General Knowledge & Current Affairs with MP-specific GK.',
    'MP ESB Group-2 Sub-Group-4 Notification — https://esb.mp.gov.in', SUBORDINATE_GK('Madhya Pradesh')),
  E('rsmssb-patwari', 'RSMSSB-PATWARI', 'RSMSSB Patwari Examination', 'Rajasthan Staff Selection Board', 'STATE',
    'Rajasthan\'s revenue-department recruitment examination for Patwari posts — a written test with General Knowledge, Current Affairs and heavily Rajasthan-weighted GK.',
    'RSMSSB Patwari Notification — https://rsmssb.rajasthan.gov.in', SUBORDINATE_GK('Rajasthan')),
  E('rsmssb-vdo', 'RSMSSB-VDO', 'RSMSSB Village Development Officer (VDO) Examination', 'Rajasthan Staff Selection Board', 'STATE',
    'Rajasthan\'s recruitment examination for Village Development Officer (Gram Vikas Adhikari) posts — a written test with General Knowledge, Current Affairs and Rajasthan-specific GK.',
    'RSMSSB VDO Notification — https://rsmssb.rajasthan.gov.in', SUBORDINATE_GK('Rajasthan')),
  E('hssc-cet', 'HSSC-CET', 'Haryana Common Entrance Test (CET) — Group-C', 'Haryana Staff Selection Commission', 'STATE',
    'Haryana\'s common eligibility test — the qualifying gateway for Group-C posts — with General Studies (Haryana GK, general knowledge, current affairs), maths, reasoning and language.',
    'HSSC CET Notification — https://hssc.gov.in', SUBORDINATE_GK('Haryana')),
  E('jssc-cgl', 'JSSC-CGL', 'JSSC Combined Graduate Level (CGL) Examination', 'Jharkhand Staff Selection Commission', 'STATE',
    'Jharkhand\'s graduate-level combined recruitment examination for secretariat and departmental Class-III posts — General Studies, General Knowledge & Current Affairs with Jharkhand-specific GK.',
    'JSSC CGL Notification — https://jssc.nic.in', SUBORDINATE_GK('Jharkhand')),
  E('bssc-cgl', 'BSSC-CGL', 'BSSC Combined Competitive (Graduate Level) Examination', 'Bihar Staff Selection Commission', 'STATE',
    'Bihar\'s graduate-level combined recruitment examination for Secretariat Assistant, Revenue Clerk and allied posts — prelims and mains with General Studies & Current Affairs (Bihar-weighted).',
    'BSSC CGL Notification — https://bssc.bihar.gov.in', SUBORDINATE_GK('Bihar')),
  E('uksssc-group-c', 'UKSSSC-GRP-C', 'UKSSSC Group-C Combined Recruitment Examination', 'Uttarakhand Subordinate Services Selection Commission', 'STATE',
    'Uttarakhand\'s combined Group-C recruitment examination for Junior Assistant, Data Entry Operator and allied posts — General Knowledge & Current Affairs with Uttarakhand-specific GK.',
    SRC.bodyNotice('UKSSSC', 'Group-C'), SUBORDINATE_GK('Uttarakhand')),

  // ===== Teaching =====
  E('super-tet', 'UP-SUPER-TET', 'UP Super TET (Prathmik Shikshak) Examination', 'Uttar Pradesh Basic Education Board', 'STATE',
    'Uttar Pradesh\'s recruitment examination for primary-school teachers (Parishadiya Shikshak) — a written test with General Knowledge & Current Affairs, teaching aptitude, Hindi and rational topics.',
    'UP Super TET Notification — https://upbasiceduboard.gov.in', TEACHING_GK('Uttar Pradesh')),
  E('kvs-teaching', 'KVS-PRT-TGT-PGT', 'KVS Teaching Staff (PRT / TGT / PGT) Recruitment Examination', 'Kendriya Vidyalaya Sangathan', 'NATIONAL',
    'Kendriya Vidyalaya Sangathan\'s recruitment examination for Primary Teacher, Trained Graduate Teacher and Post Graduate Teacher posts — with General English, General Hindi and General Knowledge & Current Affairs papers.',
    'KVS Teaching Recruitment Notification — https://kvsangathan.nic.in', TEACHING_GK()),
  E('dsssb-teaching', 'DSSSB-TEACHING', 'DSSSB Teaching & Non-Teaching Staff Recruitment Examination', 'Delhi Subordinate Services Selection Board', 'STATE',
    'Delhi\'s recruitment examination for TGT, PGT, Primary Teacher and non-teaching posts in Delhi government schools and departments — One-Tier/Two-Tier exams with General Awareness & Current Affairs.',
    'DSSSB Recruitment Notification — https://dsssb.delhi.gov.in', TEACHING_GK('Delhi')),
  E('reet', 'BSER-REET', 'Rajasthan REET / RTET (Level 1 & 2) Examination', 'Board of Secondary Education, Rajasthan', 'STATE',
    'Rajasthan\'s Teacher Eligibility Test for Level-1 (Class 1–5) and Level-2 (Class 6–8) teaching posts — with General Studies, Rajasthan-specific GK, and educational psychology.',
    'REET Notification — https://rajeduboard.rajasthan.gov.in', TEACHING_GK('Rajasthan')),
  E('rssb-senior-teacher', 'RSSB-SENIOR-TEACHER', 'RSSB Senior Teacher (Sanskrit & General) Examination', 'Rajasthan Staff Selection Board', 'STATE',
    'Rajasthan\'s recruitment examination for Senior Teacher (GK, English, Maths, Science, Sanskrit) posts — with General Studies (Rajasthan-weighted), educational psychology and the subject paper.',
    'RSSB Senior Teacher Notification — https://rsmssb.rajasthan.gov.in', TEACHING_GK('Rajasthan')),
  E('bihar-stet', 'BSEB-STET', 'Bihar Secondary Teacher Eligibility Test (STET)', 'Bihar School Examination Board', 'STATE',
    'Bihar\'s Teacher Eligibility Test for secondary (Class 9–10) and higher-secondary (Class 11–12) teaching posts — with General Studies, teaching aptitude and the subject paper.',
    'Bihar STET Notification — https://biharboardonline.bihar.gov.in', TEACHING_GK('Bihar')),
  E('bpsc-tre', 'BPSC-TRE', 'BPSC Teacher Recruitment Examination (TRE)', 'Bihar Public Service Commission', 'STATE',
    'Bihar\'s flagship teacher-recruitment examination for Classes 1–5, 6–8, 9–10 and 11–12 — with General Studies (including Bihar-specific GK & current affairs), language papers and the subject paper.',
    'BPSC TRE Notification — https://bpsc.bihar.gov.in', TEACHING_GK('Bihar')),
  E('htet', 'BSEH-HTET', 'Haryana Teacher Eligibility Test (HTET)', 'Board of School Education Haryana', 'STATE',
    'Haryana\'s Teacher Eligibility Test for Level-1 (PRT), Level-2 (TGT) and Level-3 (PGT) — with General Studies (including Haryana GK & current affairs), child development and language papers.',
    'HTET Notification — https://bseh.org.in', TEACHING_GK('Haryana')),
  E('mptet', 'MP-ESB-TET', 'MP Teacher Eligibility Test (MPTET)', 'Madhya Pradesh Employees Selection Board', 'STATE',
    'Madhya Pradesh\'s Teacher Eligibility Test for primary and middle-school teaching posts — with General Knowledge, MP-specific GK, child development & pedagogy and language papers.',
    'MPTET Notification — https://esb.mp.gov.in', TEACHING_GK('Madhya Pradesh')),
  E('awes-aps', 'AWES-APS', 'AWES Army Public School (PRT / TGT / PGT) Teacher Examination', 'Army Welfare Education Society', 'NATIONAL',
    'AWES\'s recruitment examination for teachers in Army Public Schools across India — a screening test with General Awareness & Current Affairs, teaching aptitude, and the subject paper.',
    'AWES APS Teacher Recruitment Notification — https://awesindia.com', TEACHING_GK()),

  // ===== Law entrances =====
  E('clat', 'CLAT', 'Common Law Admission Test', 'Consortium of National Law Universities', 'NATIONAL',
    'The national entrance examination for five-year integrated LLB (and LLM) programmes at the 24 National Law Universities — comprehension-based papers including a dedicated General Knowledge & Current Affairs section.',
    'CLAT Notification — https://consortiumofnlus.ac.in', LAW_GK()),
  E('ailet', 'AILET', 'All India Law Entrance Test', 'National Law University, Delhi', 'NATIONAL',
    'NLU Delhi\'s own entrance examination for its B.A. LLB (Hons) and LLM programmes — English, Current Affairs & General Knowledge and Logical Reasoning.',
    'AILET Notification — https://nludelhi.ac.in', LAW_GK()),
  E('slat', 'SLAT', 'Symbiosis Law Admission Test', 'Symbiosis International (Deemed University)', 'NATIONAL',
    'Symbiosis Law School\'s entrance examination for its B.A. LLB and BBA LLB programmes — Logical & Analytical Reasoning, Legal Reasoning, Reading Comprehension and General Knowledge & Current Affairs.',
    'SLAT Notification — https://www.siu.edu.in', LAW_GK()),
  E('mh-cet-law', 'MH-CET-LAW', 'Maharashtra Common Entrance Test (Law)', 'State Common Entrance Test Cell, Maharashtra', 'STATE',
    'Maharashtra\'s common entrance test for three-year and five-year LLB programmes across state law colleges — with General Knowledge & Current Affairs, Legal Aptitude and Logical Reasoning.',
    'MAH CET Law Notification — https://mahacet.org', LAW_GK()),
  E('du-llb', 'DU-LLB', 'Delhi University LLB Entrance Examination', 'University of Delhi', 'NATIONAL',
    'Delhi University\'s entrance examination for its three-year LLB programme — English, Legal Awareness & Aptitude, Logical Reasoning and General Knowledge & Current Affairs.',
    'DU LLB Notification — https://www.du.ac.in', LAW_GK()),

  // ===== Insurance =====
  E('lic-aao', 'LIC-AAO', 'LIC Assistant Administrative Officer Examination', 'Life Insurance Corporation of India', 'NATIONAL',
    'LIC\'s recruitment examination for Assistant Administrative Officer posts — prelims and mains with General Awareness (insurance & financial sector included) and professional-knowledge papers.',
    'LIC AAO Recruitment Notification', INSURANCE_GA()),
  E('lic-ado', 'LIC-ADO', 'LIC Apprentice Development Officer Examination', 'Life Insurance Corporation of India', 'NATIONAL',
    'LIC\'s recruitment examination for Apprentice Development Officer posts — prelims and mains with General Awareness, insurance & financial awareness papers.',
    'LIC ADO Recruitment Notification', INSURANCE_GA()),
  E('niacl-ao', 'NIACL-AO', 'NIACL Administrative Officer Examination', 'The New India Assurance Company', 'NATIONAL',
    'The New India Assurance Company\'s recruitment examination for Administrative Officer (Scale-I) posts — prelims, mains (General Awareness, insurance & financial awareness) and interview.',
    'NIACL AO Recruitment Notification', INSURANCE_GA()),
  E('uiic-ao', 'UIIC-AO', 'UIIC Assistant Administrative Officer Examination', 'United India Insurance Company', 'NATIONAL',
    'United India Insurance Company\'s recruitment examination for Assistant Administrative Officer posts — prelims, mains with General Awareness & insurance awareness and interview.',
    'UIIC AO Recruitment Notification', INSURANCE_GA()),
  E('oicl-ao', 'OICL-AO', 'OICL Administrative Officer Examination', 'The Oriental Insurance Company', 'NATIONAL',
    'The Oriental Insurance Company\'s recruitment examination for Administrative Officer (Scale-I) posts — prelims, mains with General Awareness & insurance awareness and interview.',
    'OICL AO Recruitment Notification', INSURANCE_GA()),

  // ===== Regulators, PSUs & central recruitment =====
  E('sebi-grade-a', 'SEBI-GRADE-A', 'SEBI Grade A (Assistant Manager) Examination', 'Securities and Exchange Board of India', 'NATIONAL',
    'SEBI\'s recruitment examination for Grade-A (Assistant Manager) officers across general, legal, IT and engineering streams — Phase I with General Awareness (current affairs weighted), Phase II and interview.',
    'SEBI Grade A Notification — https://www.sebi.gov.in', BANK_GA()),
  E('irdai-assistant-manager', 'IRDAI-AM', 'IRDAI Assistant Manager Examination', 'Insurance Regulatory and Development Authority of India', 'NATIONAL',
    'IRDAI\'s recruitment examination for Assistant Manager (Grade-A) posts — Phase I with General Awareness & current affairs, Phase II descriptive and interview.',
    'IRDAI Assistant Manager Notification — https://irdai.gov.in', BANK_GA()),
  E('fci-assistant-grade-3', 'FCI-AG-III', 'FCI Assistant Grade-III Examination', 'Food Corporation of India', 'NATIONAL',
    'FCI\'s recruitment examination for Assistant Grade-III posts (General, Depot, Technical & Accounts) — a computer-based test with General Awareness including Current Affairs.',
    'FCI Assistant Grade-III Notification — https://fci.gov.in', SSC_GA()),
  E('coal-india-mt', 'CIL-MT', 'Coal India Management Trainee Examination', 'Coal India Limited', 'NATIONAL',
    'Coal India\'s recruitment examination for Management Trainee posts across disciplines — a computer-based test with General Knowledge/Awareness, Reasoning, Numerical Ability and the technical paper.',
    'CIL MT Recruitment Notification — https://www.coalindia.in', SSC_GA()),
  E('ib-acio', 'IB-ACIO', 'Intelligence Bureau Assistant Central Intelligence Officer Examination', 'Intelligence Bureau, Ministry of Home Affairs', 'NATIONAL',
    'The Intelligence Bureau\'s recruitment examination for Assistant Central Intelligence Officer (Grade-II/Executive) posts — Tier-I objective (with General Knowledge & Current Affairs), Tier-II descriptive and interview.',
    'IB ACIO Recruitment Notification — https://www.mha.gov.in', SSC_GA()),

  // ===== Management & university entrances (GK-bearing) =====
  E('cuet-ug', 'CUET-UG', 'Common University Entrance Test (UG) — General Test', 'National Testing Agency', 'NATIONAL',
    'The national entrance examination for undergraduate admissions across central, state and private universities — Section III (General Test) includes General Knowledge, Current Affairs and general mental ability.',
    'CUET Notification — https://nta.ac.in', MBA_GK()),
  E('xat', 'XAT', 'Xavier Aptitude Test (XAT)', 'XLRI Jamshedpur (on behalf of XAMI)', 'NATIONAL',
    'India\'s premium MBA entrance examination for XLRI and 160+ associated B-schools — Quantitative Ability, Verbal & Logical Ability, Decision Making and a General Knowledge section.',
    'XAT Notification — https://xlri.ac.in', MBA_GK()),
  E('iift-entrance', 'IIFT', 'IIFT MBA (IB) Entrance Examination', 'Indian Institute of Foreign Trade', 'NATIONAL',
    'IIFT\'s entrance examination for its MBA (International Business) programmes — Quantitative Ability, Verbal Ability, Logical Reasoning, Data Interpretation and General Knowledge & Current Affairs.',
    'IIFT Notification — https://www.iift.ac.in', MBA_GK()),
  E('cmat', 'CMAT', 'Common Management Admission Test (CMAT)', 'National Testing Agency', 'NATIONAL',
    'The national MBA entrance examination for AICTE-approved programmes — Quantitative Techniques, Logical Reasoning, Language Comprehension, General Awareness and Innovation & Entrepreneurship.',
    'CMAT Notification — https://nta.ac.in', MBA_GK()),
  E('mat', 'MAT', 'Management Aptitude Test (MAT)', 'All India Management Association', 'NATIONAL',
    'AIMA\'s national MBA entrance examination (PBT/CBT/IBT) for 600+ B-schools — Language Comprehension, Mathematical Skills, Data Analysis, Intelligence & Critical Reasoning and the Indian & Global Environment (GK) section.',
    'MAT Notification — https://aima.in', MBA_GK()),
  E('snap', 'SNAP', 'Symbiosis National Aptitude Test (SNAP)', 'Symbiosis International (Deemed University)', 'NATIONAL',
    'Symbiosis\'s entrance examination for its MBA programmes — General English, Analytical & Logical Reasoning, Quantitative Ability and Current Affairs.',
    'SNAP Notification — https://www.siu.edu.in', MBA_GK()),
]

/**
 * The one existing DRAFT exam this corpus ACTIVATES: UPSC Engineering Services
 * (ESE) — its Paper I (General Studies & Engineering Aptitude) carries the
 * GK/current-affairs component, so it belongs in the corpus. The publisher
 * creates the missing current version + tree for it and flips it ACTIVE.
 */
export const ESE_ACTIVATION: { slug: string; tree: BlueprintNode[] } = {
  slug: 'upsc-engineering-services',
  tree: [
    {
      name: 'General Studies & Engineering Aptitude (Paper I)',
      children: [
        { name: 'Current issues of national and international importance', topic: 'current-affairs' },
        { name: 'Engineering Aptitude & Logical Reasoning' },
        { name: 'Ethics and Values in the Engineering Profession' },
        { name: 'Basics of Project Management' },
        { name: 'Material Science and Engineering' },
        { name: 'Information and Communication Technologies' },
        { name: 'Energy and Environment' },
        { name: 'Standards and Quality Practices' },
      ],
    },
  ],
}

// ---------- Auto-mapping rules (§8 requirement rows on GK/CA nodes) ----------
// A node whose canonical topic matches a rule inherits the listed KnowledgeUnit
// mappings — the same canonical unit serving many exams at honest depths
// (the exact §46.2 "mapping is a relationship, not copied content" demo).

export interface MappingRule {
  unit: string // canonical unit slug (must be VERIFIED & country-visible)
  relevance: 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
  priority: 'CORE' | 'SUPPORTING' | 'LOW'
  requiredDepth: 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
  questionLikelihood: 'HIGH' | 'MEDIUM' | 'LOW'
  expectedScope: string
}

export const MAPPING_RULES: Record<string, MappingRule[]> = {
  'current-affairs': [
    {
      unit: 'chandrayaan-3-landing-2023', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'FACT', questionLikelihood: 'HIGH',
      expectedScope: 'Recent achievements of national importance — the staple of every current-affairs section.',
    },
    {
      unit: 'un-security-council-permanent-members', relevance: 'PARTIAL', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'International-affairs awareness — membership and structure questions from current developments.',
    },
  ],
  'history': [
    {
      unit: 'ashoka-kalinga-war-261-bce', relevance: 'DIRECT', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'Ancient Indian history facts — the Mauryan empire is a recurring static-GK theme.',
    },
    {
      unit: 'fall-of-the-berlin-wall-1989', relevance: 'CONTEXTUAL', priority: 'LOW',
      requiredDepth: 'FACT', questionLikelihood: 'LOW',
      expectedScope: 'World-history context that modern Indian history questions may assume.',
    },
  ],
  'ancient-india': [
    {
      unit: 'ashoka-kalinga-war-261-bce', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'CONCEPT', questionLikelihood: 'HIGH',
      expectedScope: 'The Mauryan state, Kalinga war and its aftermath — asked directly in ancient-India sections.',
    },
  ],
  'mauryan-empire': [
    {
      unit: 'ashoka-kalinga-war-261-bce', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'DETAILED', questionLikelihood: 'HIGH',
      expectedScope: 'The Kalinga war, its consequences and Ashoka\'s dhamma — in depth.',
    },
  ],
  'world-history': [
    {
      unit: 'fall-of-the-berlin-wall-1989', relevance: 'DIRECT', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'Cold-war turning points — a standard world-history fact cluster.',
    },
  ],
  'constitutional-framework': [
    {
      unit: 'attorney-general-of-india', relevance: 'DIRECT', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'Constitutional offices — article numbers, appointment and role.',
    },
    {
      unit: 'fundamental-rights-articles-12-35', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'FACT', questionLikelihood: 'HIGH',
      expectedScope: 'Part III basics — the six rights and their article numbers.',
    },
  ],
  'polity-governance': [
    {
      unit: 'attorney-general-of-india', relevance: 'DIRECT', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'Constitutional offices — article numbers, appointment and role.',
    },
  ],
  'fundamental-rights': [
    {
      unit: 'fundamental-rights-articles-12-35', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'DETAILED', questionLikelihood: 'HIGH',
      expectedScope: 'The full Part III framework — articles, rights, and how they are enforced.',
    },
    {
      unit: 'right-to-constitutional-remedies-article-32', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'FACT', questionLikelihood: 'HIGH',
      expectedScope: 'Article 32 and the five writs — "the heart and soul of the Constitution".',
    },
  ],
  'science-technology': [
    {
      unit: 'chandrayaan-3-landing-2023', relevance: 'PARTIAL', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'Space-science achievements as they appear inside General Science sections.',
    },
  ],
  'space-technology': [
    {
      unit: 'chandrayaan-3-landing-2023', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'FACT', questionLikelihood: 'HIGH',
      expectedScope: 'ISRO missions and landing technology — a favourite static-plus-current topic.',
    },
  ],
  'isro-programmes': [
    {
      unit: 'chandrayaan-3-landing-2023', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'DETAILED', questionLikelihood: 'HIGH',
      expectedScope: 'Chandrayaan-3 end to end — mission architecture, the Vikram landing and National Space Day.',
    },
  ],
  'international-organisations': [
    {
      unit: 'un-security-council-permanent-members', relevance: 'DIRECT', priority: 'SUPPORTING',
      requiredDepth: 'FACT', questionLikelihood: 'MEDIUM',
      expectedScope: 'UN structure and the P5 — a standard international-organisations question.',
    },
  ],
  'united-nations': [
    {
      unit: 'un-security-council-permanent-members', relevance: 'DIRECT', priority: 'CORE',
      requiredDepth: 'FACT', questionLikelihood: 'HIGH',
      expectedScope: 'The Security Council, its permanent members and the veto.',
    },
  ],
  // awards-honours: no verified unit exists yet — nodes stay unmapped (honest).
}
