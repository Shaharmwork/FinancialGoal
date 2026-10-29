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


## Owner registration alerts

The Netlify scheduled function `registration-alerts` checks Supabase every five
minutes and sends an owner email to **shaharmwork@gmail.com**, from
**rekindledverbouw@gmail.com**, after email confirmation. Gmail SMTP is reused;
there is no additional sender account or domain requirement. Gmail and Netlify
usage limits still apply. Only the production deployment runs on schedule.

The private queue deduplicates by Supabase user ID. Existing confirmed users are
marked skipped at migration time. Unconfirmed, anonymous and deleted users do
not generate emails. Names and addresses appear only in plain-text owner emails,
not logs; user input never controls recipients, headers, links or attachments.
No financial data is included. No Auth trigger or synchronous email dependency
is added to signup.

### Deployment

1. Apply the `registration_alerts` migration before deploying the worker.
2. Add these **secret** environment variables in Netlify, with values for
   **Production only** (leave previews, branches and local development blank):
   - `SUPABASE_SERVICE_ROLE_KEY`: the project's server-only Supabase service-role
     key (or an equivalent Supabase secret key). Never prefix it with `NEXT_PUBLIC_`.
   - `ALERT_SMTP_PASSWORD`: a Gmail app password belonging to the sender above.
     This is separate from Supabase Auth's saved SMTP setting. Do not use the
     normal Gmail password, put it in Git, or paste it into chat.
   Netlify's free plan does not offer custom scope selection; marking each as a
   secret excludes post-processing. Keep both out of client imports and code.
3. Deploy to the production branch. Changing environment values requires a new
   deploy. Check Functions → registration-alerts for its Scheduled badge.
4. Add a single explicitly labelled test entry using Supabase SQL, then use
   Netlify's Run now button. This does not create an Auth user:

   ```sql
   insert into private.registration_alerts
     (kind,email,display_name,registered_at,confirmed_at)
   values ('test','shaharmwork@gmail.com','Delivery test',now(),now());
   ```

5. Confirm the test arrives in the destination mailbox, including its Inbox/Spam
   placement, and that a second run sends nothing. A `sent` queue status means
   Gmail accepted the message; it does not prove delivery or Inbox placement.

### Failure handling and monitoring

One email is processed per five-minute run (12/hour); bursts wait in the queue.
Known temporary pre-delivery failures retry after 15 minutes, at most five
attempts. Permanent rejections are marked `failed`. Timeouts during delivery,
interrupted workers, or a failed database acknowledgment after SMTP acceptance
are parked as `uncertain` rather than automatically risking duplicate emails.
This intentionally cannot guarantee both exactly-once delivery and automatic
recovery from an ambiguous SMTP outcome.

Review Netlify function errors and, using the Supabase SQL editor:

```sql
select id,kind,status,attempts,claimed_at,sent_at,error_code
from private.registration_alerts order by confirmed_at desc;
```

After resolving a failure, verify the recipient mailbox and sender's Sent mail
before manually resetting the affected row to `pending`; never blindly requeue
an uncertain send. The per-attempt claim token prevents stale acknowledgments.
Test alerts have no user record; real alert records are removed with their user.
To pause sending, remove the Gmail secret and redeploy (queue entries remain).

Local verification: `npm test` and `npm run build`. Database queue tests use
local Postgres via PGlite; SMTP acceptance and mailbox placement need the live
end-to-end test described above.
