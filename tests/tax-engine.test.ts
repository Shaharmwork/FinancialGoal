import { describe, expect, it } from 'vitest'
import { estimateAnnualTaxFor2026, isSupportedTaxYear } from '@/lib/tax-engine'

// Tariefsaanpassing (art. 2.10 lid 2-3 Wet IB 2001, 2026): extra tax of 11.94% of the
// lower of (a) the ondernemersaftrek + MKB-winstvrijstelling and (b) the amount by which
// taxable income plus those deductions exceeds €78,426.

function estimate(profit: number, options: { salary?: number; starters?: boolean } = {}) {
  return estimateAnnualTaxFor2026({
    annualBusinessIncome: profit,
    annualBusinessExpenses: 0,
    annualEmploymentGrossSalary: options.salary ?? 0,
    qualifiesForSelfEmployedDeduction: true,
    qualifiesForStartersDeduction: options.starters ?? false,
  })
}

describe('deduction-benefit limit (tariefsaanpassing)', () => {
  it('does not apply while income before deductions stays under €78,426', () => {
    // €74,000 profit: 1,200 + 12.7% x 72,800 = 10,445.60 of deductions, total 74,000.
    expect(estimate(74_000).deductionLimitAdjustment).toBe(0)
    expect(estimate(78_426).deductionLimitAdjustment).toBe(0)
  })

  it('starts exactly above the threshold', () => {
    // €1 above: 11.94% of €1, rounded to cents.
    expect(estimate(78_427).deductionLimitAdjustment).toBe(0.12)
  })

  it('is limited by the part above the threshold when that is smaller than the deductions', () => {
    // €85,000: taxable 73,157.40 is under the threshold, but with the deductions
    // (11,842.60) it is 85,000, i.e. 6,574 above. 11.94% x 6,574 = 784.94.
    const result = estimate(85_000)
    expect(result.taxableIncome).toBeCloseTo(73_157.4, 2)
    expect(result.deductionLimitAdjustment).toBeCloseTo(784.94, 2)
  })

  it('is limited by the deductions when the part above the threshold is larger', () => {
    // €100,000: deductions 1,200 + 12.7% x 98,800 = 13,747.60 (< 21,574 above).
    expect(estimate(100_000).deductionLimitAdjustment).toBeCloseTo(0.1194 * 13_747.6, 2)
  })

  it('includes the starters deduction', () => {
    // €100,000 with starters: deductions 3,323 + 12.7% x 96,677 = 15,600.98.
    expect(estimate(100_000, { starters: true }).deductionLimitAdjustment).toBeCloseTo(
      0.1194 * 15_600.979,
      2,
    )
  })

  it('counts salary towards the threshold', () => {
    // €50,000 profit + €40,000 salary: deductions 7,397.60, total 90,000 (11,574 above).
    expect(estimate(50_000, { salary: 40_000 }).deductionLimitAdjustment).toBeCloseTo(
      0.1194 * 7_397.6,
      2,
    )
  })

  it('adds the adjustment to the tax', () => {
    const below = estimate(78_426)
    const above = estimate(85_000)
    expect(above.incomeTaxBeforeCredits).toBeGreaterThan(below.incomeTaxBeforeCredits)
  })
})

describe('health contribution (Zvw)', () => {
  it('is charged on taxable profit', () => {
    const result = estimate(74_000)
    expect(result.healthContribution).toBeCloseTo(result.taxableProfit * 0.0485, 2)
  })

  it('only uses the room left under the €79,409 cap after salary', () => {
    const result = estimate(50_000, { salary: 70_000 })
    expect(result.healthContribution).toBeCloseTo((79_409 - 70_000) * 0.0485, 2)
  })
})

describe('supported tax year', () => {
  it('only 2026 rules are implemented', () => {
    expect(isSupportedTaxYear(2026)).toBe(true)
    expect(isSupportedTaxYear(2025)).toBe(false)
    expect(isSupportedTaxYear(2027)).toBe(false)
  })
})
