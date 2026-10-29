// Server-only: imported exclusively by the Netlify scheduled function and tests.
export const ALERT_RECIPIENT = 'shaharmwork@gmail.com'
export const ALERT_SENDER = 'rekindledverbouw@gmail.com'

export type RegistrationAlert = {
  id: string
  claim_token: string
  kind: 'registration' | 'test'
  email: string
  display_name: string | null
  registered_at: string
  confirmed_at: string
}
export type Outcome = 'sent' | 'retry' | 'failed' | 'uncertain'
export type AlertDependencies = {
  claim(): Promise<RegistrationAlert | null>
  finish(alert: RegistrationAlert, outcome: Outcome, errorCode?: string): Promise<void>
  send(message: ReturnType<typeof buildAlertMessage>): Promise<{ accepted: unknown[] }>
}

// Plain text, fixed headers and recipient: user-entered names cannot inject HTML or headers.
const clean = (value: string) => value.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 254)
const date = (value: string) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam',
}).format(new Date(value))
export function buildAlertMessage(alert: RegistrationAlert) {
  const text = alert.kind === 'test'
    ? 'This is a test of FinancialGoal owner alerts. No new user account was created.\n\nFuture alerts will be sent after a new user confirms their email.'
    : [
      'A new FinancialGoal user has confirmed their email.', '',
      `Name: ${clean(alert.display_name || 'Not provided')}`,
      `Email: ${clean(alert.email)}`,
      `Registered: ${date(alert.registered_at)}`,
      `Confirmed: ${date(alert.confirmed_at)}`,
      'Times are in Europe/Amsterdam.', '',
      'Open Supabase to manage users:',
      'https://supabase.com/dashboard/project/kyugvndvfjwpjnvorrhg/auth/users',
    ].join('\n')
  return {
    from: { name: 'FinancialGoal alerts', address: ALERT_SENDER },
    to: ALERT_RECIPIENT,
    subject: alert.kind === 'test' ? '[TEST] FinancialGoal signup alerts are connected' : 'FinancialGoal — new confirmed user',
    messageId: `<financialgoal-registration-${alert.id}@gmail.com>`,
    text,
    disableFileAccess: true,
    disableUrlAccess: true,
  }
}

export function classifyMailFailure(error: unknown): { outcome: Outcome; code: string } {
  const e = error as { code?: string; command?: string; responseCode?: number }
  const code = typeof e?.code === 'string' && /^[A-Z_]{1,40}$/.test(e.code) ? e.code : 'MAIL_ERROR'
  // An explicit SMTP rejection means the server did not accept the message.
  if (e?.responseCode && e.responseCode >= 400 && e.responseCode < 600) {
    return { outcome: e.responseCode < 500 ? 'retry' : 'failed', code }
  }
  // Connection/auth/envelope failures occur before the message body is sent.
  if (/^(CONN|EHLO|HELO|STARTTLS|AUTH.*|MAIL FROM|RCPT TO)$/.test(e?.command || '')) {
    return { outcome: 'retry', code }
  }
  // A timeout/disconnect during DATA can mean Gmail accepted it but the response was lost.
  return { outcome: 'uncertain', code }
}

export async function deliverOneAlert(deps: AlertDependencies): Promise<'empty' | Outcome> {
  const alert = await deps.claim()
  if (!alert) return 'empty'
  let outcome: Outcome
  let errorCode: string | undefined
  try {
    const result = await deps.send(buildAlertMessage(alert))
    outcome = result.accepted.includes(ALERT_RECIPIENT) ? 'sent' : 'failed'
    if (outcome === 'failed') errorCode = 'RECIPIENT_NOT_ACCEPTED'
  } catch (error) {
    const failure = classifyMailFailure(error)
    outcome = failure.outcome
    errorCode = failure.code
  }
  // A database failure after sending must never be caught as a send failure/retry.
  // The claimed row will instead become uncertain and require review.
  await deps.finish(alert, outcome, errorCode)
  return outcome
}
