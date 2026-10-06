'use client'

/**
 * GKSetu — Rich Content Renderer (SITE-S19).
 *
 * Replaces the raw `<pre>` markdown dump with a proper react-markdown render.
 * For the WORKED_MCQ kind, parses the markdown for Q/A/options/answer patterns
 * and renders interactive MCQ cards (click-to-reveal the correct answer +
 * explanation). Other kinds (PATTERN_BRIEF, CHEAT_SHEET, REVISION_NOTES) render
 * as styled markdown (headings, bold, lists, tables, code blocks).
 *
 * Used by:
 *   - src/components/premium/exam-notes-section.tsx (the chapter page's 4 cards)
 *   - src/components/console/pages/exam-note-detail-page.tsx (the Console detail)
 */
import ReactMarkdown from 'react-markdown'
import { useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, XCircle } from 'lucide-react'

// ---------- The main renderer ----------

export function RichContent({ body, kind }: { body: string; kind: string }) {
  if (kind === 'WORKED_MCQ') {
    return <InteractiveMCQ body={body} />
  }
  return <MarkdownBody body={body} />
}

// ---------- Standard markdown render (for PATTERN_BRIEF, CHEAT_SHEET, REVISION_NOTES) ----------

function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="prose prose-sm prose-zinc max-w-none
      prose-headings:font-semibold prose-headings:text-zinc-900
      prose-h1:text-lg prose-h1:mt-4 prose-h1:mb-2
      prose-h2:text-base prose-h2:mt-4 prose-h2:mb-2 prose-h2:border-b prose-h2:border-zinc-100 prose-h2:pb-1
      prose-h3:text-sm prose-h3:mt-3 prose-h3:mb-1 prose-h3:uppercase prose-h3:tracking-wide prose-h3:text-zinc-500
      prose-p:text-sm prose-p:leading-relaxed prose-p:text-zinc-700
      prose-ul:my-2 prose-ul:list-disc prose-ul:pl-5 prose-ul:text-sm prose-ul:text-zinc-700
      prose-ol:my-2 prose-ol:list-decimal prose-ol:pl-5 prose-ol:text-sm prose-ol:text-zinc-700
      prose-li:my-0.5 prose-li:text-sm
      prose-strong:font-semibold prose-strong:text-zinc-900
      prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:text-zinc-800
      prose-table:my-3 prose-table:w-full prose-table:border-collapse
      prose-th:border prose-th:border-zinc-200 prose-th:bg-zinc-50 prose-th:px-2 prose-th:py-1 prose-th:text-left prose-th:text-xs prose-th:font-semibold
      prose-td:border prose-td:border-zinc-200 prose-td:px-2 prose-td:py-1 prose-td:text-xs
      prose-blockquote:border-l-2 prose-blockquote:border-emerald-300 prose-blockquote:pl-3 prose-blockquote:text-sm prose-blockquote:text-zinc-600
      prose-hr:my-3 prose-hr:border-zinc-100
    ">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
  )
}

// ---------- Interactive MCQ (for WORKED_MCQ kind) ----------

interface ParsedMCQ {
  question: string
  options: Array<{ label: string; text: string }>
  answer: string  // the correct option label (e.g. "c")
  explanation: string
  patternAlert: string | null
}

/**
 * Parses the markdown body for MCQ blocks. The expected format (as authored
 * in SITE-S13-D) is:
 *
 * ### Q1 (UPSC Prelims 2020, adapted)
 * <question text>
 * (a) option a text
 * (b) option b text
 * (c) option c text
 * (d) option d text
 *
 * **Answer: (c) ...**
 *
 * **Why:** <explanation>
 *
 * **Pattern alert:** <alert text>
 */
function parseMCQs(body: string): ParsedMCQ[] {
  const mcqs: ParsedMCQ[] = []
  // Split on "### Q" to find each question block.
  const blocks = body.split(/^### Q/gm).filter((b) => b.trim())
  for (const block of blocks) {
    const lines = block.split('\n')
    // First line: "1 (UPSC Prelims 2020, adapted)" — the question number + context
    // Rest until (a): the question text
    let questionText = ''
    let i = 0
    // Skip the first line (the "### Q1 ..." header — it's part of the question context)
    for (i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.match(/^\([a-d]\)/)) break
      questionText += (questionText ? '\n' : '') + line
    }
    // Parse options
    const options: Array<{ label: string; text: string }> = []
    for (; i < lines.length; i++) {
      const line = lines[i].trim()
      const match = line.match(/^\(([a-d])\)\s*(.*)/)
      if (match) {
        options.push({ label: match[1], text: match[2] })
      } else if (line === '' || line.startsWith('**Answer') || line.startsWith('**Why') || line.startsWith('**Pattern')) {
        break
      } else if (options.length > 0) {
        // Continuation of the last option's text
        options[options.length - 1].text += ' ' + line
      }
    }
    // Parse answer + explanation + pattern alert
    const remaining = lines.slice(i).join('\n')
    const answerMatch = remaining.match(/\*\*Answer:\s*\(([a-d])\)/i)
    const answer = answerMatch ? answerMatch[1].toLowerCase() : ''
    const whyMatch = remaining.match(/\*\*Why:\*\*\s*([\s\S]*?)(?=\*\*Pattern|\*\*Common|$)/)
    const explanation = whyMatch ? whyMatch[1].trim() : ''
    const alertMatch = remaining.match(/\*\*Pattern alert:\*\*\s*([\s\S]*?)(?=\*\*|$)/)
    const patternAlert = alertMatch ? alertMatch[1].trim() : null

    if (questionText && options.length > 0) {
      mcqs.push({ question: questionText.trim(), options, answer, explanation, patternAlert })
    }
  }
  return mcqs
}

function InteractiveMCQ({ body }: { body: string }) {
  const mcqs = parseMCQs(body)
  if (mcqs.length === 0) {
    // Fallback: render as standard markdown if parsing fails.
    return <MarkdownBody body={body} />
  }
  return (
    <div className="space-y-4">
      {mcqs.map((mcq, index) => (
        <MCQCard key={index} mcq={mcq} index={index + 1} />
      ))}
    </div>
  )
}

function MCQCard({ mcq, index }: { mcq: ParsedMCQ; index: number }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)

  const handleSelect = (label: string) => {
    if (revealed) return
    setSelected(label)
    setRevealed(true)
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      {/* Question */}
      <p className="text-sm font-semibold leading-snug text-zinc-900">
        Q{index}. {mcq.question}
      </p>
      {/* Options */}
      <div className="mt-3 space-y-2">
        {mcq.options.map((option) => {
          const isCorrect = option.label === mcq.answer
          const isSelected = option.label === selected
          const showCorrect = revealed && isCorrect
          const showWrong = revealed && isSelected && !isCorrect
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => handleSelect(option.label)}
              disabled={revealed}
              className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                showCorrect
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900'
                  : showWrong
                    ? 'border-red-300 bg-red-50 text-red-900'
                    : revealed
                      ? 'border-zinc-200 bg-white text-zinc-500'
                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50/30'
              }`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
                showCorrect ? 'border-emerald-500 bg-emerald-500 text-white' : showWrong ? 'border-red-500 bg-red-500 text-white' : 'border-zinc-300 bg-white text-zinc-600'
              }`}>
                {showCorrect ? <CheckCircle2 className="h-3 w-3" /> : showWrong ? <XCircle className="h-3 w-3" /> : option.label}
              </span>
              <span className="flex-1">{option.text}</span>
            </button>
          )
        })}
      </div>
      {/* Reveal + explanation */}
      {revealed && (
        <div className="mt-3 space-y-2 rounded-md border border-zinc-100 bg-zinc-50 p-3">
          <p className="text-sm font-medium text-zinc-800">
            Answer: ({mcq.answer}) {mcq.options.find((o) => o.label === mcq.answer)?.text}
          </p>
          {mcq.explanation && (
            <div className="prose prose-sm prose-zinc max-w-none prose-p:text-sm prose-p:leading-relaxed prose-p:text-zinc-600">
              <ReactMarkdown>{mcq.explanation}</ReactMarkdown>
            </div>
          )}
          {mcq.patternAlert && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <strong>Pattern alert:</strong> {mcq.patternAlert}
            </p>
          )}
        </div>
      )}
      {!revealed && (
        <p className="mt-2 text-xs text-zinc-400">Click an option to reveal the answer + explanation.</p>
      )}
    </div>
  )
}
