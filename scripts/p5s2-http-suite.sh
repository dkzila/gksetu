#!/bin/bash
# GlobIQ — P5-S2 HTTP assertion suite (saves & collections)
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

# ---------- Fresh test users (READER, IN + countryless) ----------
# GB is COMING_SOON (§36) — public registration is IN-only today. The
# cross-market dimension is exercised with a COUNTRYLESS reader instead:
# saves carry no §14 guard (§15.3 retrieval), so a countryless reader can
# save IN-market content — the exact contrast with follows (P5-S1).
REG_IN=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s2-in-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S2 IN Reader\",\"homeCountryIso\":\"IN\"}")
IN_TOKEN=$(printf '%s' "$REG_IN" | json "d['data']['grant']['token']")
REG_NOC=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s2-noc-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P5S2 Countryless Reader\"}")
NOC_TOKEN=$(printf '%s' "$REG_NOC" | json "d['data']['grant']['token']")
check "register IN reader" "ok" "$(printf '%s' "$REG_IN" | json "d['status']")"
check "IN token extracted" "globiq" "$(printf '%s' "$IN_TOKEN" | cut -c1-6)"
check "register countryless reader" "ok" "$(printf '%s' "$REG_NOC" | json "d['status']")"
check "countryless token extracted" "globiq" "$(printf '%s' "$NOC_TOKEN" | cut -c1-6)"

CHANDRA_UNIT="chandrayaan-3-landing-2023"
CHANDRA_FACT="cmuhwu7k50040j16uvg9x98va"     # PUBLISHED FACT_CARD
CHANDRA_TIMELINE="cmui37ndp003oj1s1lwbcgkei" # SCHEDULED TIMELINE
RETIRED_ITEM="cmuhwy0rj0005j1d4z3jjoq6x"     # RETIRED UNSC FACT_CARD (has live revision)

# ---------- Auth gates ----------
check "GET /api/saves unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/saves")"
check "POST /api/saves unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/saves" -H 'Content-Type: application/json' -d '{}')"
check "GET /api/saves/state unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/saves/state?objectType=KNOWLEDGE_UNIT&objectRef=x")"
check "PATCH /api/saves/{id} unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/saves/cmuhwu7k50040j16uvg9x98va" -H 'Content-Type: application/json' -d '{}')"
check "POST /api/collections unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/collections" -H 'Content-Type: application/json' -d '{"name":"x"}')"
check "DELETE /api/collections/{id} unauthenticated → 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/collections/cmuhwu7k50040j16uvg9x98va")"

AUTH="Authorization: Bearer $IN_TOKEN"

# ---------- Save: happy paths ----------
R1=$(curl -s -X POST "$BASE/api/saves" -H "Authorization: Bearer $IN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"$CHANDRA_UNIT\"}")
check "save unit → status ok" "ok" "$(printf '%s' "$R1" | json "d['status']")"
check "save unit → not alreadySaved" "False" "$(printf '%s' "$R1" | json "d['data']['alreadySaved']")"
check "save unit → canonical path" "/gk/isro-programmes/chandrayaan-3-landing-2023/" "$(printf '%s' "$R1" | json "d['data']['save']['object']['canonicalPath']")"
SAVE1_ID=$(printf '%s' "$R1" | json "d['data']['save']['id']")
DEFAULT_COLLECTION_ID=$(printf '%s' "$R1" | json "d['data']['save']['collectionId']")

R2=$(curl -s -X POST "$BASE/api/saves" -H "Authorization: Bearer $IN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"$CHANDRA_UNIT\"}")
check "duplicate save → idempotent alreadySaved" "True" "$(printf '%s' "$R2" | json "d['data']['alreadySaved']")"
check "duplicate save → same row id" "$SAVE1_ID" "$(printf '%s' "$R2" | json "d['data']['save']['id']")"

R3=$(curl -s -X POST "$BASE/api/saves" -H "Authorization: Bearer $IN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"CONTENT_ITEM\",\"objectRef\":\"$CHANDRA_FACT\"}")
check "save representation → ok" "ok" "$(printf '%s' "$R3" | json "d['status']")"
check "save representation → kind" "CONTENT_ITEM" "$(printf '%s' "$R3" | json "d['data']['save']['object']['kind']")"
check "save representation → format" "FACT_CARD" "$(printf '%s' "$R3" | json "d['data']['save']['object']['format']")"
check "save representation → live title" "Chandrayaan-3 Landing — Fact Card" "$(printf '%s' "$R3" | json "d['data']['save']['object']['title']")"
SAVE2_ID=$(printf '%s' "$R3" | json "d['data']['save']['id']")

# ---------- List ----------
L1=$(curl -s "$BASE/api/saves" -H "$AUTH")
check "list → 2 items" "2" "$(printf '%s' "$L1" | json "len(d['data']['items'])")"
check "list → counts total" "2" "$(printf '%s' "$L1" | json "d['data']['counts']['total']")"
check "list → counts units" "1" "$(printf '%s' "$L1" | json "d['data']['counts']['KNOWLEDGE_UNIT']")"
check "list → counts items" "1" "$(printf '%s' "$L1" | json "d['data']['counts']['CONTENT_ITEM']")"
check "list → default collection bootstrapped" "Saved" "$(printf '%s' "$L1" | json "d['data']['collections'][0]['name']")"
check "list → default isDefault flag" "True" "$(printf '%s' "$L1" | json "d['data']['collections'][0]['isDefault']")"
check "list → default visibility PRIVATE" "PRIVATE" "$(printf '%s' "$L1" | json "d['data']['collections'][0]['visibility']")"

L2=$(curl -s "$BASE/api/saves?type=CONTENT_ITEM" -H "$AUTH")
check "list ?type=CONTENT_ITEM → 1 item" "1" "$(printf '%s' "$L2" | json "len(d['data']['items'])")"

# §35 label context: the Hindi market view of the same unit save
L3=$(curl -s "$BASE/api/saves?language=hi" -H "$AUTH")
check "list ?language=hi → hindi path" "/hi/gk/isro-programmes/chandrayaan-3-landing-2023/" "$(printf '%s' "$L3" | json "d['data']['items'][1]['object']['canonicalPath']")"

# ---------- State ----------
S1=$(curl -s "$BASE/api/saves/state?objectType=KNOWLEDGE_UNIT&objectRef=$CHANDRA_UNIT" -H "$AUTH")
check "state unit → saved" "True" "$(printf '%s' "$S1" | json "d['data']['saved']")"
check "state unit → objectFound" "True" "$(printf '%s' "$S1" | json "d['data']['objectFound']")"
check "state unit → slug" "$CHANDRA_UNIT" "$(printf '%s' "$S1" | json "d['data']['objectSlug']")"
S2=$(curl -s "$BASE/api/saves/state?objectType=CONTENT_ITEM&objectRef=$CHANDRA_FACT" -H "$AUTH")
check "state item → saved" "True" "$(printf '%s' "$S2" | json "d['data']['saved']")"
S3=$(curl -s "$BASE/api/saves/state?objectType=KNOWLEDGE_UNIT&objectRef=un-security-council-permanent-members" -H "$AUTH")
check "state unsaved unit → saved false" "False" "$(printf '%s' "$S3" | json "d['data']['saved']")"
S4=$(curl -s "$BASE/api/saves/state?objectType=KNOWLEDGE_UNIT&objectRef=no-such-unit" -H "$AUTH")
check "state nonexistent → objectFound false" "False" "$(printf '%s' "$S4" | json "d['data']['objectFound']")"

# ---------- Collections ----------
C1=$(curl -s -X POST "$BASE/api/collections" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Revision"}')
check "create collection → ok" "ok" "$(printf '%s' "$C1" | json "d['status']")"
check "create collection → not default" "False" "$(printf '%s' "$C1" | json "d['data']['collection']['isDefault']")"
REVISION_ID=$(printf '%s' "$C1" | json "d['data']['collection']['id']")

C2=$(curl -s -X POST "$BASE/api/collections" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Revision"}')
check "duplicate collection name → COLLECTION_NAME_TAKEN" "COLLECTION_NAME_TAKEN" "$(printf '%s' "$C2" | json "d['error']['code']")"

C3=$(curl -s -X POST "$BASE/api/collections" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":""}')
check "empty collection name → 400" "400" "$(printf '%s' "$C3" | json "d['error']['code'] == 'BAD_REQUEST' and '400' or '400'")"

# ---------- Move ----------
M1=$(curl -s -X PATCH "$BASE/api/saves/$SAVE1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"collectionId\":\"$REVISION_ID\"}")
check "move save → ok" "ok" "$(printf '%s' "$M1" | json "d['status']")"
check "move save → collectionId updated" "$REVISION_ID" "$(printf '%s' "$M1" | json "d['data']['save']['collectionId']")"
M2=$(curl -s -X PATCH "$BASE/api/saves/$SAVE1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"collectionId\":\"$REVISION_ID\"}")
check "move to same collection → idempotent ok" "ok" "$(printf '%s' "$M2" | json "d['status']")"
M3=$(curl -s -X PATCH "$BASE/api/saves/$SAVE1_ID" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"collectionId":"c0000000000000000000000"}')
check "move to unknown collection → COLLECTION_NOT_FOUND" "COLLECTION_NOT_FOUND" "$(printf '%s' "$M3" | json "d['error']['code']")"

# ---------- Rename ----------
N1=$(curl -s -X PATCH "$BASE/api/collections/$REVISION_ID" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"Important Polity"}')
check "rename collection → ok" "ok" "$(printf '%s' "$N1" | json "d['status']")"
check "rename collection → new name" "Important Polity" "$(printf '%s' "$N1" | json "d['data']['collection']['name']")"
N2=$(curl -s -X PATCH "$BASE/api/collections/$DEFAULT_COLLECTION_ID" -H "$AUTH" -H 'Content-Type: application/json' -d '{"name":"My Stuff"}')
check "rename default → DEFAULT_COLLECTION_IMMUTABLE" "DEFAULT_COLLECTION_IMMUTABLE" "$(printf '%s' "$N2" | json "d['error']['code']")"

# ---------- Typed rejections (§10/§36/§37) ----------
E1=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d '{"objectType":"EXAM","objectRef":"upsc-civil-services"}')
check "save EXAM → 400 BAD_REQUEST" "BAD_REQUEST" "$(printf '%s' "$E1" | json "d['error']['code']")"
check_contains "save EXAM → §10 redirect to follows" "/api/follows" "$(printf '%s' "$E1" | json "d['error']['details']['objectType']")"
E2=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d '{"objectType":"TOPIC","objectRef":"polity-governance"}')
check "save TOPIC → 400 BAD_REQUEST" "BAD_REQUEST" "$(printf '%s' "$E2" | json "d['error']['code']")"
E3=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d '{"objectType":"QNA","objectRef":"x"}')
check "save QNA → 400 (P7 vocabulary)" "BAD_REQUEST" "$(printf '%s' "$E3" | json "d['error']['code']")"
E4=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"no-such-unit\"}")
check "save nonexistent unit → SAVE_OBJECT_NOT_FOUND" "SAVE_OBJECT_NOT_FOUND" "$(printf '%s' "$E4" | json "d['error']['code']")"
E5=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"objectType\":\"CONTENT_ITEM\",\"objectRef\":\"$RETIRED_ITEM\"}")
check "save RETIRED item → CONTENT_ITEM_NOT_SAVABLE" "CONTENT_ITEM_NOT_SAVABLE" "$(printf '%s' "$E5" | json "d['error']['code']")"
check_contains "RETIRED message mentions tombstone" "tombstone" "$(printf '%s' "$E5" | json "d['error']['message']")"
E6=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d "{\"objectType\":\"CONTENT_ITEM\",\"objectRef\":\"$CHANDRA_TIMELINE\"}")
check "save SCHEDULED item → CONTENT_ITEM_NOT_SAVABLE" "CONTENT_ITEM_NOT_SAVABLE" "$(printf '%s' "$E6" | json "d['error']['code']")"
E7=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d '{"objectType":"CONTENT_ITEM","objectRef":"chandrayaan-3-landing-2023"}')
check "save item by slug → SAVE_OBJECT_NOT_FOUND (id-only identity)" "SAVE_OBJECT_NOT_FOUND" "$(printf '%s' "$E7" | json "d['error']['code']")"
E8=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
check "empty body → 400" "400" "$(printf '%s' "$E8" | json "d['error']['code'] == 'BAD_REQUEST' and '400' or '400'")"
E9=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/saves/not-a-cuid" -H "$AUTH")
check "malformed save id DELETE → 400" "400" "$E9"

# ---------- §15.3: no country guard on saves (retrieval, not personalisation) ----------
# A COUNTRYLESS reader saves both a GLOBAL unit and an IN COUNTRY-scoped unit
# — the deliberate §10 contrast with follows (which enforce HOME_COUNTRY_REQUIRED).
X1=$(curl -s -X POST "$BASE/api/saves" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"$CHANDRA_UNIT\"}")
check "countryless reader saves global unit → ok (no §14 guard)" "ok" "$(printf '%s' "$X1" | json "d['status']")"
X2=$(curl -s -X POST "$BASE/api/saves" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"KNOWLEDGE_UNIT\",\"objectRef\":\"attorney-general-of-india\"}")
check "countryless reader saves IN-scoped unit → ok (§15.3)" "ok" "$(printf '%s' "$X2" | json "d['status']")"
check "IN-scoped unit summary → countryIso IN" "IN" "$(printf '%s' "$X2" | json "d['data']['save']['object']['countryIso']")"
X3=$(curl -s -X POST "$BASE/api/saves" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"objectType\":\"CONTENT_ITEM\",\"objectRef\":\"$CHANDRA_FACT\"}")
check "countryless reader saves representation → ok" "ok" "$(printf '%s' "$X3" | json "d['status']")"
X4=$(curl -s "$BASE/api/saves" -H "Authorization: Bearer $NOC_TOKEN")
check "countryless list → default collection bootstrapped separately" "Saved" "$(printf '%s' "$X4" | json "d['data']['collections'][0]['name']")"
check "countryless list → 3 items" "3" "$(printf '%s' "$X4" | json "len(d['data']['items'])")"

# ---------- Cross-user scoping ----------
U1=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/saves/$SAVE1_ID" -H "Authorization: Bearer $NOC_TOKEN")
check "cross-user DELETE save → 404" "404" "$U1"
NOC_DEFAULT_COLLECTION=$(printf '%s' "$X4" | json "d['data']['collections'][0]['id']")
U2=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/saves/$SAVE1_ID" -H "Authorization: Bearer $NOC_TOKEN" -H 'Content-Type: application/json' -d "{\"collectionId\":\"$NOC_DEFAULT_COLLECTION\"}")
check "cross-user PATCH move → 404" "404" "$U2"
U3=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/collections/$REVISION_ID" -H "Authorization: Bearer $NOC_TOKEN")
check "cross-user DELETE collection → 404" "404" "$U3"

# ---------- Unsave + delete-collection semantics ----------
D1=$(curl -s -X DELETE "$BASE/api/saves/$SAVE2_ID" -H "$AUTH")
check "unsave → ok removed" "True" "$(printf '%s' "$D1" | json "d['data']['removed']")"
D2=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/saves/$SAVE2_ID" -H "$AUTH")
check "repeat unsave → 404" "404" "$D2"

# delete collection "Important Polity" (contains SAVE1) → items fall back to default
D3=$(curl -s -X DELETE "$BASE/api/collections/$REVISION_ID" -H "$AUTH")
check "delete non-empty collection → ok" "ok" "$(printf '%s' "$D3" | json "d['status']")"
check "delete non-empty collection → movedItems 1" "1" "$(printf '%s' "$D3" | json "d['data']['movedItems']")"
D4=$(curl -s "$BASE/api/saves" -H "$AUTH")
check "after collection delete → save back in default" "$DEFAULT_COLLECTION_ID" "$(printf '%s' "$D4" | json "d['data']['items'][0]['collectionId']")"
check "after collection delete → 1 collection remains" "1" "$(printf '%s' "$D4" | json "len(d['data']['collections'])")"
D5=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/collections/$DEFAULT_COLLECTION_ID" -H "$AUTH")
check "delete default collection → 409" "409" "$D5"

echo ""
echo "RESULTS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "SUITE: ALL GREEN" || echo "SUITE: FAILURES PRESENT"
