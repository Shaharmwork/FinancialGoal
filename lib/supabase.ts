import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthChangeEvent } from '@supabase/supabase-js'

let browserClient: SupabaseClient | null | undefined
const SESSION_TIMEOUT_MS = 2000

export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
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
        persistSession: true,
        detectSessionInUrl: false,
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

  const timeoutPromise = new Promise<null>((resolve) => {
    window.setTimeout(() => {
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
      console.error('[Financial Goal] Supabase getSession failed.', error)
      return null
    })

  return Promise.race([sessionPromise, timeoutPromise])
}

export async function signInWithEmailPassword(email: string, password: string) {
  const supabase = getSupabaseClient()

  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    throw error
  }
}

export async function signOutFromSupabase() {
  const supabase = getSupabaseClient()

  if (!supabase) {
    return
  }

  const { error } = await supabase.auth.signOut()

  if (error) {
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
