import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthChangeEvent } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null | undefined
const SESSION_TIMEOUT_MS = 2000
const SUPABASE_AUTH_STORAGE_KEY_PREFIX = 'sb'

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

function getSupabaseAuthStorageKey() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  if (!supabaseUrl) {
    return undefined
  }

  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
    return `${SUPABASE_AUTH_STORAGE_KEY_PREFIX}-${projectRef}-auth-token`
  } catch {
    return undefined
  }
}

function isInvalidRefreshTokenError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()

  return (
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('refresh token: refresh token not found')
  )
}

function clearStoredSupabaseSession() {
  if (typeof window === 'undefined') {
    return
  }

  const storageKey = getSupabaseAuthStorageKey()

  if (!storageKey) {
    return
  }

  window.localStorage.removeItem(storageKey)
  window.localStorage.removeItem(`${storageKey}-code-verifier`)
}

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    return null
  }

  if (browserClient !== undefined) {
    return browserClient
  }

  browserClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storageKey: getSupabaseAuthStorageKey(),
      },
    },
  )

  return browserClient
}

export async function getCurrentSession() {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return null
  }

  let timeoutId: number | undefined

  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutId = window.setTimeout(() => {
      console.warn('[Financial Goal] Supabase getSession timed out. Returning null session.')
      resolve(null)
    }, SESSION_TIMEOUT_MS)
  })

  const sessionPromise = supabase.auth
    .getSession()
    .then(({ data, error }) => {
      if (error) {
        throw error
      }

      return data.session
    })
    .catch((error) => {
      if (isInvalidRefreshTokenError(error)) {
        console.warn(
          '[Financial Goal] Supabase session had an invalid refresh token. Cleared local auth state.',
        )
        clearStoredSupabaseSession()
        return null
      }

      console.error('[Financial Goal] Supabase getSession failed.', error)
      return null
    })
    .finally(() => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    })

  return Promise.race([sessionPromise, timeoutPromise])
}

export async function signInWithEmailPassword(email: string, password: string) {
  const supabase = getSupabaseClient()

  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    if (error.code === 'invalid_credentials') {
      // Only inspect membership after a rejected sign-in. Lookup outages or
      // throttling must not prevent a correct password from signing in.
      let exists: boolean | undefined
      try { exists = await checkAccountEmail(email) } catch { /* retain the original auth error */ }
      if (exists === false) throw accountError('account_not_found')
      if (exists === true) throw accountError('incorrect_password')
    }
    throw error
  }

  return data
}

export async function signOutFromSupabase() {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return
  }

  const { error } = await supabase.auth.signOut()

  if (error) {
    if (isInvalidRefreshTokenError(error)) {
      clearStoredSupabaseSession()
      return
    }

    throw error
  }
}

export function onSupabaseAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
) {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return () => undefined
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })

  return () => {
    subscription.unsubscribe()
  }
}

// Redirect back to this static app; Supabase's allowed redirect list is enforced.
function authRedirectUrl() {
  return new URL(window.location.pathname, window.location.origin).href
}

function requireAuthClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Account services are unavailable.')
  return client
}

export async function registerWithEmailPassword(email: string, password: string, displayName: string) {
  const { data, error } = await requireAuthClient().auth.signUp({
    email, password,
    options: { emailRedirectTo: authRedirectUrl(), data: { display_name: displayName } },
  })
  if (error) throw error
  // Supabase can mask a repeated signup with a user that has no identities.
  // This is not proof that a new confirmation email was sent (invites can also
  // be masked). Offer account recovery without querying the account directory.
  if (!data.session && Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
    throw Object.assign(new Error('Registration requires account recovery.'), { code: 'signup_account_recovery' })
  }
  return data
}

export async function resendConfirmationEmail(email: string) {
  const { error } = await requireAuthClient().auth.resend({
    type: 'signup', email, options: { emailRedirectTo: authRedirectUrl() },
  })
  if (error) throw error
}

function accountError(code: string, retryAfter?: number) {
  return Object.assign(new Error(code), { code, retryAfter })
}

// Only a literal, validated boolean can establish that an account is missing.
export async function checkAccountEmail(email: string): Promise<boolean> {
  let result
  try { result = await requireAuthClient().rpc('check_account_email', { p_email: email.trim() }) }
  catch { throw accountError('account_lookup_unavailable') }
  const { data, error } = result
  if (error) throw accountError('account_lookup_unavailable')
  if (data?.status === 'rate_limited') {
    const retryAfter = typeof data.retry_after === 'number' && Number.isFinite(data.retry_after)
      ? Math.min(3600, Math.max(1, Math.ceil(data.retry_after))) : 60
    throw accountError('account_lookup_rate_limited', retryAfter)
  }
  if (data?.status === 'invalid_email') throw accountError('invalid_email')
  if (data?.status !== 'ok' || typeof data.exists !== 'boolean') throw accountError('account_lookup_unavailable')
  return data.exists
}

export async function sendPasswordReset(email: string) {
  const address = email.trim()
  if (!await checkAccountEmail(address)) throw accountError('account_not_found')
  const { error } = await requireAuthClient().auth.resetPasswordForEmail(address, { redirectTo: authRedirectUrl() })
  if (error) throw error
}

export async function updateAccountPassword(password: string) {
  const { error } = await requireAuthClient().auth.updateUser({ password })
  if (error) throw error
}
