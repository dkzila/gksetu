#!/usr/bin/env python3
"""CONSOLE-S1-D verification: full CRUD + lifecycle round-trip on the
questions/qna/mock-tests admin surfaces against the live dev server.
Retries through transient compile hiccups (parallel agents editing).
Scratch file — delete after verification."""
import json
import sys
import time
import urllib.request

BASE = 'http://localhost:3000'


def call(method, path, token=None, body=None, retries=8):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(BASE + path, method=method)
            if token:
                req.add_header('Authorization', f'Bearer {token}')
            data = None
            if body is not None:
                req.add_header('Content-Type', 'application/json')
                data = json.dumps(body).encode()
            with urllib.request.urlopen(req, data=data, timeout=30) as resp:
                payload = json.loads(resp.read().decode())
                return resp.status, payload
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode())
            except Exception:
                pass  # HTML error page (dev server compiling) → retry
        except Exception:
            pass
        time.sleep(6)
    return 0, {'status': 'error', 'error': {'message': 'unreachable'}}


def ok(payload):
    return payload.get('status') == 'ok'


def die(msg):
    print(f'FAIL: {msg}')
    sys.exit(1)


# ---- 1. login ----
status, payload = call('POST', '/api/auth/login', body={'email': 'admin@gksetu.dev', 'password': 'GKSetu-Dev-Admin-1'})
if not ok(payload):
    die(f'login: {payload}')
TOKEN = payload['data']['grant']['token']
print('✓ login as admin@gksetu.dev')

# ---- 2. list all three surfaces (the pages' GETs) ----
for path, label in [
    ('/api/questions/admin?status=PUBLISHED&language=en&pageSize=5', 'questions (status+language filters)'),
    ('/api/questions/admin?unit=ashoka-kalinga-war-261-bce&q=Kalinga&pageSize=5', 'questions (unit+q filters)'),
    ('/api/qna/admin?status=PUBLISHED&pageSize=5', 'qna (status filter)'),
    ('/api/mock-tests/admin?scope=EXAM&language=en&pageSize=5', 'mock-tests (scope+language filters)'),
    ('/api/languages', 'languages (create-form source)'),
    ('/api/exams?country=IN&pageSize=5', 'exams (exam-anchor source)'),
]:
    status, payload = call('GET', path, TOKEN)
    if not ok(payload):
        die(f'{label}: {payload.get("error")}')
    print(f'✓ GET {label}')

# ---- 3. questions round-trip: create → patch → submit_review → publish → republish (change summary) → retire ----
status, payload = call('POST', '/api/questions/admin', TOKEN, {
    'unit': 'ashoka-kalinga-war-261-bce', 'language': 'en', 'type': 'MCQ', 'difficulty': 'BASIC',
    'questionText': 'SCRATCH-CONSOLE-D: In which year did the Kalinga War take place?',
    'options': ['261 BCE', '232 BCE', '185 BCE', '323 BCE'], 'correctIndex': 0,
    'explanation': 'The Kalinga War was fought circa 261 BCE by Ashoka — the console-D scratch verification entry.',
    'aiAssisted': False,
})
if status != 201 or not ok(payload):
    die(f'question create: {payload.get("error")}')
QID = payload['data']['item']['id']
assert payload['data']['item']['status'] == 'DRAFT'
print(f'✓ question created (DRAFT) id={QID}')

status, payload = call('PATCH', f'/api/questions/admin/{QID}', TOKEN, {
    'options': ['261 BCE', '232 BCE', '185 BCE', '323 BCE'], 'correctIndex': 0,
    'explanation': 'PATCHED: The Kalinga War was fought circa 261 BCE by Ashoka — console-D scratch, updated working copy.',
    'difficulty': 'INTERMEDIATE', 'aiAssisted': False,
})
if not ok(payload):
    die(f'question patch: {payload.get("error")}')
print('✓ question working copy patched')

for action, expect in [
    ('submit_review', 'IN_REVIEW'),
    ('publish', 'PUBLISHED'),
]:
    status, payload = call('POST', f'/api/questions/admin/{QID}/transition', TOKEN, {'action': action})
    if not ok(payload) or payload['data']['item']['status'] != expect:
        die(f'question {action}: {payload.get("error") or payload["data"]["item"]["status"]}')
    print(f'✓ question {action} → {expect}')

# republish (correction) requires changeSummary + real change
status, payload = call('PATCH', f'/api/questions/admin/{QID}', TOKEN, {
    'explanation': 'PATCHED-2: corrected explanation — the console-D scratch republish path.',
})
if not ok(payload):
    die(f'question patch 2: {payload.get("error")}')
status, payload = call('POST', f'/api/questions/admin/{QID}/transition', TOKEN, {
    'action': 'publish', 'changeSummary': 'Console-D scratch correction test',
})
if not ok(payload) or payload['data']['item']['liveRevision']['revisionNumber'] != 2:
    die(f'question republish: {payload.get("error") or "revision != 2"}')
print('✓ question republished → revision 2 (change summary)')

status, payload = call('POST', f'/api/questions/admin/{QID}/transition', TOKEN, {'action': 'retire'})
if not ok(payload) or payload['data']['item']['status'] != 'RETIRED':
    die(f'question retire: {payload.get("error")}')
print('✓ question retired (cleanup — the API has no DELETE; retire is end-of-life)')

# ---- 4. qna round-trip: create → submit → send_back → submit → publish → retire ----
status, payload = call('POST', '/api/qna/admin', TOKEN, {
    'unit': 'ashoka-kalinga-war-261-bce', 'language': 'en',
    'questionText': 'SCRATCH-CONSOLE-D: Why is the Kalinga War a turning point in Indian history?',
    'answerBody': 'The Kalinga War (circa 261 BCE) is the turning point where Ashoka, shaken by the carnage, renounced military conquest and embraced Dhamma — redirecting Mauryan statecraft toward welfare, and patronising the spread of Buddhism beyond India. This is the console-D scratch verification entry.',
    'aiAssisted': False,
})
if status != 201 or not ok(payload):
    die(f'qna create: {payload.get("error")}')
QNA_ID = payload['data']['item']['id']
print(f'✓ qna created (DRAFT) id={QNA_ID}')

status, payload = call('PATCH', f'/api/qna/admin/{QNA_ID}', TOKEN, {'aiAssisted': True})
if not ok(payload):
    die(f'qna patch: {payload.get("error")}')
print('✓ qna working copy patched (aiAssisted flag)')

for action, expect in [('submit_review', 'IN_REVIEW'), ('send_back', 'DRAFT'), ('submit_review', 'IN_REVIEW'), ('publish', 'PUBLISHED')]:
    status, payload = call('POST', f'/api/qna/admin/{QNA_ID}/transition', TOKEN, {'action': action})
    if not ok(payload) or payload['data']['item']['status'] != expect:
        die(f'qna {action}: {payload.get("error") or payload["data"]["item"]["status"]}')
    print(f'✓ qna {action} → {expect}')

status, payload = call('POST', f'/api/qna/admin/{QNA_ID}/transition', TOKEN, {'action': 'retire'})
if not ok(payload):
    die(f'qna retire: {payload.get("error")}')
print('✓ qna retired (cleanup)')

# ---- 5. mock-test round-trip: create (composed of 2 published questions) → patch → publish → retire ----
status, payload = call('GET', '/api/questions/admin?status=PUBLISHED&language=en&pageSize=5', TOKEN)
if not ok(payload):
    die(f'pool list: {payload.get("error")}')
POOL = [item['id'] for item in payload['data']['items']][:3]
if len(POOL) < 2:
    die('not enough published en questions to compose a test')
status, payload = call('POST', '/api/mock-tests/admin', TOKEN, {
    'title': 'SCRATCH-CONSOLE-D: Verification Sprint', 'language': 'en', 'scopeType': 'EXAM',
    'examSlug': 'upsc-civil-services', 'examVersionLabel': '2026 syllabus',
    'questionIds': POOL[:2], 'durationMinutes': 5, 'passPercent': 50, 'aiAssisted': False,
})
if status != 201 or not ok(payload):
    die(f'mock-test create: {payload.get("error")}')
MT_ID = payload['data']['item']['id']
print(f'✓ mock test created (DRAFT) id={MT_ID} slug={payload["data"]["item"]["slug"]}')

status, payload = call('GET', f'/api/mock-tests/admin/{MT_ID}', TOKEN)
if not ok(payload) or len(payload['data']['item']['questions']) != 2:
    die(f'mock-test detail (composition health): {payload.get("error")}')
print('✓ mock-test detail serves the composed questions')

status, payload = call('PATCH', f'/api/mock-tests/admin/{MT_ID}', TOKEN, {
    'questionIds': POOL[:3], 'durationMinutes': 8, 'passPercent': 60,
})
if not ok(payload) or payload['data']['item']['questionCount'] != 3:
    die(f'mock-test patch: {payload.get("error")}')
print('✓ mock-test working copy patched (3 questions, 8 min, 60%)')

for action, expect in [('submit_review', 'IN_REVIEW'), ('publish', 'PUBLISHED')]:
    status, payload = call('POST', f'/api/mock-tests/admin/{MT_ID}/transition', TOKEN, {'action': action})
    if not ok(payload) or payload['data']['item']['status'] != expect:
        die(f'mock-test {action}: {payload.get("error") or payload["data"]["item"]["status"]}')
    print(f'✓ mock-test {action} → {expect}')

SLUG = payload['data']['item']['slug']
status, payload = call('GET', f'/api/mock-tests/{SLUG}', TOKEN)
if not ok(payload):
    die(f'public runner detail: {payload.get("error")}')
print(f'✓ public runner serves /exams/upsc-civil-services/mock-tests/{SLUG}')

status, payload = call('POST', f'/api/mock-tests/admin/{MT_ID}/transition', TOKEN, {'action': 'retire'})
if not ok(payload):
    die(f'mock-test retire: {payload.get("error")}')
print('✓ mock-test retired (cleanup)')

# ---- 6. schedule-path validation (the dialog's required datetime) ----
status, payload = call('POST', '/api/questions/admin', TOKEN, {
    'unit': 'ashoka-kalinga-war-261-bce', 'language': 'en', 'type': 'MCQ', 'difficulty': 'BASIC',
    'questionText': "SCRATCH-CONSOLE-D: Which edict records Ashoka's remorse after Kalinga?",
    'options': ['The 13th Major Rock Edict', 'The 7th Pillar Edict', 'The Bhabru Edict', 'The Kandahar Bilingual'],
    'correctIndex': 0,
    'explanation': "The 13th Major Rock Edict records Ashoka's remorse after the Kalinga War — console-D scratch schedule-path entry.",
    'aiAssisted': False,
})
if not ok(payload):
    die(f'schedule scratch create: {payload.get("error")}')
S_ID = payload['data']['item']['id']
call('POST', f'/api/questions/admin/{S_ID}/transition', TOKEN, {'action': 'submit_review'})
status, payload = call('POST', f'/api/questions/admin/{S_ID}/transition', TOKEN, {
    'action': 'schedule', 'scheduledFor': '2030-01-01T09:00:00.000Z',
})
if not ok(payload) or payload['data']['item']['status'] != 'SCHEDULED':
    die(f'schedule: {payload.get("error")}')
print('✓ question scheduled for 2030 release (the schedule dialog path)')
status, payload = call('POST', f'/api/questions/admin/{S_ID}/transition', TOKEN, {'action': 'send_back'})
if not ok(payload):
    die(f'unschedule: {payload.get("error")}')
print('✓ question sent back (unschedule) → DRAFT')
status, payload = call('POST', f'/api/questions/admin/{S_ID}/transition', TOKEN, {'action': 'retire'})
if not ok(payload):
    die(f'scratch retire: {payload.get("error")}')
print('✓ scratch question retired (cleanup)')

print()
print('ALL CONSOLE-S1-D VERIFICATIONS PASSED')
