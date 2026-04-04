/**
 * 2026 Dutch self-employed tax estimate assumptions used in this app:
 * - user is under pension age for the full tax year
 * - business type is sole proprietor / self-employed
 * - no fiscal partner interaction is included in this tax logic
 * - no other income categories are included here
 * - business profit is based on invoiced business income minus business expenses
 */
interface AnnualTaxInput {
  annualBusinessIncome: number
  annualBusinessExpenses: number
  qualifiesForSelfEmployedDeduction: boolean
}

export interface AnnualTaxEstimate {
  annualBusinessIncome: number
  annualBusinessExpenses: number
  annualBusinessProfit: number
  qualifiesForSelfEmployedDeduction: boolean
  selfEmployedDeduction: number
  profitAfterDeduction: number
  smallBusinessProfitExemptionRate: number
  taxableProfit: number
  incomeTaxBeforeCredits: number
  generalTaxCredit: number
  workTaxCredit: number
  healthContribution: number
  estimatedAnnualTax: number
  projectedAnnualNet: number
  projectedMonthlyNet: number
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function calculateIncomeTaxBeforeCredits(taxableProfit: number) {
  const firstBracketCap = 38883
  const secondBracketCap = 78426
  const firstBracketRate = 0.3575
  const secondBracketRate = 0.3756
  const thirdBracketRate = 0.495

  if (taxableProfit <= 0) {
    return 0
  }

  if (taxableProfit <= firstBracketCap) {
    return taxableProfit * firstBracketRate
  }

  if (taxableProfit <= secondBracketCap) {
    return (
      firstBracketCap * firstBracketRate +
      (taxableProfit - firstBracketCap) * secondBracketRate
    )
  }

  return (
    firstBracketCap * firstBracketRate +
    (secondBracketCap - firstBracketCap) * secondBracketRate +
    (taxableProfit - secondBracketCap) * thirdBracketRate
  )
}

function calculateGeneralTaxCredit(taxableProfit: number) {
  const fullCredit = 3115
  const phaseOutStart = 29736
  const phaseOutRate = 0.06398

  if (taxableProfit <= 0) {
    return 0
  }

  if (taxableProfit <= phaseOutStart) {
    return fullCredit
  }

  return Math.max(0, fullCredit - (taxableProfit - phaseOutStart) * phaseOutRate)
}

function calculateWorkTaxCredit(annualBusinessProfit: number) {
  if (annualBusinessProfit <= 0) {
    return 0
  }

  if (annualBusinessProfit <= 11965) {
    return annualBusinessProfit * 0.08324
  }

  if (annualBusinessProfit <= 25845) {
    return 996 + (annualBusinessProfit - 11965) * 0.31009
  }

  if (annualBusinessProfit <= 45592) {
    return Math.min(5685, 5300 + (annualBusinessProfit - 25845) * 0.0195)
  }

  if (annualBusinessProfit <= 132920) {
    return Math.max(0, 5685 - (annualBusinessProfit - 45592) * 0.0651)
  }

  return 0
}

function calculateHealthContribution(annualBusinessProfit: number) {
  return Math.max(0, Math.min(annualBusinessProfit, 79409) * 0.0485)
}

export function estimateAnnualTaxFor2026({
  annualBusinessIncome,
  annualBusinessExpenses,
  qualifiesForSelfEmployedDeduction,
}: AnnualTaxInput): AnnualTaxEstimate {
  const annualBusinessProfit = Math.max(0, annualBusinessIncome - annualBusinessExpenses)
  const selfEmployedDeduction = qualifiesForSelfEmployedDeduction ? 1200 : 0
  const profitAfterDeduction = Math.max(0, annualBusinessProfit - selfEmployedDeduction)
  const smallBusinessProfitExemptionRate = 0.127
  const taxableProfit = profitAfterDeduction * (1 - smallBusinessProfitExemptionRate)
  const incomeTaxBeforeCredits = calculateIncomeTaxBeforeCredits(taxableProfit)
  const generalTaxCredit = calculateGeneralTaxCredit(taxableProfit)
  const workTaxCredit = calculateWorkTaxCredit(annualBusinessProfit)
  const healthContribution = calculateHealthContribution(annualBusinessProfit)
  const estimatedAnnualTax =
    Math.max(0, incomeTaxBeforeCredits - generalTaxCredit - workTaxCredit) +
    healthContribution
  const projectedAnnualNet = annualBusinessProfit - estimatedAnnualTax
  const projectedMonthlyNet = projectedAnnualNet / 12

  return {
    annualBusinessIncome: roundCurrency(annualBusinessIncome),
    annualBusinessExpenses: roundCurrency(annualBusinessExpenses),
    annualBusinessProfit: roundCurrency(annualBusinessProfit),
    qualifiesForSelfEmployedDeduction,
    selfEmployedDeduction: roundCurrency(selfEmployedDeduction),
    profitAfterDeduction: roundCurrency(profitAfterDeduction),
    smallBusinessProfitExemptionRate,
    taxableProfit: roundCurrency(taxableProfit),
    incomeTaxBeforeCredits: roundCurrency(incomeTaxBeforeCredits),
    generalTaxCredit: roundCurrency(generalTaxCredit),
    workTaxCredit: roundCurrency(workTaxCredit),
    healthContribution: roundCurrency(healthContribution),
    estimatedAnnualTax: roundCurrency(estimatedAnnualTax),
    projectedAnnualNet: roundCurrency(projectedAnnualNet),
    projectedMonthlyNet: roundCurrency(projectedMonthlyNet),
  }
}

export function estimateRequiredAnnualBusinessProfitForTargetNet2026({
  targetAnnualNet,
  qualifiesForSelfEmployedDeduction,
}: {
  targetAnnualNet: number
  qualifiesForSelfEmployedDeduction: boolean
}) {
  if (targetAnnualNet <= 0) {
    return 0
  }

  let lowerBound = 0
  let upperBound = 100000

  while (
    estimateAnnualTaxFor2026({
      annualBusinessIncome: upperBound,
      annualBusinessExpenses: 0,
      qualifiesForSelfEmployedDeduction,
    }).projectedAnnualNet < targetAnnualNet &&
    upperBound < 500000
  ) {
    upperBound *= 1.5
  }

  for (let index = 0; index < 50; index += 1) {
    const midpoint = (lowerBound + upperBound) / 2
    const estimate = estimateAnnualTaxFor2026({
      annualBusinessIncome: midpoint,
      annualBusinessExpenses: 0,
      qualifiesForSelfEmployedDeduction,
    })

    if (estimate.projectedAnnualNet >= targetAnnualNet) {
      upperBound = midpoint
    } else {
      lowerBound = midpoint
    }
  }

  return roundCurrency(upperBound)
}
