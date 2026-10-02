/**
 * GKSetu — homepage UI strings (SITE-S2).
 *
 * The homepage's chrome translation dictionary. The platform's own rule
 * (the user's instruction): translate the page honestly per language, but
 * keep the SEARCH KEYWORDS users actually type — GK, Current Affairs, Exam,
 * Mock Test, Search, Syllabus — in English inside the translated copy, so
 * indexing and in-site search stay keyword-true.
 *
 * Content (knowledge pages, events, subject labels) is translated by the
 * content pipeline (§35 honest fallback) — this dictionary is the CHROME
 * only: hero, section headings, buttons, empty states, SEO title/description.
 *
 * English is the base; every other language falls back per-key (a missing
 * key renders English, never a blank).
 */

export interface HomeStrings {
  /** Hero — assembled as {prefix}{highlight}{suffix} (word order per language). */
  heroPrefix: string
  heroHighlight: string
  heroSuffix: string
  heroSub: string
  comingSoonBadge: string
  comingSoonSub: string
  searchPlaceholder: string
  readIn: string
  soon: string
  currentAffairs: string
  viewAll: string
  browseCurrentAffairs: string
  caEmptyTitleAvailable: string
  caEmptyBodyAvailable: string
  caEmptyTitleMarket: string
  caEmptyBodyMarket: string
  exploreBySubject: string
  libraryLine: string
  prepareForExam: string
  allExams: string
  examsAtLaunch: string
  popularNow: string
  majorTopics: string
  topicsLabel: string
  pagesLabel: string
  seoTitle: string
  seoDescription: string
}

const EN: HomeStrings = {
  heroPrefix: '',
  heroHighlight: 'GK, Current Affairs',
  heroSuffix: '',
  heroSub:
    'Everything you need in one place: evergreen GK, daily current affairs with exam context, and complete syllabi for every major exam — searchable, in your language.',
  comingSoonBadge: 'Launching soon in {country}',
  comingSoonSub:
    'GKSetu launches in {country} soon. Until then, explore the global knowledge library — every topic below is open to browse today.',
  searchPlaceholder: 'Search topics, knowledge, exams…',
  readIn: 'Read in',
  soon: 'Soon',
  currentAffairs: 'Current affairs',
  viewAll: 'View all',
  browseCurrentAffairs: 'Browse current affairs',
  caEmptyTitleAvailable: 'The latest stories are on their way',
  caEmptyBodyAvailable: 'New stories appear here as soon as our editors publish them — check back shortly.',
  caEmptyTitleMarket: 'Current affairs for this country launch soon',
  caEmptyBodyMarket: 'Until then, the global knowledge library below is fully open to browse.',
  exploreBySubject: 'Explore by subject',
  libraryLine: 'The full GK library, organised for {country}',
  prepareForExam: 'Prepare for your exam',
  allExams: 'All {n} exams',
  examsAtLaunch: 'exams at launch',
  popularNow: 'Popular right now',
  majorTopics: 'Major topics',
  topicsLabel: 'topics',
  pagesLabel: 'pages',
  seoTitle: '{country} — GK, Current Affairs & Exam Preparation | GKSetu',
  seoDescription:
    'GK, daily current affairs and exam preparation for {country}: {topics} topics, {units} knowledge pages, {exams} exams — in your language.',
}

/** The hero for English renders as "{country}'s {highlight} & exam companion". */
EN.heroPrefix = "{country}'s "
EN.heroSuffix = ' & exam companion'

const HI: HomeStrings = {
  ...EN,
  heroPrefix: '{country} के लिए ',
  heroHighlight: 'GK, Current Affairs',
  heroSuffix: ' और Exam की पूरी तैयारी',
  heroSub:
    'सब एक जगह: हमेशा काम आने वाला GK, Exam संदर्भ के साथ रोज़ के Current Affairs, और हर बड़े Exam का पूरा Syllabus — Search करें, अपनी भाषा में पढ़ें।',
  comingSoonBadge: '{country} में जल्द लॉन्च हो रहा है',
  comingSoonSub:
    'GKSetu जल्द ही {country} में लॉन्च हो रहा है। तब तक नीचे दी गई global knowledge library खुली है — हर topic आज ही पढ़ें।',
  searchPlaceholder: 'Search करें: topics, knowledge, exams…',
  readIn: 'इसमें पढ़ें',
  soon: 'जल्द',
  currentAffairs: 'Current Affairs',
  viewAll: 'सभी देखें',
  browseCurrentAffairs: 'Current Affairs देखें',
  caEmptyTitleAvailable: 'नई stories रास्ते में हैं',
  caEmptyBodyAvailable: 'Editors publish करते ही नई stories यहाँ दिखने लगेंगी — थोड़ी देर में फिर से देखें।',
  caEmptyTitleMarket: 'इस देश के लिए Current Affairs जल्द शुरू होंगे',
  caEmptyBodyMarket: 'तब तक नीचे की global knowledge library पूरी खुली है।',
  exploreBySubject: 'Subject के हिसाब से देखें',
  libraryLine: '{country} के लिए पूरी GK library',
  prepareForExam: 'अपने Exam की तैयारी करें',
  allExams: 'सभी {n} Exams',
  examsAtLaunch: 'Exams at launch',
  popularNow: 'अभी popular',
  majorTopics: 'बड़े topics',
  topicsLabel: 'topics',
  pagesLabel: 'pages',
  seoTitle: '{country} — GK, Current Affairs और Exam Preparation | GKSetu',
  seoDescription:
    '{country} के लिए GK, रोज़ के Current Affairs और Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams — अपनी भाषा में।',
}

const BN: HomeStrings = {
  ...EN,
  heroPrefix: '{country}-এর জন্য ',
  heroSuffix: ' এবং Exam-এর পূর্ণ প্রস্তুতি',
  heroSub:
    'সব এক জায়গায়: চিরকালের কাজে লাগা GK, Exam-এর প্রেক্ষাপটে প্রতিদিনের Current Affairs, আর প্রতিটি বড় Exam-এর পূর্ণ Syllabus — Search করুন, নিজের ভাষায় পড়ুন।',
  comingSoonBadge: '{country}-এ শীঘ্রই আসছে',
  comingSoonSub: 'GKSetu শীঘ্রই {country}-এ চালু হচ্ছে। ততদিন নিচের global knowledge library পড়ার জন্য খোলা।',
  searchPlaceholder: 'Search করুন: topics, knowledge, exams…',
  readIn: 'এই ভাষায় পড়ুন',
  soon: 'শীঘ্রই',
  viewAll: 'সব দেখুন',
  browseCurrentAffairs: 'Current Affairs দেখুন',
  exploreBySubject: 'Subject অনুযায়ী দেখুন',
  libraryLine: '{country}-এর জন্য সম্পূর্ণ GK library',
  prepareForExam: 'আপনার Exam-এর প্রস্তুতি নিন',
  allExams: 'সব {n} Exams',
  popularNow: 'এখন জনপ্রিয়',
  majorTopics: 'বড় topics',
  seoTitle: '{country} — GK, Current Affairs ও Exam Preparation | GKSetu',
  seoDescription:
    '{country}-এর জন্য GK, প্রতিদিনের Current Affairs ও Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams।',
}

const MR: HomeStrings = {
  ...EN,
  heroPrefix: '{country} साठी ',
  heroSuffix: ' आणि Examची पूर्ण तयारी',
  heroSub:
    'सगळं एकाच ठिकाणी: कायम कामी येणारं GK, Exam संदर्भासह रोजचे Current Affairs, आणि प्रत्येक मोठ्या Examचा पूर्ण Syllabus — Search करा, तुमच्या भाषेत वाचा.',
  comingSoonBadge: '{country} मध्ये लवकरच',
  comingSoonSub: 'GKSetu लवकरच {country} मध्ये सुरू होत आहे. तोवर खालील global knowledge library वाचण्यासाठी खुली आहे.',
  searchPlaceholder: 'Search करा: topics, knowledge, exams…',
  readIn: 'यात वाचा',
  soon: 'लवकरच',
  viewAll: 'सर्व पहा',
  browseCurrentAffairs: 'Current Affairs पहा',
  exploreBySubject: 'Subject नुसार पहा',
  libraryLine: '{country} साठी संपूर्ण GK library',
  prepareForExam: 'तुमच्या Examची तयारी करा',
  allExams: 'सर्व {n} Exams',
  popularNow: 'आता लोकप्रिय',
  majorTopics: 'मोठे topics',
  seoTitle: '{country} — GK, Current Affairs आणि Exam Preparation | GKSetu',
  seoDescription:
    '{country} साठी GK, रोजचे Current Affairs आणि Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams.',
}

const TE: HomeStrings = {
  ...EN,
  heroPrefix: '{country} కోసం ',
  heroSuffix: ' మరియు Exam పూర్తి సన్నాహం',
  heroSub:
    'అంతా ఒకే చోట: ఎప్పటికీ పనికొచ్చే GK, Exam సందర్భంతో రోజువారీ Current Affairs, మరియు ప్రతి పెద్ద Exam యొక్క పూర్తి Syllabus — Search చేయండి, మీ భాషలో చదవండి.',
  comingSoonBadge: '{country}లో త్వరలో',
  comingSoonSub: 'GKSetu త్వరలో {country}లో ప్రారంభమవుతోంది. అప్పటివరకు క్రింది global knowledge library చదవడానికి తెరిచి ఉంది.',
  searchPlaceholder: 'Search చేయండి: topics, knowledge, exams…',
  readIn: 'ఇందులో చదవండి',
  soon: 'త్వరలో',
  viewAll: 'అన్నీ చూడండి',
  browseCurrentAffairs: 'Current Affairs చూడండి',
  exploreBySubject: 'Subject ప్రకారం చూడండి',
  libraryLine: '{country} కోసం పూర్తి GK library',
  prepareForExam: 'మీ Exam సన్నాహం చేయండి',
  allExams: 'అన్ని {n} Exams',
  popularNow: 'ఇప్పుడే ప్రాచుర్యం',
  majorTopics: 'పెద్ద topics',
  seoTitle: '{country} — GK, Current Affairs మరియు Exam Preparation | GKSetu',
  seoDescription:
    '{country} కోసం GK, దైనందిన Current Affairs మరియు Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams.',
}

const TA: HomeStrings = {
  ...EN,
  heroPrefix: '{country}-க்கான ',
  heroSuffix: ' மற்றும் Exam முழு தயாரிப்பு',
  heroSub:
    'எல்லாம் ஒரே இடத்தில்: எப்போதும் பயனுள்ள GK, Exam சூழலுடன் தினசரி Current Affairs, மற்றும் ஒவ்வொரு பெரிய Exam-ன் முழு Syllabus — Search செய்யுங்கள், உங்கள் மொழியில் படியுங்கள்.',
  comingSoonBadge: '{country}-இல் விரைவில்',
  comingSoonSub: 'GKSetu விரைவில் {country}-இல் தொடங்குகிறது. அதுவரை கீழே உள்ள global knowledge library படிக்க திறந்திருக்கிறது.',
  searchPlaceholder: 'Search செய்யுங்கள்: topics, knowledge, exams…',
  readIn: 'இதில் படிக்கவும்',
  soon: 'விரைவில்',
  viewAll: 'அனைத்தையும் பார்க்க',
  browseCurrentAffairs: 'Current Affairs பார்க்க',
  exploreBySubject: 'Subject வாரியாக பார்க்க',
  libraryLine: '{country}-க்கான முழு GK library',
  prepareForExam: 'உங்கள் Exam தயாரிப்பு',
  allExams: 'அனைத்து {n} Exams',
  popularNow: 'இப்போது பிரபலம்',
  majorTopics: 'பெரிய topics',
  seoTitle: '{country} — GK, Current Affairs மற்றும் Exam Preparation | GKSetu',
  seoDescription:
    '{country}-க்கு GK, தினசரி Current Affairs மற்றும் Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams.',
}

const GU: HomeStrings = {
  ...EN,
  heroPrefix: '{country} માટે ',
  heroSuffix: ' અને Examની પૂરી તૈયારી',
  heroSub:
    'બધું એક જ જગ્યાએ: હંમેશા કામ લાગે એવું GK, Exam સંદર્ભ સાથે રોજનાં Current Affairs, અને દરેક મોટી Examનો પૂરો Syllabus — Search કરો, તમારી ભાષામાં વાંચો.',
  comingSoonBadge: '{country}માં ટૂંક સમયમાં',
  comingSoonSub: 'GKSetu ટૂંક સમયમાં {country}માં શરૂ થાય છે. ત્યાં સુધી નીચેની global knowledge library વાંચવા માટે ખુલ્લી છે.',
  searchPlaceholder: 'Search કરો: topics, knowledge, exams…',
  readIn: 'આમાં વાંચો',
  soon: 'ટૂંક સમયમાં',
  viewAll: 'બધું જુઓ',
  browseCurrentAffairs: 'Current Affairs જુઓ',
  exploreBySubject: 'Subject પ્રમાણે જુઓ',
  libraryLine: '{country} માટે સંપૂર્ણ GK library',
  prepareForExam: 'તમારી Examની તૈયારી કરો',
  allExams: 'બધી {n} Exams',
  popularNow: 'હમણાં લોકપ્રિય',
  majorTopics: 'મોટા topics',
  seoTitle: '{country} — GK, Current Affairs અને Exam Preparation | GKSetu',
  seoDescription:
    '{country} માટે GK, રોજનાં Current Affairs અને Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams.',
}

const KN: HomeStrings = {
  ...EN,
  heroPrefix: '{country} ಗಾಗಿ ',
  heroSuffix: ' ಮತ್ತು Exam ಸಂಪೂರ್ಣ ಸಿದ್ಧತೆ',
  heroSub:
    'ಎಲ್ಲವೂ ಒಂದೇ ಕಡೆ: ಯಾವಾಗಲೂ ಉಪಯುಕ್ತ GK, Exam ಸಂದರ್ಭದೊಂದಿಗೆ ದೈನಂದಿನ Current Affairs, ಮತ್ತು ಪ್ರತಿ ದೊಡ್ಡ Exam ಸಂಪೂರ್ಣ Syllabus — Search ಮಾಡಿ, ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಓದಿ.',
  comingSoonBadge: '{country}ದಲ್ಲಿ ಶೀಘ್ರವೇ',
  comingSoonSub: 'GKSetu ಶೀಘ್ರವೇ {country}ದಲ್ಲಿ ಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ. ಆವರೆಗೆ ಕೆಳಗಿನ global knowledge library ಓದಲು ತೆರೆದಿದೆ.',
  searchPlaceholder: 'Search ಮಾಡಿ: topics, knowledge, exams…',
  readIn: 'ಇದರಲ್ಲಿ ಓದಿ',
  soon: 'ಶೀಘ್ರವೇ',
  viewAll: 'ಎಲ್ಲವನ್ನೂ ನೋಡಿ',
  browseCurrentAffairs: 'Current Affairs ನೋಡಿ',
  exploreBySubject: 'Subject ಅನುಸಾರ ನೋಡಿ',
  libraryLine: '{country} ಗಾಗಿ ಸಂಪೂರ್ಣ GK library',
  prepareForExam: 'ನಿಮ್ಮ Exam ಸಿದ್ಧತೆ ಮಾಡಿ',
  allExams: 'ಎಲ್ಲಾ {n} Exams',
  popularNow: 'ಈಗ ಜನಪ್ರಿಯ',
  majorTopics: 'ದೊಡ್ಡ topics',
  seoTitle: '{country} — GK, Current Affairs ಮತ್ತು Exam Preparation | GKSetu',
  seoDescription:
    '{country} ಗಾಗಿ GK, ದೈನಂದಿನ Current Affairs ಮತ್ತು Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams.',
}

const OR: HomeStrings = {
  ...EN,
  heroPrefix: '{country} ପାଇଁ ',
  heroSuffix: ' ଏବଂ Exam ପାଇଁ ସମ୍ପୂର୍ଣ୍ଣ ପ୍ରସ୍ତୁତି',
  heroSub:
    'ସବୁ ଏକ ସ୍ଥାନରେ: ସବୁଦିନ କାମରେ ଆସୁଥିବା GK, Exam ପ୍ରସଙ୍ଗ ସହ ଦୈନିକ Current Affairs, ଏବଂ ପ୍ରତ୍ୟେକ ବଡ଼ Examର ସମ୍ପୂର୍ଣ୍ଣ Syllabus — Search କରନ୍ତୁ, ନିଜ ଭାଷାରେ ପଢ଼ନ୍ତୁ।',
  comingSoonBadge: '{country}ରେ ଶୀଘ୍ର ଆସୁଛି',
  comingSoonSub: 'GKSetu ଶୀଘ୍ର {country}ରେ ଆରମ୍ଭ ହେଉଛି। ସେତେବେଳେ ତଳେ ଥିବା global knowledge library ପଢ଼ିବା ପାଇଁ ଖୋଲା।',
  searchPlaceholder: 'Search କରନ୍ତୁ: topics, knowledge, exams…',
  readIn: 'ଏଥିରେ ପଢ଼ନ୍ତୁ',
  soon: 'ଶୀଘ୍ର',
  viewAll: 'ସବୁ ଦେଖନ୍ତୁ',
  browseCurrentAffairs: 'Current Affairs ଦେଖନ୍ତୁ',
  exploreBySubject: 'Subject ଅନୁସାରେ ଦେଖନ୍ତୁ',
  libraryLine: '{country} ପାଇଁ ସମ୍ପୂର୍ଣ୍ଣ GK library',
  prepareForExam: 'ନିଜ Exam ପ୍ରସ୍ତୁତି କରନ୍ତୁ',
  allExams: 'ସବୁ {n} Exams',
  popularNow: 'ବର୍ତ୍ତମାନ ଲୋକପ୍ରିୟ',
  majorTopics: 'ବଡ଼ topics',
  seoTitle: '{country} — GK, Current Affairs ଏବଂ Exam Preparation | GKSetu',
  seoDescription:
    '{country} ପାଇଁ GK, ଦୈନିକ Current Affairs ଏବଂ Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams।',
}

const ML: HomeStrings = {
  ...EN,
  heroPrefix: '{country}-ന് വേണ്ടി ',
  heroSuffix: ' ഒപ്പം Exam പൂർണ്ണ തയ്യാറെടുപ്പ്',
  heroSub:
    'എല്ലാം ഒരിടത്ത്: എന്നും ഉപയോഗിക്കാവുന്ന GK, Exam സാഹചര്യത്തോടെ ദിനംപ്രതി Current Affairs, ഒപ്പം ഓരോ വലിയ Exam-ന്റെയും പൂർണ്ണ Syllabus — Search ചെയ്യൂ, നിങ്ങളുടെ ഭാഷയിൽ വായിക്കൂ.',
  comingSoonBadge: '{country}-ൽ ഉടൻ വരുന്നു',
  comingSoonSub: 'GKSetu ഉടൻ {country}-ൽ ആരംഭിക്കുന്നു. അതുവരെ താഴെയുള്ള global knowledge library വായിക്കാൻ തുറന്നിരിക്കുന്നു.',
  searchPlaceholder: 'Search ചെയ്യൂ: topics, knowledge, exams…',
  readIn: 'ഇതിൽ വായിക്കൂ',
  soon: 'ഉടൻ',
  viewAll: 'എല്ലാം കാണൂ',
  browseCurrentAffairs: 'Current Affairs കാണൂ',
  exploreBySubject: 'Subject അനുസരിച്ച് കാണൂ',
  libraryLine: '{country}-ന് വേണ്ടി പൂർണ്ണ GK library',
  prepareForExam: 'നിങ്ങളുടെ Exam തയ്യാറെടുപ്പ്',
  allExams: 'എല്ലാ {n} Exams',
  popularNow: 'ഇപ്പോൾ ജനപ്രിയം',
  majorTopics: 'വലിയ topics',
  seoTitle: '{country} — GK, Current Affairs, Exam Preparation | GKSetu',
  seoDescription:
    '{country}-ന് വേണ്ടി GK, ദിനംപ്രതി Current Affairs, Exam Preparation — {topics} topics, {units} knowledge pages, {exams} Exams.',
}

const FR: HomeStrings = {
  ...EN,
  heroPrefix: 'Pour {country} : ',
  heroHighlight: 'GK, Current Affairs',
  heroSuffix: ' et la préparation aux examens',
  heroSub:
    'Tout au même endroit : le GK essentiel, l’actualité quotidienne avec le contexte des examens, et le programme complet de chaque grand examen — en votre langue.',
  comingSoonBadge: 'Bientôt disponible en {country}',
  comingSoonSub:
    'GKSetu arrive bientôt en {country}. En attendant, la bibliothèque mondiale ci-dessous est déjà ouverte.',
  searchPlaceholder: 'Rechercher : matières, connaissances, examens…',
  readIn: 'Lire en',
  soon: 'Bientôt',
  currentAffairs: 'Current Affairs',
  viewAll: 'Tout voir',
  browseCurrentAffairs: 'Voir les Current Affairs',
  caEmptyTitleAvailable: 'Les dernières actualités arrivent',
  caEmptyBodyAvailable: 'De nouvelles histoires apparaissent ici dès leur publication par nos rédacteurs.',
  caEmptyTitleMarket: 'Les Current Affairs de ce pays arrivent bientôt',
  caEmptyBodyMarket: 'En attendant, la bibliothèque mondiale ci-dessous reste entièrement ouverte.',
  exploreBySubject: 'Explorer par matière',
  libraryLine: 'Toute la bibliothèque GK pour {country}',
  prepareForExam: 'Préparez votre examen',
  allExams: 'Les {n} examens',
  examsAtLaunch: 'examens au lancement',
  popularNow: 'Populaire en ce moment',
  majorTopics: 'Grands sujets',
  topicsLabel: 'sujets',
  pagesLabel: 'pages',
  seoTitle: '{country} — GK, Current Affairs & Préparation aux Examens | GKSetu',
  seoDescription:
    'GK, actualités quotidiennes et préparation aux examens pour {country} : {topics} matières, {units} pages, {exams} examens — dans votre langue.',
}

const BY_LANGUAGE: Record<string, HomeStrings> = {
  en: EN,
  hi: HI,
  bn: BN,
  mr: MR,
  te: TE,
  ta: TA,
  gu: GU,
  kn: KN,
  or: OR,
  ml: ML,
  fr: FR,
}

/** Fill a `{placeholder}` template. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )
}

/** The homepage strings for a language — per-key English fallback. */
export function homeStrings(languageCode: string): HomeStrings {
  return BY_LANGUAGE[languageCode] ?? EN
}
