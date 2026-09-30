'use client'

/**
 * GlobIQ — the §22 scored practice layer (P7-S2, extended P8-S1)
 *
 * Master Plan §22 "learn → practice → revise": after the explanatory Q&A
 * layer comes the SCORED half of practice — one-shot MCQ questions rendered
 * from the live revision only (§36). The correct answer and explanation are
 * deliberately NOT in the page payload (§6/§22): they ship per-question from
 * POST /api/questions/practice only AFTER the learner commits an answer, so
 * scoring is always server-side truth (§37 — the same contract a future
 * mobile client consumes, §39). One attempt per page view; the running score
 * chip sums what was answered here.
 *
 * P8-S1 §21: every question is a shareable canonical object — each card
 * carries its own share action (the §16 unit path + ?q={id} focus), and a
 * shared question link scrolls to and highlights its card once (the address
 * ?q= state is the §21 stable share URL's fragment).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  GraduationCap,
  ListChecks,
  Loader2,
  Target,
  XCircle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SaveButton } from '@/components/saves/save-button'
import { ReportButton } from '@/components/feedback/report-button'
import { ShareButton } from '@/components/shares/share-button'

import type { PagePracticeLayer, PagePracticeQuestion } from '@/components/reader/knowledge-page-view'

// ---------- API types (mirror POST /api/questions/practice — §37/§39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

/** The answer-check result — the ONLY public path where correctAnswer +
 * explanation ship, and only for the question that was just answered. */
interface PracticeAnswerResult {
  questionId: string
  selected: string
  correct: boolean
  correctAnswer: string
  explanation: string
  revision: { number: number; publishedAt: string }
  aiAssisted: boolean
}

// ---------- Presentation helpers ----------

const DIFFICULTY_STYLE: Record<PagePracticeQuestion['difficulty'], string> = {
  BASIC: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------- The per-question card (stateful) ----------

interface QuestionCardProps {
  entry: PagePracticeQuestion
  selected: string | null
  answer: { selected: string; result: PracticeAnswerResult } | null
  busy: boolean
  error: string | null
  /** P8-S1 §21: the unit page's §16 path — this question's share URL base. */
  unitSharePath: string
  onSelect: (optionKey: string) => void
  onCheck: () => void
}

function QuestionCard({ entry, selected, answer, busy, error, unitSharePath, onSelect, onCheck }: QuestionCardProps) {
  const answered = answer !== null
  return (
    <li
      id={`question-${entry.id}`}
      className="scroll-mt-24 rounded-lg border border-zinc-200 bg-white shadow-sm"
    >
      {/* Question header — the save + share affordances ride it (§10/§21) */}
      <div className="flex flex-wrap items-start gap-2 p-3 sm:p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={`text-[10px] font-medium ${DIFFICULTY_STYLE[entry.difficulty]}`}
              title="How hard this question is classified (§6 difficulty)"
            >
              {entry.difficulty}
            </Badge>
            {entry.examAnchor && (
              <Badge
                variant="outline"
                className="gap-1 border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
                title={`Authored for ${entry.examAnchor.exam.name} — ${entry.examAnchor.versionLabel} (§6 exam anchor)`}
              >
                <GraduationCap className="h-3 w-3" aria-hidden="true" />
                For {entry.examAnchor.exam.code.replace('-', ' ')}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm font-semibold leading-snug text-zinc-800">{entry.question}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <SaveButton objectType="QUESTION" objectRef={entry.id} objectName={entry.question} />
          {/* P8-S1 §21: the question's own share link — the unit page + ?q={id}. */}
          <ShareButton
            path={`${unitSharePath}?q=${entry.id}`}
            title={entry.question}
            iconOnly
            className="h-9 w-9 px-0"
          />
          {/* P8-S3 §25: report this question (id = §37 identity) — a wrong
              answer key or distorted option is exactly a factual error. */}
          <ReportButton
            objectType="QUESTION"
            objectRef={entry.id}
            objectName={entry.question}
            languageCode={entry.language.code}
            iconOnly
            className="h-9 w-9 px-0"
          />
        </span>
      </div>

      <div className="space-y-3 border-t border-zinc-100 p-3 sm:p-4">
        {/* Options — radio semantics (keyboard: Tab + arrows), one commit only */}
        <div
          role="radiogroup"
          aria-label={`Answer options for: ${entry.question}`}
          className="space-y-1.5"
        >
          {entry.options.map((option, index) => {
            const isSelected = selected === option.key
            const isCorrectOption = answered && answer.result.correctAnswer === option.key
            const isWrongSelection = answered && isSelected && !answer.result.correct
            const rowClass = !answered
              ? isSelected
                ? 'border-emerald-400 bg-emerald-50/60'
                : 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
              : isCorrectOption
                ? 'border-emerald-400 bg-emerald-50'
                : isWrongSelection
                  ? 'border-red-300 bg-red-50'
                  : 'border-zinc-200 bg-zinc-50/60'
            const keyClass = !answered
              ? isSelected
                ? 'border-emerald-500 bg-emerald-600 text-white'
                : 'border-zinc-300 bg-white text-zinc-600'
              : isCorrectOption
                ? 'border-emerald-500 bg-emerald-600 text-white'
                : isWrongSelection
                  ? 'border-red-400 bg-red-500 text-white'
                  : 'border-zinc-200 bg-white text-zinc-400'
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-disabled={answered || busy ? true : undefined}
                disabled={answered || busy}
                tabIndex={isSelected || (!selected && index === 0) ? 0 : -1}
                onClick={() => onSelect(option.key)}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
                  event.preventDefault()
                  const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
                  const next = (index + delta + entry.options.length) % entry.options.length
                  onSelect(entry.options[next].key)
                  const group = event.currentTarget.closest('[role="radiogroup"]')
                  const radios = group
                    ? Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
                    : []
                  radios[next]?.focus()
                }}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${rowClass}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-xs font-semibold ${keyClass}`}
                >
                  {option.key}
                </span>
                <span
                  className={`min-w-0 flex-1 text-sm leading-snug ${
                    answered && !isCorrectOption && !isWrongSelection ? 'text-zinc-400' : 'text-zinc-700'
                  }`}
                >
                  {option.text}
                </span>
                {isCorrectOption && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                )}
                {isWrongSelection && <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />}
                <span className="sr-only">
                  {isSelected ? ' — your selection' : ''} {isCorrectOption ? ' — the correct answer' : ''}
                </span>
              </button>
            )
          })}
        </div>

        {/* Commit — scored server-side; the reveal only comes after this */}
        {!answered && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="gap-2"
              disabled={!selected || busy}
              onClick={onCheck}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ListChecks className="h-4 w-4" aria-hidden="true" />
              )}
              Check answer
            </Button>
            <span className="text-xs text-zinc-400">
              One attempt per view — scored server-side (§22), the key never ships in the page.
            </span>
          </div>
        )}

        {/* Inline failure — the answer stays selectable and retryable */}
        {error && !answered && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* The reveal — explanation + the exact QnA-layer footer conventions */}
        {answered && (
          <div
            className={`rounded-lg border p-3 sm:p-4 ${
              answer.result.correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
            }`}
          >
            <p
              className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${
                answer.result.correct ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {answer.result.correct ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {answer.result.correct
                ? 'Correct'
                : `Not quite — the correct answer is ${answer.result.correctAnswer}`}
            </p>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">
              {answer.result.explanation}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-zinc-500">
              <span>
                Rev {answer.result.revision.number} · published{' '}
                {formatDate(answer.result.revision.publishedAt)}
              </span>
              {entry.revision.changeSummary && (
                <span className="italic text-zinc-500">
                  Corrected: “{entry.revision.changeSummary}”
                </span>
              )}
              {answer.result.aiAssisted && (
                <Badge
                  variant="outline"
                  className="gap-1 border-fuchsia-200 bg-fuchsia-50 font-normal text-fuchsia-700"
                >
                  <Bot className="h-3 w-3" aria-hidden="true" />
                  AI-assisted draft
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

// ---------- The layer (heading + running score + entries) ----------

export interface PracticeLayerProps {
  practice: PagePracticeLayer
  /** P8-S1 §21: the unit page's §16 canonical path (the share URL base). */
  unitSharePath?: string
  /** P8-S1 §21: the ?q= focus from a shared question link — scrolls once. */
  focusQuestionId?: string | null
}

export function PracticeLayer({ practice, unitSharePath, focusQuestionId = null }: PracticeLayerProps) {
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, { selected: string; result: PracticeAnswerResult }>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  // P8-S1 §21: a shared question link (?q={id}) scrolls to its card once and
  // highlights it — the focus is addressable state, never component state
  // beyond the one-shot effect (the hash stays honest; the highlight fades).
  const focusApplied = useRef(false)
  useEffect(() => {
    if (focusApplied.current || !focusQuestionId) return
    const target = document.getElementById(`question-${focusQuestionId}`)
    if (!target) return
    focusApplied.current = true
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target.classList.add(
      'border-emerald-400',
      'ring-2',
      'ring-emerald-200',
      'transition-shadow',
      'duration-1000'
    )
    const timer = window.setTimeout(() => {
      target.classList.remove('ring-2', 'ring-emerald-200')
    }, 4000)
    return () => window.clearTimeout(timer)
  }, [focusQuestionId, practice])

  const answeredCount = Object.keys(answers).length
  const correctCount = Object.values(answers).filter((entry) => entry.result.correct).length

  const checkAnswer = useCallback(
    async (questionId: string) => {
      const selected = selections[questionId]
      if (!selected || busyId) return
      setBusyId(questionId)
      try {
        const response = await fetch('/api/questions/practice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ questionId, selected }),
        })
        const payload = (await response.json()) as Envelope<{ result: PracticeAnswerResult }>
        if (payload.status === 'ok' && payload.data) {
          setAnswers((current) => ({
            ...current,
            [questionId]: { selected, result: payload.data!.result },
          }))
          setErrors((current) => {
            if (!(questionId in current)) return current
            const next = { ...current }
            delete next[questionId]
            return next
          })
        } else {
          setErrors((current) => ({
            ...current,
            [questionId]: payload.error?.message ?? 'Could not check this answer — please retry.',
          }))
        }
      } catch {
        setErrors((current) => ({
          ...current,
          [questionId]: 'Network error — please retry.',
        }))
      } finally {
        setBusyId(null)
      }
    },
    [selections, busyId]
  )

  return (
    <div className="space-y-3">
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-900">
        <ListChecks className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        Practice — Test yourself
        {practice.entries.length > 0 && (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            {practice.entries.length} question{practice.entries.length === 1 ? '' : 's'}
          </Badge>
        )}
        {answeredCount > 0 && (
          <Badge
            variant="outline"
            className="gap-1 border-amber-200 bg-amber-50 font-normal text-amber-700"
            aria-live="polite"
          >
            <Target className="h-3 w-3" aria-hidden="true" />
            Score {correctCount}/{answeredCount}
          </Badge>
        )}
      </h4>
      {practice.entries.length > 0 ? (
        <ul className="space-y-2" aria-label="Scored practice questions">
          {practice.entries.map((entry) => (
            <QuestionCard
              key={entry.id}
              entry={entry}
              selected={selections[entry.id] ?? null}
              answer={answers[entry.id] ?? null}
              busy={busyId === entry.id}
              error={errors[entry.id] ?? null}
              unitSharePath={unitSharePath ?? '#/'}
              onSelect={(optionKey) =>
                setSelections((current) => ({ ...current, [entry.id]: optionKey }))
              }
              onCheck={() => void checkAnswer(entry.id)}
            />
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <ListChecks className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            No practice questions yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{practice.note}</p>
        </div>
      )}
    </div>
  )
}
