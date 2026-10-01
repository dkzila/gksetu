#!/bin/bash
# GKSetu — P6-S1 HTTP assertion suite (CurrentEvent + source aggregation)
# Master Plan §12 (event-centric architecture: steps 1–3, 6–7), §6
# (CurrentEvent row), §7 (VERIFIED-unit links), §11 (evidence URL dedup),
# §14/§20 (GLOBAL admin-only + own-country scoping, WRITER exclusion),
# §16 (slug hygiene), §24 (shared registry, UNRELIABLE trust rule), §36
# (ARCHIVED read-only, audited transitions), §37 (envelope), §38.
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
check_http() { # check_http <label> <expected> <method> <url> [curl args…]
  local label="$1" expected="$2" method="$3" url="$4"; shift 4
  local actual
  actual=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" "$@")
  check "$label" "$expected" "$actual"
}

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1], {'d': d}))" "$1" 2>/dev/null; }

# ---------- Fixtures (seeded Supabase data) ----------
ADMIN_EMAIL="admin@gksetu.dev";        ADMIN_PASS="GKSetu-Dev-Admin-1"
IN_ADMIN_EMAIL="in-admin@gksetu.dev";  IN_ADMIN_PASS="GKSetu-Dev-INAdmin-1"
WRITER_EMAIL="writer-in@gksetu.dev";   WRITER_PASS="GKSetu-Dev-Writer-1"
ISRO_URL="https://www.isro.gov.in/Chandrayaan3.html"                 # VERIFIED registry record
UNRELIABLE_URL="https://spaceinsider-daily.example.com/india-third-country-moon-landing"  # UNRELIABLE record
G20_SLUG="g20-new-delhi-leaders-declaration"                          # seeded ARCHIVED event
STABLE_SLUG="chandrayaan-3-vikram-landing"                            # seeded STABLE event (3 sources, 1 unit)

login() { # login <email> <password> → token
  curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | json "d['data']['grant']['token']"
}

ADMIN_TOKEN=$(login "$ADMIN_EMAIL" "$ADMIN_PASS")
IN_ADMIN_TOKEN=$(login "$IN_ADMIN_EMAIL" "$IN_ADMIN_PASS")
WRITER_TOKEN=$(login "$WRITER_EMAIL" "$WRITER_PASS")
check "admin login" "ok" "$([ -n "$ADMIN_TOKEN" ] && echo ok || echo fail)"
check "IN admin login" "ok" "$([ -n "$IN_ADMIN_TOKEN" ] && echo ok || echo fail)"
check "writer login" "ok" "$([ -n "$WRITER_TOKEN" ] && echo ok || echo fail)"
AUTH_ADMIN="Authorization: Bearer $ADMIN_TOKEN"
AUTH_IN="Authorization: Bearer $IN_ADMIN_TOKEN"
AUTH_WRITER="Authorization: Bearer $WRITER_TOKEN"

# ---------- Auth & permission gates (§20/§38 — canonical-record model) ----------
check_http "GET events unauthenticated → 401" 401 GET "$BASE/api/current-affairs/admin/events"
check_http "GET events bad token → 401" 401 GET "$BASE/api/current-affairs/admin/events" -H "Authorization: Bearer not-a-token"
REG=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p6s1-reader-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P6S1 Reader\"}")
READER_TOKEN=$(printf '%s' "$REG" | json "d['data']['grant']['token']")
check_http "GET events as READER → 403 (canonical-record permission)" 403 GET "$BASE/api/current-affairs/admin/events" -H "Authorization: Bearer $READER_TOKEN"
check_http "GET events as WRITER → 403 (writers enter at P6-S2 representations)" 403 GET "$BASE/api/current-affairs/admin/events" -H "Authorization: Bearer $WRITER_TOKEN"
check_http "GET events as IN COUNTRY_ADMIN → 200" 200 GET "$BASE/api/current-affairs/admin/events" -H "$AUTH_IN"
check_http "GET events as ADMIN → 200" 200 GET "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN"

# ---------- Seeded list (§45 structurally rich fixtures) ----------
# Suite fixtures carry the p6s1- slug prefix and persist across runs (§36 —
# archived tombstones, like the P5 test users); seeded assertions exclude them.
LIST=$(curl -s "$BASE/api/current-affairs/admin/events?pageSize=100" -H "$AUTH_ADMIN")
SEEDED="[e for e in d['data']['events'] if not e['slug'].startswith('p6s1')]"
check "list read → ok" "ok" "$(printf '%s' "$LIST" | json "d['status']")"
check "list → 4 seeded events (fixtures excluded)" "4" "$(printf '%s' "$LIST" | json "len($SEEDED)")"
check "seeded lifecycle mix → EMERGING 1" "1" "$(printf '%s' "$LIST" | json "len([e for e in $SEEDED if e['lifecycleState']=='EMERGING'])")"
check "seeded lifecycle mix → DEVELOPING 1" "1" "$(printf '%s' "$LIST" | json "len([e for e in $SEEDED if e['lifecycleState']=='DEVELOPING'])")"
check "seeded lifecycle mix → STABLE 1" "1" "$(printf '%s' "$LIST" | json "len([e for e in $SEEDED if e['lifecycleState']=='STABLE'])")"
check "seeded lifecycle mix → ARCHIVED 1" "1" "$(printf '%s' "$LIST" | json "len([e for e in $SEEDED if e['lifecycleState']=='ARCHIVED'])")"
check "deterministic order → newest seeded eventDate first" "un-security-council-reform-ign-round" "$(printf '%s' "$LIST" | json "[e['slug'] for e in $SEEDED][0]")"

STABLE_FILTER=$(curl -s "$BASE/api/current-affairs/admin/events?lifecycle=STABLE" -H "$AUTH_ADMIN")
check "lifecycle=STABLE filter → the seeded landing" "$STABLE_SLUG" "$(printf '%s' "$STABLE_FILTER" | json "[e['slug'] for e in d['data']['events'] if not e['slug'].startswith('p6s1')][0]")"
SCOPE_FILTER=$(curl -s "$BASE/api/current-affairs/admin/events?scope=COUNTRY" -H "$AUTH_ADMIN")
check "scope=COUNTRY filter → 2 seeded IN events" "2" "$(printf '%s' "$SCOPE_FILTER" | json "len([e for e in d['data']['events'] if not e['slug'].startswith('p6s1')])")"
Q_FILTER=$(curl -s "$BASE/api/current-affairs/admin/events?q=G20" -H "$AUTH_ADMIN")
check "q=G20 search → the declaration event" "$G20_SLUG" "$(printf '%s' "$Q_FILTER" | json "d['data']['events'][0]['slug']")"
BAD_QUERY=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/current-affairs/admin/events?lifecycle=NOPE" -H "$AUTH_ADMIN")
check "invalid lifecycle enum → 400" "400" "$BAD_QUERY"

# §14 read visibility: IN admin sees global + own, never other markets
IN_LIST=$(curl -s "$BASE/api/current-affairs/admin/events?pageSize=100" -H "$AUTH_IN")
check "IN admin visibility → 4 seeded (2 GLOBAL + 2 IN)" "4" "$(printf '%s' "$IN_LIST" | json "len([e for e in d['data']['events'] if not e['slug'].startswith('p6s1')])")"
IN_COUNTRY_ONLY=$(curl -s "$BASE/api/current-affairs/admin/events?scope=COUNTRY" -H "$AUTH_IN")
check "IN admin scope=COUNTRY → 2 seeded (own market only)" "2" "$(printf '%s' "$IN_COUNTRY_ONLY" | json "len([e for e in d['data']['events'] if not e['slug'].startswith('p6s1')])")"
IN_ISO_CHECK=$(printf '%s' "$IN_COUNTRY_ONLY" | json "set(e['countryIso'] for e in d['data']['events'])")
check "IN admin country events all IN" "{'IN'}" "$IN_ISO_CHECK"

# ---------- Detail: the §12 aggregation surface ----------
STABLE_ID=$(printf '%s' "$LIST" | json "[e['id'] for e in d['data']['events'] if e['slug']=='$STABLE_SLUG'][0]")
G20_ID=$(printf '%s' "$LIST" | json "[e['id'] for e in d['data']['events'] if e['slug']=='$G20_SLUG'][0]")
DETAIL=$(curl -s "$BASE/api/current-affairs/admin/events/$STABLE_ID" -H "$AUTH_ADMIN")
check "detail read → ok" "ok" "$(printf '%s' "$DETAIL" | json "d['status']")"
check "detail → 3 aggregated sources (multi-source §45)" "3" "$(printf '%s' "$DETAIL" | json "d['data']['event']['sources'].__len__()")"
check "detail → 1 primary source" "1" "$(printf '%s' "$DETAIL" | json "len([s for s in d['data']['event']['sources'] if s['isPrimary']])")"
check "detail → primary is the ISRO official record" "ISRO" "$(printf '%s' "$DETAIL" | json "[s['source']['publisher'] for s in d['data']['event']['sources'] if s['isPrimary']][0]")"
check "detail → 1 canonical unit link (§12 step 3)" "1" "$(printf '%s' "$DETAIL" | json "d['data']['event']['knowledgeUnits'].__len__()")"
check "detail → linked unit is the VERIFIED Chandrayaan-3 record" "chandrayaan-3-landing-2023" "$(printf '%s' "$DETAIL" | json "d['data']['event']['knowledgeUnits'][0]['unit']['slug']")"
check "detail → STABLE affordances [ARCHIVED, DEVELOPING]" "['ARCHIVED', 'DEVELOPING']" "$(printf '%s' "$DETAIL" | json "d['data']['event']['allowedTransitions']")"
check "detail → STABLE is editable" "True" "$(printf '%s' "$DETAIL" | json "d['data']['event']['editable']")"
check_contains "detail → UNRELIABLE provenance preserved (§36)" "Space Insider Daily" "$(printf '%s' "$DETAIL" | json "[s['source']['publisher'] for s in d['data']['event']['sources']].__str__()")"

ARCHIVED_DETAIL=$(curl -s "$BASE/api/current-affairs/admin/events/$G20_ID" -H "$AUTH_ADMIN")
check "ARCHIVED detail → editable false (§36 read-only)" "False" "$(printf '%s' "$ARCHIVED_DETAIL" | json "d['data']['event']['editable']")"
check "ARCHIVED detail → reopen affordances [DEVELOPING, STABLE]" "['DEVELOPING', 'STABLE']" "$(printf '%s' "$ARCHIVED_DETAIL" | json "d['data']['event']['allowedTransitions']")"
check_http "GET unknown event id → 404" 404 GET "$BASE/api/current-affairs/admin/events/clxxxxxxxxxxxxxxxxxxxxx" -H "$AUTH_ADMIN"

# ---------- §12 step 1: create (with initial source aggregation) ----------
CREATE_BODY=$(cat <<EOF
{
  "title": "P6S1 test event — ISRO announces Gaganyaan schedule",
  "eventDate": "2025-11-20",
  "topic": "space-technology",
  "scope": "GLOBAL",
  "location": "Bengaluru",
  "summary": "A P6S1 HTTP-suite fixture event covering a hypothetical Gaganyaan schedule announcement.",
  "significance": "Fixture for the §12 step 1+2 create flow.",
  "initialSources": [
    {
      "title": "ISRO — Gaganyaan schedule announcement",
      "publisher": "ISRO",
      "url": "https://www.isro.gov.in/p6s1-gaganyaan-schedule-$SUFFIX.html",
      "type": "OFFICIAL",
      "isPrimary": true
    }
  ]
}
EOF
)
CREATE=$(curl -s -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "$CREATE_BODY")
check "create GLOBAL event with initial source → ok" "ok" "$(printf '%s' "$CREATE" | json "d['status']")"
NEW_ID=$(printf '%s' "$CREATE" | json "d['data']['event']['id']")
NEW_SLUG=$(printf '%s' "$CREATE" | json "d['data']['event']['slug']")
check "create → lifecycle EMERGING (§12 step 6 start)" "EMERGING" "$(printf '%s' "$CREATE" | json "d['data']['event']['lifecycleState']")"
check "create → slug auto-generated kebab-case (§16, suffix-tolerant)" "True" "$(printf '%s' "$CREATE" | json "d['data']['event']['slug'].startswith('p6s1-test-event-isro-announces-gaganyaan-schedule')")"
check "create → 1 initial source aggregated" "1" "$(printf '%s' "$CREATE" | json "d['data']['event']['sources'].__len__()")"
check "create → initial source is primary" "True" "$(printf '%s' "$CREATE" | json "d['data']['event']['sources'][0]['isPrimary']")"
check "create → source starts UNVERIFIED (§24)" "UNVERIFIED" "$(printf '%s' "$CREATE" | json "d['data']['event']['sources'][0]['source']['verification']")"
check "create → EMERGING affordances include DEVELOPING" "True" "$(printf '%s' "$CREATE" | json "'DEVELOPING' in d['data']['event']['allowedTransitions']")"

# Validation errors (§37 explicit)
BAD_TOPIC=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"P6S1 bad topic event","eventDate":"2025-11-20","topic":"not-a-topic","scope":"GLOBAL","summary":"A validation fixture for unknown topics."}')
check "create with unknown topic → 400" "400" "$BAD_TOPIC"
SLUG_CLASH=$(curl -s -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"P6S1 clash\",\"slug\":\"$NEW_SLUG\",\"eventDate\":\"2025-11-20\",\"topic\":\"space-technology\",\"scope\":\"GLOBAL\",\"summary\":\"A slug-clash fixture for the §16 uniqueness rule.\"}")
check "create with taken slug → 409 EVENT_SLUG_TAKEN" "EVENT_SLUG_TAKEN" "$(printf '%s' "$SLUG_CLASH" | json "d['error']['code']")"
COUNTRY_MISSING=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"P6S1 scope fixture","eventDate":"2025-11-20","topic":"space-technology","scope":"COUNTRY","summary":"A scope-pairing fixture missing its country code."}')
check "COUNTRY scope without country → 400" "400" "$COUNTRY_MISSING"
INACTIVE_COUNTRY=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"P6S1 GB fixture","eventDate":"2025-11-20","topic":"space-technology","scope":"COUNTRY","country":"GB","summary":"A fixture targeting a COMING_SOON country."}')
check "COUNTRY scope with inactive country (GB) → 400" "400" "$INACTIVE_COUNTRY"

# §14 create scoping
IN_CREATE_GLOBAL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"title":"P6S1 IN admin global attempt","eventDate":"2025-11-20","topic":"space-technology","scope":"GLOBAL","summary":"A §14 denial fixture: global events are admin-managed."}')
check "IN admin create GLOBAL event → 403" "403" "$IN_CREATE_GLOBAL"
IN_CREATE=$(curl -s -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"title":"P6S1 IN admin country event","eventDate":"2025-11-20","topic":"current-affairs","scope":"COUNTRY","location":"Mumbai","summary":"A §14 fixture: the IN country admin creating an own-market event with implied country."}')
check "IN admin create COUNTRY event (implied IN) → ok" "ok" "$(printf '%s' "$IN_CREATE" | json "d['status']")"
IN_EVENT_ID=$(printf '%s' "$IN_CREATE" | json "d['data']['event']['id']")
check "IN admin event → countryIso IN (implied §14)" "IN" "$(printf '%s' "$IN_CREATE" | json "d['data']['event']['countryIso']")"

# ---------- §12 step 6: lifecycle transitions ----------
SKIP=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"to":"STABLE","reason":"Clear picture from the start — skip-forward is allowed"}')
check "EMERGING → STABLE skip-forward → ok" "ok" "$(printf '%s' "$SKIP" | json "d['status']")"
check "transition applied → STABLE" "STABLE" "$(printf '%s' "$SKIP" | json "d['data']['event']['lifecycleState']")"
BACKWARD=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"to":"EMERGING"}')
check "STABLE → EMERGING invalid edge → 409 INVALID_TRANSITION" "INVALID_TRANSITION" "$(printf '%s' "$BACKWARD" | json "d['error']['code']")"
SAME=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"to":"STABLE"}')
check "same-state transition → 409" "INVALID_TRANSITION" "$(printf '%s' "$SAME" | json "d['error']['code']")"

# §36: ARCHIVED is read-only; the explicit reopen is the only way forward
ARCHIVE=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"to":"ARCHIVED","reason":"Fixture complete — archive it"}')
check "STABLE → ARCHIVED → ok" "ok" "$(printf '%s' "$ARCHIVE" | json "d['status']")"
ARCHIVED_PATCH=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/current-affairs/admin/events/$NEW_ID" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"summary":"Attempting to edit an archived event should fail (§36)."}')
check "PATCH archived event → 409 EVENT_ARCHIVED" "409" "$ARCHIVED_PATCH"
ARCHIVED_ATTACH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/sources" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.isro.gov.in/another-p6s1-fixture.html","title":"Post-archive source","publisher":"ISRO","type":"OFFICIAL"}')
check "attach source to archived event → 409" "409" "$ARCHIVED_ATTACH"
REOPEN=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"to":"DEVELOPING","reason":"The story returned — explicit reopen (§36)"}')
check "ARCHIVED → DEVELOPING explicit reopen → ok" "ok" "$(printf '%s' "$REOPEN" | json "d['status']")"

# ---------- §12 step 2: source aggregation (URL dedup + trust rules) ----------
REUSE=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/sources" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"ISRO Chandrayaan-3 record (reuse fixture)\",\"publisher\":\"ISRO\",\"url\":\"$ISRO_URL\",\"type\":\"OFFICIAL\",\"note\":\"Cite the existing registry record\"}")
check "attach by already-registered URL → ok" "ok" "$(printf '%s' "$REUSE" | json "d['status']")"
check "attach → sourceReused true (§11 URL dedup)" "True" "$(printf '%s' "$REUSE" | json "d['data']['sourceReused']")"
check "attach → sourceCreated false" "False" "$(printf '%s' "$REUSE" | json "d['data']['sourceCreated']")"
check "reused record keeps its VERIFIED state (§24)" "VERIFIED" "$(printf '%s' "$REUSE" | json "d['data']['link']['source']['verification']")"
DUP=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/sources" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"url\":\"$ISRO_URL\",\"title\":\"Duplicate attach\",\"publisher\":\"ISRO\",\"type\":\"OFFICIAL\"}")
check "attach same URL twice → 409 SOURCE_ALREADY_LINKED" "SOURCE_ALREADY_LINKED" "$(printf '%s' "$DUP" | json "d['error']['code']")"
NEW_SRC=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/sources" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"url\":\"https://www.thehindu.com/science/p6s1-gaganyaan-$SUFFIX/\",\"title\":\"The Hindu — Gaganyaan coverage\",\"publisher\":\"The Hindu\",\"type\":\"NEWS_MEDIA\"}")
check "attach new URL → ok" "ok" "$(printf '%s' "$NEW_SRC" | json "d['status']")"
check "attach new URL → sourceCreated true" "True" "$(printf '%s' "$NEW_SRC" | json "d['data']['sourceCreated']")"
NEW_LINK_ID=$(printf '%s' "$NEW_SRC" | json "d['data']['link']['id']")
UNRELIABLE=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/sources" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"url\":\"$UNRELIABLE_URL\",\"title\":\"Unreliable attach attempt\",\"publisher\":\"Space Insider Daily\",\"type\":\"NEWS_MEDIA\"}")
check "attach UNRELIABLE source by URL → 409 SOURCE_UNRELIABLE (§24)" "SOURCE_UNRELIABLE" "$(printf '%s' "$UNRELIABLE" | json "d['error']['code']")"
BAD_ATTACH=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/sources" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"note":"Neither a source id nor a full payload"}')
check "attach with neither id nor payload → 400" "400" "$BAD_ATTACH"

# Primary swap (at most one lead source)
SWAP=$(curl -s -X PATCH "$BASE/api/current-affairs/admin/events/$NEW_ID/sources/$NEW_LINK_ID" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"isPrimary":true,"note":"The Hindu leads the follow-up coverage"}')
check "primary swap → ok" "ok" "$(printf '%s' "$SWAP" | json "d['status']")"
DETAIL_AFTER=$(curl -s "$BASE/api/current-affairs/admin/events/$NEW_ID" -H "$AUTH_ADMIN")
check "after swap → exactly 1 primary" "1" "$(printf '%s' "$DETAIL_AFTER" | json "len([s for s in d['data']['event']['sources'] if s['isPrimary']])")"
check "after swap → The Hindu is primary" "The Hindu" "$(printf '%s' "$DETAIL_AFTER" | json "[s['source']['publisher'] for s in d['data']['event']['sources'] if s['isPrimary']][0]")"

# Detach preserves the shared registry (§36)
DETACH=$(curl -s -X DELETE "$BASE/api/current-affairs/admin/events/$NEW_ID/sources/$NEW_LINK_ID" -H "$AUTH_ADMIN")
check "detach source → ok" "ok" "$(printf '%s' "$DETACH" | json "d['status']")"
check "detach → sourceCount back to 2" "2" "$(printf '%s' "$(curl -s "$BASE/api/current-affairs/admin/events/$NEW_ID" -H "$AUTH_ADMIN")" | json "d['data']['event']['sourceCount']")"
check_http "detach a foreign link id → 404" 404 DELETE "$BASE/api/current-affairs/admin/events/$NEW_ID/sources/clxxxxxxxxxxxxxxxxxxxxx" -H "$AUTH_ADMIN"

# ---------- §12 step 3: canonical unit links (§7 VERIFIED only) ----------
LINK_UNIT=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/knowledge-units" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"unit":"chandrayaan-3-landing-2023","note":"The §7 one-truth link fixture"}')
check "link VERIFIED unit → ok" "ok" "$(printf '%s' "$LINK_UNIT" | json "d['status']")"
# A fresh DRAFT unit via the admin API — the live attorney-general unit was
# verified in a prior session, so the fixture must be created per-run.
DRAFT_KU=$(curl -s -X POST "$BASE/api/knowledge/admin/units" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"canonicalName\":\"P6S1 DRAFT fixture unit $SUFFIX\",\"slug\":\"p6s1-draft-fixture-$SUFFIX\",\"canonicalBody\":\"A DRAFT knowledge unit created by the P6-S1 HTTP suite to prove that events link only VERIFIED canonical units (§7).\",\"type\":\"FACT\",\"scope\":\"GLOBAL\",\"topic\":\"current-affairs\"}")
check "create DRAFT unit fixture → ok" "ok" "$(printf '%s' "$DRAFT_KU" | json "d['status']")"
DRAFT_UNIT=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/knowledge-units" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d "{\"unit\":\"p6s1-draft-fixture-$SUFFIX\"}")
check "link DRAFT unit → 409 UNIT_NOT_VERIFIED (§7 canonical truth only)" "UNIT_NOT_VERIFIED" "$(printf '%s' "$DRAFT_UNIT" | json "d['error']['code']")"
DUP_UNIT=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/knowledge-units" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"unit":"chandrayaan-3-landing-2023"}')
check "link same unit twice → 409 UNIT_ALREADY_LINKED" "UNIT_ALREADY_LINKED" "$(printf '%s' "$DUP_UNIT" | json "d['error']['code']")"
UNIT_LINK_ID=$(printf '%s' "$LINK_UNIT" | json "d['data']['link']['id']")
UNLINK=$(curl -s -X DELETE "$BASE/api/current-affairs/admin/events/$NEW_ID/knowledge-units/$UNIT_LINK_ID" -H "$AUTH_ADMIN")
check "unlink unit → ok" "ok" "$(printf '%s' "$UNLINK" | json "d['status']")"

# ---------- §36: audited metadata edit + scope immutability ----------
PATCH_OK=$(curl -s -X PATCH "$BASE/api/current-affairs/admin/events/$NEW_ID" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"significance":"Updated significance through the audited PATCH path (§36).","location":"Thiruvananthapuram"}')
check "PATCH metadata → ok" "ok" "$(printf '%s' "$PATCH_OK" | json "d['status']")"
check "PATCH applied → location updated" "Thiruvananthapuram" "$(printf '%s' "$PATCH_OK" | json "d['data']['event']['location']")"
SCOPE_PATCH=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/current-affairs/admin/events/$NEW_ID" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"scope":"COUNTRY","country":"IN"}')
check "PATCH scope/country → 400 (identity is immutable §36)" "400" "$SCOPE_PATCH"

# ---------- §14/§20: object-level scoping on a COUNTRY event ----------
IN_TOUCH_GLOBAL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"to":"STABLE"}')
check "IN admin transition GLOBAL event → 403" "403" "$IN_TOUCH_GLOBAL"
IN_TOUCH_IN=$(curl -s -X POST "$BASE/api/current-affairs/admin/events/$IN_EVENT_ID/transition" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"to":"DEVELOPING"}')
check "IN admin transition own COUNTRY event → ok" "ok" "$(printf '%s' "$IN_TOUCH_IN" | json "d['status']")"

# ---------- Audit trail (§12 step 7 / §36) ----------
AUDIT=$(curl -s "$BASE/api/audit?action=currentaffairs.event.transition&page=1&pageSize=5" -H "$AUTH_ADMIN")
check "audit trail records event transitions" "True" "$(printf '%s' "$AUDIT" | json "d['data']['summary']['total'] > 0")"
AUDIT_CREATE=$(curl -s "$BASE/api/audit?action=currentaffairs.event.create&page=1&pageSize=5" -H "$AUTH_ADMIN")
check "audit trail records event creates" "True" "$(printf '%s' "$AUDIT_CREATE" | json "d['data']['summary']['total'] > 0")"

# ---------- Cleanup: archive the fixtures (§36 — nothing hard-deleted) ----------
curl -s -X POST "$BASE/api/current-affairs/admin/events/$NEW_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' \
  -d '{"to":"ARCHIVED","reason":"HTTP-suite fixture cleanup"}' > /dev/null
curl -s -X POST "$BASE/api/current-affairs/admin/events/$IN_EVENT_ID/transition" -H "$AUTH_IN" -H 'Content-Type: application/json' \
  -d '{"to":"ARCHIVED","reason":"HTTP-suite fixture cleanup"}' > /dev/null

# ---------- Result ----------
echo ""
echo "P6-S1 HTTP suite: $PASS passed, $FAIL failed (of $((PASS+FAIL)))"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
