'use client'

import Image from 'next/image'
import { useState, type FormEvent } from 'react'
import { FieldLabel, GhostButton, GoldButton, inputClassName, Notice, Panel } from '@/components/ui/kit'
import OwlIcon from '@/src/assets/web/icons/Owlicon.png'

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
    <div className="space-y-5">
      <div className="flex flex-col items-center text-center">
        <span className="relative h-20 w-20">
          <Image alt="" className="object-contain" fill priority sizes="80px" src={OwlIcon} />
        </span>
        <h1 className="dashboard-gold-title mt-3 text-[28px] font-bold">Financial Goal</h1>
        <p className="mt-1 text-sm text-[#b0947a]">Your freelance hours, income and tax reserve.</p>
      </div>

      <Panel title="Sign in">
        {errorMessage ? (
          <div aria-live="polite" className="mb-4">
            <Notice title={errorMessage} tone="danger" />
          </div>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit} suppressHydrationWarning>
          <label className="block">
            <FieldLabel>Email</FieldLabel>
            <input
              autoComplete="email"
              className={inputClassName()}
              disabled={!isConfigured || isBusy}
              onChange={(event) => setEmail(event.target.value)}
              suppressHydrationWarning
              type="email"
              value={email}
            />
          </label>

          <div className="block">
            <label htmlFor="login-password">
              <FieldLabel>Password</FieldLabel>
            </label>
            <div className="flex items-center gap-2">
              <input
                id="login-password"
                autoComplete="current-password"
                className={inputClassName(false, 'flex-1')}
                disabled={!isConfigured || isBusy}
                onChange={(event) => setPassword(event.target.value)}
                suppressHydrationWarning
                type={showPassword ? 'text' : 'password'}
                value={password}
              />
              <GhostButton
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="shrink-0 px-3"
                disabled={!isConfigured || isBusy}
                onClick={handleTogglePassword}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </GhostButton>
            </div>
          </div>

          <GoldButton className="w-full" disabled={!isConfigured || isBusy} type="submit">
            {isBusy ? 'Signing in…' : 'Sign in'}
          </GoldButton>

          {!isConfigured ? (
            <p className="text-sm text-[#a88c71]">
              Add your Supabase URL and anon key to `.env.local` first.
            </p>
          ) : null}
        </form>
      </Panel>
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
