/**
 * GKSetu — REBRAND-S1 one-time database migration (GlobIQ → GKSetu).
 *
 * What it does (run ONCE against the live database):
 *  1. The seven §45 demo/staff accounts: email moved to the @gksetu.dev
 *     domain AND password re-hashed to the new GKSetu-Dev-* scheme (the
 *     seed never overwrites existing users — update:{}, "never overwrite a
 *     manually-changed password on re-seed" — so the rebrand has to do it
 *     explicitly; this script is that explicit step).
 *  2. Every remaining account whose email still carries an @globiq. domain
 *     (E2E/test readers, the audit reader) — moved to the matching @gksetu.
 *     domain. Passwords untouched (they carry no branding).
 *
 * Idempotent by construction: every step matches on the OLD value only, so
 * re-running after a successful migration is a no-op ("already migrated").
 * Historical records (audit trails, seeded feedback notes) deliberately keep
 * the emails/strings that existed when they were written — the rebrand
 * changes the live identity, not history.
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/modules/identity-access/password'

const prisma = new PrismaClient()

/** [old email, new email, new password] — the eight §45 demo accounts. */
const STAFF: Array<[string, string, string]> = [
  ['admin@globiq.dev', 'admin@gksetu.dev', 'GKSetu-Dev-Admin-1'],
  ['in-admin@globiq.dev', 'in-admin@gksetu.dev', 'GKSetu-Dev-INAdmin-1'],
  ['writer-in@globiq.dev', 'writer-in@gksetu.dev', 'GKSetu-Dev-Writer-1'],
  ['writer-hi@globiq.dev', 'writer-hi@gksetu.dev', 'GKSetu-Dev-Writer-Hi-1'],
  ['fr-admin@globiq.dev', 'fr-admin@gksetu.dev', 'GKSetu-Dev-Fr-Admin-1'],
  ['writer-fr@globiq.dev', 'writer-fr@gksetu.dev', 'GKSetu-Dev-Writer-Fr-1'],
  ['uk-admin@globiq.dev', 'uk-admin@gksetu.dev', 'GKSetu-Dev-Uk-Admin-1'],
]

async function main(): Promise<void> {
  let moved = 0
  let rehashed = 0

  // 1) staff: email + password (matched on the OLD email)
  for (const [oldEmail, newEmail, newPassword] of STAFF) {
    const user = await prisma.user.findUnique({ where: { email: oldEmail } })
    if (!user) {
      console.log(`staff  skip (already migrated or absent): ${oldEmail}`)
      continue
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail, passwordHash: await hashPassword(newPassword) },
    })
    moved += 1
    rehashed += 1
    console.log(`staff  ${oldEmail} → ${newEmail} (password re-hashed)`)
  }

  // 2) every remaining email that still carries a globiq domain
  // (E2E/test readers incl. the @e2e.globiq.dev form — matched on the bare
  // brand token so no domain variant escapes)
  const rest = await prisma.user.findMany({
    where: { email: { contains: 'globiq' } },
    select: { id: true, email: true },
  })
  for (const account of rest) {
    const next = account.email.replaceAll('globiq', 'gksetu')
    await prisma.user.update({ where: { id: account.id }, data: { email: next } })
    moved += 1
    console.log(`account ${account.email} → ${next}`)
  }

  // 3) final census: nothing carrying the old brand token may remain
  const leftover = await prisma.user.count({ where: { email: { contains: 'globiq' } } })
  console.log(`\ndone: ${moved} emails moved, ${rehashed} passwords re-hashed, ${leftover} leftover (must be 0)`)
  if (leftover > 0) throw new Error('accounts still carry the old brand token — investigate before going live')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
