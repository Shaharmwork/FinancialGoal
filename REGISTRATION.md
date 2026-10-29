# Registration and first-use setup

## User journey

1. **Create account:** optional preferred name, email, password (minimum 10 characters), matching confirmation and a Show/Hide control.
2. **Confirm email:** the app explains the email link, spam folder, existing-account alternative and resend with a cooldown. Passwords are cleared after signup, never stored in a draft.
3. **Your goal:** monthly take-home target and optional other household net income.
4. **Your work:** usual hourly rate excluding VAT, hours per workday, weekly target and planned days off.
5. **Tax assumptions:** extra reserve buffer and explicit deduction eligibility choices. “Not sure” excludes the deduction. No eligibility is inferred from a signup.
6. **Review:** editable summary, validation, save-in-progress state and retryable save errors.
7. **Start:** log a first workday, add earlier months, or explore the dashboard. Historical data is not invented or marked complete.
8. **Return:** existing accounts skip the wizard. An unfinished setup survives refresh in the same browser tab; saving settings makes completion durable across devices.

The app is currently scoped to Dutch freelance planning and euros. Password reset is available from sign-in and returns to a dedicated password-change screen. Invalid email links provide a route to request another link.

## Supabase release checks

Public auth settings checked on 27 October 2026:
- Email/password sign-in: enabled.
- Signup: enabled.
- Confirm email: enabled.

Before inviting new users:
1. Open [URL Configuration](https://supabase.com/dashboard/project/kyugvndvfjwpjnvorrhg/auth/url-configuration). Set **Site URL** to the actual production Netlify URL.
2. Add that same production URL, including the root trailing slash, to **Redirect URLs**. The app uses its current origin and pathname for confirmation and reset redirects. Add only intended preview/local URLs if needed.
3. Check [SMTP settings](https://supabase.com/dashboard/project/kyugvndvfjwpjnvorrhg/auth/smtp). Configure a verified sender for public registration. Supabase's built-in sender is restricted and is not a general public-signup mail service. Do not disable email confirmation to bypass delivery problems.
4. Keep the confirmation and reset email templates compatible with Supabase's standard confirmation links (the SDK consumes the returned session). Existing custom templates require separate verification.
5. Deploy the code to Netlify.
6. Use an email address you control for one real signup. Check email delivery, confirmation, setup save, sign out/in and another device. Then test a password-reset email and the newest-link/expired-link states.

The signup/setup flow itself needs no database migration. The separate abandoned-registration cleanup below requires its migration. First-use detection uses the existing account-specific data load. Setup uses the existing version-checked settings save, including mutation IDs for retry safety and conflict handling. Display-name metadata is presentation only, never authorization.

## Verification

Production build/typecheck, registration/auth unit tests, existing data-save regression tests, and local browser checks use synthetic data. Public auth settings and existing ownership policies were inspected read-only. No real account or test emails were created by the agent. SMTP, redirect allowlists and actual inbox delivery still require the release checks above.

Sources:
- [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup)
- [Email redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Email delivery and custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)

## Abandoned registrations (approved 28 October 2026)

Policy: clean up abandoned email/password signups daily, after seven days without
confirmation or further activity. A fresh confirmation request restarts the window.
Confirmed users, anyone who ever signed in, invited/social/anonymous users, accounts
with a session or MFA factor, and accounts with any profile, settings, report, month
summary, or owned Storage object/bucket are excluded. Users removed by this policy
can register again.

Implementation: `supabase/migrations/20261028091636_cleanup_abandoned_registrations.sql`.
The private SECURITY INVOKER function is inaccessible to application roles. It locks
candidate account rows and briefly locks the data tables against concurrent writes,
skips busy users, and deletes at most 200 accounts per run. The job runs daily at
03:17 UTC. Busy tables abort the run after two seconds instead of delaying app writes
indefinitely. If additional user-owned tables are added, update the guards and tests.

Validation: five PGlite tests cover deletion/cascading identities, repeat runs, protected
accounts, recent activity, app/storage data, batch size, and blocked application roles.
Before applying, the function's exact predicate matched zero eligible accounts in
production (counted read-only, no emails read).

**Enabled on 29 October 2026** with `supabase db push --linked`. Verified afterwards:
- Migration history: `20261028000000` (safe-saving, applied earlier outside the CLI and
  recorded with `migration repair`; the file was renamed from `20261028_safe_saving.sql`
  so the CLI orders it correctly, contents unchanged) and `20261028091636` (cleanup).
- pg_cron 1.6.4 installed; `cron.timezone` is GMT.
- `private.cleanup_abandoned_registrations()`: one copy, owned by `postgres`, SECURITY
  INVOKER, `search_path=''`, ACL `{postgres=X/postgres}`. `anon`, `authenticated` and
  `service_role` have neither EXECUTE on it nor USAGE on schema `private`.
- Exactly one cron job in the database: `financialgoal-cleanup-abandoned-registrations`,
  schedule `17 3 * * *` (03:17 UTC), active, runs as `postgres` in database `postgres`.
  `postgres` owns the function and has the needed privileges on every guarded table.
- The job is **scheduled**; no run had happened yet at verification time (zero entries
  in `cron.job_run_details`). The first run is 30 October 2026 03:17 UTC. Cleanup was not
  run manually.

Check the schedule (expect exactly one active row, `17 3 * * *`, username `postgres`):
```sql
select jobid, jobname, schedule, active, username from cron.job
where jobname = 'financialgoal-cleanup-abandoned-registrations';
```
Monitor runs in Supabase > Integrations > Cron > History, or:
```sql
select status, return_message, start_time from cron.job_run_details
where jobid = (select jobid from cron.job
  where jobname = 'financialgoal-cleanup-abandoned-registrations')
order by start_time desc limit 5;
```
To pause cleanup:
```sql
select cron.unschedule('financialgoal-cleanup-abandoned-registrations');
```
Pausing does not restore deleted accounts. No cleanup has been run against live data
by the agent. SMTP and redirects were configured separately; the user reported a
successful confirmation/setup flow. The registration website changes are pushed
(c37c65c) and live.
