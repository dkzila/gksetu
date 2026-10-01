'use client'

/**
 * GKSetu — the §21 share action button (P8-S1)
 * Master Plan §21: "a share action must exist on every shareable canonical
 * page" — this button is that action, one per surface (knowledge page,
 * current-affairs item, topic hub, exam page, practice question, eligible
 * collection). It opens the ShareDialog with the surface's §16 path; the
 * dialog owns the card, the Web Share API and the copy-link fallback. §38:
 * sharing is public — the button never gates on sign-in (unlike Save, a
 * share carries no account requirement; §31 anonymous shares are by design).
 */
import { useState } from 'react'
import { Share2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { ShareDialog } from './share-dialog'

export interface ShareButtonProps {
  /** The §16 URL path, exactly as the app renders it (with ?q= when focused). */
  path: string
  /** Fallback title while the card loads (the surface's honest label). */
  title: string
  size?: 'sm' | 'default'
  className?: string
  /** Icon-only rendering for tight rows (the per-question affordance). */
  iconOnly?: boolean
}

export function ShareButton({ path, title, size = 'sm', className, iconOnly = false }: ShareButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="outline"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`gap-2 border-zinc-300 bg-white text-zinc-800 hover:border-emerald-400 hover:text-emerald-800 ${className ?? ''}`}
      >
        <Share2 className="h-4 w-4" aria-hidden="true" />
        {!iconOnly && 'Share'}
        <span className="sr-only"> — share {title}</span>
      </Button>
      {open && <ShareDialog path={path} title={title} open={open} onOpenChange={setOpen} />}
    </>
  )
}
