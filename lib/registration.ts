import type { Settings } from './types'

export const MIN_PASSWORD_LENGTH = 10

export function passwordError(password: string, confirmation: string) {
  if (password.length < MIN_PASSWORD_LENGTH) return 'Use at least 10 characters for your password.'
  if (password !== confirmation) return 'The passwords do not match.'
  return ''
}

export function authErrorMessage(error: unknown) {
  const code = (error as { code?: string })?.code
  if (code === 'email_not_confirmed') return 'Confirm your email first. You can request another confirmation email below.'
  if (code === 'user_already_exists' || code === 'email_exists') return 'This email is already registered. Sign in or use Forgot password to reset your password.'
  if (code === 'signup_account_recovery') return 'This email may already be registered. Sign in or use Forgot password to reset your password. If you received an invitation, use the link in that email.'
  if (code === 'weak_password') return 'Choose a stronger password. Try a longer phrase with a mix of letters, numbers and symbols.'
  if (code === 'signup_disabled') return 'Registration is currently unavailable. Please try again later.'
  if (code === 'email_address_not_authorized') return 'Email delivery is not ready for this address. Please contact the app owner.'
  if (code === 'over_email_send_rate_limit') return 'The app has reached its email-sending limit. Please wait before requesting another email. If this continues, contact the app owner.'
  if (code === 'over_request_rate_limit') return 'Too many requests. Please wait before trying again.'
  if (code === 'invalid_credentials') return 'The email or password is incorrect.'
  if (code === 'same_password') return 'Choose a different password from your current one.'
  return 'We could not complete that request. Check your connection and try again.'
}

export type SetupDraft = {
  target: string; spouse: string; hourlyRate: string; shiftHours: string
  weeklyHours: string; vacation: string; reserve: string; deduction: string; starter: string
}

export const initialSetupDraft: SetupDraft = {
  target: '', spouse: '0', hourlyRate: '', shiftHours: '',
  weeklyHours: '', vacation: '', reserve: '5', deduction: 'no', starter: 'no',
}

export const setupStepLabels = ['Your goal', 'Your work', 'Tax assumptions', 'Review'] as const
export const setupFieldSteps: Record<keyof SetupDraft, number> = {
  target: 0, spouse: 0, hourlyRate: 1, shiftHours: 1, weeklyHours: 1,
  vacation: 1, reserve: 2, deduction: 2, starter: 2,
}

export function setupErrors(draft: SetupDraft): Partial<Record<keyof SetupDraft, string>> {
  const errors: Partial<Record<keyof SetupDraft, string>> = {}
  const number = (key: keyof SetupDraft, label: string, min: number, max: number, integer = false) => {
    const value = Number(draft[key])
    if (!draft[key].trim() || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      errors[key] = `Enter ${label} between ${min} and ${max}${integer ? ' (whole days)' : ''}.`
    }
  }
  number('target', 'a monthly target', 1, 1000000)
  number('spouse', 'monthly household income', 0, 1000000)
  number('hourlyRate', 'an hourly rate', 0.01, 10000)
  number('shiftHours', 'hours per workday', 0.25, 24)
  number('weeklyHours', 'weekly hours', 0.25, 168)
  number('vacation', 'days off', 0, 260, true)
  number('reserve', 'a buffer percentage', 0, 100)
  if (!['yes', 'no', 'unsure'].includes(draft.deduction)) errors.deduction = 'Choose an answer, including Not sure if needed.'
  if (draft.deduction === 'yes' && !['yes', 'no', 'unsure'].includes(draft.starter)) errors.starter = 'Choose an answer for the starters deduction.'
  return errors
}

export function settingsFromSetup(draft: SetupDraft): Settings {
  if (Object.keys(setupErrors(draft)).length) throw new Error('Complete the highlighted setup fields.')
  return {
    targetNetMonth: Number(draft.target), spouseMonthlyIncome: Number(draft.spouse),
    defaultShiftIncome: Math.round(Number(draft.hourlyRate) * Number(draft.shiftHours) * 100) / 100,
    defaultShiftHours: Number(draft.shiftHours), weeklyHoursTarget: Number(draft.weeklyHours),
    vacationDaysPerYear: Number(draft.vacation), reserveBufferPercent: Number(draft.reserve),
    qualifiesForSelfEmployedDeduction: draft.deduction === 'yes',
    qualifiesForStartersDeduction: draft.deduction === 'yes' && draft.starter === 'yes',
  }
}

// Only known string fields are restored; never restore auth data or a save result.
export function restoreSetupDraft(value: string | null): { draft: SetupDraft; step: number } | null {
  try {
    const parsed = JSON.parse(value ?? 'null')
    if (parsed?.version !== 1 || !parsed.draft || typeof parsed.draft !== 'object') return null
    const draft = { ...initialSetupDraft }
    for (const key of Object.keys(draft) as (keyof SetupDraft)[]) {
      if (typeof parsed.draft[key] === 'string') draft[key] = parsed.draft[key].slice(0, 100)
    }
    return { draft, step: Number.isInteger(parsed.step) ? Math.max(0, Math.min(3, parsed.step)) : 0 }
  } catch { return null }
}
