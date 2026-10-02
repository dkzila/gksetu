'use client'

/**
 * GKSetu — the thin emerald tutorial progress bar (SITE-S8-B).
 *
 * One shared renderer for the syllabus-walk progress everywhere a tutorial
 * surface shows it: the TOC hero, the "Your exams" cards and the chapter
 * reader's right rail / chapters drawer. Percent is always the server's
 * rounded 0–100 (§37) — the bar is presentation only.
 */
export function TutorialProgressBar({ percent, className }: { percent: number; className?: string }) {
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-emerald-100 ${className ?? ''}`}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-emerald-600 transition-[width] duration-300"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}
