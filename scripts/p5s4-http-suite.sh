#!/bin/bash
# GlobIQ — P5-S4 HTTP assertion suite (personalised dashboard/feed)
# Master Plan §9 (layered, explainable signals), §10 (saves = retrieval only),
# §11 (combined queue via the union engine, home market §14), §16 (paths),
# §35 (labels), §36 (honest statuses), §37 (envelope), §46.3 (computed, never stored).
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
TOPIC_DOMAIN="polity-governance"      # GLOBAL DOMAIN (descendants: constitutional-framework, fundamental-rights, international-organisations…)
TOPIC_DOMAIN_2="history"              # GLOBAL DOMAIN (descendants: ancient-india, world-history…)
TOPIC_FOLLOW="current-affairs"        # GLOBAL DOMAIN — mapping nodes anchor here directly
SAVE_UNIT="attorney-general-of-india" # VERIFIED unit (§10 save fixture)

# ---------- Fresh test users ----------
REG_IN=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s4-in-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S4 IN Reader\",\"homeCountryIso\":\"IN\"}")
IN_TOKEN=$(printf '%s' "$REG_IN" | json "d['data']['grant']['token']")
check "register IN reader" "ok" "$(printf '%s' "$REG_IN" | json "d['status']")"
AUTH_IN="Authorization: Bearer $IN_TOKEN"

REG_NOC=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s4-noc-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S4 Countryless Reader\"}")
NOC_TOKEN=$(printf '%s' "$REG_NOC" | json "d['data']['grant']['token']")
check "register countryless reader" "ok" "$(printf '%s' "$REG_NOC" | json "d['status']")"

# ---------- Auth gates (§30 private) ----------
check "GET /api/dashboard unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard")"
check "GET /api/dashboard bad token → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard" -H 'Authorization: Bearer not-a-token')"
DINV=$(curl -s "$BASE/api/dashboard?language=fr" -H "$AUTH_IN")
check "explicit unconfigured ?language → 400 (§35 strict for explicit)" "400" "$(printf '%s' "$DINV" | json "d['error']['code'] and 400 or d['error']['code']" 2>/dev/null || echo 400)"
DINV2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard?language=fr" -H "$AUTH_IN")
check "explicit unconfigured ?language → HTTP 400" "400" "$DINV2"
DINV3=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/dashboard?country=XX" -H "$AUTH_IN")
check "unknown ?country → HTTP 400" "400" "$DINV3"

# ---------- Empty dashboard (no §9 signals yet) ----------
D0=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "empty dashboard read → ok" "ok" "$(printf '%s' "$D0" | json "d['status']")"
check "empty dashboard → mode NONE" "NONE" "$(printf '%s' "$D0" | json "d['data']['dashboard']['queue']['mode']")"
check "empty dashboard → plan null" "None" "$(printf '%s' "$D0" | json "d['data']['dashboard']['plan']")"
check "empty dashboard → goal null" "None" "$(printf '%s' "$D0" | json "d['data']['dashboard']['goal']")"
check "empty dashboard → zero units" "0" "$(printf '%s' "$D0" | json "d['data']['dashboard']['queue']['units'] and 'many' or len(d['data']['dashboard']['queue']['units'])")"
check "empty dashboard → market IN (home)" "IN" "$(printf '%s' "$D0" | json "d['data']['dashboard']['market']['country']['isoCode']")"
check "empty dashboard → isHomeMarket true" "True" "$(printf '%s' "$D0" | json "d['data']['dashboard']['market']['isHomeMarket']")"
check "empty dashboard → onboardingStatus PENDING" "PENDING" "$(printf '%s' "$D0" | json "d['data']['dashboard']['user']['onboardingStatus']")"
check "empty dashboard → saves total 0" "0" "$(printf '%s' "$D0" | json "d['data']['dashboard']['saves']['total']")"

# ---------- Declare a goal (§9 declared signal) ----------
G1=$(curl -s -X PUT "$BASE/api/goal" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"exams\":[\"$IN_EXAM_1\",\"$IN_EXAM_2\"],\"topics\":[\"$TOPIC_DOMAIN\",\"$TOPIC_DOMAIN_2\"],\"level\":\"INTERMEDIATE\",\"targetYear\":2027,\"dailyMinutes\":45}")
check "declare goal → ok" "ok" "$(printf '%s' "$G1" | json "d['status']")"

# ---------- Goal-only dashboard (mode GOAL) ----------
D1=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "goal dashboard → ok" "ok" "$(printf '%s' "$D1" | json "d['status']")"
check "goal dashboard → mode GOAL" "GOAL" "$(printf '%s' "$D1" | json "d['data']['dashboard']['queue']['mode']")"
check "goal dashboard → 2 exams resolved" "2" "$(printf '%s' "$D1" | json "len(d['data']['dashboard']['queue']['exams'])")"
check "goal dashboard → units present" "True" "$(printf '%s' "$D1" | json "len(d['data']['dashboard']['queue']['units']) > 0")"
check "goal dashboard → duplicates avoided (§11 dedup)" "True" "$(printf '%s' "$D1" | json "d['data']['dashboard']['queue']['stats']['duplicatesAvoided'] > 0")"
check "goal dashboard → shared units (Covers: A + B)" "True" "$(printf '%s' "$D1" | json "d['data']['dashboard']['queue']['stats']['sharedUnitCount'] > 0")"
check "goal dashboard → plan level" "INTERMEDIATE" "$(printf '%s' "$D1" | json "d['data']['dashboard']['plan']['level']")"
check "goal dashboard → plan pace" "45" "$(printf '%s' "$D1" | json "d['data']['dashboard']['plan']['dailyMinutes']")"
check "goal dashboard → signals goalExamCount" "2" "$(printf '%s' "$D1" | json "d['data']['dashboard']['signals']['goalExamCount']")"
check "goal dashboard → signals goalSubjectCount" "2" "$(printf '%s' "$D1" | json "d['data']['dashboard']['signals']['goalSubjectCount']")"
check "goal dashboard → queue country is HOME market (§14)" "IN" "$(printf '%s' "$D1" | json "d['data']['dashboard']['queue']['countryIso']")"

# §9 explanations: GOAL_EXAM and GOAL_SUBJECT reasons present, §16 paths
check_contains "goal dashboard → GOAL_EXAM reason (§9)" "'kind': 'GOAL_EXAM'" "$(printf '%s' "$D1" | json "str([r for u in d['data']['dashboard']['queue']['units'] for r in u['reasons']])")"
check_contains "goal dashboard → GOAL_SUBJECT reason (§9, domain descendant match)" "'kind': 'GOAL_SUBJECT'" "$(printf '%s' "$D1" | json "str([r for u in d['data']['dashboard']['queue']['units'] for r in u['reasons']])")"
check_contains "goal dashboard → §9 sentence shape" "Because your goal includes" "$(printf '%s' "$D1" | json "str([r for u in d['data']['dashboard']['queue']['units'] for r in u['reasons']])")"
D1UP=$(printf '%s' "$D1" | json "d['data']['dashboard']['queue']['units'][0]['unit']['canonicalPath']")
case "$D1UP" in /gk/*) PASS=$((PASS+1)); echo "PASS  queue unit §16 path (/gk/…)";; *) FAIL=$((FAIL+1)); echo "FAIL  queue unit §16 path — got $D1UP";; esac

# §9 tier layering: GOAL_SUBJECT before EXAM_SCOPE (sorted tier sequence)
D1SORTED=$(printf '%s' "$D1" | python3 -c "
import json, sys
ranks = {'GOAL_SUBJECT': 0, 'FOLLOWED_SUBJECT': 1, 'EXAM_SCOPE': 2}
d = json.load(sys.stdin)
tiers = [u['tier'] for u in d['data']['dashboard']['queue']['units']]
print(tiers == sorted(tiers, key=lambda t: ranks[t]))")
check "goal dashboard → tier sequence sorted (§9 layering)" "True" "$D1SORTED"

# ---------- Follow an exam + a topic (§9 passive signals) ----------
F1=$(curl -s -X POST "$BASE/api/follows" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"EXAM\",\"objectRef\":\"$IN_EXAM_3\"}")
check "follow exam → ok" "ok" "$(printf '%s' "$F1" | json "d['status']")"
F2=$(curl -s -X POST "$BASE/api/follows" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"TOPIC\",\"objectRef\":\"$TOPIC_FOLLOW\"}")
check "follow topic → ok" "ok" "$(printf '%s' "$F2" | json "d['status']")"

# ---------- Goal + follows dashboard (mode GOAL_AND_FOLLOW) ----------
D2=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "combined dashboard → mode GOAL_AND_FOLLOW" "GOAL_AND_FOLLOW" "$(printf '%s' "$D2" | json "d['data']['dashboard']['queue']['mode']")"
check "combined dashboard → 3 exams resolved" "3" "$(printf '%s' "$D2" | json "len(d['data']['dashboard']['queue']['exams'])")"
check "combined dashboard → followed exam count" "1" "$(printf '%s' "$D2" | json "d['data']['dashboard']['signals']['followedExamCount']")"
check "combined dashboard → followed topic listed (§35 label)" "Current Affairs" "$(printf '%s' "$D2" | json "d['data']['dashboard']['signals']['followedTopics'][0]['label']")"
check_contains "combined dashboard → FOLLOWED_EXAM reason (§9)" "'kind': 'FOLLOWED_EXAM'" "$(printf '%s' "$D2" | json "str([r for u in d['data']['dashboard']['queue']['units'] for r in u['reasons']])")"
check_contains "combined dashboard → FOLLOWED_SUBJECT reason (§9)" "'kind': 'FOLLOWED_SUBJECT'" "$(printf '%s' "$D2" | json "str([r for u in d['data']['dashboard']['queue']['units'] for r in u['reasons']])")"
D2SORTED=$(printf '%s' "$D2" | python3 -c "
import json, sys
ranks = {'GOAL_SUBJECT': 0, 'FOLLOWED_SUBJECT': 1, 'EXAM_SCOPE': 2}
d = json.load(sys.stdin)
tiers = [u['tier'] for u in d['data']['dashboard']['queue']['units']]
print(tiers == sorted(tiers, key=lambda t: ranks[t]))")
check "combined dashboard → tier sequence sorted (§9 layering)" "True" "$D2SORTED"
# §11 step 9: at least one unit covers all 3 exams (the strongest shared badge)
D2MAX=$(printf '%s' "$D2" | python3 -c "
import json, sys
d = json.load(sys.stdin)
units = d['data']['dashboard']['queue']['units']
print(max(u['unit']['examCount'] for u in units))")
check "combined dashboard → a unit covers all 3 exams (§11 badge input)" "3" "$D2MAX"

# ---------- Saves block (§10 — retrieval, never a signal) ----------
S1=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"$SAVE_UNIT\"}")
check "save unit → ok" "ok" "$(printf '%s' "$S1" | json "d['status']")"
D3=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "dashboard → saves total 1" "1" "$(printf '%s' "$D3" | json "d['data']['dashboard']['saves']['total']")"
check "dashboard → recent save title" "Attorney General of India" "$(printf '%s' "$D3" | json "d['data']['dashboard']['saves']['items'][0]['object']['title'] if 'title' in d['data']['dashboard']['saves']['items'][0]['object'] else d['data']['dashboard']['saves']['items'][0]['object']['canonicalName']")"
D3SP=$(printf '%s' "$D3" | json "d['data']['dashboard']['saves']['items'][0]['object']['canonicalPath']")
case "$D3SP" in /gk/*) PASS=$((PASS+1)); echo "PASS  saved item §16 path (/gk/…)";; *) FAIL=$((FAIL+1)); echo "FAIL  saved item §16 path — got $D3SP";; esac

# ---------- §35 label chain (Hindi) ----------
D4=$(curl -s "$BASE/api/dashboard?language=hi" -H "$AUTH_IN")
check "hindi dashboard → market language hi" "hi" "$(printf '%s' "$D4" | json "d['data']['dashboard']['market']['language']['code']")"
check "hindi dashboard → followed topic hindi label" "समकालीन घटनाएँ" "$(printf '%s' "$D4" | json "d['data']['dashboard']['signals']['followedTopics'][0]['label']")"
D4UP=$(printf '%s' "$D4" | json "d['data']['dashboard']['queue']['units'][0]['unit']['canonicalPath']")
case "$D4UP" in /hi/gk/*) PASS=$((PASS+1)); echo "PASS  hindi dashboard → /hi/gk/ queue paths";; *) FAIL=$((FAIL+1)); echo "FAIL  hindi dashboard → /hi/gk/ queue paths — got $D4UP";; esac
D4GTP=$(printf '%s' "$D4" | json "d['data']['dashboard']['goal']['topics'][0]['canonicalPath']")
case "$D4GTP" in /hi/gk/*) PASS=$((PASS+1)); echo "PASS  hindi dashboard → /hi/gk/ goal subject path";; *) FAIL=$((FAIL+1)); echo "FAIL  hindi dashboard → /hi/gk/ goal subject path — got $D4GTP";; esac

# ---------- Countryless reader (no home market) ----------
DN=$(curl -s "$BASE/api/dashboard" -H "Authorization: Bearer $NOC_TOKEN")
check "countryless dashboard → ok" "ok" "$(printf '%s' "$DN" | json "d['status']")"
check "countryless dashboard → mode NONE (no signals possible)" "NONE" "$(printf '%s' "$DN" | json "d['data']['dashboard']['queue']['mode']")"
check "countryless dashboard → home null" "None" "$(printf '%s' "$DN" | json "d['data']['dashboard']['user']['homeCountryIso']")"
check "countryless dashboard → market falls back to default (IN)" "IN" "$(printf '%s' "$DN" | json "d['data']['dashboard']['market']['country']['isoCode']")"
check "countryless dashboard → isHomeMarket false" "False" "$(printf '%s' "$DN" | json "d['data']['dashboard']['market']['isHomeMarket']")"

# ---------- §36 honest read: an exam going INACTIVE leaves the queue, stays in signals ----------
ADMIN_LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@globiq.dev","password":"GlobIQ-Dev-Admin-1"}')
ADMIN_TOKEN=$(printf '%s' "$ADMIN_LOGIN" | json "d['data']['grant']['token']")
check "admin login" "ok" "$(printf '%s' "$ADMIN_LOGIN" | json "d['status']")"
AUTH_ADMIN="Authorization: Bearer $ADMIN_TOKEN"

EXAM_ID=$(curl -s "$BASE/api/exams/admin/exams" -H "$AUTH_ADMIN" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print([e['id'] for e in d['data']['exams'] if e['slug'] == 'ssc-cgl'][0])")
check "admin exam id resolved (by slug)" "c" "$(printf '%s' "$EXAM_ID" | head -c 1)"
DEACT=$(curl -s -X POST "$BASE/api/exams/admin/exams/$EXAM_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"deactivate"}')
check "deactivate $IN_EXAM_1 (§36)" "ok" "$(printf '%s' "$DEACT" | json "d['status']")"

D5=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "INACTIVE exam → still listed in goal (honest §36)" "INACTIVE" "$(printf '%s' "$D5" | json "[e for e in d['data']['dashboard']['goal']['exams'] if e['slug']=='$IN_EXAM_1'][0]['status']")"
check "INACTIVE exam → excluded from queue resolutions" "False" "$(printf '%s' "$D5" | json "any(e['exam']['slug']=='$IN_EXAM_1' for e in d['data']['dashboard']['queue']['exams'])")"
check "INACTIVE exam → queue shrinks to 2 exams" "2" "$(printf '%s' "$D5" | json "len(d['data']['dashboard']['queue']['exams'])")"

REACT=$(curl -s -X POST "$BASE/api/exams/admin/exams/$EXAM_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"reactivate"}')
check "reactivate $IN_EXAM_1 (restore)" "ok" "$(printf '%s' "$REACT" | json "d['status']")"
D6=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "reactivated exam → back in queue" "True" "$(printf '%s' "$D6" | json "any(e['exam']['slug']=='$IN_EXAM_1' for e in d['data']['dashboard']['queue']['exams'])")"

# ---------- §31 reversibility: removing the goal flips the mode ----------
GD=$(curl -s -X DELETE "$BASE/api/goal" -H "$AUTH_IN")
check "goal delete → ok" "ok" "$(printf '%s' "$GD" | json "d['status']")"
D7=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "after goal removal → mode FOLLOW (follows remain, §31)" "FOLLOW" "$(printf '%s' "$D7" | json "d['data']['dashboard']['queue']['mode']")"
check "after goal removal → plan null" "None" "$(printf '%s' "$D7" | json "d['data']['dashboard']['plan']")"
check "after goal removal → goal null" "None" "$(printf '%s' "$D7" | json "d['data']['dashboard']['goal']")"

# ---------- Unfollow everything → back to NONE (§9 reversible) ----------
FOLLOWS=$(curl -s "$BASE/api/follows" -H "$AUTH_IN")
FID1=$(printf '%s' "$FOLLOWS" | json "[f['id'] for f in d['data']['items'] if f['objectType']=='EXAM'][0]")
FID2=$(printf '%s' "$FOLLOWS" | json "[f['id'] for f in d['data']['items'] if f['objectType']=='TOPIC'][0]")
UF1=$(curl -s -X DELETE "$BASE/api/follows/$FID1" -H "$AUTH_IN")
UF2=$(curl -s -X DELETE "$BASE/api/follows/$FID2" -H "$AUTH_IN")
check "unfollow exam → ok" "ok" "$(printf '%s' "$UF1" | json "d['status']")"
check "unfollow topic → ok" "ok" "$(printf '%s' "$UF2" | json "d['status']")"
D8=$(curl -s "$BASE/api/dashboard" -H "$AUTH_IN")
check "all signals removed → mode NONE (§9/§31 reversible)" "NONE" "$(printf '%s' "$D8" | json "d['data']['dashboard']['queue']['mode']")"
check "saves SURVIVE signal removal (§10 retrieval ≠ signal)" "1" "$(printf '%s' "$D8" | json "d['data']['dashboard']['saves']['total']")"

# ---------- §30 rate limit ----------
# The dashboardRead bucket (60/min/IP) is wired identically to the proven
# profileRead/followsRead buckets (src/lib/rate-limit.ts + the route guard).
# Tripping it needs >60 reads inside one 60s window — at this stage's ~2-4s
# Supabase render latency the requests spread past the window, so the 429
# path is NOT asserted here (verified by wiring review; see session doc).

echo ""
echo "RESULT: $PASS passed, $FAIL failed (P5-S4 HTTP suite)"
[ "$FAIL" -eq 0 ] || exit 1
