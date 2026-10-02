'use client'

/**
 * GKSetu — the shared inline practice list (SITE-S8-B, the SITE-S8 plan's
 * extraction; unified from mcq-view + pyq-view's year mode).
 *
 * The ONE one-tap practice surface: every question card renders its options
 * as positional A/B/C/D buttons; a single tap commits through POST
 * /api/questions/practice (the §37 server-truth contract — the answer key is
 * NEVER in any listing payload) and the reveal — correct/incorrect + the
 * explanation — ships for that one question only. The card locks after its
 * verdict. A running score ("N answered · M correct") counts exactly what is
 * on screen, and optional "Asked in …" provenance badges ride the shared
 * ProvenanceBadgeLine.
 *
 * Consumers: /mcq/ (mcq-view), /pyq/{exam}/{year}/ (pyq-view) and the
 * tutorial chapter reader's Practice and Previous-year-questions blocks.
 * Views keep their listing chrome (filters, pagination, headings) and own
 * the questions array — this component owns only the answer mechanics.
 */
import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Target, XCircle } from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import { ProvenanceBadgeLine } from '@/components/assessment/provenance-badges'
import type { ProvenanceBadgeItem } from '@/components/assessment/provenance-badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// ---------- The question shape (a structural subset of PracticeQuestionCard) ----------

/** Any card the practice engine serves: mcq-view's, pyq-view's or the
 * tutorial reader's — options are positional LABELS only; the letter keys
 * (A/B/C/…) are re-derived by index, matching the keys the answer-check
 * endpoint scores against. */
export interface InlinePracticeQuestion {
  id: string
  questionText: string
  options: string[]
  difficulty: string
  subject?: { slug: string; label: string } | null
  unit?: { slug: string; canonicalName: string; topicSlug: string } | null
  /** Exam-sitting appearances ("Asked in UPSC CSE · 2021") — nothing renders when empty. */
  provenance?: ProvenanceBadgeItem[]
}

/** POST /api/questions/practice → data.result — the ONLY public path where
 * correctAnswer + explanation ship, and only for the question just answered. */
interface PracticeAnswerResult {
  questionId: string
  selected: string
  correct: boolean
  correctAnswer: string
  explanation: string
}

/** One committed answer + the server's verdict (view-local state — §22's
 * practice is judged in the moment; nothing is persisted). */
interface RevealState {
  selectedIndex: number
  correct: boolean
  correctIndex: number | null
  correctAnswer: string
  explanation: string
}

// ---------- Presentation constants ----------

/** Positional option keys — the letters the answer key scores against. */
const OPTION_LETTERS: string[] = ['A', 'B', 'C', 'D', 'E', 'F']

/** Subtle difficulty chips (small — a hint, never a headline). */
const DIFFICULTY_STYLE: Record<string, string> = {
  BASIC: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

// ---------- One question card (the inline one-tap practice flow) ----------

interface QuestionCardProps {
  question: InlinePracticeQuestion
  reveal: RevealState | null
  pendingIndex: number | null
  error: string | null
  onCommit: (index: number) => void
}

export function InlinePracticeCard({ question, reveal, pendingIndex, error, onCommit }: QuestionCardProps) {
  // Locked while a check is in flight OR once revealed — one attempt per view.
  const locked = reveal !== null || pendingIndex !== null
  const difficultyStyle = DIFFICULTY_STYLE[question.difficulty]
  return (
    <Card className="py-0">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Meta row — difficulty hint + subject context (no technical badges) */}
        <div className="flex flex-wrap items-center gap-1.5">
          {difficultyStyle && (
            <Badge variant="outline" className={`text-[10px] font-medium ${difficultyStyle}`}>
              {question.difficulty}
            </Badge>
          )}
          {question.subject && (
            <Badge
              variant="outline"
              className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
            >
              {question.subject.label}
            </Badge>
          )}
        </div>
        <p className="text-sm font-semibold leading-snug text-zinc-800 sm:text-[15px]">
          {question.questionText}
        </p>

        {/* "Asked in …" provenance — where this question appeared; nothing
            renders for practice-original items. */}
        <ProvenanceBadgeLine items={question.provenance} />

        {/* Options — ONE TAP commits (server-scored); 44px touch targets */}
        <div className="space-y-1.5">
          {question.options.map((option, index) => {
            const letter = OPTION_LETTERS[index] ?? String(index + 1)
            const isPending = pendingIndex === index
            const isChosen = reveal !== null ? reveal.selectedIndex === index : isPending
            const isCorrectRow = reveal !== null && reveal.correctIndex === index
            const isWrongRow = reveal !== null && isChosen && !reveal.correct
            let rowClass: string
            let keyClass: string
            let textClass = 'text-zinc-700'
            if (isCorrectRow) {
              rowClass = 'border-emerald-400 bg-emerald-50'
              keyClass = 'border-emerald-500 bg-emerald-600 text-white'
            } else if (isWrongRow) {
              rowClass = 'border-red-300 bg-red-50'
              keyClass = 'border-red-400 bg-red-500 text-white'
            } else if (isChosen) {
              // The in-flight check on the committed row.
              rowClass = 'border-emerald-400 bg-emerald-50/60'
              keyClass = 'border-emerald-500 bg-emerald-600 text-white'
            } else if (reveal) {
              rowClass = 'border-zinc-200 bg-zinc-50/60'
              keyClass = 'border-zinc-200 bg-white text-zinc-400'
              textClass = 'text-zinc-400'
            } else {
              rowClass = 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
              keyClass = 'border-zinc-300 bg-white text-zinc-600'
            }
            return (
              <button
                key={letter}
                type="button"
                disabled={locked}
                onClick={() => onCommit(index)}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${rowClass}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-xs font-semibold ${keyClass}`}
                >
                  {letter}
                </span>
                <span className={`min-w-0 flex-1 text-sm leading-snug ${textClass}`}>{option}</span>
                {isPending && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" aria-hidden="true" />
                )}
                {isCorrectRow && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                )}
                {isWrongRow && <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />}
                <span className="sr-only">
                  {isChosen ? ' — your answer' : ''}
                  {isCorrectRow ? ' — the correct answer' : ''}
                </span>
              </button>
            )
          })}
        </div>

        {/* Inline check failure — the card stays tappable (retry by tapping again) */}
        {error && !reveal && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* The reveal — verdict + explanation, bordered, inline */}
        {reveal && (
          <div
            className={`rounded-lg border p-3 sm:p-4 ${
              reveal.correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
            }`}
          >
            <p
              className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${
                reveal.correct ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {reveal.correct ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {reveal.correct
                ? 'Correct'
                : `Not quite — the correct answer is ${
                    reveal.correctIndex !== null
                      ? (question.options[reveal.correctIndex] ?? reveal.correctAnswer)
                      : reveal.correctAnswer
                  }`}
            </p>
            {reveal.explanation && (
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">
                {reveal.explanation}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- The list (cards + the running score) ----------

export interface InlinePracticeScore {
  answered: number
  correct: number
}

export interface InlinePracticeProps {
  questions: InlinePracticeQuestion[]
  /** Optional heading rendered beside the live score badge (the section title). */
  heading?: string
  /** The list's accessible label (defaults to "Practice questions"). */
  listLabel?: string
  /** Fires after every committed verdict with the refreshed on-screen score. */
  onAnswered?: (questionId: string, correct: boolean, score: InlinePracticeScore) => void
}

export function InlinePractice({ questions, heading, listLabel, onAnswered }: InlinePracticeProps) {
  /** View-local reveal state — {questionId → committed answer + verdict}. */
  const [reveals, setReveals] = useState<Record<string, RevealState>>({})
  const [pending, setPending] = useState<{ questionId: string; index: number } | null>(null)
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({})

  // The running score counts only what is on screen (honest per view) —
  // stale page-switch entries in the map never render and never count.
  const score = useMemo<InlinePracticeScore>(
    () => ({
      answered: questions.filter((question) => reveals[question.id] !== undefined).length,
      correct: questions.filter((question) => reveals[question.id]?.correct === true).length,
    }),
    [questions, reveals]
  )

  // ---------- The answer check (POST /api/questions/practice — §22/§37) ----------

  const commitAnswer = useCallback(
    async (question: InlinePracticeQuestion, index: number) => {
      if (pending || reveals[question.id] !== undefined) return
      setPending({ questionId: question.id, index })
      let committed: boolean | null = null
      try {
        const response = await fetch('/api/questions/practice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          // selected = the option KEY (the positional letter), exactly the
          // contract the knowledge page's practice layer commits against.
          body: JSON.stringify({
            questionId: question.id,
            selected: OPTION_LETTERS[index] ?? String(index + 1),
          }),
        })
        const body = (await response.json()) as Envelope<{ result: PracticeAnswerResult }>
        if (body.status === 'ok' && body.data) {
          const result = body.data.result
          committed = result.correct
          setReveals((current) => ({
            ...current,
            [question.id]: {
              selectedIndex: index,
              correct: result.correct,
              correctIndex: OPTION_LETTERS.indexOf(result.correctAnswer),
              correctAnswer: result.correctAnswer,
              explanation: result.explanation,
            },
          }))
          setRevealErrors((current) => {
            if (!(question.id in current)) return current
            const next = { ...current }
            delete next[question.id]
            return next
          })
        } else {
          setRevealErrors((current) => ({
            ...current,
            [question.id]: body.error?.message ?? 'Could not check this answer — please retry.',
          }))
        }
      } catch {
        setRevealErrors((current) => ({
          ...current,
          [question.id]: 'Network error — please retry.',
        }))
      } finally {
        setPending(null)
      }
      if (committed !== null && onAnswered) {
        // The refreshed score after this commit: the pre-update closure's
        // map is stale, so this one question's verdict is folded in by hand.
        const answered = questions.filter(
          (entry) => entry.id === question.id || reveals[entry.id] !== undefined
        ).length
        const correct =
          questions.filter((entry) => reveals[entry.id]?.correct === true).length +
          (committed ? 1 : 0)
        onAnswered(question.id, committed, { answered, correct })
      }
    },
    [pending, reveals, questions, onAnswered]
  )

  return (
    <div className="space-y-4">
      {(heading || score.answered > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {heading && <h2 className="text-sm font-semibold text-zinc-900">{heading}</h2>}
          {score.answered > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
              aria-live="polite"
            >
              <Target className="h-3 w-3" aria-hidden="true" />
              {score.answered} answered · {score.correct} correct
            </Badge>
          )}
        </div>
      )}
      <ul className="grid gap-4" role="list" aria-label={listLabel ?? 'Practice questions'}>
        {questions.map((question) => (
          // min-w-0 lets the grid item shrink below the provenance pill's
          // nowrap min-content — the badge truncates inside the card instead
          // of stretching it (390px safety).
          <li key={question.id} className="min-w-0">
            <InlinePracticeCard
              question={question}
              reveal={reveals[question.id] ?? null}
              pendingIndex={pending?.questionId === question.id ? pending.index : null}
              error={revealErrors[question.id] ?? null}
              onCommit={(index) => void commitAnswer(question, index)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
