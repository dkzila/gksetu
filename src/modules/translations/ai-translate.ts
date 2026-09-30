/**
 * GlobIQ — Translations module: the §26 AI translation assist (P9-S1)
 *
 * Master Plan §26: "AI may assist … Translate/localise drafts." — and the
 * hard rule rides every call: AI must NEVER silently invent facts or alter
 * canonical data. This module is therefore a DRAFT GENERATOR and nothing
 * else:
 *   - Input: the SOURCE's current PUBLISHED revision (title + body) — never
 *     a working copy, never canonical records.
 *   - Output: a translated working copy for the TARGET representation,
 *     which lands in DRAFT status and must clear the full §19 workflow
 *     (including the §19 step-5 localisation review) before it can go live.
 *     The aiAssisted provenance flag is set on both the target and the
 *     translation link (§26 "carries provenance/status metadata").
 *   - Structure preservation (§23): the prompt instructs the model to keep
 *     FACT_CARD lines, TIMELINE "date — event" lines, COMPARISON pipe rows
 *     and PROFILE "key: value" lines structurally intact — the format-aware
 *     parsers stay honest.
 *
 * Backend-only by contract (z-ai-web-dev-sdk); the module is imported
 * exclusively from the translations service, which runs on the server.
 */
import ZAI from 'z-ai-web-dev-sdk'

import type { TranslationSourceTypePublic } from './types'

/** What the machine drafter needs about the source. */
export interface AiTranslateSource {
  sourceType: TranslationSourceTypePublic
  format: string
  title: string
  body: string
}

export interface AiTranslateTarget {
  languageCode: string
  languageName: string
  nativeName: string | null
}

export interface AiTranslateResult {
  title: string
  body: string
}

const FORMAT_RULES: Record<string, string> = {
  FACT_CARD:
    'The body is a compact fact card. Keep it compact and exam-focused; translate every sentence; do not add or drop facts.',
  EXPLAINER:
    'The body is explanatory prose in paragraphs. Translate paragraph by paragraph; keep every fact, name, date and article number exactly as given.',
  REVISION_NOTE:
    'The body is revision notes. Translate each note; keep every fact and figure exactly as given.',
  CURRENT_EVENT_UPDATE:
    'The body is a current-affairs update in paragraphs. Translate paragraph by paragraph; keep every fact, name and date exactly as given.',
  TIMELINE:
    'The body is one milestone per line in the exact shape "date — event". Keep exactly one " — " per line, keep the dates untranslated (e.g. "23 August 2023"), and translate the event text. Keep the same number of lines in the same order.',
  PROFILE:
    'The body is one "key: value" field per line. Keep exactly one ": " per line, translate BOTH the key and the value, and keep the same number of lines in the same order.',
  COMPARISON:
    'The body is a comparison table with one row per line in the exact shape "axis | left | right". Keep exactly two " | " separators per line and the same number of lines in the same order; translate the axis label and both sides.',
  QNA: 'The source is a question-and-answer pair. Translate the question and the full answer; keep every fact and legal term exactly as given (use the standard target-language legal terminology where one exists).',
}

function systemPrompt(target: AiTranslateTarget): string {
  const language = target.nativeName
    ? `${target.languageName} (${target.nativeName})`
    : target.languageName
  return [
    `You are a professional translator producing a DRAFT ${language} translation of published educational exam-preparation content for the GlobIQ platform.`,
    'Hard rules:',
    '1. Translate faithfully — every fact, name, date, number, article reference and quotation must survive exactly. Never invent, never omit, never "correct" facts.',
    '2. Translate IDs, dates in Latin numerals, and internationally standard symbols as-is.',
    '3. Use the standard target-language terminology for domain terms where it exists (e.g. standard legal or constitutional terms).',
    '4. Preserve the structure of the text exactly — paragraph breaks and line shapes are part of the data format.',
    '5. Output ONLY a JSON object of the shape {"title": string, "body": string} — no markdown fences, no commentary.',
  ].join('\n')
}

function userPrompt(source: AiTranslateSource, target: AiTranslateTarget): string {
  const rule = FORMAT_RULES[source.sourceType === 'QNA' ? 'QNA' : source.format] ?? FORMAT_RULES.EXPLAINER
  return [
    `Translate the following ${source.sourceType === 'QNA' ? 'question-and-answer entry' : `${source.format} content`} into ${target.nativeName ?? target.languageName}.`,
    `Format rule: ${rule}`,
    '',
    `TITLE${source.sourceType === 'QNA' ? ' (the question)' : ''}:`,
    source.title,
    '',
    `BODY${source.sourceType === 'QNA' ? ' (the answer)' : ''}:`,
    source.body,
    '',
    'Return the JSON object {"title": …, "body": …} with the translated title/question and body/answer only.',
  ].join('\n')
}

/** Extracts the first JSON object from a model reply (tolerates fences). */
function parseResult(content: string): AiTranslateResult | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]! : content
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as {
      title?: unknown
      body?: unknown
    }
    if (typeof parsed.title !== 'string' || typeof parsed.body !== 'string') return null
    if (!parsed.title.trim() || !parsed.body.trim()) return null
    return { title: parsed.title.trim(), body: parsed.body }
  } catch {
    return null
  }
}

/**
 * Generates the §26 machine draft. Throws `AiTranslateError` on any failure
 * (unavailable model, empty or malformed reply) — the caller surfaces a clean
 * error and NEVER persists partial state.
 */
export async function aiTranslateDraft(
  source: AiTranslateSource,
  target: AiTranslateTarget
): Promise<AiTranslateResult> {
  let completion: { choices?: Array<{ message?: { content?: string } }> }
  try {
    const zai = await ZAI.create()
    completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt(target) },
        { role: 'user', content: userPrompt(source, target) },
      ],
      thinking: { type: 'disabled' },
    })
  } catch (error) {
    console.error('[translations:ai-draft] model call failed:', error)
    throw new AiTranslateError('The translation model is unavailable right now — try again shortly')
  }

  const content = completion.choices?.[0]?.message?.content
  if (!content || !content.trim()) {
    throw new AiTranslateError('The translation model returned an empty draft — nothing was saved')
  }
  const parsed = parseResult(content)
  if (!parsed) {
    throw new AiTranslateError('The translation model returned a malformed draft — nothing was saved')
  }
  return parsed
}

export class AiTranslateError extends Error {
  readonly code = 'TRANSLATION_AI_UNAVAILABLE'
  readonly status = 503

  constructor(message: string) {
    super(message)
    this.name = 'AiTranslateError'
  }
}
