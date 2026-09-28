#!/bin/bash
# GlobIQ — P6-S2 HTTP assertion suite (current-affairs publishing & revisions)
# Master Plan §12 step 4 (language-specific ContentItems for events), §7 (one
# rendering per anchor × language × format), §19 (the review workflow rides the
# same ContentItem machinery; scheduled releases materialize), §24 (item-level
# provenance on event representations), §14/§20 (GLOBAL admin-only anchors,
# writer language scope, own-country scoping), §16 (the /current-affairs/{slug}/
# canonical page + SEO block + NewsArticle), §17 (CURRENT_EVENT search with
# eventDate freshness + events filter), §34 (homepage discovery list), §35
# (only published languages; canonical fallback, never fake translations), §36
# (ARCHIVED events read-only for representations; corrections = new revisions),
# §37 (envelope), §38 (public page unauthenticated). English-only per user
# directive. Run with the dev server on :3000.
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
check_not_contains() { # check_not_contains <label> <needle> <haystack>
  case "$3" in *"$2"*) FAIL=$((FAIL+1)); echo "FAIL  $1 — unexpectedly found [$2] in: ${3:0:220}";; *) PASS=$((PASS+1)); echo "PASS  $1";; esac
}
check_http() { # check_http <label> <expected> <method> <url> [curl args…]
  local label="$1" expected="$2" method="$3" url="$4"; shift 4
  local actual
  actual=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" "$@")
  check "$label" "$expected" "$actual"
}

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1], {'d': d}))" "$1" 2>/dev/null; }

# ---------- Fixtures (seeded Supabase data) ----------
ADMIN_EMAIL="admin@globiq.dev";        ADMIN_PASS="GlobIQ-Dev-Admin-1"
IN_ADMIN_EMAIL="in-admin@globiq.dev";  IN_ADMIN_PASS="GlobIQ-Dev-INAdmin-1"
WRITER_EMAIL="writer-in@globiq.dev";   WRITER_PASS="GlobIQ-Dev-Writer-1"
WRITER_HI_EMAIL="writer-hi@globiq.dev"; WRITER_HI_PASS="GlobIQ-Dev-Writer-Hi-1"
CHANDRAYAAN="chandrayaan-3-vikram-landing"     # GLOBAL/STABLE — en (2 revs) + hi published
SPACE_DAY="national-space-day-notification"    # COUNTRY/IN DEVELOPING — en published, hi DRAFT
G20="g20-new-delhi-leaders-declaration"        # COUNTRY/IN ARCHIVED — en published (historical page)
UNSC="un-security-council-reform-ign-round"    # GLOBAL/EMERGING — no representation (no public page)
ISRO_URL="https://www.isro.gov.in/Chandrayaan3.html"

login() { # login <email> <password> → token
  curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" | json "d['data']['grant']['token']"
}

ADMIN_TOKEN=$(login "$ADMIN_EMAIL" "$ADMIN_PASS")
IN_ADMIN_TOKEN=$(login "$IN_ADMIN_EMAIL" "$IN_ADMIN_PASS")
WRITER_TOKEN=$(login "$WRITER_EMAIL" "$WRITER_PASS")
WRITER_HI_TOKEN=$(login "$WRITER_HI_EMAIL" "$WRITER_HI_PASS")
check "admin login" "ok" "$([ -n "$ADMIN_TOKEN" ] && echo ok || echo fail)"
check "IN admin login" "ok" "$([ -n "$IN_ADMIN_TOKEN" ] && echo ok || echo fail)"
check "writer login" "ok" "$([ -n "$WRITER_TOKEN" ] && echo ok || echo fail)"
check "Hindi writer login" "ok" "$([ -n "$WRITER_HI_TOKEN" ] && echo ok || echo fail)"
AUTH_ADMIN="Authorization: Bearer $ADMIN_TOKEN"
AUTH_IN="Authorization: Bearer $IN_ADMIN_TOKEN"
AUTH_WRITER="Authorization: Bearer $WRITER_TOKEN"
AUTH_WRITER_HI="Authorization: Bearer $WRITER_HI_TOKEN"

echo ""
echo "===== 1. The public §16 event page (unauthenticated, §38) ====="

PAGE=$(curl -s "$BASE/api/current-affairs/page/$CHANDRAYAAN?country=IN")
check "event page: envelope ok" "ok" "$(printf '%s' "$PAGE" | json "d['status']")"
check "event page: canonical path" "/current-affairs/$CHANDRAYAAN/" "$(printf '%s' "$PAGE" | json "d['data']['page']['canonicalPath']")"
check "event page: lifecycle STABLE" "STABLE" "$(printf '%s' "$PAGE" | json "d['data']['page']['event']['lifecycleState']")"
check "event page: reader-language presentation" "reader_language" "$(printf '%s' "$PAGE" | json "d['data']['page']['presentedFrom']")"
check "event page: EN live revision = 2 (the §36 correction)" "2" "$(printf '%s' "$PAGE" | json "d['data']['page']['representations'][0]['revision']['number']")"
check_contains "event page: correction change summary present" "never a silent edit" "$(printf '%s' "$PAGE" | json "d['data']['page']['representations'][0]['revision']['changeSummary']")"
check "event page: hreflang set = en+hi (§35 honest)" "en,hi" "$(printf '%s' "$PAGE" | python3 -c "import json,sys;d=json.load(sys.stdin);print(','.join(sorted(a['hreflang'] for a in d['data']['page']['seo']['alternates'])))")"
check "event page: translations include hi" "hi" "$(printf '%s' "$PAGE" | python3 -c "import json,sys;d=json.load(sys.stdin);print('hi' if any(t['code']=='hi' for t in d['data']['page']['translations']) else 'missing')")"
check "event page: primary source first (ISRO)" "Primary" "$(printf '%s' "$PAGE" | json "'Primary' if d['data']['page']['sources'][0]['isPrimary'] else 'not-primary'")"
check "event page: §7 unit link present" "chandrayaan-3-landing-2023" "$(printf '%s' "$PAGE" | json "d['data']['page']['knowledgeUnits'][0]['slug']")"
check_contains "event page: §16 knowledge path" "/gk/isro-programmes/chandrayaan-3-landing-2023/" "$(printf '%s' "$PAGE" | json "d['data']['page']['knowledgeUnits'][0]['canonicalPath']")"
check_contains "event page: NewsArticle structured data" "NewsArticle" "$(printf '%s' "$PAGE" | json "[n['@type'] if isinstance(n['@type'],str) else '@'.join(n['@type']) for n in d['data']['page']['structuredData']['graph']].__str__()")"
check_contains "event page: canonical robots index" "'index': True" "$(printf '%s' "$PAGE" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['data']['page']['seo']['robots'])")"
check "event page: citedBy on the ISRO evidence (§24)" "1" "$(printf '%s' "$PAGE" | json "len(d['data']['page']['sources'][0]['citedBy'])")"

# Hindi read (§35): the Hindi representation renders, self hreflang.
PAGE_HI=$(curl -s "$BASE/api/current-affairs/page/$CHANDRAYAAN?country=IN&language=hi")
check "Hindi event page: ok" "ok" "$(printf '%s' "$PAGE_HI" | json "d['status']")"
check "Hindi event page: Hindi title" "चंद्रयान-3" "$(printf '%s' "$PAGE_HI" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['data']['page']['representations'][0]['title'].split(':')[0])")"

# Canonical fallback (§35): G20 has no Hindi representation — the record
# renders alone with the honest note, never a fake translation.
PAGE_FALLBACK=$(curl -s "$BASE/api/current-affairs/page/$G20?country=IN&language=hi")
check "G20 Hindi read: canonical fallback" "canonical_fallback" "$(printf '%s' "$PAGE_FALLBACK" | json "d['data']['page']['presentedFrom']")"
check "G20 Hindi read: no representations rendered" "0" "$(printf '%s' "$PAGE_FALLBACK" | json "len(d['data']['page']['representations'])")"
check "G20 Hindi read: still public via EN publication" "ARCHIVED" "$(printf '%s' "$PAGE_FALLBACK" | json "d['data']['page']['event']['lifecycleState']")"

# The EMERGING no-publication state: UNSC has no representation → 404.
check_http "UNSC (no published representation) → 404 (§19/§35 gate)" 404 GET "$BASE/api/current-affairs/page/$UNSC?country=IN"
check_http "unknown event slug → 404" 404 GET "$BASE/api/current-affairs/page/no-such-event?country=IN"

# §14: a COUNTRY/IN event is invisible in the GB market; GLOBAL events are
# browsable everywhere the market is ACTIVE (GB is COMING_SOON → 404, the
# knowledge-page precedent).
check_http "COUNTRY/IN event from GB → 404 (§14)" 404 GET "$BASE/api/current-affairs/page/$SPACE_DAY?country=GB"
check_http "GLOBAL event from GB (COMING_SOON market) → 404 (§15 precedent)" 404 GET "$BASE/api/current-affairs/page/$CHANDRAYAAN?country=GB"

echo ""
echo "===== 2. The admin events read surface opens to writers (P6-S2 §20) ====="

WRITER_EVENTS=$(curl -s "$BASE/api/current-affairs/admin/events" -H "$AUTH_WRITER")
check "writer reads the event directory" "ok" "$(printf '%s' "$WRITER_EVENTS" | json "d['status']")"
WRITER_EVENT_LIST=$(printf '%s' "$WRITER_EVENTS" | python3 -c "import json,sys;d=json.load(sys.stdin);print(' '.join(e['slug'] for e in d['data']['events']))")
check_contains "writer sees the seeded GLOBAL event" "$CHANDRAYAAN" "$WRITER_EVENT_LIST"
check_contains "writer sees the own-country event" "$SPACE_DAY" "$WRITER_EVENT_LIST"
check_http "writer cannot CREATE events (current-affairs:manage intact)" 403 POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_WRITER" -H 'Content-Type: application/json' -d '{}'
REG=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p6s2-reader-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"P6S2 Reader\"}")
READER_TOKEN=$(printf '%s' "$REG" | json "d['data']['grant']['token']")
check_http "READER cannot read the event directory" 403 GET "$BASE/api/current-affairs/admin/events" -H "Authorization: Bearer $READER_TOKEN"

echo ""
echo "===== 3. Event-representation authoring (§12 step 4 rides §19) ====="

# Per-run fixtures (§36: nothing hard-deleted — archived tombstones on cleanup).
RUN_EVENT="p6s2-global-event-$SUFFIX"          # GLOBAL/EMERGING — the §19 breaking-news workflow
RUN_IN_EVENT="p6s2-in-event-$SUFFIX"           # COUNTRY/IN — the writer workspace workflow
RUN_EVENT_CREATED=$(curl -s -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "{
  \"title\": \"P6-S2 verification event — global breaking story $SUFFIX\", \"slug\": \"$RUN_EVENT\",
  \"eventDate\": \"2025-11-20T00:00:00Z\", \"scope\": \"GLOBAL\", \"topic\": \"united-nations\",
  \"summary\": \"A per-run verification event exercising the §12 step 4 publishing workflow end-to-end: create the representation, walk it through §19 review and publish, stage a §36 correction, and retire it — leaving an archived tombstone, never a hard delete.\"
}")
check "per-run GLOBAL event created (EMERGING)" "EMERGING" "$(printf '%s' "$RUN_EVENT_CREATED" | json "d['data']['event']['lifecycleState']")"
check "per-run GLOBAL event slug is explicit (§16)" "$RUN_EVENT" "$(printf '%s' "$RUN_EVENT_CREATED" | json "d['data']['event']['slug']")"
RUN_IN_EVENT_CREATED=$(curl -s -X POST "$BASE/api/current-affairs/admin/events" -H "$AUTH_IN" -H 'Content-Type: application/json' -d "{
  \"title\": \"P6-S2 verification event — India workspace story $SUFFIX\", \"slug\": \"$RUN_IN_EVENT\",
  \"eventDate\": \"2025-11-21T00:00:00Z\", \"scope\": \"COUNTRY\", \"country\": \"IN\", \"topic\": \"current-affairs\",
  \"summary\": \"A per-run COUNTRY/IN verification event for the writer workspace flow: a writer authors its representation, an editor publishes it, and the run leaves an archived tombstone per the §36 no-hard-delete rule.\"
}")
check "per-run COUNTRY/IN event created" "ok" "$(printf '%s' "$RUN_IN_EVENT_CREATED" | json "d['status']")"

# Create on the emerging per-run event (ADMIN): EMERGING publishes — breaking news.
CREATE=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "{
  \"event\": \"$RUN_EVENT\", \"language\": \"en\", \"format\": \"CURRENT_EVENT_UPDATE\",
  \"title\": \"Verification event — new round opens\", \"body\": \"A fresh round of negotiations opened with members tabling new positions on expansion and veto use. This update is drafted for the P6-S2 verification run and will be corrected mid-suite to prove the §36 never-silent-edit cycle, then retired to leave an honest tombstone.\"
}")
check "create on EMERGING event → DRAFT" "DRAFT" "$(printf '%s' "$CREATE" | json "d['data']['item']['status']")"
check "created item carries the event anchor" "$RUN_EVENT" "$(printf '%s' "$CREATE" | json "d['data']['item']['event']['slug']")"
check "created item unit anchor is null (XOR)" "None" "$(printf '%s' "$CREATE" | json "d['data']['item']['unit']")"
RUN_ITEM=$(printf '%s' "$CREATE" | json "d['data']['item']['id']")

# The §7/§12 identity rule: one rendering per anchor × language × format.
DUP=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "{
  \"event\": \"$RUN_EVENT\", \"language\": \"en\", \"format\": \"CURRENT_EVENT_UPDATE\",
  \"title\": \"Duplicate update\", \"body\": \"This should be rejected as a duplicate rendering of the same event, the same language and the same format — the §7/§12 identity rule allows exactly one rendering per anchor, language and format, so the platform refuses the second create with a typed conflict error.\"
}")
check "duplicate (event, language, format) → 409 REPRESENTATION_EXISTS" "REPRESENTATION_EXISTS" "$(printf '%s' "$DUP" | json "d['error']['code']")"

# The XOR invariant (§12 step 4): both anchors → 400.
XOR=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "{
  \"event\": \"$UNSC\", \"unit\": \"chandrayaan-3-landing-2023\", \"language\": \"en\", \"format\": \"EXPLAINER\",
  \"title\": \"Both anchors\", \"body\": \"This must be rejected — an item represents exactly one canonical record, never both a unit and an event at the same time.\"
}")
check "both unit+event anchors → 400 (XOR)" "400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/content/admin/items" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "{
  \"event\": \"$UNSC\", \"unit\": \"chandrayaan-3-landing-2023\", \"language\": \"en\", \"format\": \"EXPLAINER\",
  \"title\": \"Both anchors\", \"body\": \"This must be rejected — an item represents exactly one canonical record, never both a unit and an event at the same time.\"
}")"

# Unknown event → 404; ARCHIVED event → 409 EVENT_ARCHIVED (§36 read-only).
UNKNOWN=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d "{
  \"event\": \"no-such-event\", \"language\": \"en\", \"format\": \"CURRENT_EVENT_UPDATE\",
  \"title\": \"Unknown anchor\", \"body\": \"This must be rejected because the referenced current event does not exist in the platform's canonical record store — the anchor resolution fails with a typed not-found error before any representation row is created, exactly as the knowledge-unit path behaves.\"
}")
check "unknown event anchor → 404 EVENT_NOT_FOUND" "EVENT_NOT_FOUND" "$(printf '%s' "$UNKNOWN" | json "d['error']['code']")"
ARCHIVED_CREATE=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_IN" -H 'Content-Type: application/json' -d "{
  \"event\": \"$G20\", \"language\": \"en\", \"format\": \"CURRENT_EVENT_UPDATE\",
  \"title\": \"Archived anchor\", \"body\": \"This must be rejected because the G20 event is archived and read-only under the platform's lifecycle rules for end-of-life records — archived events never receive new representations, and the honest path is reopening the event through an explicit lifecycle transition before authoring resumes.\"
}")
check "create on ARCHIVED event → 409 EVENT_ARCHIVED (§36)" "EVENT_ARCHIVED" "$(printf '%s' "$ARCHIVED_CREATE" | json "d['error']['code']")"

# The admin list filter: ?event= narrows to one event's representations.
LIST=$(curl -s "$BASE/api/content/admin/items?event=$CHANDRAYAAN" -H "$AUTH_ADMIN")
check "admin list ?event= filter: 2 Chandrayaan representations" "2" "$(printf '%s' "$LIST" | json "len(d['data']['items'])")"
check "list rows carry the event anchor" "$CHANDRAYAAN" "$(printf '%s' "$LIST" | json "d['data']['items'][0]['event']['slug']")"

# The revision history (§36): anchor-labelled, both preserved revisions.
REVISIONS=$(curl -s "$BASE/api/content/admin/items/$(printf '%s' "$LIST" | json "[i['id'] for i in d['data']['items'] if i['language']['code']=='en'][0]")/revisions" -H "$AUTH_ADMIN")
check "revision history: anchor kind event" "event" "$(printf '%s' "$REVISIONS" | json "d['data']['anchor']['kind']")"
check "revision history: 2 preserved versions" "2" "$(printf '%s' "$REVISIONS" | json "len(d['data']['revisions'])")"

# §24: item-level provenance on an event representation (seeded ISRO link).
SRC=$(curl -s "$BASE/api/content/admin/items/$(printf '%s' "$LIST" | json "[i['id'] for i in d['data']['items'] if i['language']['code']=='en'][0]")/sources" -H "$AUTH_ADMIN")
check "sources list: anchor kind event" "event" "$(printf '%s' "$SRC" | json "d['data']['anchor']['kind']")"
check "sources list: the seeded ISRO citation" "$ISRO_URL" "$(printf '%s' "$SRC" | json "d['data']['links'][0]['source']['url']")"

echo ""
echo "===== 4. The §19 workflow on event representations ====="

# submit_review → publish (ADMIN). EMERGING publishes — breaking news is the point.
SUBMIT=$(curl -s -X POST "$BASE/api/content/admin/items/$RUN_ITEM/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"submit_review"}')
check "submit_review on event item → IN_REVIEW" "IN_REVIEW" "$(printf '%s' "$SUBMIT" | json "d['data']['item']['status']")"
PUBLISH=$(curl -s -X POST "$BASE/api/content/admin/items/$RUN_ITEM/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"publish"}')
check "publish on EMERGING event → PUBLISHED (breaking news, §12)" "PUBLISHED" "$(printf '%s' "$PUBLISH" | json "d['data']['item']['status']")"
check "published revision 1 exists" "1" "$(printf '%s' "$PUBLISH" | json "d['data']['item']['liveRevision']['revisionNumber']")"

# The public page materialises the moment the update publishes (§19/§35).
check_http "per-run event page now public after first publish" 200 GET "$BASE/api/current-affairs/page/$RUN_EVENT?country=IN"

# The §36 correction cycle: stage an edit → republish requires changeSummary.
PATCH=$(curl -s -X PATCH "$BASE/api/content/admin/items/$RUN_ITEM" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"body": "A fresh round of negotiations opened with members tabling new positions on expansion and veto use. CORRECTED: the round is co-chaired by two permanent representatives, and positions on veto restraint remain divided. This staged correction proves the working-copy/live-revision split: the public keeps the original until a new revision publishes with its change summary."}')
check "staged correction saved (working copy)" "PUBLISHED" "$(printf '%s' "$PATCH" | json "d['data']['item']['status']")"
REPUBLISH_NO_SUMMARY=$(curl -s -X POST "$BASE/api/content/admin/items/$RUN_ITEM/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"publish"}')
check "republish without changeSummary → 400 (§36 never silent)" "CHANGE_SUMMARY_REQUIRED" "$(printf '%s' "$REPUBLISH_NO_SUMMARY" | json "d['error']['code']")"
REPUBLISH=$(curl -s -X POST "$BASE/api/content/admin/items/$RUN_ITEM/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"publish","changeSummary":"Added the co-chairs and the veto-restraint line"}')
check "republish with changeSummary → revision 2" "2" "$(printf '%s' "$REPUBLISH" | json "d['data']['item']['liveRevision']['revisionNumber']")"
PUBLIC_AFTER=$(curl -s "$BASE/api/current-affairs/page/$RUN_EVENT?country=IN")
check_contains "public page serves revision 2" "CORRECTED" "$(printf '%s' "$PUBLIC_AFTER" | json "d['data']['page']['representations'][0]['body']")"
check "public page revision = 2" "2" "$(printf '%s' "$PUBLIC_AFTER" | json "d['data']['page']['representations'][0]['revision']['number']")"

echo ""
echo "===== 5. Writer scoping (§18/§20) ====="

# A writer authors an own-country event representation (content:manage)…
WRITER_CREATE=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_WRITER" -H 'Content-Type: application/json' -d "{
  \"event\": \"$RUN_IN_EVENT\", \"language\": \"en\", \"format\": \"EXPLAINER\",
  \"title\": \"Verification story — why it matters for exams\", \"body\": \"This explainer walks through what the verification story covers, how institutions observe it, and the one-liner framing exam setters prefer. It is authored by the IN workspace writer for review: the writer submits, an editor publishes — the §18 separation of duties proven on an event representation exactly as on unit content. The body carries genuine article depth so the §23 per-format rules hold.\"
}")
check "writer creates own-country event representation" "DRAFT" "$(printf '%s' "$WRITER_CREATE" | json "d['data']['item']['status']")"
WRITER_ITEM=$(printf '%s' "$WRITER_CREATE" | json "d['data']['item']['id']")
# …but never publishes (§18) and never touches GLOBAL anchors (§14).
WRITER_PUBLISH=$(curl -s -X POST "$BASE/api/content/admin/items/$WRITER_ITEM/transition" -H "$AUTH_WRITER" -H 'Content-Type: application/json' -d '{"action":"submit_review"}')
check "writer submit_review → IN_REVIEW (opens the board)" "IN_REVIEW" "$(printf '%s' "$WRITER_PUBLISH" | json "d['data']['item']['status']")"
WRITER_PUBLISH_DENY=$(curl -s -X POST "$BASE/api/content/admin/items/$WRITER_ITEM/transition" -H "$AUTH_WRITER" -H 'Content-Type: application/json' -d '{"action":"publish"}')
check "writer publish → 403 PUBLISH_NOT_PERMITTED (§18)" "PUBLISH_NOT_PERMITTED" "$(printf '%s' "$WRITER_PUBLISH_DENY" | json "d['error']['code']")"
WRITER_GLOBAL=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_WRITER" -H 'Content-Type: application/json' -d "{
  \"event\": \"$CHANDRAYAAN\", \"language\": \"en\", \"format\": \"CURRENT_EVENT_UPDATE\",
  \"title\": \"Global anchor from writer\", \"body\": \"This must be rejected: the Chandrayaan event is a global canonical record, and country-scoped staff cannot author representations of global records under the platform's server-side country scope rules — the same object-level boundary that protects global knowledge units applies unchanged to global current events.\"
}")
check "writer on GLOBAL event → 403 GLOBAL_CONTENT_ADMIN_ONLY" "GLOBAL_CONTENT_ADMIN_ONLY" "$(printf '%s' "$WRITER_GLOBAL" | json "d['error']['code']")"

# A Hindi-scoped writer writes Hindi event updates only (§20).
HI_CREATE=$(curl -s -X POST "$BASE/api/content/admin/items" -H "$AUTH_WRITER_HI" -H 'Content-Type: application/json' -d "{
  \"event\": \"$RUN_IN_EVENT\", \"language\": \"en\", \"format\": \"REVISION_NOTE\",
  \"title\": \"English note from Hindi-scoped writer\", \"body\": \"This must be rejected because the Hindi-scoped writer's explicit language scope excludes English representations under the platform's staff scope rules.\"
}")
check "Hindi-scoped writer on EN item → 403 LANGUAGE_SCOPE" "LANGUAGE_SCOPE" "$(printf '%s' "$HI_CREATE" | json "d['error']['code']")"

# IN admin publishes the writer's submission (the §18 editor handoff).
IN_PUBLISH=$(curl -s -X POST "$BASE/api/content/admin/items/$WRITER_ITEM/transition" -H "$AUTH_IN" -H 'Content-Type: application/json' -d '{"action":"publish"}')
check "IN admin publishes the writer's submission" "PUBLISHED" "$(printf '%s' "$IN_PUBLISH" | json "d['data']['item']['status']")"

# IN admin cannot manage GLOBAL event representations (§14 object scoping).
IN_GLOBAL_EDIT=$(curl -s -X PATCH "$BASE/api/content/admin/items/$(printf '%s' "$LIST" | json "[i['id'] for i in d['data']['items'] if i['language']['code']=='en'][0]")" -H "$AUTH_IN" -H 'Content-Type: application/json' -d '{"title":"IN admin edit on a global event"}')
check "IN admin edit on GLOBAL event item → 403" "GLOBAL_CONTENT_ADMIN_ONLY" "$(printf '%s' "$IN_GLOBAL_EDIT" | json "d['error']['code']")"

echo ""
echo "===== 6. Search integration (§17: CURRENT_EVENT + freshness + events filter) ====="

SEARCH=$(curl -s "$BASE/api/search?q=chandrayaan&country=IN")
check_contains "search finds the CURRENT_EVENT result" "CURRENT_EVENT" "$(printf '%s' "$SEARCH" | json "[r['objectType'] for r in d['data']['results']].__str__()")"
check_contains "event result path is the §16 event page" "/current-affairs/$CHANDRAYAAN/" "$(printf '%s' "$SEARCH" | json "[r['urlPath'] for r in d['data']['results'] if r['objectType']=='CURRENT_EVENT'][0]")"
EVENTS_FILTER=$(curl -s "$BASE/api/search?q=chandrayaan&country=IN&type=events")
check "events filter: only CURRENT_EVENT results" "True" "$(printf '%s' "$EVENTS_FILTER" | python3 -c "import json,sys;d=json.load(sys.stdin);print(all(r['objectType']=='CURRENT_EVENT' for r in d['data']['results']))")"
check "events filter finds the event" "$CHANDRAYAAN" "$(printf '%s' "$EVENTS_FILTER" | json "[r['ref'] for r in d['data']['results'] if r['objectType']=='CURRENT_EVENT'][0]")"

# Hindi search reaches the Hindi event document (language-aware FTS, §17.4).
SEARCH_HI=$(curl -s "$BASE/api/search?q=%E0%A4%9A%E0%A4%82%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%AF%E0%A4%BE%E0%A4%A8&country=IN&language=hi")
check "Hindi query finds the event (hi document)" "$CHANDRAYAAN" "$(printf '%s' "$SEARCH_HI" | json "next((r['ref'] for r in d['data']['results'] if r['objectType']=='CURRENT_EVENT'), 'missing')")"

echo ""
echo "===== 7. Homepage discovery (§34) + sitemap (§16) ====="

HOME=$(curl -s "$BASE/api/home?country=IN")
HOME_EVENTS=$(printf '%s' "$HOME" | python3 -c "import json,sys;d=json.load(sys.stdin);print(' '.join(e['slug'] for e in d['data']['currentAffairs']['items']))")
check "homepage current affairs available" "True" "$(printf '%s' "$HOME" | json "d['data']['currentAffairs']['available']")"
check_contains "homepage lists the Chandrayaan event" "$CHANDRAYAAN" "$HOME_EVENTS"
check_contains "homepage lists the Space Day event" "$SPACE_DAY" "$HOME_EVENTS"
check_contains "homepage lists the archived G20 event" "$G20" "$HOME_EVENTS"
check_contains "homepage card carries the §16 path" "/current-affairs/$CHANDRAYAAN/" "$(printf '%s' "$HOME" | json "[e['canonicalPath'] for e in d['data']['currentAffairs']['items'] if e['slug']=='$CHANDRAYAAN'][0]")"

SITEMAP=$(curl -s "$BASE/api/seo/sitemap?country=IN&language=en&type=current-affairs")
check_contains "sitemap lists the event URL" "/current-affairs/$CHANDRAYAAN/" "$SITEMAP"
check_contains "sitemap lists the per-run event (just published)" "/current-affairs/$RUN_EVENT/" "$SITEMAP"
check_not_contains "sitemap omits the space-day Hindi draft-only slug from EN" "<loc>https://placeholder/current-affairs/$SPACE_DAY-hi</loc>" "$SITEMAP"
HINDI_SITEMAP=$(curl -s "$BASE/api/seo/sitemap?country=IN&language=hi&type=current-affairs")
check_contains "Hindi sitemap lists the Chandrayaan hi variant" "/hi/current-affairs/$CHANDRAYAAN/" "$HINDI_SITEMAP"

echo ""
echo "===== 8. Public-content boundary + cleanup (§36 — nothing hard-deleted) ====="

# An event representation's public surface is the event page — the standalone
# item read 404s with the honest pointer.
ITEM_READ=$(curl -s "$BASE/api/content/items/$RUN_ITEM?country=IN")
check "standalone item read for event representation → 404 pointer" "CONTENT_NOT_VISIBLE" "$(printf '%s' "$ITEM_READ" | json "d['error']['code']")"

# Cleanup: retire the run's representations and archive the run's events
# (§36 honest tombstones, never hard deletes).
curl -s -X POST "$BASE/api/content/admin/items/$RUN_ITEM/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"action":"retire"}' > /dev/null
curl -s -X POST "$BASE/api/content/admin/items/$WRITER_ITEM/transition" -H "$AUTH_IN" -H 'Content-Type: application/json' -d '{"action":"retire"}' > /dev/null
RETIRED_LIST=$(curl -s "$BASE/api/content/admin/items?event=$RUN_EVENT&status=RETIRED" -H "$AUTH_ADMIN")
check "run fixture retired (tombstone)" "RETIRED" "$(printf '%s' "$RETIRED_LIST" | json "d['data']['items'][0]['status']")"
# Retiring the only representation withdraws the public page (§35).
check_http "run event page withdrawn after its only representation retired" 404 GET "$BASE/api/current-affairs/page/$RUN_EVENT?country=IN"
RUN_EVENT_ID=$(printf '%s' "$RUN_EVENT_CREATED" | json "d['data']['event']['id']")
RUN_IN_EVENT_ID=$(printf '%s' "$RUN_IN_EVENT_CREATED" | json "d['data']['event']['id']")
curl -s -X POST "$BASE/api/current-affairs/admin/events/$RUN_EVENT_ID/transition" -H "$AUTH_ADMIN" -H 'Content-Type: application/json' -d '{"to":"ARCHIVED","reason":"P6-S2 verification run complete — archived tombstone (§36)"}' > /dev/null
curl -s -X POST "$BASE/api/current-affairs/admin/events/$RUN_IN_EVENT_ID/transition" -H "$AUTH_IN" -H 'Content-Type: application/json' -d '{"to":"ARCHIVED","reason":"P6-S2 verification run complete — archived tombstone (§36)"}' > /dev/null
RUN_EVENT_AFTER=$(curl -s "$BASE/api/current-affairs/admin/events/$RUN_EVENT_ID" -H "$AUTH_ADMIN")
check "run event archived (§36 tombstone)" "ARCHIVED" "$(printf '%s' "$RUN_EVENT_AFTER" | json "d['data']['event']['lifecycleState']")"

echo ""
echo "=============================================="
echo "P6-S2 HTTP suite: $PASS passed, $FAIL failed"
echo "=============================================="
[ "$FAIL" -eq 0 ]
