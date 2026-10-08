#!/bin/bash
# SITE-S26: Translation runner — loops over all subjects × all languages.
# Each subject×lang is a separate `bun scripts/s26-translate-one.ts` invocation.
# Robust: a crash only loses the current batch; the loop continues.
#
# Usage:
#   bash scripts/s26-run-translator.sh                # all subjects, 50 MCQs each
#   bash scripts/s26-run-translator.sh 30             # 30 MCQs per subject per lang

cd /home/z/my-project/work/globiq

LIMIT="${1:-50}"
LANGS_ARG="en bn gu kn ml mr or ta te"

# Get all subjects with content (non-empty JSON files with Hindi MCQs)
SUBJECTS=$(python3 -c "
import json, glob, os
for f in sorted(glob.glob('scripts/s25-data/*.json')):
    try:
        d = json.load(open(f))
        if isinstance(d, list) and len(d) > 0:
            slug = os.path.basename(f).replace('.json','')
            hindi = [m for m in d if m.get('language') == 'hi']
            if hindi:
                print(slug)
    except: pass
")

TOTAL_SUBJECTS=$(echo "$SUBJECTS" | wc -l)
echo "SITE-S26 translator: $TOTAL_SUBJECTS subjects × $LANGS_ARG × $LIMIT MCQs/lang"
echo "Started at: $(date)"
echo ""

i=0
for slug in $SUBJECTS; do
  i=$((i + 1))
  for lang in $LANGS_ARG; do
    # Run translator for one subject × one language.
    # Run directly (no subshell capture) — the bun process writes its own output.
    bun scripts/s26-translate-one.ts --slug "$slug" --lang "$lang" --limit "$LIMIT" --batch-size 8 2>/dev/null
    # Continue regardless of exit code (the bun process may crash on SDK errors,
    # but each invocation has already saved its progress to the JSON cache file)
  done
  # Progress heartbeat every 3 subjects
  TOTAL=$(python3 -c "
import json, glob
t=0
for f in glob.glob('scripts/s25-data/translations/*/*.json'):
    try: t += len(json.load(open(f)))
    except: pass
print(t)
" 2>/dev/null)
  echo "  --- [$i/$TOTAL_SUBJECTS done] total translations: $TOTAL ---"
done

echo ""
echo "========== ALL SUBJECTS DONE at $(date) =========="
python3 -c "
import json, glob
t=0; by_lang={}
for f in glob.glob('scripts/s25-data/translations/*/*.json'):
    lang = f.split('/')[-1].replace('.json','')
    try:
        d = json.load(open(f))
        if isinstance(d, list):
            t += len(d)
            by_lang[lang] = by_lang.get(lang, 0) + len(d)
    except: pass
print(f'Total translations: {t}')
for lang, c in sorted(by_lang.items()):
    print(f'  {lang}: {c}')
"
