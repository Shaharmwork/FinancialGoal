'use client'

import { getDutchPublicHolidayWeekdays } from '@/lib/calculations'
import { useEffect, useRef, useState } from 'react'
import { FieldLabel, GhostButton, GoldButton, inputClassName, Notice, Panel } from '@/components/ui/kit'
import { initialSetupDraft, restoreSetupDraft, settingsFromSetup, setupErrors, setupFieldSteps, setupStepLabels, type SetupDraft } from '@/lib/registration'
import type { Settings } from '@/lib/types'

const setupHelp: Record<keyof SetupDraft, { title: string; body: string }> = {
  holidays: {title: 'Dutch holidays', body: 'Optional approval for weekday holidays. Saved as editable vacation reports when setup is saved.'},
  target: {
    title: 'Take-home per month (Net)',
    body: 'The amount you want your business to provide each month after estimated tax. This is your personal take-home goal, not your invoices or turnover. The dashboard works backward to estimate how much you need to earn before tax.',
  },
  spouse: {
    title: 'Other household income',
    body: 'Optional net income from a partner or another household source, per month. Keep your own business income out of this field. Use 0 if it does not apply. This is separate from your business take-home goal.',
  },
  hourlyRate: {
    title: 'Hourly rate (excluding VAT)',
    body: 'What you charge for one hour of work before VAT. This and your day/shift length set the default amount per day/shift in Configuration. For example, €50 per hour × 8 hours = €400 per day/shift, excluding VAT. You can use a different rate when reporting a job.',
  },
  shiftHours: {
    title: 'Day/shift length',
    body: 'The number of working hours in one standard day or shift. For example, enter 8 for an eight-hour day. Together with your hourly rate, this sets the default day/shift income. Reports can still use the actual hours worked.',
  },
  weeklyHours: {
    title: 'Hours / per week',
    body: 'How many hours you plan to work in a normal week, before days off. For example, five eight-hour days = 40 hours per week. This is your planning target; it does not add logged hours or confirm eligibility for a tax deduction.',
  },
  vacation: {
    title: 'Planned days off / year',
    body: 'Whole weekdays you plan not to work during the year. These reduce the hours available in the planning check, which uses a five-day workweek. Approving Dutch holidays below adds them to this total. You can add extra days; they are not subtracted twice. Do not count weekends again. Enter 0 if you have not planned any yet.',
  },
  reserve: {
    title: 'Reserve buffer',
    body: 'An extra percentage on top of the estimated tax reserve. For example, a 5% buffer on €1,000 of estimated tax means setting aside €1,050. This is a cushion, not your tax rate. Enter 0 for no extra buffer.',
  },
  deduction: {
    title: 'Self-employed deduction',
    body: 'The Dutch zelfstandigenaftrek can reduce taxable business profit if you qualify. The hours criterion generally requires at least 1,225 business hours in the calendar year, and other conditions also apply. A weekly work target does not prove eligibility. Choose Yes only after checking your situation; No or Not sure keeps this deduction out of the estimate.',
  },
  starter: {
    title: 'Starters deduction',
    body: 'The Dutch startersaftrek is an additional deduction for eligible starting entrepreneurs who also qualify for the self-employed deduction. Being new to this app does not make you eligible: your business and deduction history matter. Choose Yes only after checking your eligibility; No or Not sure leaves it out.',
  },
}

type Destination = 'dashboard' | 'daily-log' | 'history'
export function Onboarding({ userId, onSave, onComplete, onSignOut }: {
  userId: string
  onSave: (settings: Settings) => Promise<void>
  onComplete: (destination: Destination) => void
  onSignOut: () => void
}) {
  const storageKey = `financial-goal-setup-v1:${userId}`
  const [draft, setDraft] = useState<SetupDraft>({ ...initialSetupDraft })
  const [step, setStep] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [message, setMessage] = useState('')
  const [storageAvailable, setStorageAvailable] = useState(true)
  const lock = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const errors = setupErrors(draft)
  const fieldErrors = attempted ? errors : {}

  useEffect(() => {
    try {
      const previous = restoreSetupDraft(sessionStorage.getItem(storageKey))
      if (previous) { setDraft(previous.draft); setStep(previous.step) }
    } catch { setStorageAvailable(false) }
    setLoaded(true)
  }, [storageKey])

  useEffect(() => {
    if (!loaded || saved) return
    try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, draft, step })) }
    catch { setStorageAvailable(false) }
  }, [draft, step, loaded, saved, storageKey])

  useEffect(() => {
    if (loaded) { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'auto' }) }
  }, [step, saved, loaded])

  const update = (key: keyof SetupDraft, value: string) => {
    setDraft(current => ({ ...current, [key]: value, ...(key === 'deduction' && value !== 'yes' ? { starter: '' } : {}) }))
    setMessage('')
  }
  const numberField = (key: keyof SetupDraft, label: string, hint: string, min: number, max: number, increment = '0.01', placeholder?: string) => (
    <div className="block">
      <FieldLabel info={setupHelp[key]}><label htmlFor={`setup-${key}`}>{label}</label></FieldLabel>
      <input id={`setup-${key}`} required type="number" inputMode="decimal" min={min} max={max} step={increment} placeholder={placeholder}
        className={inputClassName(Boolean(fieldErrors[key]), "text-base")} value={draft[key]} disabled={busy}
        aria-invalid={Boolean(fieldErrors[key])} aria-describedby={`setup-${key}-hint`}
        onChange={event => update(key, event.target.value)} />
      <span id={`setup-${key}-hint`} className={`mt-1 block text-sm ${fieldErrors[key] ? 'text-[#ffb4a7]' : 'text-[#b0947a]'}`}>
        {fieldErrors[key] ?? hint}
      </span>
    </div>
  )
  const choice = (key: 'deduction' | 'starter', label: string) => (
    <div className="block">
      <FieldLabel info={setupHelp[key]}><label htmlFor={`setup-${key}`}>{label}</label></FieldLabel>
      <select id={`setup-${key}`} className={inputClassName(Boolean(fieldErrors[key]), "text-base")} value={draft[key]}
        disabled={busy} aria-invalid={Boolean(fieldErrors[key])} onChange={event => update(key, event.target.value)}>
        <option value="">Choose an answer</option><option value="yes">Yes, eligibility confirmed</option>
        <option value="no">No</option><option value="unsure">Not sure — leave it out for now</option>
      </select>
      {fieldErrors[key] ? <p className="mt-1 text-sm text-[#ffb4a7]">{fieldErrors[key]}</p> : null}
    </div>
  )
  const submit = async () => {
    if (lock.current) return
    setAttempted(true)
    const invalid = (Object.keys(errors) as (keyof SetupDraft)[]).find(key => step === 3 || setupFieldSteps[key] === step)
    if (invalid) {
      if (step === 3) setStep(setupFieldSteps[invalid])
      setMessage('Please check the highlighted fields before continuing.')
      document.getElementById(`setup-${invalid}`)?.focus()
      return
    }
    if (step < 3) { setStep(step + 1); setAttempted(false); setMessage(''); return }
    lock.current = true
    setBusy(true); setMessage('')
    try {
      await onSave(settingsFromSetup(draft))
      setSaved(true)
      try { sessionStorage.removeItem(storageKey) } catch { /* saved remotely */ }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Saving failed. Your entries are still here. Try again.')
    } finally { lock.current = false; setBusy(false) }
  }

  if (!loaded) return <p className="p-6 text-center">Preparing your setup…</p>
  return (
    <main className="mx-auto min-h-[100dvh] w-full max-w-lg px-4 py-8 text-[#f3e4cf]">
      <p className="dashboard-gold-label text-xs uppercase tracking-[0.2em]">Financial Goal · Welcome</p>
      <h1 ref={heading} tabIndex={-1} className="dashboard-gold-title mt-2 text-3xl font-bold outline-none">
        {saved ? 'Your starting point is ready' : 'Make room for your goals'}
      </h1>
      <p className="mb-6 mt-3 text-sm leading-relaxed text-[#b0947a]">
        {saved ? 'Your settings are saved to your account. Choose where you want to begin.' : 'A few small steps to shape your dashboard. You can change everything later in Configuration.'}
      </p>
      {saved ? (
        <Panel title="What would you like to do first?">
          <div className="space-y-3">
            <GoldButton className="w-full" onClick={() => onComplete('daily-log')}>Log my first workday</GoldButton>
            <GhostButton className="w-full" onClick={() => onComplete('history')}>Add earlier months</GhostButton>
            <GhostButton className="w-full" onClick={() => onComplete('dashboard')}>Explore my dashboard</GhostButton>
            <p className="text-sm leading-relaxed text-[#b0947a]">Starting partway through the year? Add earlier business or employment months in Configuration → Past months. Until then, yearly estimates may be incomplete.</p>
          </div>
        </Panel>
      ) : (
        <>
          <ol aria-label="Setup progress" className="mb-5 grid grid-cols-4 gap-2">
            {setupStepLabels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}
              className={`border-t-2 pt-2 text-xs ${index <= step ? 'border-[#ddb580] text-[#f3e4cf]' : 'border-[#493629] text-[#a88c71]'}`}>
              {index < step ? '✓' : index + 1}. {label}
            </li>)}
          </ol>
          <Panel title={`Step ${step + 1} of 4 · ${setupStepLabels[step]}`}>
            <form noValidate onSubmit={event => { event.preventDefault(); void submit() }} className="relative space-y-5">
              {step === 0 ? <>
                <Notice title="Built for Dutch freelancers" tone="info">Amounts are in euros. The tax estimates currently use Dutch self-employed rules.</Notice>
                {numberField('target', 'Take-home per month (Net, €)', 'The net monthly income you want your business to provide.', 1, 1000000)}
                {numberField('spouse', 'Other household income (Net, €/month)', 'Optional partner income for household planning. Use 0 if it does not apply.', 0, 1000000)}
              </> : null}
              {step === 1 ? <>
                {numberField('hourlyRate', 'Hourly rate (€ excl. VAT)', 'A starting default for reports; individual jobs can use different rates.', 0.01, 10000)}
                {numberField('shiftHours', 'Day/shift length (hours)', 'Used with your rate to calculate a standard day/shift.', 0.25, 24, '0.01', 'e.g. 8')}
                {numberField('weeklyHours', 'Hours / per week', 'How many hours you aim to work in a usual week.', 0.25, 168)}
                {numberField('vacation', 'Planned days off / year', 'Whole workdays you plan to take off. Enter 0 if none.', 0, 260, '1', 'e.g. 20')}
              </> : null}
              {step === 1 ? <div className="space-y-2">
                <label className="flex gap-3 text-sm">
                  <input type="checkbox" checked={draft.holidays === 'yes'} disabled={busy}
                    onChange={event => {
                      const count = getDutchPublicHolidayWeekdays(new Date().getFullYear()).length
                      setDraft({...draft, holidays: event.target.checked ? 'yes' : 'no',
                        vacation: String(Math.max(0, Number(draft.vacation || 0) + (event.target.checked ? count : -count)))})
                    }} />
                  <span>I approve Dutch weekday holidays as vacation for {new Date().getFullYear()}.</span>
                </label>
                <p className="text-xs text-[#b0947a]">Adds {getDutchPublicHolidayWeekdays(new Date().getFullYear()).length} days to the total above and marks those dates as vacation when you save. You can edit each mark later.</p>
                {draft.holidays === 'yes' ? <Notice title="The total and calendar are separately editable">
                  Reducing or clearing planned days off will not remove the approved holiday marks. Turn this option off to remove them, or edit individual days after setup.
                </Notice> : null}
              </div> : null}
              {step === 2 ? <>
                {numberField('reserve', 'Reserve buffer (%)', 'An extra cushion on top of the estimated tax reserve; this is not your tax rate.', 0, 100)}
                {choice('deduction', 'Self-employed deduction eligibility')}
                {draft.deduction === 'yes' ? choice('starter', 'Starters deduction eligibility') : null}
                <p className="text-sm leading-relaxed text-[#b0947a]">Choose Yes only if you have checked your eligibility. Not sure leaves that deduction out of the estimate until you update it. These are planning estimates, not a tax filing.</p>
              </> : null}
              {step === 3 ? <>
                <p className="text-sm text-[#b0947a]">Check your starting settings before saving them to your account.</p>
                {[
                  ['Your goal', `€${draft.target} take-home per month (Net) · €${draft.spouse} other net household income/month`],
                  ['Your work', `€${draft.hourlyRate}/hour excl. VAT · ${draft.shiftHours}h per day/shift · ${draft.weeklyHours}h per week · ${draft.vacation} planned days off/year · Dutch holidays: ${draft.holidays === 'yes' ? 'approved' : 'not enabled'}`],
                  ['Tax assumptions', `${draft.reserve}% extra buffer · Self-employed deduction: ${draft.deduction === 'yes' ? 'included' : 'excluded'} · Starters deduction: ${draft.deduction === 'yes' && draft.starter === 'yes' ? 'included' : 'excluded'}`],
                ].map(([label, detail], index) => <div key={label} className="rounded-xl border border-[#a8744a]/30 p-3">
                  <div className="flex items-center justify-between"><h3 className="font-semibold">{label}</h3><GhostButton disabled={busy} onClick={() => {setStep(index); setAttempted(false)}}>Edit</GhostButton></div>
                  <p className="mt-2 text-sm text-[#c9af91]">{detail}</p>
                </div>)}
                <p className="text-sm text-[#b0947a]">Past months and your first workday come next. We will not fill in income or work history for you.</p>
              </> : null}
              {message ? <div role="alert"><Notice title={message} tone="danger" /></div> : null}
              <div className="flex gap-3">
                {step > 0 ? <GhostButton disabled={busy} onClick={() => { setStep(step - 1); setMessage(''); setAttempted(false) }}>Back</GhostButton> : null}
                <GoldButton className="flex-1" type="submit" disabled={busy}>{busy ? 'Saving your setup…' : step === 3 ? 'Save my setup' : 'Continue'}</GoldButton>
              </div>
            </form>
          </Panel>
          <p className="mt-4 text-center text-xs text-[#a88c71]">{storageAvailable ? 'Your unfinished setup stays in this browser tab if you refresh.' : 'This browser cannot keep a draft. Keep this tab open until you save.'}</p>
        </>
      )}
      <div className="mt-5 text-center"><GhostButton disabled={busy} onClick={onSignOut}>Sign out</GhostButton></div>
    </main>
  )
}
