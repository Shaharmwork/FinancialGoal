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
The live dry run found zero eligible accounts. Automatic migration application failed
with an expired-request integration error; this migration is **not enabled yet**.

After applying, verify the schedule:
```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'financialgoal-cleanup-abandoned-registrations';
```
Monitor runs in Supabase > Integrations > Cron > History. To pause cleanup:
```sql
select cron.unschedule('financialgoal-cleanup-abandoned-registrations');
```
Pausing does not restore deleted accounts. No cleanup has been run against live data
by the agent. SMTP and redirects were configured separately; the user reported a
successful confirmation/setup flow. Website changes remain local.
