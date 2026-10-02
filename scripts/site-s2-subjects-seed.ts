/**
 * GKSetu — SITE-S2-A seed: the 17-subject corpus.
 * docs/site-overhaul-plan.md §3 Task 8 — the root-DOMAIN subject grid grows
 * from 4 to 21 (current-affairs keeps its anchor slot, excluded from subject
 * grids in the UI). Final subject set (20 grid entries + current-affairs):
 *   1-4   polity-governance / history / science-technology / current-affairs
 *         (pre-existing; this seed only asserts their orderIndex)
 *   5-21  the 17 subjects below, one of which (awards-honours) is PROMOTED
 *         from its current-affairs BRANCH to a root DOMAIN (§13 — plan Task 8
 *         "promoted from a History branch to root"; its existing labels stay,
 *         the promotion only re-parents and up-ranks it).
 *
 * Per subject (site-overhaul plan: "SEO-meaningful canonical description
 * (English) + hi label + description + native labels for the 8 PLANNED
 * languages + aliases + stable order"):
 *   - Topic: DOMAIN / GLOBAL / parentId null / orderIndex 5-21, canonical
 *     SEO description (120-200 chars, exam-relevant, keyword-rich but natural).
 *   - TopicLabel en + hi: name + description (§35 chain — reader-language
 *     label description → en label description → canonical topic description).
 *   - TopicLabel bn/mr/te/ta/gu/kn/or/ml: native-script NAME only — those
 *     languages are PLANNED (no published content; the label is the
 *     announcement, the UI honestly falls back to English).
 *   - TopicAlias: 3-6 English search aliases, language-neutral (languageId
 *     null), following prisma/seed.ts's pattern.
 *
 * Idempotency contract (safe to re-run):
 *   - Topics upsert by slug; the update arm re-asserts only the seed-owned
 *     content fields (canonicalName, description, orderIndex) so a re-run
 *     lands corrections — status/type/scope/parent of an already-root topic
 *     are never touched (§36: live console edits and lifecycle states stay).
 *   - awards-honours: promoted ONLY while it is still a branch (parentId set
 *     or type != DOMAIN); an already-promoted root is left untouched.
 *   - Labels upsert by [topicId, languageId] (update: name, plus description
 *     for en/hi — the seed-owned SEO copy); planned-language labels never
 *     write a description (an admin-added one is never cleared).
 *   - Aliases are add-missing (existing values kept, nothing deleted).
 *
 * Run: bun scripts/site-s2-subjects-seed.ts
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const url = readFileSync('.env', 'utf8').match(/GKSETU_DATABASE_URL=["']?([^"'\n]+)["']?/)?.[1] ?? ''
const prisma = new PrismaClient({ datasources: { db: { url } } })

// ---------- Seed data ----------

/** The 8 PLANNED India languages (site-s2-languages-seed) — name-only labels. */
const PLANNED_LANGUAGE_CODES = ['bn', 'mr', 'te', 'ta', 'gu', 'kn', 'or', 'ml'] as const
type PlannedCode = (typeof PLANNED_LANGUAGE_CODES)[number]

interface SubjectSeed {
  slug: string
  canonicalName: string
  orderIndex: number
  /** Canonical (English-reference) SEO description, 120-200 chars. */
  description: string
  /** Hindi label name (loanwords in Devanagari where natural, Latin exam terms per platform convention). */
  hiName: string
  /** Hindi label description (same SEO intent; UPSC/SSC/GK etc. stay Latin). */
  hiDescription: string
  /** Native-script subject names for the 8 PLANNED languages — name only, no description. */
  native: Record<PlannedCode, string>
  /** English search aliases (lowercase, language-neutral). */
  aliases: string[]
}

const SUBJECTS: SubjectSeed[] = [
  {
    slug: 'geography',
    canonicalName: 'Geography',
    orderIndex: 5,
    description:
      'Indian and world geography — physical features, rivers, climate, states and capitals — the static GK every exam maps, with maps, facts and quick revision notes.',
    hiName: 'भूगोल',
    hiDescription:
      'भारतीय और विश्व भूगोल — नदियाँ, पर्वत, जलवायु, राज्य-राजधानियाँ — maps और तथ्यों के साथ वह static GK जो UPSC, SSC और state PCS की हर परीक्षा में पूछा जाता है।',
    native: {
      bn: 'ভূগোল',
      mr: 'भूगोल',
      te: 'భూగోళం',
      ta: 'புவியியல்',
      gu: 'ભૂગોળ',
      kn: 'ಭೂಗೋಳ',
      or: 'ଭୂଗୋଳ',
      ml: 'ഭൂമിശാസ്ത്രം',
    },
    aliases: ['indian geography', 'world geography', 'maps', 'physical geography', 'rivers', 'states and capitals'],
  },
  {
    slug: 'economy',
    canonicalName: 'Economy & Business',
    orderIndex: 6,
    description:
      'Indian economy and business — budget, banking, RBI, inflation, national income and organisations — the GK that UPSC, SSC and banking exams repeatedly ask.',
    hiName: 'अर्थव्यवस्था और बिज़नेस',
    hiDescription:
      'भारतीय अर्थव्यवस्था और बिज़नेस — बजट, बैंकिंग, RBI, महँगाई, राष्ट्रीय आय और संगठन — UPSC, SSC और banking परीक्षाओं में बार-बार पूछा जाने वाला GK।',
    native: {
      bn: 'অর্থনীতি ও ব্যবসা',
      mr: 'अर्थव्यवस्था आणि व्यवसाय',
      te: 'ఆర్థిక వ్యవస్థ & వ్యాపారం',
      ta: 'பொருளாதாரம் & வணிகம்',
      gu: 'અર્થતંત્ર અને બિઝનેસ',
      kn: 'ಆರ್ಥಿಕತೆ ಮತ್ತು ವ್ಯಾಪಾರ',
      or: 'ଅର୍ଥନୀତି ଓ ବ୍ୟବସାୟ',
      ml: 'സമ്പദ്‌വ്യവസ്ഥയും ബിസിനസും',
    },
    aliases: ['economics', 'budget', 'banking awareness', 'rbi', 'indian economy', 'inflation'],
  },
  {
    slug: 'environment-ecology',
    canonicalName: 'Environment & Ecology',
    orderIndex: 7,
    description:
      'Environment and ecology GK — ecosystems, biodiversity, national parks, sanctuaries, climate treaties and pollution control — a UPSC, SSC and state PCS favourite.',
    hiName: 'पर्यावरण और पारिस्थितिकी',
    hiDescription:
      'पर्यावरण और पारिस्थितिकी — जैव विविधता, राष्ट्रीय उद्यान, अभयारण्य, जलवायु समझौते और प्रदूषण — UPSC, SSC और state PCS के लिए आवश्यक GK, सरल नोट्स के साथ।',
    native: {
      bn: 'পরিবেশ ও বাস্তুসংস্থান',
      mr: 'पर्यावरण आणि परिस्थितिकी',
      te: 'పర్యావరణం & జీవావరణ శాస్త్రం',
      ta: 'சுற்றுச்சூழல் & சூழலியல்',
      gu: 'પર્યાવરણ અને ઇકોલોજી',
      kn: 'ಪರಿಸರ ಮತ್ತು ಪರಿಸರವಿಜ್ಞಾನ',
      or: 'ପରିବେଶ ଓ ପାରିସ୍ଥିତିକ ବିଜ୍ଞାନ',
      ml: 'പരിസ്ഥിതിയും ആവാസവിജ്ഞാനവും',
    },
    aliases: ['ecology', 'environment', 'biodiversity', 'national parks', 'climate change'],
  },
  {
    slug: 'biology',
    canonicalName: 'Biology',
    orderIndex: 8,
    description:
      'Biology GK for competitive exams — human body systems, plants, genetics, diseases and everyday science — the life-science questions UPSC, SSC and railways ask.',
    hiName: 'जीव विज्ञान (Biology)',
    hiDescription:
      'जीव विज्ञान GK — मानव शरीर, पौधे, आनुवंशिकी, रोग और रोज़मर्रा का विज्ञान — UPSC, SSC और railways परीक्षाओं में पूछे जाने वाले life-science प्रश्न।',
    native: {
      bn: 'জীববিজ্ঞান',
      mr: 'जीवशास्त्र',
      te: 'జీవ శాస్త్రం',
      ta: 'உயிரியல்',
      gu: 'જીવવિજ્ઞાન',
      kn: 'ಜೀವಶಾಸ್ತ್ರ',
      or: 'ଜୀବ ବିଜ୍ଞାନ',
      ml: 'ജീവശാസ്ത്രം',
    },
    aliases: ['life science', 'botany', 'zoology', 'human body', 'genetics'],
  },
  {
    slug: 'physics',
    canonicalName: 'Physics',
    orderIndex: 9,
    description:
      'Physics GK — laws of motion, light, electricity, units, inventions and famous experiments — the everyday science and applied physics SSC, railways and UPSC ask.',
    hiName: 'भौतिक विज्ञान (Physics)',
    hiDescription:
      'भौतिक विज्ञान GK — गति के नियम, प्रकाश, बिजली, मात्रक, खोजें और प्रसिद्ध प्रयोग — SSC, railways और UPSC की परीक्षाओं में पूछा जाने वाला everyday science।',
    native: {
      bn: 'পদার্থবিজ্ঞান',
      mr: 'भौतिकशास्त्र',
      te: 'భౌతిక శాస్త్రం',
      ta: 'இயற்பியல்',
      gu: 'ભૌતિકવિજ્ઞાન',
      kn: 'ಭೌತಿಕಶಾಸ್ತ್ರ',
      or: 'ପଦାର୍ଥ ବିଜ୍ଞାନ',
      ml: 'ഭൗതികശാസ്ത്രം',
    },
    aliases: ['physical science', 'laws of motion', 'light and optics', 'electricity', 'units and measurements'],
  },
  {
    slug: 'chemistry',
    canonicalName: 'Chemistry',
    orderIndex: 10,
    description:
      'Chemistry GK — elements, acids and bases, everyday chemistry, metals, gases and famous chemists — high-yield science questions for SSC, railways and UPSC.',
    hiName: 'रसायन विज्ञान (Chemistry)',
    hiDescription:
      'रसायन विज्ञान GK — तत्व, अम्ल-क्षार, धातुएँ, गैसें और रोज़मर्रा का रसायन — SSC, railways, UPSC और state परीक्षाओं के लिए उपयोगी तथ्य।',
    native: {
      bn: 'রসায়ন',
      mr: 'रसायनशास्त्र',
      te: 'రసాయన శాస్త్రం',
      ta: 'வேதியியல்',
      gu: 'રસાયણવિજ્ઞાન',
      kn: 'ರಸಾಯನಶಾಸ್ತ್ರ',
      or: 'ରସାୟନ ବିଜ୍ଞାନ',
      ml: 'രസതന്ത്രം',
    },
    aliases: ['chemical science', 'elements', 'acids and bases', 'metals', 'everyday chemistry'],
  },
  {
    slug: 'computer-it',
    canonicalName: 'Computer & IT',
    orderIndex: 11,
    description:
      'Computer and IT GK — hardware, software, internet, MS Office shortcuts and new technologies — the computer awareness every SSC, banking and railways exam tests.',
    hiName: 'कंप्यूटर और IT',
    hiDescription:
      'कंप्यूटर और IT GK — हार्डवेयर, सॉफ्टवेयर, इंटरनेट, MS Office और नई तकनीकें — SSC, banking और railways की हर परीक्षा में पूछा जाने वाला computer awareness।',
    native: {
      bn: 'কম্পিউটার ও IT',
      mr: 'संगणक आणि IT',
      te: 'కంప్యూటర్ & IT',
      ta: 'கணினி & IT',
      gu: 'કમ્પ્યુટર અને IT',
      kn: 'ಕಂಪ್ಯೂಟರ್ ಮತ್ತು IT',
      or: 'କମ୍ପ୍ୟୁଟର ଓ IT',
      ml: 'കമ്പ്യൂട്ടർ & IT',
    },
    aliases: ['computer awareness', 'computers', 'information technology', 'internet', 'software'],
  },
  {
    slug: 'sports',
    canonicalName: 'Sports',
    orderIndex: 12,
    description:
      'Sports GK — cricket, Olympics, Commonwealth and Asian Games, cups and trophies, famous players and venues — the games current affairs every exam loves.',
    hiName: 'खेल',
    hiDescription:
      'खेल GK — क्रिकेट, Olympics, Commonwealth और Asian Games, कप-ट्रॉफियाँ, प्रसिद्ध खिलाड़ी और स्टेडियम — हर परीक्षा में पूछे जाने वाले खेल समाचार।',
    native: {
      bn: 'খেলাধুলা',
      mr: 'खेळ',
      te: 'క్రీడలు',
      ta: 'விளையாட்டு',
      gu: 'રમતગમત',
      kn: 'ಕ್ರೀಡೆ',
      or: 'ଖେଳ',
      ml: 'കായികം',
    },
    aliases: ['games', 'cricket', 'olympics', 'football', 'cups and trophies'],
  },
  {
    slug: 'art-culture',
    canonicalName: 'Art & Culture',
    orderIndex: 13,
    description:
      'Indian art and culture — classical dances, music, festivals, painting schools, architecture and UNESCO heritage sites — the culture GK UPSC and state PCS ask.',
    hiName: 'कला और संस्कृति',
    hiDescription:
      'भारतीय कला और संस्कृति — शास्त्रीय नृत्य, संगीत, त्योहार, चित्रकला, स्थापत्य और UNESCO धरोहर — UPSC और state PCS में बार-बार पूछा जाने वाला विषय।',
    native: {
      bn: 'শিল্পকলা ও সংস্কৃতি',
      mr: 'कला आणि संस्कृती',
      te: 'కళలు & సంస్కృతి',
      ta: 'கலை & கலாச்சாரம்',
      gu: 'કલા અને સંસ્કૃતિ',
      kn: 'ಕಲೆ ಮತ್ತು ಸಂಸ್ಕೃತಿ',
      or: 'କଳା ଓ ସଂସ୍କୃତି',
      ml: 'കലയും സംസ്കാരവും',
    },
    aliases: ['culture', 'dance', 'music', 'festivals', 'heritage sites', 'architecture'],
  },
  {
    slug: 'books-authors',
    canonicalName: 'Books & Authors',
    orderIndex: 14,
    description:
      'Books and authors GK — famous books, their writers, autobiographies and literary awards — a classic one-liner topic for SSC, railways, UPSC and quiz rounds.',
    hiName: 'पुस्तकें और लेखक',
    hiDescription:
      'पुस्तकें और लेखक GK — प्रसिद्ध किताबें, उनके लेखक, आत्मकथाएँ और साहित्यिक पुरस्कार — SSC, railways, UPSC और quiz का क्लासिक टॉपिक।',
    native: {
      bn: 'বই ও লেখক',
      mr: 'पुस्तके आणि लेखक',
      te: 'పుస్తకాలు & రచయితలు',
      ta: 'புத்தகங்கள் & ஆசிரியர்கள்',
      gu: 'પુસ્તકો અને લેખકો',
      kn: 'ಪುಸ್ತಕಗಳು ಮತ್ತು ಲೇಖಕರು',
      or: 'ପୁସ୍ତକ ଓ ଲେଖକ',
      ml: 'പുസ്തകങ്ങളും എഴുത്തുകാരും',
    },
    aliases: ['books', 'authors', 'literature', 'famous books', 'novels'],
  },
  {
    slug: 'awards-honours',
    canonicalName: 'Awards & Honours',
    orderIndex: 15,
    description:
      'Awards and honours — Bharat Ratna, Nobel Prizes, Padma awards, sports and literary honours, national and international — the GK every exam and quiz includes.',
    hiName: 'पुरस्कार और सम्मान',
    hiDescription:
      'पुरस्कार और सम्मान — भारत रत्न, Nobel, पद्म पुरस्कार, खेल और साहित्य सम्मान — हर परीक्षा और quiz में शामिल राष्ट्रीय-अंतर्राष्ट्रीय GK।',
    native: {
      bn: 'পুরস্কার ও সম্মাননা',
      mr: 'पुरस्कार आणि सन्मान',
      te: 'పురస్కారాలు & సత్కారాలు',
      ta: 'விருதுகள் & கௌரவங்கள்',
      gu: 'પુરસ્કારો અને સન્માન',
      kn: 'ಪ್ರಶಸ್ತಿಗಳು ಮತ್ತು ಗೌರವಗಳು',
      or: 'ପୁରସ୍କାର ଓ ସମ୍ମାନ',
      ml: 'അവാർഡുകളും ബഹുമതികളും',
    },
    aliases: ['awards', 'prizes', 'bharat ratna', 'nobel prize', 'padma awards'],
  },
  {
    slug: 'schemes',
    canonicalName: 'Schemes & Policies',
    orderIndex: 16,
    description:
      'Government schemes and policies — central and state yojanas, launches, ministries and beneficiaries — the flagship-programme GK UPSC, SSC and state exams ask.',
    hiName: 'योजनाएँ और नीतियाँ',
    hiDescription:
      'सरकारी योजनाएँ और नीतियाँ — केंद्र और राज्यों की योजनाएँ, लॉन्च, मंत्रालय और लाभार्थी — UPSC, SSC और state परीक्षाओं में हर साल पूछा जाने वाला विषय।',
    native: {
      bn: 'প্রকল্প ও নীতি',
      mr: 'योजना आणि धोरणे',
      te: 'పథకాలు & విధానాలు',
      ta: 'திட்டங்கள் & கொள்கைகள்',
      gu: 'યોજનાઓ અને ધોરણો',
      kn: 'ಯೋಜನೆಗಳು ಮತ್ತು ನೀತಿಗಳು',
      or: 'ଯୋଜନା ଓ ନୀତି',
      ml: 'പദ്ധതികളും നയങ്ങളും',
    },
    aliases: ['government schemes', 'yojanas', 'policies', 'flagship programmes', 'central schemes'],
  },
  {
    slug: 'defence-security',
    canonicalName: 'Defence & Security',
    orderIndex: 17,
    description:
      'Defence and security GK — the Indian Army, Navy and Air Force, missiles, exercises, defence deals and internal security — high-yield facts for UPSC, SSC and CDS.',
    hiName: 'रक्षा और सुरक्षा',
    hiDescription:
      'रक्षा और सुरक्षा GK — भारतीय सेना, नौसेना, वायुसेना, मिसाइल, युद्धाभ्यास और रक्षा सौदे — UPSC, SSC और CDS के लिए उपयोगी तथ्य।',
    native: {
      bn: 'প্রতিরক্ষা ও নিরাপত্তা',
      mr: 'संरक्षण आणि सुरक्षा',
      te: 'రక్షణ & భద్రత',
      ta: 'தற்காப்பு & பாதுகாப்பு',
      gu: 'સંરક્ષણ અને સુરક્ષા',
      kn: 'ರಕ್ಷಣೆ ಮತ್ತು ಭದ್ರತೆ',
      or: 'ପ୍ରତିରକ୍ଷା ଓ ସୁରକ୍ଷା',
      ml: 'പ്രതിരോധവും സുരക്ഷയും',
    },
    aliases: ['defence', 'indian army', 'missiles', 'military exercises', 'internal security'],
  },
  {
    slug: 'international-relations',
    canonicalName: 'International Relations',
    orderIndex: 18,
    description:
      'International relations — summits, treaties, groupings like BRICS and QUAD, bilateral ties and foreign policy — the global affairs GK UPSC and state PCS demand.',
    hiName: 'अंतर्राष्ट्रीय संबंध',
    hiDescription:
      'अंतर्राष्ट्रीय संबंध — शिखर सम्मेलन, संधियाँ, BRICS और QUAD जैसे समूह, द्विपक्षीय संबंध — UPSC और state PCS के लिए वैश्विक मामलों का GK।',
    native: {
      bn: 'আন্তর্জাতিক সম্পর্ক',
      mr: 'आंतरराष्ट्रीय संबंध',
      te: 'అంతర్జాతీయ సంబంధాలు',
      ta: 'சர்வதேச உறவுகள்',
      gu: 'આંતરરાષ્ટ્રીય સંબંધો',
      kn: 'ಅಂತರರಾಷ್ಟ್ರೀಯ ಸಂಬಂಧಗಳು',
      or: 'ଆନ୍ତର୍ଜାତିକ ସମ୍ପର୍କ',
      ml: 'അന്താരാഷ്ട്ര ബന്ധങ്ങൾ',
    },
    aliases: ['ir', 'foreign policy', 'diplomacy', 'summits', 'bilateral relations'],
  },
  {
    slug: 'static-gk',
    canonicalName: 'Static GK',
    orderIndex: 19,
    description:
      'The static GK favourites — national symbols, important days, firsts in India, dances, festivals and one-liner facts every competitive exam loves.',
    hiName: 'स्टैटिक GK',
    hiDescription:
      'स्टैटिक GK के प्रिय टॉपिक — राष्ट्रीय प्रतीक, महत्वपूर्ण दिन, भारत में पहली बार, नृत्य, त्योहार और one-liner तथ्य — हर प्रतियोगी परीक्षा का पसंदीदा।',
    native: {
      bn: 'স্ট্যাটিক জিকে',
      mr: 'स्थिर सामान्य ज्ञान',
      te: 'స్థిర సామాన్య జ్ఞానం',
      ta: 'நிலையான பொது அறிவு',
      gu: 'સ્થિર સામાન્ય જ્ઞાન',
      kn: 'ಸ್ಥಿರ ಸಾಮಾನ್ಯ ಜ್ಞಾನ',
      or: 'ଷ୍ଟାଟିକ୍ ଜିକେ',
      ml: 'സ്റ്റാറ്റിക് ജികെ',
    },
    aliases: ['static general knowledge', 'national symbols', 'important days', 'firsts in india', 'one liner gk'],
  },
  {
    slug: 'agriculture',
    canonicalName: 'Agriculture',
    orderIndex: 20,
    description:
      'Agriculture GK — crops, seasons, irrigation, revolutions, soil types and agri-policy — the farming facts SSC, railways, UPSC and state agriculture exams ask.',
    hiName: 'कृषि',
    hiDescription:
      'कृषि GK — फसलें, मौसम, सिंचाई, क्रांतियाँ, मिट्टी के प्रकार और कृषि नीति — SSC, railways, UPSC और state कृषि परीक्षाओं में पूछे जाने वाले तथ्य।',
    native: {
      bn: 'কৃষি',
      mr: 'शेती',
      te: 'వ్యవసాయం',
      ta: 'வேளாண்மை',
      gu: 'ખેતી',
      kn: 'ಕೃಷಿ',
      or: 'କୃଷି',
      ml: 'കൃഷി',
    },
    aliases: ['farming', 'crops', 'irrigation', 'agricultural revolutions', 'soil'],
  },
  {
    slug: 'disaster-management',
    canonicalName: 'Disaster Management',
    orderIndex: 21,
    description:
      'Disaster management — natural and man-made disasters, NDMA, cyclones, earthquakes and disaster risk reduction — the UPSC and state PCS topic growing every year.',
    hiName: 'आपदा प्रबंधन',
    hiDescription:
      'आपदा प्रबंधन — प्राकृतिक और मानवनिर्मित आपदाएँ, NDMA, चक्रवात, भूकंप और जोखिम कमी — UPSC और state PCS का हर साल महत्वपूर्ण होता विषय।',
    native: {
      bn: 'দুর্যোগ ব্যবস্থাপনা',
      mr: 'आपत्ती व्यवस्थापन',
      te: 'విపత్తు నిర్వహణ',
      ta: 'பேரிடர் மேலாண்மை',
      gu: 'આપત્તિ વ્યવસ્થાપન',
      kn: 'ವಿಪತ್ತು ನಿರ್ವಹಣೆ',
      or: 'ଆପଦ ପରିଚାଳନା',
      ml: 'ദുരന്ത മാനേജ്മെന്റ്',
    },
    aliases: ['disasters', 'ndma', 'earthquakes', 'cyclones', 'disaster risk reduction'],
  },
]

/** The pre-existing root domains — asserted, never restructured (order 1-4). */
const EXISTING_ROOT_ORDERS: Array<{ slug: string; orderIndex: number }> = [
  { slug: 'polity-governance', orderIndex: 1 },
  { slug: 'history', orderIndex: 2 },
  { slug: 'science-technology', orderIndex: 3 },
  { slug: 'current-affairs', orderIndex: 4 },
]

// ---------- Seed ----------

async function main() {
  // ---------- Languages (resolve ids by code — never hard-coded) ----------
  const codes = ['en', 'hi', ...PLANNED_LANGUAGE_CODES]
  const languageRows = await prisma.language.findMany({ where: { code: { in: codes } } })
  const languageIdByCode = new Map(languageRows.map((row) => [row.code, row.id]))
  for (const code of codes) {
    if (!languageIdByCode.has(code)) {
      throw new Error(`Language "${code}" not found — run the base + languages seeds first`)
    }
  }
  const enId = languageIdByCode.get('en')!
  const hiId = languageIdByCode.get('hi')!

  // ---------- 1. Assert the pre-existing root orders (1-4) ----------
  for (const expected of EXISTING_ROOT_ORDERS) {
    const existing = await prisma.topic.findUnique({ where: { slug: expected.slug } })
    if (!existing) throw new Error(`Existing root "${expected.slug}" not found — run the base seed first`)
    if (existing.orderIndex !== expected.orderIndex) {
      await prisma.topic.update({
        where: { id: existing.id },
        data: { orderIndex: expected.orderIndex },
      })
      console.log(`~ ${expected.slug}: orderIndex ${existing.orderIndex} → ${expected.orderIndex}`)
    }
  }

  // ---------- 2. awards-honours promotion (branch → root DOMAIN) ----------
  // The plan (Task 8): awards-honours is promoted from a branch to a root
  // subject. Its existing labels stay (only descriptions are filled below);
  // an already-promoted root is left untouched (§36).
  const awards = await prisma.topic.findUnique({ where: { slug: 'awards-honours' } })
  const awardsSeed = SUBJECTS.find((subject) => subject.slug === 'awards-honours')!
  if (!awards) throw new Error('Branch "awards-honours" not found — run the base seed first')
  if (awards.parentId !== null || awards.type !== 'DOMAIN' || awards.scope !== 'GLOBAL' || awards.orderIndex !== 15) {
    const parent = awards.parentId
      ? await prisma.topic.findUnique({ where: { id: awards.parentId }, select: { slug: true } })
      : null
    await prisma.topic.update({
      where: { id: awards.id },
      data: {
        parentId: null,
        type: 'DOMAIN',
        scope: 'GLOBAL',
        countryId: null,
        orderIndex: 15,
        description: awardsSeed.description,
      },
    })
    console.log(
      `^ awards-honours PROMOTED: parent ${parent?.slug ?? 'none'} → root, ` +
        `${awards.type} → DOMAIN, scope GLOBAL, orderIndex 15`
    )
  } else {
    console.log('= awards-honours already a root DOMAIN at order 15 (kept)')
  }

  // ---------- 3. Upsert the 17 subjects ----------
  let topicsCreated = 0
  let topicsTouched = 0
  let labelsCreated = 0
  let labelsUpdated = 0
  let aliasesCreated = 0

  for (const seed of SUBJECTS) {
    const existing = await prisma.topic.findUnique({ where: { slug: seed.slug } })
    const topic = await prisma.topic.upsert({
      where: { slug: seed.slug },
      // §36: the update arm re-asserts only the seed-owned content fields —
      // status/parent/type/scope of an existing root stay as the console left them.
      update: { canonicalName: seed.canonicalName, description: seed.description, orderIndex: seed.orderIndex },
      create: {
        slug: seed.slug,
        canonicalName: seed.canonicalName,
        description: seed.description,
        type: 'DOMAIN',
        status: 'ACTIVE',
        scope: 'GLOBAL',
        countryId: null,
        parentId: null,
        orderIndex: seed.orderIndex,
      },
    })
    if (!existing) {
      topicsCreated++
      console.log(`+ ${seed.slug} — ${seed.canonicalName} (order ${seed.orderIndex})`)
    } else {
      topicsTouched++
    }

    // ---------- Labels: en + hi (name + SEO description) ----------
    const described: Array<{ languageId: string; name: string; description: string }> = [
      { languageId: enId, name: seed.canonicalName, description: seed.description },
      { languageId: hiId, name: seed.hiName, description: seed.hiDescription },
    ]
    for (const label of described) {
      const existingLabel = await prisma.topicLabel.findUnique({
        where: { topicId_languageId: { topicId: topic.id, languageId: label.languageId } },
      })
      await prisma.topicLabel.upsert({
        where: { topicId_languageId: { topicId: topic.id, languageId: label.languageId } },
        update: { name: label.name, description: label.description },
        create: {
          topicId: topic.id,
          languageId: label.languageId,
          name: label.name,
          description: label.description,
        },
      })
      if (!existingLabel) labelsCreated++
      else labelsUpdated++
    }

    // ---------- Labels: the 8 PLANNED languages (native name only — §35) ----------
    for (const code of PLANNED_LANGUAGE_CODES) {
      const languageId = languageIdByCode.get(code)!
      const existingLabel = await prisma.topicLabel.findUnique({
        where: { topicId_languageId: { topicId: topic.id, languageId } },
      })
      // Never writes a description — a live admin description is never cleared.
      await prisma.topicLabel.upsert({
        where: { topicId_languageId: { topicId: topic.id, languageId } },
        update: { name: seed.native[code] },
        create: { topicId: topic.id, languageId, name: seed.native[code] },
      })
      if (!existingLabel) labelsCreated++
      else labelsUpdated++
    }

    // ---------- Aliases: add-missing, delete nothing ----------
    const existingAliases = await prisma.topicAlias.findMany({
      where: { topicId: topic.id },
      select: { value: true },
    })
    const existingValues = new Set(existingAliases.map((alias) => alias.value))
    for (const value of seed.aliases) {
      if (existingValues.has(value)) continue
      await prisma.topicAlias.create({
        data: { topicId: topic.id, value, languageId: null },
      })
      aliasesCreated++
    }
  }

  console.log(
    `\nSeeded: ${topicsCreated} topics created, ${topicsTouched} re-asserted (incl. awards-honours promotion); ` +
      `${labelsCreated} labels created, ${labelsUpdated} labels upserted; ${aliasesCreated} aliases added.`
  )

  // ---------- 4. Verification: the full root-subject list ----------
  const roots = await prisma.topic.findMany({
    where: { parentId: null, type: 'DOMAIN' },
    orderBy: [{ orderIndex: 'asc' }, { canonicalName: 'asc' }],
    select: {
      id: true,
      slug: true,
      canonicalName: true,
      orderIndex: true,
      description: true,
      labels: { select: { language: { select: { code: true } } } },
      _count: { select: { aliases: true } },
    },
  })

  const labelCodes = ['en', 'hi', ...PLANNED_LANGUAGE_CODES, 'fr']
  console.log(`\nROOT DOMAIN SUBJECTS (${roots.length} total):`)
  console.log('  # | slug                       | canonicalName           | aliases | labels per language')
  for (const root of roots) {
    const counts = labelCodes
      .map((code) => `${code}:${root.labels.filter((label) => label.language.code === code).length}`)
      .join(' ')
    console.log(
      `  ${String(root.orderIndex).padStart(2)} | ${root.slug.padEnd(26)} | ${root.canonicalName.padEnd(23)} | ` +
        `${String(root._count.aliases).padStart(7)} | ${counts}`
    )
  }

  const rootsWithoutDescription = roots.filter((root) => !root.description)
  if (rootsWithoutDescription.length > 0) {
    console.log(`\nWARNING: roots without a canonical description: ${rootsWithoutDescription.map((r) => r.slug).join(', ')}`)
  }

  const expectedSlugs = [
    ...EXISTING_ROOT_ORDERS.map((entry) => entry.slug),
    ...SUBJECTS.map((subject) => subject.slug),
  ].sort()
  const actualSlugs = roots.map((root) => root.slug).sort()
  const complete =
    actualSlugs.length === 21 &&
    expectedSlugs.every((slug, index) => slug === actualSlugs[index])
  console.log(
    `\n${complete ? 'OK' : 'MISMATCH'} — ${actualSlugs.length} root DOMAIN subjects ` +
      `(expected 21: 4 pre-existing + 17 seeded; current-affairs stays the events anchor, excluded from subject grids).`
  )
  if (!complete) {
    throw new Error(`Root-subject set mismatch — expected [${expectedSlugs.join(', ')}], got [${actualSlugs.join(', ')}]`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
