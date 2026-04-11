/**
 * 2026 Dutch self-employed tax estimate assumptions used in this app:
 * - user is under pension age for the full tax year
 * - business type is sole proprietor / self-employed
 * - no fiscal partner interaction is included in this tax logic
 * - employment income is included as gross salary when monthly summaries provide it
 * - business result is based on invoiced business income minus business expenses
 */
interface AnnualTaxInput {
  annualBusinessIncome: number
  annualBusinessExpenses: number
  annualEmploymentGrossSalary?: number
  annualTaxAlreadyWithheld?: number
  qualifiesForSelfEmployedDeduction: boolean
}

export interface AnnualTaxEstimate {
  annualBusinessIncome: number
  annualBusinessExpenses: number
  annualBusinessProfit: number
  annualEmploymentGrossSalary: number
  annualCombinedPreTaxIncome: number
  annualTaxAlreadyWithheld: number
  qualifiesForSelfEmployedDeduction: boolean
  selfEmployedDeduction: number
  profitAfterDeduction: number
  smallBusinessProfitExemptionRate: number
  taxableProfit: number
  taxableEmploymentIncome: number
  taxableIncome: number
  incomeTaxBeforeCredits: number
  generalTaxCredit: number
  workTaxCredit: number
  healthContribution: number
  estimatedAnnualTax: number
  remainingTaxToSave: number
  projectedAnnualNet: number
  projectedMonthlyNet: number
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function calculateIncomeTaxBeforeCredits(taxableIncome: number) {
  const firstBracketCap = 38883
  const secondBracketCap = 78426
  const firstBracketRate = 0.3575
  const secondBracketRate = 0.3756
  const thirdBracketRate = 0.495

  if (taxableIncome <= 0) {
    return 0
  }

  if (taxableIncome <= firstBracketCap) {
    return taxableIncome * firstBracketRate
  }

  if (taxableIncome <= secondBracketCap) {
    return (
      firstBracketCap * firstBracketRate +
      (taxableIncome - firstBracketCap) * secondBracketRate
    )
  }

  return (
    firstBracketCap * firstBracketRate +
    (secondBracketCap - firstBracketCap) * secondBracketRate +
    (taxableIncome - secondBracketCap) * thirdBracketRate
  )
}

function calculateGeneralTaxCredit(taxableIncome: number) {
  const fullCredit = 3115
  const phaseOutStart = 29736
  const phaseOutRate = 0.06398

  if (taxableIncome <= 0) {
    return 0
  }

  if (taxableIncome <= phaseOutStart) {
    return fullCredit
  }

  return Math.max(0, fullCredit - (taxableIncome - phaseOutStart) * phaseOutRate)
}

function calculateWorkTaxCredit(annualWorkIncome: number) {
  if (annualWorkIncome <= 0) {
    return 0
  }

  if (annualWorkIncome <= 11965) {
    return annualWorkIncome * 0.08324
  }

  if (annualWorkIncome <= 25845) {
    return 996 + (annualWorkIncome - 11965) * 0.31009
  }

  if (annualWorkIncome <= 45592) {
    return Math.min(5685, 5300 + (annualWorkIncome - 25845) * 0.0195)
  }

  if (annualWorkIncome <= 132920) {
    return Math.max(0, 5685 - (annualWorkIncome - 45592) * 0.0651)
  }

  return 0
}

function calculateHealthContribution(annualBusinessProfit: number) {
  return Math.max(0, Math.min(annualBusinessProfit, 79409) * 0.0485)
}

export function estimateAnnualTaxFor2026({
  annualBusinessIncome,
  annualBusinessExpenses,
  annualEmploymentGrossSalary = 0,
  annualTaxAlreadyWithheld = 0,
  qualifiesForSelfEmployedDeduction,
}: AnnualTaxInput): AnnualTaxEstimate {
  const annualBusinessProfit = Math.max(0, annualBusinessIncome - annualBusinessExpenses)
  const normalizedEmploymentGrossSalary = Math.max(0, annualEmploymentGrossSalary)
  const normalizedTaxAlreadyWithheld = Math.max(0, annualTaxAlreadyWithheld)
  const annualCombinedPreTaxIncome = annualBusinessProfit + normalizedEmploymentGrossSalary
  const selfEmployedDeduction = qualifiesForSelfEmployedDeduction ? 1200 : 0
  const profitAfterDeduction = Math.max(0, annualBusinessProfit - selfEmployedDeduction)
  const smallBusinessProfitExemptionRate = 0.127
  const taxableProfit = profitAfterDeduction * (1 - smallBusinessProfitExemptionRate)
  const taxableEmploymentIncome = normalizedEmploymentGrossSalary
  const taxableIncome = taxableProfit + taxableEmploymentIncome
  const incomeTaxBeforeCredits = calculateIncomeTaxBeforeCredits(taxableIncome)
  const generalTaxCredit = calculateGeneralTaxCredit(taxableIncome)
  const workTaxCredit = calculateWorkTaxCredit(annualCombinedPreTaxIncome)
  const healthContribution = calculateHealthContribution(annualBusinessProfit)
  const estimatedAnnualTax =
    Math.max(0, incomeTaxBeforeCredits - generalTaxCredit - workTaxCredit) +
    healthContribution
  const remainingTaxToSave = Math.max(0, estimatedAnnualTax - normalizedTaxAlreadyWithheld)
  const projectedAnnualNet = annualCombinedPreTaxIncome - estimatedAnnualTax
  const projectedMonthlyNet = projectedAnnualNet / 12

  return {
    annualBusinessIncome: roundCurrency(annualBusinessIncome),
    annualBusinessExpenses: roundCurrency(annualBusinessExpenses),
    annualBusinessProfit: roundCurrency(annualBusinessProfit),
    annualEmploymentGrossSalary: roundCurrency(normalizedEmploymentGrossSalary),
    annualCombinedPreTaxIncome: roundCurrency(annualCombinedPreTaxIncome),
    annualTaxAlreadyWithheld: roundCurrency(normalizedTaxAlreadyWithheld),
    qualifiesForSelfEmployedDeduction,
    selfEmployedDeduction: roundCurrency(selfEmployedDeduction),
    profitAfterDeduction: roundCurrency(profitAfterDeduction),
    smallBusinessProfitExemptionRate,
    taxableProfit: roundCurrency(taxableProfit),
    taxableEmploymentIncome: roundCurrency(taxableEmploymentIncome),
    taxableIncome: roundCurrency(taxableIncome),
    incomeTaxBeforeCredits: roundCurrency(incomeTaxBeforeCredits),
    generalTaxCredit: roundCurrency(generalTaxCredit),
    workTaxCredit: roundCurrency(workTaxCredit),
    healthContribution: roundCurrency(healthContribution),
    estimatedAnnualTax: roundCurrency(estimatedAnnualTax),
    remainingTaxToSave: roundCurrency(remainingTaxToSave),
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
