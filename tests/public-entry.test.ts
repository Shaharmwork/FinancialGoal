import { describe, expect, it } from 'vitest'
import { getPublicEntryMode } from '@/lib/public-entry'

describe('public landing and account entry', () => {
  it('shows a public homepage unless an account flow was requested', () => {
    expect(getPublicEntryMode(new URL('https://example.test/'))).toBeNull()
    expect(getPublicEntryMode(new URL('https://example.test/?auth=unknown'))).toBeNull()
    expect(getPublicEntryMode(new URL('https://example.test/?auth=signin'))).toBe('signin')
    expect(getPublicEntryMode(new URL('https://example.test/?auth=signup'))).toBe('signup')
  })
  it.each(['?error=expired', '#error=expired', '?code=confirmation', '#access_token=example&type=recovery'])('keeps email callbacks in the account flow: %s', suffix => {
    const url = new URL('https://example.test/' + suffix)
    const before = url.href
    expect(getPublicEntryMode(url)).toBe('signin')
    expect(url.href).toBe(before)
  })
})
