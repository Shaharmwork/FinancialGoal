'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FieldLabel, GhostButton, GoldButton, inputClassName, Notice, Panel } from '@/components/ui/kit'
import { registerWithEmailPassword, resendConfirmationEmail, sendPasswordReset, updateAccountPassword } from '@/lib/supabase'
import { authErrorMessage, MIN_PASSWORD_LENGTH, passwordError } from '@/lib/registration'
import OwlIcon from '@/src/assets/web/icons/Owlicon.png'

type Mode = 'signin' | 'signup' | 'confirm' | 'forgot'
interface LoginFormProps {
  isBusy: boolean
  isConfigured: boolean
  onSubmit: (email: string, password: string) => Promise<void | "confirmation-required">
  linkError?: string
}

export function LoginForm({ isBusy, isConfigured, onSubmit, linkError = '' }: LoginFormProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [hideLinkError, setHideLinkError] = useState(false)
  const lock = useRef(false)
  const busy = isBusy || working
  const disabled = !isConfigured || busy
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  const changeMode = (next: Mode) => {
    if (busy) return
    setMode(next); setError(''); setNotice(''); setPassword(''); setConfirmation(''); setShowPassword(false); setHideLinkError(true)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled || lock.current || ((mode === 'confirm' || mode === 'forgot') && cooldown > 0)) return
    setError(''); setNotice('')
    if (mode === 'signup') {
      const message = passwordError(password, confirmation)
      if (message) { setError(message); return }
    }
    lock.current = true; setWorking(true)
    try {
      if (mode === 'signin') {
        const result = await onSubmit(email.trim(), password)
        if (result === 'confirmation-required') {
          setMode('confirm'); setPassword(''); setConfirmation(''); setShowPassword(false)
          setNotice('Your email is not confirmed yet. Check your inbox and spam/junk folder for the confirmation link, or request a new one below.')
        }
      }
      if (mode === 'signup') {
        const data = await registerWithEmailPassword(email.trim(), password, name.trim())
        setPassword(''); setConfirmation(''); setShowPassword(false)
        if (!data.session) {
          setMode('confirm'); setCooldown(60)
          setNotice('Check your inbox and spam/junk folder for a confirmation link. If this email already has an account, sign in instead.')
        }
      }
      if (mode === 'confirm') {
        await resendConfirmationEmail(email.trim())
        setCooldown(60)
        setNotice('If confirmation is needed for this address, a new link has been requested. Check your inbox and spam/junk folder, and use the newest email.')
      }
      if (mode === 'forgot') {
        const requestedEmail = email.trim()
        await sendPasswordReset(requestedEmail)
        setCooldown(60)
        setNotice(`A password-reset link has been requested for ${requestedEmail}. Check your inbox and spam/junk folder, allow a few minutes, and use the newest link.`)
      }
    } catch (cause) {
      const code = (cause as { code?: string })?.code
      if (mode === 'forgot' && code === 'account_lookup_rate_limited') {
        setCooldown((cause as { retryAfter?: number }).retryAfter ?? 60)
      }
      if (mode === 'signup' && ['signup_account_recovery', 'user_already_exists', 'email_exists'].includes(code ?? '')) {
        setMode('signin'); setPassword(''); setConfirmation(''); setShowPassword(false)
      }
      setError(authErrorMessage(cause))
    }
    finally { lock.current = false; setWorking(false) }
  }
  const visibleError = error || (!hideLinkError ? linkError : '')
  const title = { signin: 'Welcome back', signup: 'Step 1 · Create your account', confirm: 'Step 2 · Confirm your email', forgot: 'Reset your password' }[mode]
  return <div className="space-y-5">
    <header className="flex flex-col items-center text-center">
      <span className="relative h-20 w-20"><Image alt="" className="object-contain" fill priority sizes="80px" src={OwlIcon}/></span>
      <h1 className="dashboard-gold-title mt-3 text-[28px] font-bold">Financial Goal</h1>
      <p className="mt-2 text-sm text-[#b0947a]">Your freelance work. A clearer financial future.</p>
    </header>
    <Panel title={title}>
      {mode === 'signup' ? <p className="mb-5 text-sm leading-relaxed text-[#c9af91]">Create an account, confirm your email, then build your personal plan one step at a time. Made for Dutch freelancers, with amounts in euros.</p> : null}
      {mode === 'confirm' ? <p className="mb-5 text-sm leading-relaxed text-[#c9af91]">Open the confirmation link in your email to continue to setup. If it has not arrived after a few minutes, check your spam/junk folder and the email address below before requesting another link. If you find it in spam, mark it as not spam.</p> : null}
      {mode === 'forgot' ? <p className="mb-5 text-sm text-[#c9af91]">Check your email address below, then select Send reset link. Your current password is not needed. No email is requested until you press that button.</p> : null}
      {visibleError ? <div role="alert" className="relative mb-4">
        <Notice title={visibleError} tone="danger"/>
        {mode === 'signin' || mode === 'forgot' ? <div className="mt-3 flex flex-wrap gap-2">
          {mode === 'signin' ? <GhostButton disabled={busy} onClick={() => changeMode('forgot')}>Reset password</GhostButton> : null}
          <GhostButton disabled={busy} onClick={() => changeMode('signup')}>Create account</GhostButton>
        </div> : null}
      </div> : null}
      {notice ? <div className="relative mb-4">
        <div role="status"><Notice title={notice} tone="info"/></div>
        {mode === 'forgot' ? <div className="mt-3">
          <GhostButton disabled={busy} onClick={() => changeMode('signup')}>Create account</GhostButton>
        </div> : null}
      </div> : null}
      <form className="relative space-y-4" onSubmit={submit}>
        {mode === 'signup' ? <label className="block"><FieldLabel>Your name (optional)</FieldLabel>
          <input className={inputClassName(false, "text-base")} autoComplete="given-name" maxLength={60} disabled={disabled} value={name} onChange={event => setName(event.target.value)}/>
          <span className="mt-1 block text-xs text-[#b0947a]">Used in your dashboard greeting. Leave blank for a greeting without a name.</span></label> : null}
        <label className="block"><FieldLabel>Email address</FieldLabel>
          <input required type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} className={inputClassName(false, "text-base")} disabled={disabled}
            value={email} onChange={event => setEmail(event.target.value)}/></label>
        {mode === 'signin' || mode === 'signup' ? <>
          <label className="block" htmlFor="auth-password"><FieldLabel>Password</FieldLabel></label>
          <div className="flex gap-2">
            <input id="auth-password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'}
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined} className={inputClassName(false,'min-w-0 flex-1 text-base')} disabled={disabled} value={password} onChange={event => setPassword(event.target.value)}/>
            <GhostButton aria-pressed={showPassword} disabled={disabled} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</GhostButton>
          </div>
          {mode === 'signup' ? <>
            <p className="text-sm text-[#b0947a]">Use at least 10 characters. A long, unique phrase works well.</p>
            <label className="block"><FieldLabel>Confirm password</FieldLabel>
              <input required autoComplete="new-password" type={showPassword ? 'text' : 'password'} className={inputClassName(false, "text-base")} disabled={disabled}
                value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
          </> : null}
        </> : null}
        <GoldButton className="w-full" type="submit" disabled={disabled || ((mode === 'confirm' || mode === 'forgot') && cooldown > 0)}>
          {busy ? 'Please wait…' : (mode === 'confirm' || mode === 'forgot') && cooldown > 0 ? `Try again in ${cooldown}s` : {signin:'Sign in', signup:'Create account', confirm:'Resend confirmation', forgot:'Send reset link'}[mode]}
        </GoldButton>
        {!isConfigured ? <p role="alert" className="text-sm text-[#ffb4a7]">Account services are unavailable. Please contact the app owner.</p> : null}
      </form>
      {mode !== 'signin' || !visibleError ? <div className="relative mt-5 flex flex-wrap justify-center gap-2 border-t border-[#a8744a]/25 pt-4">
        {mode === 'signin' ? <>
          <GhostButton disabled={busy} onClick={() => changeMode('signup')}>Create account</GhostButton>
          <GhostButton disabled={busy} onClick={() => changeMode('forgot')}>Reset password</GhostButton>
        </> : <GhostButton disabled={busy} onClick={() => changeMode('signin')}>Back to sign in</GhostButton>}
      </div> : null}
    </Panel>
    {mode === 'signup' ? <p className="text-center text-xs text-[#b0947a]">Account → Email confirmation → Personal setup → Dashboard</p> : null}
  </div>
}

export function PasswordResetForm({ onComplete, onCancel }: { onComplete: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  return <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center p-5">
    <h1 className="dashboard-gold-title mb-5 text-3xl font-bold">Choose a new password</h1>
    <Panel>
      <form className="relative space-y-4" onSubmit={async event => {
        event.preventDefault()
        if (lock.current) return
        const message = passwordError(password, confirmation)
        if (message) { setError(message); return }
        lock.current = true; setBusy(true); setError('')
        try { await updateAccountPassword(password); setPassword(''); setConfirmation(''); onComplete() }
        catch (cause) { setError(authErrorMessage(cause)) }
        finally { lock.current = false; setBusy(false) }
      }}>
        <p className="text-sm text-[#b0947a]">Use at least 10 characters, different from your old password.</p>
        <label className="block"><FieldLabel>New password</FieldLabel><input required autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} type={show ? 'text' : 'password'} className={inputClassName(false, "text-base")} value={password} disabled={busy} onChange={event => setPassword(event.target.value)}/></label>
        <label className="block"><FieldLabel>Confirm new password</FieldLabel><input required autoComplete="new-password" type={show ? 'text' : 'password'} className={inputClassName(false, "text-base")} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)}/></label>
        <GhostButton disabled={busy} aria-pressed={show} onClick={() => setShow(!show)}>{show ? 'Hide passwords' : 'Show passwords'}</GhostButton>
        {error ? <p role="alert" className="text-sm text-[#ffb4a7]">{error}</p> : null}
        <GoldButton disabled={busy} className="w-full" type="submit">{busy ? 'Updating…' : 'Update password'}</GoldButton>
        <GhostButton disabled={busy} className="w-full" onClick={onCancel}>Cancel and sign out</GhostButton>
      </form>
    </Panel>
  </main>
}
