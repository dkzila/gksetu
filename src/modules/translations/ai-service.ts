/**
 * GKSetu — Translations module: the §26 AI-draft service (P9-S1, SERVER-ONLY)
 *
 * This file is imported EXCLUSIVELY by its API route — it is deliberately
 * NEVER re-exported through the module barrel. Client components reach the
 * translations module's graph via the analytics barrel (the §32 metrics) and
 * the console sections; the z-ai SDK is backend-only, so the model call is
 * isolated here, one hop beyond every client-reachable import chain.
 *
 * Master Plan §26 "Translate/localise drafts" with the hard rules structural:
 *   - the model translates the SOURCE's current PUBLISHED revision (never a
 *     draft, never canonical records — AI is an augmentation layer over
 *     structured truth);
 *   - the result lands in the TARGET's DRAFT working copy ONLY (409 when the
 *     target has moved past DRAFT);
 *   - provenance is recorded on both the target (aiAssisted, frozen onto the
 *     revision at publish time) and the link;
 *   - nothing is ever auto-published — the §19 workflow (including the step-5
 *     localisation review) is the human gate, and the response states it.
 * A failed or malformed model reply leaves NO partial state (clean 503).
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
} from '@/modules/audit'

import { aiTranslateDraft } from './ai-translate'
import {
  loadTranslationDto,
  resolveRepresentations,
  TranslationError,
  type TranslationRequestMeta,
} from './service'
import type {
  TranslationDto,
  TranslationSourceTypePublic,
} from './types'

export async function generateAiDraft(
  actor: Actor,
  translationId: string,
  meta: TranslationRequestMeta = {}
): Promise<{ translation: TranslationDto; contract: string }> {
  const link = await db.translation.findUnique({
    where: { id: translationId },
    include: { language: true },
  })
  if (!link) throw new TranslationError('TRANSLATION_NOT_FOUND', 'Translation link not found')
  if (link.status === 'RETIRED') {
    throw new TranslationError('TRANSLATION_NOT_DRAFT', 'This translation link is retired')
  }
  if (link.status !== 'DRAFT') {
    throw new TranslationError(
      'TRANSLATION_NOT_DRAFT',
      'The AI drafter only fills translations that have not published yet — a published translation refreshes through the normal §19 correction cycle'
    )
  }

  const sourceMap = await resolveRepresentations(
    link.sourceContentType as TranslationSourceTypePublic,
    [link.sourceContentId]
  )
  const source = sourceMap.get(link.sourceContentId)
  if (!source || source.liveRevisionNumber == null || source.liveTitle == null || source.liveBody == null) {
    throw new TranslationError('SOURCE_NOT_PUBLISHED', 'The source no longer has a published revision to translate from')
  }

  const targetMap = await resolveRepresentations(
    link.targetContentType as TranslationSourceTypePublic,
    [link.targetContentId]
  )
  const target = targetMap.get(link.targetContentId)
  if (!target) throw new TranslationError('TRANSLATION_NOT_FOUND', 'The target representation was not found')
  if (target.status !== 'DRAFT') {
    throw new TranslationError(
      'TARGET_NOT_DRAFT',
      'The machine draft can only fill a DRAFT working copy — submit it for review only after the human pass (§26)'
    )
  }

  assertCan(actor, 'translations:manage', { countryId: target.countryId, languageId: link.languageId })

  // §26: the model call runs OUTSIDE any transaction — a failed or malformed
  // reply never leaves partial state (the target's working copy stands).
  let draft: { title: string; body: string }
  try {
    draft = await aiTranslateDraft(
      {
        sourceType: link.sourceContentType as TranslationSourceTypePublic,
        format: source.format ?? 'EXPLAINER',
        title: source.liveTitle,
        body: source.liveBody,
      },
      { languageCode: link.language.code, languageName: link.language.name, nativeName: link.language.nativeName }
    )
  } catch (modelError) {
    // The model's own message is honest (unavailable / empty / malformed) —
    // surfaced through the uniform TranslationError mapping.
    const message =
      modelError instanceof Error ? modelError.message : 'The translation model failed — nothing was saved'
    throw new TranslationError('TRANSLATION_AI_UNAVAILABLE', message)
  }

  await db.$transaction(async (tx) => {
    if (link.targetContentType === 'CONTENT_ITEM') {
      await tx.contentItem.update({
        where: { id: link.targetContentId },
        data: { title: draft.title, body: draft.body, aiAssisted: true },
      })
    } else {
      await tx.qnA.update({
        where: { id: link.targetContentId },
        data: { questionText: draft.title, answerBody: draft.body, aiAssisted: true },
      })
    }
    await tx.translation.update({
      where: { id: link.id },
      data: { aiAssisted: true, sourceRevisionNumber: source.liveRevisionNumber! },
    })
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.translationAiDraft,
    objectType: AUDIT_OBJECT_TYPES.translation,
    objectId: link.id,
    objectLabel: `${source.label} → ${link.language.code}`,
    before: { aiAssisted: link.aiAssisted, syncedSourceRevision: link.sourceRevisionNumber },
    after: { aiAssisted: true, syncedSourceRevision: source.liveRevisionNumber },
    metadata: {
      model: 'z-ai (§26 translation assist)',
      sourceRevisionNumber: source.liveRevisionNumber,
      targetWorkingCopy: 'replaced',
      reviewGate: '§19 workflow incl. step-5 localisation review — never auto-published',
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  }).catch(() => undefined)

  const refreshed = await loadTranslationDto(link.id)
  return {
    translation: refreshed!,
    contract:
      '§26: this is an AI-assisted DRAFT — provenance recorded on the target and the link; it must clear the §19 editorial workflow (including the localisation review) before anything goes live. AI never publishes silently.',
  }
}
