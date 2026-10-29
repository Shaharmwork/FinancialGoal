# FinancialGoal
App to manage my daily weekly monthly and yearly work load calculations and yearly expected tax calculation

## Account lookup and recovery

The anonymous `check_account_email` RPC intentionally reveals only whether an
email has an account. This is a product privacy tradeoff, not password or account
access. The private budget table stores counters only; no queried addresses or IPs.

Apply `supabase/migrations/20261029153543_rate_limited_account_lookup.sql`
before deploying this client to another Supabase project. It has already been
applied to FinancialGoal. No new environment variables or Netlify server are needed;
localhost uses the same Supabase backend and budget.

- One atomic database budget is shared by all callers: 30 lookups per 60-second
  window and 300 per hour. Refreshing the browser or changing IP does not reset it.
  Fixed windows may allow a burst across a window boundary.
- Correct-password sign-in goes directly to Supabase Auth. Only rejected
  credentials trigger a lookup. When lookup fails or is throttled, sign-in keeps
  the generic credentials error, without claiming the account is missing.
- Password reset checks membership first. Missing accounts show a create-account
  action and no reset email is requested. Throttling/outages also stop reset
  submission with an accurate message and retry delay.
- Supabase's own auth/email limits and the existing 60-second resend cooldown
  still apply. Email request acceptance does not prove inbox delivery.
- The shared cap is intended for this small app. Someone exhausting it can
  temporarily prevent other users from getting a specific error or requesting a
  reset. Successful sign-in is unaffected. Before broader rollout, replace it
  with a trusted server-side per-client limiter and/or CAPTCHA.
- Supabase advisors flag anonymous SECURITY DEFINER execution deliberately:
  this function is the explicitly approved pre-login API, with an empty search
  path, fixed SQL, no user-record output and no public grants on auth tables.
  The private counter table deliberately has RLS with no user policies.
