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
        detectSessionInUrl: false,
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
