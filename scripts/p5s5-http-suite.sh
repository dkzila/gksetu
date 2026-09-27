#!/bin/bash
# GlobIQ — P5-S5 HTTP assertion suite (personalisation explanations & controls)
# Master Plan §9 (layered, explainable, reversible — the inventory IS the
# explanation surface), §10 (saves quarantined from signals), §31 (the
# account-control surface incl. the explicit reset), §35 (labels), §36
# (honest statuses), §37 (envelope), §46.3 (computed, never stored).
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
IN_EXAM_1="ssc-cgl"                   # ACTIVE exam, IN
IN_EXAM_2="upsc-civil-services"       # ACTIVE exam, IN
IN_EXAM_3="mp-police-constable"       # ACTIVE exam, IN (follow target)
TOPIC_DOMAIN="polity-governance"      # GLOBAL DOMAIN
TOPIC_FOLLOW="current-affairs"        # GLOBAL DOMAIN (follow target)
SAVE_UNIT="attorney-general-of-india" # VERIFIED unit (§10 save fixture)

# ---------- Fresh test user ----------
REG_IN=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s5-in-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S5 IN Reader\",\"homeCountryIso\":\"IN\"}")
IN_TOKEN=$(printf '%s' "$REG_IN" | json "d['data']['grant']['token']")
check "register IN reader" "ok" "$(printf '%s' "$REG_IN" | json "d['status']")"
AUTH_IN="Authorization: Bearer $IN_TOKEN"

# ---------- Auth gates (§30 private) ----------
check "GET /api/personalisation unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/personalisation")"
check "GET /api/personalisation bad token → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/personalisation" -H 'Authorization: Bearer not-a-token')"
check "DELETE /api/personalisation unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/personalisation")"
check "explicit unconfigured ?language → HTTP 400 (§35 strict for explicit)" "400" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/personalisation?language=fr" -H "$AUTH_IN")"
check "unknown ?country → HTTP 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/personalisation?country=XX" -H "$AUTH_IN")"

# ---------- Empty inventory (no §9 signals yet) ----------
P0=$(curl -s "$BASE/api/personalisation" -H "$AUTH_IN")
check "empty inventory read → ok" "ok" "$(printf '%s' "$P0" | json "d['status']")"
check "empty inventory → total signals 0" "0" "$(printf '%s' "$P0" | json "d['data']['personalisation']['signals']['counts']['total']")"
check "empty inventory → goal null" "None" "$(printf '%s' "$P0" | json "d['data']['personalisation']['signals']['goal']")"
check "empty inventory → onboarding PENDING" "PENDING" "$(printf '%s' "$P0" | json "d['data']['personalisation']['user']['onboardingStatus']")"
check "empty inventory → market IN (home)" "IN" "$(printf '%s' "$P0" | json "d['data']['personalisation']['market']['country']['isoCode']")"
check "empty inventory → saves 0 + collections 0 (§10 block present)" "0" "$(printf '%s' "$P0" | json "d['data']['personalisation']['saves']['total'] + d['data']['personalisation']['saves']['collections']")"
check "empty inventory → reset available (§31 always exists)" "True" "$(printf '%s' "$P0" | json "d['data']['personalisation']['reset']['available']")"
check_contains "empty inventory → howItWorks scope sentence" "union of 0 goal exams and 0 followed exams" "$(printf '%s' "$P0" | json "d['data']['personalisation']['howItWorks']['scope']")"
check_contains "empty inventory → §10 saves note" "never influence" "$(printf '%s' "$P0" | json "d['data']['personalisation']['howItWorks']['saves']")"

# ---------- Declare a goal + follows (all §9 signal kinds) ----------
G1=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_1\",\"$IN_EXAM_2\"],\"topics\":[\"$TOPIC_DOMAIN\"],\"level\":\"INTERMEDIATE\",\"targetYear\":2027,\"dailyMinutes\":45,\"studyLanguageCode\":\"hi\"}")
check "declare goal → ok" "ok" "$(printf '%s' "$G1" | json "d['status']")"
F1=$(curl -s -X POST "$BASE/api/follows" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"EXAM\",\"objectRef\":\"$IN_EXAM_3\"}")
check "follow exam → ok" "ok" "$(printf '%s' "$F1" | json "d['status']")"
F2=$(curl -s -X POST "$BASE/api/follows" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"TOPIC\",\"objectRef\":\"$TOPIC_FOLLOW\"}")
check "follow topic → ok" "ok" "$(printf '%s' "$F2" | json "d['status']")"
SV=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"$SAVE_UNIT\"}")
check "save a unit → ok (the §10 quarantine fixture)" "ok" "$(printf '%s' "$SV" | json "d['status']")"

# ---------- The full inventory ----------
P1=$(curl -s "$BASE/api/personalisation" -H "$AUTH_IN")
check "inventory read → ok" "ok" "$(printf '%s' "$P1" | json "d['status']")"
check "inventory → total signals 9 (2 goal exams + 1 goal subject + 4 preferences + 2 follows)" "9" "$(printf '%s' "$P1" | json "d['data']['personalisation']['signals']['counts']['total']")"
check "inventory → follows count 2" "2" "$(printf '%s' "$P1" | json "d['data']['personalisation']['signals']['counts']['follows']")"
check "inventory → goal exams 2" "2" "$(printf '%s' "$P1" | json "d['data']['personalisation']['signals']['counts']['goalExams']")"
check "inventory → goal subjects 1" "1" "$(printf '%s' "$P1" | json "d['data']['personalisation']['signals']['counts']['goalSubjects']")"
check "inventory → goal preferences 4 (level, study language, year, pace)" "4" "$(printf '%s' "$P1" | json "d['data']['personalisation']['signals']['counts']['goalPreferences']")"
check "inventory → label market hi (goal study language §35)" "hi" "$(printf '%s' "$P1" | json "d['data']['personalisation']['market']['language']['code']")"
check "inventory → onboarding IN_PROGRESS (goal declared while PENDING)" "IN_PROGRESS" "$(printf '%s' "$P1" | json "d['data']['personalisation']['user']['onboardingStatus']")"
check "inventory → saves 1 / collections 1 (default bootstrapped)" "2" "$(printf '%s' "$P1" | json "d['data']['personalisation']['saves']['total'] + d['data']['personalisation']['saves']['collections']")"

# §9 explanations: every signal kind present with effect sentences
KINDS=$(printf '%s' "$P1" | json "str(sorted(set(s['kind'] for s in d['data']['personalisation']['signals']['follows'] + d['data']['personalisation']['signals']['goal']['exams'] + d['data']['personalisation']['signals']['goal']['subjects'] + d['data']['personalisation']['signals']['goal']['preferences'])))")
check "inventory → all 5 §9 signal kinds" "['FOLLOWED_EXAM', 'FOLLOWED_TOPIC', 'GOAL_EXAM', 'GOAL_PREFERENCE', 'GOAL_SUBJECT']" "$KINDS"
check_contains "inventory → FOLLOWED_EXAM effect (queue scope)" "Joins your combined-exam queue" "$(printf '%s' "$P1" | json "str([e['text'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_EXAM' for e in s['effects']])")"
check_contains "inventory → FOLLOWED_TOPIC effect mirrors the dashboard reason (§9 coherence)" "Because you follow the subject" "$(printf '%s' "$P1" | json "str([e['text'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_TOPIC' for e in s['effects']])")"
check_contains "inventory → GOAL_SUBJECT effect mirrors the dashboard reason" "is one of your goal subjects" "$(printf '%s' "$P1" | json "str([e['text'] for s in d['data']['personalisation']['signals']['goal']['subjects'] for e in s['effects']])")"
check_contains "inventory → GOAL_PREFERENCE study-language effect (§35)" "follow" "$(printf '%s' "$P1" | json "str([e['text'] for s in d['data']['personalisation']['signals']['goal']['preferences'] if s['id']=='goal:studyLanguage' for e in s['effects']])")"

# §31 per-signal removal refs: follows carry them; goal rows deliberately not
REMOVALS=$(printf '%s' "$P1" | json "str(sorted(set('removal' if s['removal'] else 'none' for s in d['data']['personalisation']['signals']['follows'])))")
check "inventory → every follow carries its removal ref (§31)" "['removal']" "$REMOVALS"
GOALREMOVALS=$(printf '%s' "$P1" | json "str(sorted(set('removal' if s['removal'] else 'none' for s in d['data']['personalisation']['signals']['goal']['exams'] + d['data']['personalisation']['signals']['goal']['subjects'] + d['data']['personalisation']['signals']['goal']['preferences'])))")
check "inventory → goal rows carry NO per-row removal (§9 wholesale replacement)" "['none']" "$GOALREMOVALS"

# §16 paths + §35 labels on signals
check "inventory → followed topic label in Hindi (§35 chain via study language)" "समकालीन घटनाएँ" "$(printf '%s' "$P1" | json "[s['label'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_TOPIC'][0]")"
case "$(printf '%s' "$P1" | json "[s['canonicalPath'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_EXAM'][0]")" in
  /exams/*) PASS=$((PASS+1)); echo "PASS  inventory → follow §16 exam path (/exams/…)";;
  *) FAIL=$((FAIL+1)); echo "FAIL  inventory → follow §16 exam path";;
esac
case "$(printf '%s' "$P1" | json "[s['canonicalPath'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_TOPIC'][0]")" in
  /hi/gk/*) PASS=$((PASS+1)); echo "PASS  inventory → followed topic §16 path in hi market";;
  *) FAIL=$((FAIL+1)); echo "FAIL  inventory → followed topic §16 path — got $(printf '%s' "$P1" | json "[s['canonicalPath'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_TOPIC'][0]")";;
esac
check "inventory → §35 fallback detail (Hindi label, canonical name as detail)" "Current Affairs" "$(printf '%s' "$P1" | json "[s['detail'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_TOPIC'][0]")"

# howItWorks live values
check_contains "inventory → howItWorks scope counts live signals" "union of 2 goal exams and 1 followed exam" "$(printf '%s' "$P1" | json "d['data']['personalisation']['howItWorks']['scope']")"
check_contains "inventory → howItWorks home market (§14)" "home market (IN)" "$(printf '%s' "$P1" | json "d['data']['personalisation']['howItWorks']['homeMarket']")"
check_contains "inventory → howItWorks saves counts live rows" "Your 1 saved item" "$(printf '%s' "$P1" | json "d['data']['personalisation']['howItWorks']['saves']")"

# The §31 reset contract
check "inventory → reset signalCount 9" "9" "$(printf '%s' "$P1" | json "d['data']['personalisation']['reset']['signalCount']")"
REMOVES=$(printf '%s' "$P1" | json "'|'.join(d['data']['personalisation']['reset']['removes'])")
check_contains "reset contract → removes follows" "All follows" "$REMOVES"
check_contains "reset contract → removes the goal" "Your declared goal" "$REMOVES"
check_contains "reset contract → setup returns to pending" "pending" "$REMOVES"
KEEPS=$(printf '%s' "$P1" | json "'|'.join(d['data']['personalisation']['reset']['keeps'])")
check_contains "reset contract → keeps saves (§10)" "never personalisation signals" "$KEEPS"
check_contains "reset contract → keeps account settings" "account settings" "$KEEPS"
check_contains "reset contract → keeps audit trail note" "security-trail" "$KEEPS"

# ---------- Per-signal control: unfollow via the inventory's removal ref ----------
FOLLOW_TOPIC_ID=$(printf '%s' "$P1" | json "[s['id'] for s in d['data']['personalisation']['signals']['follows'] if s['kind']=='FOLLOWED_TOPIC'][0]")
UF=$(curl -s -X DELETE "$BASE/api/follows/$FOLLOW_TOPIC_ID" -H "$AUTH_IN")
check "per-signal unfollow via inventory ref → ok (§31 reversible)" "ok" "$(printf '%s' "$UF" | json "d['status']")"
P2=$(curl -s "$BASE/api/personalisation" -H "$AUTH_IN")
check "inventory after unfollow → total 8 (§31 live shrink)" "8" "$(printf '%s' "$P2" | json "d['data']['personalisation']['signals']['counts']['total']")"

# ---------- §36 honest statuses: deactivate a goal exam, read the inventory ----------
ADMIN_LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@globiq.dev","password":"GlobIQ-Dev-Admin-1"}')
ADMIN_TOKEN=$(printf '%s' "$ADMIN_LOGIN" | json "d['data']['grant']['token']")
if [ -n "$ADMIN_TOKEN" ]; then
  AUTH_ADMIN="Authorization: Bearer $ADMIN_TOKEN"
  EXAM_ID=$(curl -s "$BASE/api/exams/admin/exams" -H "$AUTH_ADMIN" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print([e['id'] for e in d['data']['exams'] if e['slug'] == 'ssc-cgl'][0])")
  DEACT=$(curl -s -X POST "$BASE/api/exams/admin/exams/$EXAM_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"deactivate"}')
  check "deactivate $IN_EXAM_1 (§36 fixture)" "ok" "$(printf '%s' "$DEACT" | json "d['status']")"
  P3=$(curl -s "$BASE/api/personalisation" -H "$AUTH_IN")
  check "§36 honest read → INACTIVE status surfaced on the signal" "INACTIVE" "$(printf '%s' "$P3" | json "[s['status'] for s in d['data']['personalisation']['signals']['goal']['exams'] if s['slug']=='$IN_EXAM_1'][0]")"
  check_contains "§36 honest read → INACTIVE goal exam stays listed with honest effect" "leaves the queue until it is active again" "$(printf '%s' "$P3" | json "str([e['text'] for s in d['data']['personalisation']['signals']['goal']['exams'] if s['status']=='INACTIVE' for e in s['effects']])")"
  REACT=$(curl -s -X POST "$BASE/api/exams/admin/exams/$EXAM_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"reactivate"}')
  check "reactivate $IN_EXAM_1 (restore)" "ok" "$(printf '%s' "$REACT" | json "d['status']")"
  P3B=$(curl -s "$BASE/api/personalisation" -H "$AUTH_IN")
  check "§36 → reactivated exam back to ACTIVE" "ACTIVE" "$(printf '%s' "$P3B" | json "[s['status'] for s in d['data']['personalisation']['signals']['goal']['exams'] if s['slug']=='$IN_EXAM_1'][0]")"
else
  echo "SKIP  §36 admin fixture (admin credentials unavailable)"
fi

# ---------- Complete onboarding (so the reset has a non-PENDING state to clear) ----------
OB=$(curl -s -X POST "$BASE/api/onboarding" -H "$AUTH_IN" -H 'Content-Type: application/json' -d '{"action":"complete"}')
check "complete onboarding → ok" "ok" "$(printf '%s' "$OB" | json "d['status']")"

# ---------- The §31 reset ----------
R1=$(curl -s -X DELETE "$BASE/api/personalisation" -H "$AUTH_IN")
check "reset → ok" "ok" "$(printf '%s' "$R1" | json "d['status']")"
check "reset → removed 1 follow" "1" "$(printf '%s' "$R1" | json "d['data']['reset']['removed']['follows']")"
check "reset → removed the goal" "True" "$(printf '%s' "$R1" | json "d['data']['reset']['removed']['goal']")"
check "reset → removed 2 goal exams" "2" "$(printf '%s' "$R1" | json "d['data']['reset']['removed']['goalExams']")"
check "reset → removed 1 goal subject" "1" "$(printf '%s' "$R1" | json "d['data']['reset']['removed']['goalSubjects']")"
check "reset → onboarding reset (was COMPLETED)" "True" "$(printf '%s' "$R1" | json "d['data']['reset']['removed']['onboardingReset']")"
check "reset → keeps 1 save (§10 quarantine survives)" "1" "$(printf '%s' "$R1" | json "d['data']['reset']['kept']['saves']")"
check "reset → keeps 1 collection" "1" "$(printf '%s' "$R1" | json "d['data']['reset']['kept']['collections']")"

# Post-reset state: fresh canvas, saves intact
P4=$(curl -s "$BASE/api/personalisation" -H "$AUTH_IN")
check "post-reset → total signals 0" "0" "$(printf '%s' "$P4" | json "d['data']['personalisation']['signals']['counts']['total']")"
check "post-reset → goal null" "None" "$(printf '%s' "$P4" | json "d['data']['personalisation']['signals']['goal']")"
check "post-reset → onboarding PENDING (fresh canvas)" "PENDING" "$(printf '%s' "$P4" | json "d['data']['personalisation']['user']['onboardingStatus']")"
check "post-reset → saves still 1 (§10)" "1" "$(printf '%s' "$P4" | json "d['data']['personalisation']['saves']['total']")"
D4=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "post-reset dashboard → mode NONE (signals gone, §31 live)" "NONE" "$(printf '%s' "$D4" | json "d['data']['dashboard']['queue']['mode']")"
check "post-reset dashboard → saves block still renders 1 (§10)" "1" "$(printf '%s' "$D4" | json "d['data']['dashboard']['saves']['total']")"

# Idempotent reset on the empty account (§37 idempotency precedent)
R2=$(curl -s -X DELETE "$BASE/api/personalisation" -H "$AUTH_IN")
check "reset on empty account → ok (idempotent no-op)" "ok" "$(printf '%s' "$R2" | json "d['status']")"
check "idempotent reset → zeros" "0" "$(printf '%s' "$R2" | json "d['data']['reset']['removed']['follows'] + d['data']['reset']['removed']['goalExams'] + d['data']['reset']['removed']['goalSubjects']")"

# The audit trail records the bulk action (§30 — mutations leave a trail)
if [ -n "$ADMIN_TOKEN" ]; then
  AUD=$(curl -s "$BASE/api/audit?action=user.personalisation.reset&pageSize=5" -H "Authorization: Bearer $ADMIN_TOKEN")
  check "audit trail → personalisationReset recorded" "True" "$(printf '%s' "$AUD" | json "len(d['data']['items']) > 0")"
fi

# ---------- Re-declare after reset (reversible by re-declaring) + explicit §35 query ----------
G2=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_2\"],\"topics\":[\"$TOPIC_DOMAIN\"],\"level\":\"BEGINNER\"}")
check "re-declare goal after reset → ok" "ok" "$(printf '%s' "$G2" | json "d['status']")"
P5=$(curl -s "$BASE/api/personalisation?language=en" -H "$AUTH_IN")
check "?language=en → en label market (explicit §35)" "en" "$(printf '%s' "$P5" | json "d['data']['personalisation']['market']['language']['code']")"
check "?language=en → English topic label" "Polity & Governance" "$(printf '%s' "$P5" | json "[s['label'] for s in d['data']['personalisation']['signals']['goal']['subjects']][0]")"

# ---------- §30 rate limit ----------
# The personalisationRead bucket (60/min/IP) is wired identically to the
# proven profileRead/dashboardRead buckets (src/lib/rate-limit.ts + the route
# guard). Tripping it needs >60 reads inside one 60s window — at this stage's
# ~2-4s Supabase render latency the requests spread past the window, so the
# 429 path is NOT asserted here (verified by wiring review; see session doc).

echo ""
echo "RESULT: $PASS passed, $FAIL failed (P5-S5 HTTP suite)"
[ "$FAIL" -eq 0 ] || exit 1
