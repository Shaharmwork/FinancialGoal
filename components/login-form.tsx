'use client'

import { useState, type FormEvent } from 'react'

interface LoginFormProps {
  errorMessage: string
  isBusy: boolean
  isConfigured: boolean
  onSubmit: (email: string, password: string) => Promise<void>
}

export function LoginForm({ errorMessage, isBusy, isConfigured, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const handleTogglePassword = () => {
    if (!isConfigured || isBusy) {
      return
    }

    setShowPassword((currentValue) => {
      return !currentValue
    })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isConfigured || isBusy) {
      return
    }

    await onSubmit(email.trim(), password)
  }

  return (
    <div className="space-y-4 pb-8">
      <section className="rounded-[1.9rem] border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Sign in</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Use your existing Supabase email and password.
        </p>

        {errorMessage ? (
          <div
            aria-live="polite"
            className="mt-4 rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
          >
            {errorMessage}
          </div>
        ) : null}

        <form className="mt-4 space-y-4" onSubmit={handleSubmit} suppressHydrationWarning>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-foreground">Email</span>
            <input
              autoComplete="email"
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
              disabled={!isConfigured || isBusy}
              onChange={(event) => setEmail(event.target.value)}
              suppressHydrationWarning
              type="email"
              value={email}
            />
          </label>

          <div className="block">
            <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="login-password">
              Password
            </label>
            <div className="flex items-center gap-2">
              <input
                id="login-password"
                autoComplete="current-password"
                className="min-w-0 flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none transition focus:border-primary"
                disabled={!isConfigured || isBusy}
                onChange={(event) => setPassword(event.target.value)}
                suppressHydrationWarning
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <button
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="shrink-0 rounded-2xl border border-border bg-background px-3 py-3 text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
                disabled={!isConfigured || isBusy}
                onClick={handleTogglePassword}
                type="button"
              >
                <span className="flex items-center gap-2">
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </span>
              </button>
            </div>
          </div>

          <button
            className="w-full rounded-2xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!isConfigured || isBusy}
            type="submit"
          >
            {isBusy ? 'Signing in...' : 'Sign in'}
          </button>

          {!isConfigured ? (
            <p className="text-sm text-muted-foreground">
              Add your Supabase URL and anon key to `.env.local` first.
            </p>
          ) : null}
        </form>
      </section>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M2.7 12c1.8-3.2 5-5.2 9.3-5.2s7.5 2 9.3 5.2c-1.8 3.2-5 5.2-9.3 5.2S4.5 15.2 2.7 12Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M3.5 3.5 20.5 20.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M10.7 6.9A10.6 10.6 0 0 1 12 6.8c4.3 0 7.5 2 9.3 5.2a11 11 0 0 1-4 4.1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M8.9 8.1A11 11 0 0 0 2.7 12c1.8 3.2 5 5.2 9.3 5.2 1 0 2-.1 2.9-.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path
        d="M10.4 10.4A2.7 2.7 0 0 0 12 14.7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}
