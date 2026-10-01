#!/bin/bash
# GKSetu — P5-S3 HTTP assertion suite (onboarding/profile + explicit goals)
# English-only per user directive. Run with the dev server on :3000.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
SUFFIX=$(date +%s)

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"
  else FAIL=$((FAIL+1)); echo "FAIL  $1 — expected [$2] got [$3]"; fi
}
check_contains() { # check_contains <label> <needle> <haystack>
  case "$3" in *"$2"*) PASS=$((PASS+1)); echo "PASS  $1";; *) FAIL=$((FAIL+1)); echo "FAIL  $1 — missing [$2] in: ${3:0:220}";; esac
}

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1], {'d': d}))" "$1" 2>/dev/null; }

# ---------- Fixtures (seeded Supabase data) ----------
IN_EXAM_ACTIVE="ssc-cgl"            # ACTIVE exam, IN
IN_EXAM_ACTIVE_2="upsc-civil-services" # ACTIVE exam, IN
IN_EXAM_DRAFT="upsc-engineering-services" # DRAFT exam, IN (not declarable)
GB_EXAM_DRAFT="uk-civil-service-fast-stream" # DRAFT exam, GB (draft AND cross-market)
TOPIC_GLOBAL="polity-governance"    # GLOBAL topic
TOPIC_GLOBAL_2="history"            # GLOBAL topic
TOPIC_IN_COUNTRY="ancient-india"    # COUNTRY topic, IN

# ---------- Fresh test users ----------
# IN reader (the full happy path), a countryless reader (HOME_COUNTRY_REQUIRED
# for goal exams), and a GB reader via PATCH (cross-market goal guard §14).
REG_IN=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s3-in-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S3 IN Reader\",\"homeCountryIso\":\"IN\"}")
IN_TOKEN=$(printf '%s' "$REG_IN" | json "d['data']['grant']['token']")
check "register IN reader" "ok" "$(printf '%s' "$REG_IN" | json "d['status']")"
check "IN token extracted" "gksetu" "$(printf '%s' "$IN_TOKEN" | cut -c1-6)"

REG_NOC=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s3-noc-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S3 Countryless Reader\"}")
NOC_TOKEN=$(printf '%s' "$REG_NOC" | json "d['data']['grant']['token']")
check "register countryless reader" "ok" "$(printf '%s' "$REG_NOC" | json "d['status']")"

# ---------- Auth gates (§30 private) ----------
check "GET /api/profile unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/profile")"
check "PATCH /api/profile unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/profile" -H 'Content-Type: application/json' -d '{}')"
check "GET /api/goal unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/goal")"
check "PUT /api/goal unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/goal" -H 'Content-Type: application/json' -d '{}')"
check "DELETE /api/goal unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/goal")"
check "POST /api/onboarding unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/onboarding" -H 'Content-Type: application/json' -d '{"action":"complete"}')"

AUTH_IN="Authorization: Bearer $IN_TOKEN"

# ---------- Profile read (§6 onboarding state present) ----------
P1=$(curl -s "$BASE/api/profile" -H "$AUTH_IN")
check "profile read → ok" "ok" "$(printf '%s' "$P1" | json "d['status']")"
check "profile → onboardingStatus PENDING at registration" "PENDING" "$(printf '%s' "$P1" | json "d['data']['user']['onboardingStatus']")"
check "profile → goal null before declaration" "None" "$(printf '%s' "$P1" | json "d['data']['goal']")"

# ---------- Goal: declare (happy path) ----------
G1=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE\"],\"topics\":[\"$TOPIC_GLOBAL\",\"$TOPIC_GLOBAL_2\"],\"level\":\"BEGINNER\",\"studyLanguageCode\":\"en\",\"targetYear\":2026,\"dailyMinutes\":45}")
check "declare goal → ok" "ok" "$(printf '%s' "$G1" | json "d['status']")"
check "declare goal → created flag" "True" "$(printf '%s' "$G1" | json "d['data']['created']")"
check "goal exam canonical path (§16)" "/exams/ssc-cgl/" "$(printf '%s' "$G1" | json "d['data']['goal']['exams'][0]['canonicalPath']")"
check_contains "goal topic canonical paths (§16, label-sorted)" "/gk/polity-governance/" "$(printf '%s' "$G1" | json "str(d['data']['goal']['topics'])")"
check_contains "goal topic canonical path 2 (§16)" "/gk/history/" "$(printf '%s' "$G1" | json "str(d['data']['goal']['topics'])")"
check "goal counts (exams/topics)" "1/2" "$(printf '%s' "$G1" | json "d['data']['goal']['counts']['exams']")/$(printf '%s' "$G1" | json "d['data']['goal']['counts']['topics']")"
check "goal level persisted" "BEGINNER" "$(printf '%s' "$G1" | json "d['data']['goal']['level']")"
check "goal dailyMinutes persisted" "45" "$(printf '%s' "$G1" | json "d['data']['goal']['dailyMinutes']")"

# §6: goal declaration moves PENDING → IN_PROGRESS
P2=$(curl -s "$BASE/api/profile" -H "$AUTH_IN")
check "goal declaration → onboarding IN_PROGRESS" "IN_PROGRESS" "$(printf '%s' "$P2" | json "d['data']['user']['onboardingStatus']")"

# ---------- Goal read + §35 label chain ----------
G2=$(curl -s "$BASE/api/goal" -H "$AUTH_IN")
check "goal read → ok" "ok" "$(printf '%s' "$G2" | json "d['status']")"
check "goal read → exam slug" "$IN_EXAM_ACTIVE" "$(printf '%s' "$G2" | json "d['data']['goal']['exams'][0]['slug']")"

G3=$(curl -s "$BASE/api/goal?language=hi" -H "$AUTH_IN")
check_contains "goal read hi → hindi label present" "label" "$(printf '%s' "$G3" | json "d['data']['goal']['topics'][0]")"
G3P=$(printf '%s' "$G3" | json "d['data']['goal']['topics'][0]['canonicalPath']")
case "$G3P" in /hi/gk/*) PASS=$((PASS+1)); echo "PASS  goal read hi → /hi/ path prefix";; *) FAIL=$((FAIL+1)); echo "FAIL  goal read hi → /hi/ path prefix — got $G3P";; esac

# ---------- Goal replace (§9 full replacement) ----------
G4=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE_2\"],\"topics\":[\"$TOPIC_IN_COUNTRY\"],\"level\":\"ADVANCED\",\"targetYear\":2027}")
check "replace goal → ok" "ok" "$(printf '%s' "$G4" | json "d['status']")"
check "replace goal → not created" "False" "$(printf '%s' "$G4" | json "d['data']['created']")"
check "replace goal → exam swapped" "$IN_EXAM_ACTIVE_2" "$(printf '%s' "$G4" | json "d['data']['goal']['exams'][0]['slug']")"
check "replace goal → topic swapped (COUNTRY topic, home market)" "$TOPIC_IN_COUNTRY" "$(printf '%s' "$G4" | json "d['data']['goal']['topics'][0]['slug']")"
check "replace goal → level swapped" "ADVANCED" "$(printf '%s' "$G4" | json "d['data']['goal']['level']")"
check "replace goal → counts 1/1" "1/1" "$(printf '%s' "$G4" | json "d['data']['goal']['counts']['exams']")/$(printf '%s' "$G4" | json "d['data']['goal']['counts']['topics']")"

# ---------- Goal guards (§14 home-market, §36 statuses, §35 language) ----------
GE=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_DRAFT\"]}")
check "declare DRAFT exam → GOAL_EXAM_NOT_ELIGIBLE" "GOAL_EXAM_NOT_ELIGIBLE" "$(printf '%s' "$GE" | json "d['error']['code']")"

GN=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"exams":["no-such-exam"]}')
check "declare unknown exam → GOAL_OBJECT_NOT_FOUND" "GOAL_OBJECT_NOT_FOUND" "$(printf '%s' "$GN" | json "d['error']['code']")"

GL=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE\"],\"studyLanguageCode\":\"fr\"}")
check "declare goal with fr (not configured in IN) → LANGUAGE_NOT_AVAILABLE_IN_COUNTRY" "LANGUAGE_NOT_AVAILABLE_IN_COUNTRY" "$(printf '%s' "$GL" | json "d['error']['code']")"
check_contains "fr guard message" "not available" "$(printf '%s' "$GL" | json "d['error']['message']")"

GV=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE\"],\"level\":\"GURU\"}")
check "invalid level → BAD_REQUEST" "BAD_REQUEST" "$(printf '%s' "$GV" | json "d['error']['code']")"

GX=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE\",\"$IN_EXAM_ACTIVE_2\",\"$IN_EXAM_DRAFT\",\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\",\"h\"]}")
check ">10 exams → BAD_REQUEST (zod array cap)" "BAD_REQUEST" "$(printf '%s' "$GX" | json "d['error']['code']")"

# Countryless reader: goal exams need a home country (§14)
GC=$(curl -s -X PUT "$BASE/api/goal" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE\"]}")
check "countryless goal exam → HOME_COUNTRY_REQUIRED" "HOME_COUNTRY_REQUIRED" "$(printf '%s' "$GC" | json "d['error']['code']")"
GC2=$(curl -s -X PUT "$BASE/api/goal" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"topics\":[\"$TOPIC_GLOBAL\"]}")
check "countryless GLOBAL topic goal → ok" "ok" "$(printf '%s' "$GC2" | json "d['status']")"

# ---------- Onboarding state machine (§6, §31) ----------
O1=$(curl -s -X POST "$BASE/api/onboarding" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"action":"complete"}')
check "onboarding complete → ok" "ok" "$(printf '%s' "$O1" | json "d['status']")"
check "onboarding complete → COMPLETED" "COMPLETED" "$(printf '%s' "$O1" | json "d['data']['user']['onboardingStatus']")"
COMPLETED_AT=$(printf '%s' "$O1" | json "d['data']['user']['onboardingCompletedAt']")

O2=$(curl -s -X POST "$BASE/api/onboarding" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"action":"complete"}')
check "onboarding complete idempotent → COMPLETED" "COMPLETED" "$(printf '%s' "$O2" | json "d['data']['user']['onboardingStatus']")"
check "onboarding complete idempotent → same completedAt" "$COMPLETED_AT" "$(printf '%s' "$O2" | json "d['data']['user']['onboardingCompletedAt']")"

O3=$(curl -s -X POST "$BASE/api/onboarding" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"action":"skip"}')
check "skip after COMPLETED → never downgrades" "COMPLETED" "$(printf '%s' "$O3" | json "d['data']['user']['onboardingStatus']")"

OV=$(curl -s -X POST "$BASE/api/onboarding" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"action":"maybe"}')
check "invalid onboarding action → BAD_REQUEST" "BAD_REQUEST" "$(printf '%s' "$OV" | json "d['error']['code']")"

# Countryless reader skips
O4=$(curl -s -X POST "$BASE/api/onboarding" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"skip"}')
check "skip from PENDING → SKIPPED" "SKIPPED" "$(printf '%s' "$O4" | json "d['data']['user']['onboardingStatus']")"

# ---------- Profile self-service (§6 basics, §35 rules) ----------
PR1=$(curl -s -X PATCH "$BASE/api/profile" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"name":"P5S3 Renamed Reader"}')
check "profile patch name → ok" "ok" "$(printf '%s' "$PR1" | json "d['status']")"
check "profile patch name persisted" "P5S3 Renamed Reader" "$(printf '%s' "$PR1" | json "d['data']['user']['name']")"

PR2=$(curl -s -X PATCH "$BASE/api/profile" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"preferredLanguageCode":"hi"}')
check "profile patch preferredLanguage hi → ok" "ok" "$(printf '%s' "$PR2" | json "d['status']")"
check "profile patch preferredLanguage code" "hi" "$(printf '%s' "$PR2" | json "d['data']['user']['preferredLanguage']['code']")"

# fr is an active language but not configured in IN (§35)
PR4=$(curl -s -X PATCH "$BASE/api/profile" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"preferredLanguageCode":"fr"}')
check "IN + fr → LANGUAGE_NOT_AVAILABLE_IN_COUNTRY" "LANGUAGE_NOT_AVAILABLE_IN_COUNTRY" "$(printf '%s' "$PR4" | json "d['error']['code']")"

PR5=$(curl -s -X PATCH "$BASE/api/profile" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"homeCountryIso":"XX"}')
check "unknown country → INVALID_COUNTRY" "INVALID_COUNTRY" "$(printf '%s' "$PR5" | json "d['error']['code']")"
PR6=$(curl -s -X PATCH "$BASE/api/profile" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"homeCountryIso":"GB"}')
check "GB (COMING_SOON §36) → INVALID_COUNTRY (ACTIVE-only §35)" "INVALID_COUNTRY" "$(printf '%s' "$PR6" | json "d['error']['code']")"

# ---------- §14 cross-market goal guard (home flipped via SQL — see helper) ----------
# GB is COMING_SOON so /api/profile cannot set it (verified above); the §14
# guard itself needs a non-IN home, so the suite flips the row directly.
bun scripts/p5s3-set-home.ts "p5s3-in-$SUFFIX@test.dev" GB >/dev/null
PRM=$(curl -s "$BASE/api/profile" -H "$AUTH_IN")
check "home flipped to GB (via SQL)" "GB" "$(printf '%s' "$PRM" | json "d['data']['user']['homeCountry']['isoCode']")"

GG=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_ACTIVE\"]}")
check "IN exam from GB home → GOAL_COUNTRY_MISMATCH" "GOAL_COUNTRY_MISMATCH" "$(printf '%s' "$GG" | json "d['error']['code']")"
GG2=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"topics\":[\"$TOPIC_GLOBAL\"]}")
check "GLOBAL topic from GB home → ok" "ok" "$(printf '%s' "$GG2" | json "d['status']")"
# COUNTRY topic of another market from GB → mismatch (§14)
GG3=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"topics\":[\"$TOPIC_IN_COUNTRY\"]}")
check "IN COUNTRY topic from GB home → GOAL_COUNTRY_MISMATCH" "GOAL_COUNTRY_MISMATCH" "$(printf '%s' "$GG3" | json "d['error']['code']")"

# Goal read from the GB home resolves §35 labels in the GB market
GG4=$(curl -s "$BASE/api/goal" -H "$AUTH_IN")
check "goal read after GB flip → ok" "ok" "$(printf '%s' "$GG4" | json "d['status']")"
GG4P=$(printf '%s' "$GG4" | json "d['data']['goal']['topics'][0]['canonicalPath']")
case "$GG4P" in /uk/gk/*) PASS=$((PASS+1)); echo "PASS  GLOBAL topic from GB home → /uk/ market path";; *) FAIL=$((FAIL+1)); echo "FAIL  GLOBAL topic from GB home → /uk/ market path — got $GG4P";; esac

# ---------- Goal removal (§31 reversible) ----------
GD=$(curl -s -X DELETE "$BASE/api/goal" -H "$AUTH_IN")
check "goal delete → ok" "ok" "$(printf '%s' "$GD" | json "d['status']")"
check "goal delete → removed" "True" "$(printf '%s' "$GD" | json "d['data']['removed']")"
GD2=$(curl -s "$BASE/api/goal" -H "$AUTH_IN")
check "goal read after delete → null" "None" "$(printf '%s' "$GD2" | json "d['data']['goal']")"
GD3=$(curl -s -X DELETE "$BASE/api/goal" -H "$AUTH_IN")
check "goal delete again → GOAL_NOT_FOUND" "GOAL_NOT_FOUND" "$(printf '%s' "$GD3" | json "d['error']['code']")"

# ---------- Audit trail (§5 accountability) ----------
AL=$(curl -s "$BASE/api/audit?limit=200" -H "Authorization: Bearer $NOC_TOKEN")
check "reader audit list → FORBIDDEN" "FORBIDDEN" "$(printf '%s' "$AL" | json "d['error']['code']")"

echo ""
echo "RESULT: $PASS passed, $FAIL failed (P5-S3 HTTP suite)"
[ "$FAIL" -eq 0 ] || exit 1
