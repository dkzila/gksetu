'use client'

/**
 * GKSetu — Paywall Modal (SITE-S13/S14)
 *
 * The pricing table + the checkout trigger. When Razorpay is configured, the
 * "Pay ₹99" / "Pay ₹499" buttons trigger the Razorpay checkout modal. When
 * Razorpay is NOT configured (the default "free for now" state), the buttons
 * show a "Coming soon" message — the entire premium pipeline is ready, the
 * user just hasn't flipped the payment switch yet.
 *
 * The parent (chapter-reader) renders this modal when the user taps "Unlock
 * for ₹99" on a locked ExamNote card.
 */
import { useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PRICING } from '@/config/pricing'
import type { Envelope } from '@/components/home/types'

interface CheckoutSession {
  provider: 'razorpay'
  providerOrderId: string
  amount: number
  currency: 'INR'
  amountLabel: string
  scope: 'SINGLE_EXAM' | 'ALL_EXAMS'
  examId: string | null
  examName: string | null
  publishableKey: string | null
}

export interface PaywallModalProps {
  open: boolean
  onClose: () => void
  /** The exam slug — required for SINGLE_EXAM checkout. */
  examSlug: string
  /** The default scope to highlight (the locked card's CTA decides). */
  defaultScope?: 'SINGLE_EXAM' | 'ALL_EXAMS'
}

export function PaywallModal({ open, onClose, examSlug, defaultScope = 'SINGLE_EXAM' }: PaywallModalProps) {
  const { token } = useAuth()
  const { toast } = useToast()
  const [busy, setBusy] = useState<'single' | 'annual' | null>(null)
  const [paymentsConfigured, setPaymentsConfigured] = useState<boolean | null>(null)

  // Check if payments are configured (one-time on open).
  useState(() => {
    if (!open) return
    void fetch('/api/payments/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'SINGLE_EXAM', examRef: examSlug }),
    })
      .then((response) => {
        if (response.status === 503) {
          setPaymentsConfigured(false)
        } else if (response.ok) {
          setPaymentsConfigured(true)
        }
      })
      .catch(() => setPaymentsConfigured(false))
  })

  const handleCheckout = async (scope: 'SINGLE_EXAM' | 'ALL_EXAMS') => {
    if (!token) {
      toast({ title: 'Please sign in to continue', variant: 'destructive' })
      return
    }
    setBusy(scope === 'SINGLE_EXAM' ? 'single' : 'annual')
    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          ...(scope === 'SINGLE_EXAM' ? { examRef: examSlug } : {}),
        }),
      })
      const payload = (await response.json()) as Envelope<{ session: CheckoutSession }>
      if (payload.status === 'ok' && payload.data) {
        // SITE-S14: when Razorpay is live, load the SDK + open the modal here.
        // For now (scaffold), show the "coming soon" message.
        toast({
          title: 'Payment integration coming soon',
          description: 'Your premium access pipeline is ready — payments activate when Razorpay keys are added.',
        })
        onClose()
      } else {
        const code = payload.error?.code
        if (code === 'PAYMENTS_NOT_CONFIGURED') {
          setPaymentsConfigured(false)
          toast({
            title: 'Payments not configured yet',
            description: 'The Razorpay integration is scaffolded. See docs/payment-integration.md to enable.',
            variant: 'destructive',
          })
        } else {
          toast({ title: 'Could not start checkout', description: payload.error?.message, variant: 'destructive' })
        }
      }
    } catch {
      toast({ title: 'Network error — could not start checkout', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <DialogTitle>Unlock exam notes</DialogTitle>
          </div>
          <DialogDescription>
            The exam-pattern-specific editorial layer — pattern briefs, cheat sheets, worked PYQs
            and revision notes for every chapter. Beats coaching notes at 1/50th the price.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Single Exam — ₹99 */}
          <button
            type="button"
            onClick={() => void handleCheckout('SINGLE_EXAM')}
            disabled={busy !== null}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
              defaultScope === 'SINGLE_EXAM'
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-zinc-200 bg-white hover:border-emerald-200'
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900">This exam — lifetime</p>
              <p className="text-xs text-zinc-500">All 4 note kinds for every chapter of this exam. One-time payment.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-lg font-bold text-emerald-700">{PRICING.SINGLE_EXAM.label}</span>
              {busy === 'single' && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden="true" />}
            </div>
          </button>

          {/* Annual Pass — ₹499 */}
          <button
            type="button"
            onClick={() => void handleCheckout('ALL_EXAMS')}
            disabled={busy !== null}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
              defaultScope === 'ALL_EXAMS'
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-zinc-200 bg-white hover:border-emerald-200'
            }`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-zinc-900">Every exam — 1 year</p>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  Best value
                </Badge>
              </div>
              <p className="text-xs text-zinc-500">All 138 exams' notes. Renewable annually.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-lg font-bold text-emerald-700">{PRICING.ANNUAL_PASS.label}</span>
              {busy === 'annual' && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden="true" />}
            </div>
          </button>

          {paymentsConfigured === false && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Payments activate when Razorpay keys are added. The premium pipeline is otherwise complete.
              See <code className="font-mono">docs/payment-integration.md</code>.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy !== null}>
            <X className="mr-1 h-4 w-4" aria-hidden="true" />
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
