'use client'

/**
 * GlobIQ — client notification-count state (P8-S2)
 *
 * The header bell's lean source: the PURE /api/notifications/stats read
 * (never the delivering GET /api/notifications — refreshing the badge must
 * not consume the queued → sent lifecycle, §27). Refreshes on auth changes
 * and window focus while signed in; the notification center pushes live
 * counts into the same store after its own reads/marks, so the badge is
 * always coherent with the surface (§37 — same APIs a mobile app calls).
 */
import { create } from 'zustand'

import { useAuth } from '@/stores/auth'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface NotificationCountStore {
  unreadCount: number
  fetched: boolean
  /** Pure read — safe to call on focus/mount. Clears on sign-out. */
  refresh: () => Promise<void>
  /** The center pushes its coherent count (after reads/marks). */
  setCount: (count: number) => void
  clear: () => void
}

export const useNotificationCount = create<NotificationCountStore>((set) => ({
  unreadCount: 0,
  fetched: false,
  refresh: async () => {
    const { token, status } = useAuth.getState()
    if (status !== 'authenticated' || !token) {
      set({ unreadCount: 0, fetched: true })
      return
    }
    try {
      const response = await fetch('/api/notifications/stats', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ stats: { unreadCount: number } }>
      if (payload.status === 'ok' && payload.data) {
        set({ unreadCount: payload.data.stats.unreadCount, fetched: true })
      }
    } catch {
      // Best-effort badge — never a user-facing error.
    }
  },
  setCount: (count) => set({ unreadCount: count, fetched: true }),
  clear: () => set({ unreadCount: 0, fetched: true }),
}))
