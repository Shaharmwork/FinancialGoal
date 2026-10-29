import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import { ALERT_SENDER, deliverOneAlert, type RegistrationAlert } from '../../server/registration-alerts'

export default async () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const password = process.env.ALERT_SMTP_PASSWORD
  if (!key || !password) {
    console.error('Registration alerts are not configured: missing server credentials.')
    throw new Error('Registration alert credentials missing')
  }
  const db = createClient('https://kyugvndvfjwpjnvorrhg.supabase.co', key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(4000) }) },
  })
  const smtp = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: ALERT_SENDER, pass: password.replace(/\s/g, '') },
    connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 6000,
    logger: false, debug: false,
  })
  // Scheduled functions have a 30s limit. Handle one message each five-minute run;
  // a backlog drains across runs. There is no public HTTP invocation endpoint.
  try {
    const outcome = await deliverOneAlert({
      claim: async () => {
        const { data, error } = await db.rpc('claim_registration_alert')
        if (error) throw new Error('Could not claim registration alert')
        return data as RegistrationAlert | null
      },
      send: (message) => smtp.sendMail(message),
      finish: async (alert, outcome, errorCode) => {
        const { data, error } = await db.rpc('finish_registration_alert', {
          p_id: alert.id, p_claim_token: alert.claim_token,
          p_outcome: outcome, p_error_code: errorCode ?? null,
        })
        if (error || data !== true) throw new Error('Could not record registration alert outcome; review queue before retrying')
      },
    })
    // Never log account addresses, names, SMTP responses, or credentials.
    console.log(`Registration alerts: ${outcome}`)
    if (outcome === 'failed' || outcome === 'uncertain') throw new Error(`Registration alert ${outcome}; review private queue`)
  } finally {
    smtp.close()
  }
}
