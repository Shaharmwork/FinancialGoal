const NUMBER_LOCALE = 'en-US'
const DATE_LOCALE = 'en-NL'

const currencyFormatter = new Intl.NumberFormat(NUMBER_LOCALE, {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

const preciseCurrencyFormatter = new Intl.NumberFormat(NUMBER_LOCALE, {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat(NUMBER_LOCALE, {
  maximumFractionDigits: 1,
})

const preciseNumberFormatter = new Intl.NumberFormat(NUMBER_LOCALE, {
  maximumFractionDigits: 2,
})

export function formatCurrency(value: number) {
  return currencyFormatter.format(value)
}

export function formatCurrencyPrecise(value: number) {
  return preciseCurrencyFormatter.format(value)
}

export function formatHours(value: number) {
  return `${numberFormatter.format(value)}h`
}

export function formatNumber(value: number) {
  return numberFormatter.format(value)
}

export function formatPreciseNumber(value: number) {
  return preciseNumberFormatter.format(value)
}

export function formatDate(date: Date) {
  return date.toLocaleDateString(DATE_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatHeaderDate(date: Date) {
  return date.toLocaleDateString(DATE_LOCALE, {
    day: 'numeric',
    month: 'short',
  })
}
