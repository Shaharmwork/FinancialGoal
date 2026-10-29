import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptySettings, normalizeSettings } from '@/lib/default-state'
import { initialSetupDraft, passwordError, restoreSetupDraft, settingsFromSetup, setupErrors, authErrorMessage } from '@/lib/registration'

const complete = () => ({ ...initialSetupDraft, target: '3500', hourlyRate: '50', weeklyHours: '32', shiftHours: '8', vacation: '20', deduction: 'yes', starter: 'yes' })

describe('first-use setup', () => {
  it('requires financial values while excluding deductions by default', () => {
    expect(Object.keys(setupErrors(initialSetupDraft))).toEqual(expect.arrayContaining(['target', 'hourlyRate', 'weeklyHours', 'shiftHours', 'vacation']))
    expect(() => settingsFromSetup(initialSetupDraft)).toThrow()
  })
  it('converts the hourly rate into the existing shift-income contract without seeding history', () => {
    const settings = settingsFromSetup(complete())
    expect(settings.defaultShiftIncome).toBe(400)
    expect(settings.targetNetMonth).toBe(3500)
    expect(settings.updatedAt).toBeUndefined()
    expect(settings.qualifiesForStartersDeduction).toBe(true)
  })
  it('defaults missing deductions to no without overwriting saved eligibility', () => {
    expect(emptySettings.qualifiesForSelfEmployedDeduction).toBe(false)
    expect(emptySettings.qualifiesForStartersDeduction).toBe(false)
    expect(normalizeSettings({ qualifiesForSelfEmployedDeduction: null }).qualifiesForSelfEmployedDeduction).toBe(false)
    expect(normalizeSettings({ qualifiesForSelfEmployedDeduction: true }).qualifiesForSelfEmployedDeduction).toBe(true)
    const settings = settingsFromSetup({ ...initialSetupDraft, target: '3500', hourlyRate: '50', weeklyHours: '32', shiftHours: '8', vacation: '20' })
    expect(settings.qualifiesForSelfEmployedDeduction).toBe(false)
    expect(settings.qualifiesForStartersDeduction).toBe(false)
  })
  it('never includes an uncertain or inapplicable deduction', () => {
    expect(settingsFromSetup({ ...complete(), deduction: 'unsure', starter: 'yes' }).qualifiesForStartersDeduction).toBe(false)
    expect(settingsFromSetup({ ...complete(), deduction: 'unsure' }).qualifiesForSelfEmployedDeduction).toBe(false)
    expect(setupErrors({ ...complete(), starter: '' }).starter).toBeTruthy()
  })
  it.each([
    ['target', ''], ['shiftHours', ''], ['vacation', ''], ['spouse', '-1'], ['hourlyRate', 'Infinity'], ['shiftHours', '25'],
    ['weeklyHours', '169'], ['vacation', '1.5'], ['reserve', '101'], ['target', 'NaN'],
  ])('rejects invalid %s value %s', (field, value) => {
    expect(setupErrors({ ...complete(), [field]: value })[field as keyof ReturnType<typeof complete>]).toBeTruthy()
  })
  it('accepts optional zero values and decimal rates', () => {
    expect(settingsFromSetup({ ...complete(), hourlyRate: '43.75', spouse: '0', vacation: '0', reserve: '0' }).defaultShiftIncome).toBe(350)
  })
  it('restores only known fields and bounds the step', () => {
    expect(restoreSetupDraft('broken')).toBeNull()
    expect(restoreSetupDraft(JSON.stringify({ version: 99 }))).toBeNull()
    const restored = restoreSetupDraft(JSON.stringify({ version: 1, step: 100, draft: { ...complete(), password: 'never restore', target: 12 } }))
    expect(restored?.step).toBe(3)
    expect(restored?.draft.target).toBe('')
    expect(restored?.draft).not.toHaveProperty('password')
  })
})

describe('account form validation', () => {
  it('requires a long matching password', () => {
    expect(passwordError('short', 'short')).toBeTruthy()
    expect(passwordError('long unique phrase', 'different')).toBeTruthy()
    expect(passwordError('long unique phrase', 'long unique phrase')).toBe('')
  })
  it('provides useful rate-limit and confirmation recovery messages without exposing raw errors', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toContain('Confirm')
    expect(authErrorMessage({ code: 'over_email_send_rate_limit' })).toContain('email-sending limit')
    expect(authErrorMessage({ code: 'over_request_rate_limit' })).toContain('Too many requests')
    expect(authErrorMessage(new Error('sensitive server response'))).not.toContain('sensitive')
  })
})

describe('Supabase auth requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock('@supabase/supabase-js') })
  async function client() {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-test-key')
    vi.stubGlobal('window', { location: { origin: 'https://test.netlify.app', pathname: '/' } })
    const auth = {
      signUp: vi.fn().mockResolvedValue({ data: { user: { id: 'new', identities: [{ provider: 'email' }] }, session: null }, error: null }),
      resend: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'new' } } }, error: null }),
    }
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'ok', exists: true }, error: null })
    const createClient = vi.fn().mockReturnValue({ auth, rpc })
    vi.doMock('@supabase/supabase-js', () => ({ createClient }))
    return { auth, rpc, createClient, api: await import('@/lib/supabase') }
  }
  it('does not request a reset for a missing account', async () => {
    const { auth, rpc, api } = await client()
    rpc.mockResolvedValueOnce({ data: { status: 'ok', exists: false }, error: null })
    await expect(api.sendPasswordReset('missing@example.com')).rejects.toMatchObject({code:'account_not_found'})
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it.each([
    { data: null, error: { message: 'unavailable' } },
    { data: null, error: null },
    { data: { status: 'ok', exists: 'false' }, error: null },
    { data: { status: 'ok' }, error: null },
  ])('never treats a broken lookup as a missing account or requests a reset: %j', async result => {
    const { auth, rpc, api } = await client()
    rpc.mockResolvedValueOnce(result as never)
    await expect(api.sendPasswordReset('new@example.com')).rejects.toMatchObject({code:'account_lookup_unavailable'})
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it('returns a bounded retry delay and sends no email when throttled', async () => {
    const { auth, rpc, api } = await client()
    rpc.mockResolvedValueOnce({ data: { status: 'rate_limited', retry_after: 121 }, error: null } as never)
    await expect(api.sendPasswordReset('new@example.com')).rejects.toMatchObject({code:'account_lookup_rate_limited', retryAfter:121})
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
  it('does not look up membership on a successful sign-in', async () => {
    const { rpc, api } = await client()
    await expect(api.signInWithEmailPassword('new@example.com','right password')).resolves.toHaveProperty('session')
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([[false, 'account_not_found'], [true, 'incorrect_password']])('explains failed sign-in when membership is %s', async (exists, code) => {
    const { auth, rpc, api } = await client()
    auth.signInWithPassword.mockResolvedValueOnce({data:null, error:{code:'invalid_credentials'}} as never)
    rpc.mockResolvedValueOnce({data:{status:'ok',exists},error:null} as never)
    await expect(api.signInWithEmailPassword('new@example.com','wrong password')).rejects.toMatchObject({code})
  })
  it('retains the original auth error when the lookup is unavailable or throttled', async () => {
    const { auth, rpc, api } = await client()
    for (const result of [{data:null,error:{message:'offline'}}, {data:{status:'rate_limited',retry_after:60},error:null}]) {
      auth.signInWithPassword.mockResolvedValueOnce({data:null, error:{code:'invalid_credentials'}} as never)
      rpc.mockResolvedValueOnce(result as never)
      await expect(api.signInWithEmailPassword('new@example.com','wrong password')).rejects.toMatchObject({code:'invalid_credentials'})
    }
  })
  it('does not replace unconfirmed or rate-limited sign-in responses with password errors', async () => {
    const { auth, rpc, api } = await client()
    for (const code of ['email_not_confirmed', 'over_request_rate_limit']) {
      auth.signInWithPassword.mockResolvedValueOnce({data:null, error:{code}} as never)
      await expect(api.signInWithEmailPassword('new@example.com','password')).rejects.toMatchObject({code})
    }
    expect(rpc).not.toHaveBeenCalled()
  })
  it('supports confirmation-required signup and enables returning email-link sessions', async () => {
    const { auth, api, createClient } = await client()
    const result = await api.registerWithEmailPassword('new@example.com', 'long unique phrase', 'New')
    expect(result.session).toBeNull()
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'long unique phrase', options: { emailRedirectTo: 'https://test.netlify.app/', data: { display_name: 'New' } } })
    expect(createClient.mock.calls[0][2].auth.detectSessionInUrl).toBe(true)
  })
  it('routes an obfuscated duplicate signup to recovery instead of claiming confirmation was sent', async () => {
    const { auth, api } = await client()
    auth.signUp.mockResolvedValueOnce({ data: { user: { id: 'masked', identities: [] }, session: null }, error: null } as never)
    await expect(api.registerWithEmailPassword('existing@example.com', 'long unique phrase', '')).rejects.toMatchObject({ code: 'signup_account_recovery' })
    expect(authErrorMessage({ code: 'signup_account_recovery' })).toContain('may already be registered')
    expect(auth.resend).not.toHaveBeenCalled()
  })
  it('preserves an explicit duplicate error for the sign-in recovery path', async () => {
    const { auth, api } = await client()
    auth.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'user_already_exists' } } as never)
    await expect(api.registerWithEmailPassword('existing@example.com', 'long unique phrase', '')).rejects.toMatchObject({ code: 'user_already_exists' })
    expect(authErrorMessage({ code: 'user_already_exists' })).toContain('already registered')
  })
  it('supports immediate sessions when project confirmation settings differ', async () => {
    const { auth, api } = await client()
    auth.signUp.mockResolvedValueOnce({ data: { session: { user: { id: 'new' } } }, error: null } as never)
    expect((await api.registerWithEmailPassword('new@example.com', 'long unique phrase', '')).session).toBeTruthy()
  })
  it('uses the correct confirmation and recovery endpoints with an app redirect', async () => {
    const { auth, api } = await client()
    await api.resendConfirmationEmail('new@example.com')
    await api.sendPasswordReset('new@example.com')
    await api.updateAccountPassword('replacement phrase')
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'new@example.com', options: { emailRedirectTo: 'https://test.netlify.app/' } })
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('new@example.com', { redirectTo: 'https://test.netlify.app/' })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'replacement phrase' })
  })
  it('does not claim signup succeeded when the provider rejects it', async () => {
    const { auth, api } = await client()
    auth.signUp.mockResolvedValueOnce({ data: null, error: { code: 'signup_disabled' } } as never)
    await expect(api.registerWithEmailPassword('new@example.com', 'long unique phrase', '')).rejects.toEqual({ code: 'signup_disabled' })
  })
})
