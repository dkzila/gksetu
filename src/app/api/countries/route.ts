/**
 * GET  /api/countries — public country list with per-country languages and
 *   canonical home URLs (Master Plan §14, §16, §35). INACTIVE markets hidden.
 *   ?include=inactive — admin variant (country-config:manage): paused/staged
 *   markets are returned too (P9-S2 launch configuration needs to see the
 *   market a pause just hid — the getCountryIncludingInactive precedent).
 * POST /api/countries — admin: add a country to the platform (§38 admin scope).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  createCountry,
  createCountrySchema,
  listAdminCountries,
  listPublicCountries,
  toLocaleErrorResponse,
} from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('include') === 'inactive') {
    const auth = await requirePermission(request, 'country-config:manage')
    if (auth instanceof NextResponse) return auth
    try {
      const countries = await listAdminCountries()
      return ok({ countries })
    } catch (error) {
      console.error('[countries/list-admin] unexpected error:', error)
      return fail('Could not load countries', 'INTERNAL_ERROR', 500)
    }
  }
  try {
    const countries = await listPublicCountries()
    return ok({ countries })
  } catch (error) {
    console.error('[countries/list] unexpected error:', error)
    return fail('Could not load countries', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'country-config:manage')
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createCountrySchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const country = await createCountry(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ country }, { status: 201 })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/create] unexpected error:', error)
    return fail('Could not create the country', 'INTERNAL_ERROR', 500)
  }
}
