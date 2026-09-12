// Entitlements — Phase 1 scaffold.
//
// A user's plan lives in the Supabase auth user's app_metadata.plan. Only the
// service role can write app_metadata, so the value that arrives in the JWT is
// unforgeable from the browser. Absence means 'free': every new sign-up is free
// without a trigger, a table, or a migration. See CLAUDE.md → Routing → Entitlements.

export const PLANS = Object.freeze({ FREE: 'free', PAID: 'paid' })

/** @param {import('@supabase/supabase-js').User | null | undefined} user */
export function getPlan(user) {
  const plan = user?.app_metadata?.plan
  return plan === PLANS.PAID ? PLANS.PAID : PLANS.FREE
}

/** @param {import('@supabase/supabase-js').User | null | undefined} user */
export function isPaid(user) {
  return getPlan(user) === PLANS.PAID
}
