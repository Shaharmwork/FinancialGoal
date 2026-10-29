// Read entry intent without consuming Supabase's confirmation/recovery parameters.
export function getPublicEntryMode(url: URL): 'signin' | 'signup' | null {
  const hash = new URLSearchParams(url.hash.slice(1))
  if (url.searchParams.has('error') || hash.has('error') || url.searchParams.has('code') || hash.has('access_token')) return 'signin'
  const mode = url.searchParams.get('auth')
  return mode === 'signin' || mode === 'signup' ? mode : null
}
