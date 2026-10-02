/**
 * GET  /api/settings — the console's settings view (CONSOLE-S1,
 * settings:manage): every row (private keys included) + the country list.
 * PUT  /api/settings — bulk upsert of entries (global or per-country).
 * DELETE /api/settings?key=…&country=… — remove one row.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  listSettings,
  removeSetting,
  SettingsError,
  settingsRemoveSchema,
  settingsUpsertSchema,
  upsertSettings,
} from '@/modules/site-settings'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'settings:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`settings:read:${clientIp(request)}`, RATE_LIMITS.settingsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const view = await listSettings()
    return ok(view)
  } catch (error) {
    console.error('[settings/list] unexpected error:', error)
    return fail('Could not load settings', 'INTERNAL_ERROR', 500)
  }
}

export async function PUT(request: Request) {
  const auth = await requirePermission(request, 'settings:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`settings:write:${clientIp(request)}`, RATE_LIMITS.settingsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = settingsUpsertSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const result = await upsertSettings(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok(result)
  } catch (error) {
    if (error instanceof SettingsError) return fail(error.message, error.code, error.status)
    console.error('[settings/upsert] unexpected error:', error)
    return fail('Could not save settings', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission(request, 'settings:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`settings:write:${clientIp(request)}`, RATE_LIMITS.settingsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = settingsRemoveSchema.safeParse({
    key: url.searchParams.get('key') ?? undefined,
    countryIso: url.searchParams.get('country') ?? null,
  })
  if (!parsed.success) {
    return errors.badRequest('A valid settings key is required', fieldErrors(parsed.error))
  }

  try {
    await removeSetting(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ removed: true })
  } catch (error) {
    if (error instanceof SettingsError) return fail(error.message, error.code, error.status)
    console.error('[settings/remove] unexpected error:', error)
    return fail('Could not remove the setting', 'INTERNAL_ERROR', 500)
  }
}
