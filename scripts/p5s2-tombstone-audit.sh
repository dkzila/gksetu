#!/bin/bash
# GlobIQ — P5-S2 phase 2: §10 tombstone fixture + audit rows + follow regression
# The tombstone case cannot be produced via the API (retired objects are
# correctly not savable anymore) — the fixture simulates a PRE-retirement save
# by inserting the row the API would have written, then asserting the honest
# §36 listing. Cleaned up afterwards.
set -u
BASE="http://localhost:3000"
PASS=0; FAIL=0
SUFFIX=$(date +%s)
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 — expected [$2] got [$3]"; fi; }
json() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1], {'d': d}))" "$1" 2>/dev/null; }

# Fresh user for the tombstone fixture
REG=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"p5s2-tomb-$SUFFIX@test.dev\",\"password\":\"TestPass-123\",\"name\":\"Tomb Reader\",\"homeCountryIso\":\"IN\"}")
TOKEN=$(printf '%s' "$REG" | json "d['data']['grant']['token']")
USER_ID=$(printf '%s' "$REG" | json "d['data']['user']['id']")
check "register tombstone reader" "ok" "$(printf '%s' "$REG" | json "d['status']")"
AUTH="Authorization: Bearer $TOKEN"

# One real save first (bootstraps the default collection)
R=$(curl -s -X POST "$BASE/api/saves" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"objectType":"KNOWLEDGE_UNIT","objectRef":"fall-of-the-berlin-wall-1989"}')
check "seed save for collection bootstrap" "ok" "$(printf '%s' "$R" | json "d['status']")"
DEFAULT_COLLECTION_ID=$(printf '%s' "$R" | json "d['data']['save']['collectionId']")

# ---------- §10 tombstone fixture: a save of the now-RETIRED UNSC fact card ----------
cat > /tmp/tombstone.mjs << 'EOF'
import { db } from '/home/z/my-project/src/lib/db.ts'
const [userId, collectionId] = process.argv.slice(2)
// The row the API would have written before the item was retired (§36).
const row = await db.savedItem.create({
  data: {
    userId,
    objectType: 'CONTENT_ITEM',
    objectId: 'cmuhwy0rj0005j1d4z3jjoq6x', // RETIRED UNSC FACT_CARD (live revision exists)
    collectionId,
  },
})
console.log(row.id)
process.exit(0)
EOF
TOMB_ID=$(bun run /tmp/tombstone.mjs "$USER_ID" "$DEFAULT_COLLECTION_ID" | tail -1)
check "tombstone fixture row inserted" "c" "$(printf '%s' "$TOMB_ID" | cut -c1-1)"

L=$(curl -s "$BASE/api/saves" -H "$AUTH")
TOMB_FIELDS=$(printf '%s' "$L" | python3 -c "
import json,sys
d = json.load(sys.stdin)
item = [i for i in d['data']['items'] if i['id'] == '$TOMB_ID'][0]
print(item['objectType'])
print(item['object']['status'])
print(item['object']['title'])
print(item['object']['format'])
print(item['object']['canonicalPath'])
")
check "tombstone stays listed (§10 — never silently disappears)" "CONTENT_ITEM" "$(sed -n 1p <<< "$TOMB_FIELDS")"
check "tombstone honest status RETIRED (§36)" "RETIRED" "$(sed -n 2p <<< "$TOMB_FIELDS")"
check "tombstone title from the live revision" "UNSC — Quick Facts" "$(sed -n 3p <<< "$TOMB_FIELDS")"
check "tombstone format preserved" "FACT_CARD" "$(sed -n 4p <<< "$TOMB_FIELDS")"
check "tombstone path resolves to the unit page" "/gk/united-nations/un-security-council-permanent-members/" "$(sed -n 5p <<< "$TOMB_FIELDS")"
TS=$(curl -s "$BASE/api/saves/state?objectType=CONTENT_ITEM&objectRef=cmuhwy0rj0005j1d4z3jjoq6x" -H "$AUTH")
check "tombstone state truthful — saved true" "True" "$(printf '%s' "$TS" | json "d['data']['saved']")"
check "tombstone state truthful — objectFound true" "True" "$(printf '%s' "$TS" | json "d['data']['objectFound']")"

# Cleanup: remove the fixture row (keeps Supabase free of synthetic saves)
DEL=$(curl -s -X DELETE "$BASE/api/saves/$TOMB_ID" -H "$AUTH")
check "tombstone fixture removed via the real API" "True" "$(printf '%s' "$DEL" | json "d['data']['removed']")"

# ---------- Audit rows (§19/§30 accountability) ----------
cat > /tmp/audit.mjs << 'EOF'
import { db } from '/home/z/my-project/src/lib/db.ts'
const actions = await db.auditLog.groupBy({
  by: ['action'],
  where: { action: { startsWith: 'user.save.' } },
  _count: { action: true },
})
const collectionActions = await db.auditLog.groupBy({
  by: ['action'],
  where: { action: { startsWith: 'user.collection.' } },
  _count: { action: true },
})
for (const a of [...actions, ...collectionActions]) console.log(`${a.action}=${a._count.action}`)
const objectTypes = await db.auditLog.findMany({
  where: { objectType: { in: ['SavedItem', 'Collection'] } },
  select: { objectType: true, objectLabel: true },
  take: 3,
})
for (const o of objectTypes) console.log(`ROW ${o.objectType} ${o.objectLabel ?? ''}`)
process.exit(0)
EOF
AUDIT=$(bun run /tmp/audit.mjs)
check_contains() { case "$3" in *"$2"*) PASS=$((PASS+1)); echo "PASS  $1";; *) FAIL=$((FAIL+1)); echo "FAIL  $1 — missing [$2] in: $3";; esac; }
check_contains "audit: user.save.create rows exist" "user.save.create=" "$AUDIT"
check_contains "audit: user.save.remove rows exist" "user.save.remove=" "$AUDIT"
check_contains "audit: user.save.move rows exist" "user.save.move=" "$AUDIT"
check_contains "audit: user.collection.create rows exist" "user.collection.create=" "$AUDIT"
check_contains "audit: user.collection.update rows exist" "user.collection.update=" "$AUDIT"
check_contains "audit: user.collection.remove rows exist" "user.collection.remove=" "$AUDIT"
check_contains "audit: SavedItem object type" "ROW SavedItem" "$AUDIT"
check_contains "audit: Collection object type" "ROW Collection" "$AUDIT"

# ---------- Follow-half regression after the shared §16 path fix ----------
F1=$(curl -s -X POST "$BASE/api/follows" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"objectType":"TOPIC","objectRef":"polity-governance"}')
check "follow regression: topic follow ok" "ok" "$(printf '%s' "$F1" | json "d['status']")"
F2=$(curl -s "$BASE/api/follows?language=hi" -H "$AUTH")
check "follow regression: hi label (§35 chain)" "राजव्यवस्था और शासन" "$(printf '%s' "$F2" | json "d['data']['items'][0]['object']['label']")"
check "follow regression: GLOBAL topic hi path (§16 fix)" "/hi/gk/polity-governance/" "$(printf '%s' "$F2" | json "d['data']['items'][0]['object']['canonicalPath']")"
F3=$(curl -s "$BASE/api/follows" -H "$AUTH")
check "follow regression: default-market path stays canonical" "/gk/polity-governance/" "$(printf '%s' "$F3" | json "d['data']['items'][0]['object']['canonicalPath']")"

# ---------- Public regression sweep ----------
for ENTRY in "health" "countries" "taxonomy/tree?country=IN" "taxonomy/search?q=polity&country=IN" "knowledge/units?topic=fundamental-rights&country=IN" "content/items?unit=fundamental-rights-articles-12-35&country=IN" "exams?country=IN" "exams/upsc-civil-services?country=IN" "search?q=constitution&country=IN" "home?country=IN" "seo/sitemap" "seo/robots" "seo/status" "knowledge/page/fundamental-rights-articles-12-35?country=IN"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/$ENTRY")
  check "public sweep /api/$ENTRY → 200" "200" "$CODE"
done

echo ""
echo "RESULTS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "SUITE: ALL GREEN" || echo "SUITE: FAILURES PRESENT"
