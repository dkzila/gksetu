'use client'

/**
 * GKSetu — Console API client (CONSOLE-S1).
 *
 * One typed fetch helper every console page uses: attaches the staff
 * Bearer token (the same token-based identity the public site and future
 * apps share — §4/§37/§39), unwraps the standard envelope and returns
 * errors as values (never throws) so pages render inline, actionable
 * messages.
 */
import { useMemo } from 'react'

import { useAuth } from '@/stores/auth'

export interface ApiEnvelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: unknown }
}

export class ConsoleApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(code: string, message: string, status: number, details: unknown) {
    super(message)
    this.name = 'ConsoleApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

/** Field-error details the API returns as `{ field: [messages] }`. */
export function fieldErrorMap(details: unknown): Record<string, string> {
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(details as Record<string, unknown>)) {
      if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0]
      else if (typeof value === 'string') out[key] = value
    }
    return out
  }
  return {}
}

export async function consoleFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<{ data: T | null; error: ConsoleApiError | null }> {
  const { method = 'GET', body, token } = options
  try {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null
    if (!payload) {
      return { data: null, error: new ConsoleApiError('BAD_RESPONSE', 'The server returned an unreadable response', response.status, null) }
    }
    if (payload.status === 'ok' && payload.data !== undefined) {
      return { data: payload.data, error: null }
    }
    const err = payload.error ?? { code: 'UNKNOWN', message: 'Something went wrong' }
    return { data: null, error: new ConsoleApiError(err.code, err.message, response.status, err.details) }
  } catch {
    return { data: null, error: new ConsoleApiError('NETWORK', 'Network error — check your connection and retry', 0, null) }
  }
}

/** The console's fetch bound to the live session token.
 *
 * MEMOISED on `token` — pages legitimately place `api` in useCallback /
 * useEffect dependency arrays, so the returned object must be referentially
 * stable across renders (a fresh object per render would re-trigger every
 * dependent effect — an infinite refetch loop; found in CONSOLE-S1 QA).
 */
export function useConsoleApi() {
  const token = useAuth((state) => state.token)
  return useMemo(
    () => ({
      token,
      get: <T>(path: string) => consoleFetch<T>(path, { token }),
      post: <T>(path: string, body?: unknown) => consoleFetch<T>(path, { method: 'POST', body, token }),
      put: <T>(path: string, body?: unknown) => consoleFetch<T>(path, { method: 'PUT', body, token }),
      patch: <T>(path: string, body?: unknown) => consoleFetch<T>(path, { method: 'PATCH', body, token }),
      del: <T>(path: string) => consoleFetch<T>(path, { method: 'DELETE', token }),
    }),
    [token]
  )
}

/** True when the signed-in user holds `permission` (server-truth list). */
export function useHasPermission(permission: string): boolean {
  const permissions = useAuth((state) => state.permissions)
  return permissions.includes(permission)
}
