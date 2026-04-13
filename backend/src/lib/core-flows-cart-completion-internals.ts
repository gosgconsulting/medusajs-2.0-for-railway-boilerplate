import type {
  CampaignBudgetUsageContext,
  UsageComputedActions,
} from "@medusajs/framework/types"
import type { StepFunction } from "@medusajs/framework/workflows-sdk"
import { createRequire } from "module"
import { dirname, join } from "path"

const nodeRequire = createRequire(require.resolve("@medusajs/medusa/package.json"))
const coreFlowsDist = dirname(nodeRequire.resolve("@medusajs/core-flows"))

const lineItemData = nodeRequire(
  join(coreFlowsDist, "cart/utils/prepare-line-item-data.js")
) as {
  prepareLineItemData: (input: Record<string, unknown>) => Record<string, unknown>
  prepareTaxLinesData: (lines: unknown[]) => unknown[]
  prepareAdjustmentsData: (adj: unknown[]) => unknown[]
}

const confirmInv = nodeRequire(
  join(coreFlowsDist, "cart/utils/prepare-confirm-inventory-input.js")
) as {
  prepareConfirmInventoryInput: (input: Record<string, unknown>) => unknown
}

type RegisterUsageStepInput = {
  computedActions: UsageComputedActions[]
  registrationContext: CampaignBudgetUsageContext
}

const registerUsage = nodeRequire(
  join(coreFlowsDist, "promotion/steps/register-usage.js")
) as { registerUsageStep: StepFunction<RegisterUsageStepInput, null> }

export const prepareLineItemData = lineItemData.prepareLineItemData
export const prepareTaxLinesData = lineItemData.prepareTaxLinesData
export const prepareAdjustmentsData = lineItemData.prepareAdjustmentsData
export const prepareConfirmInventoryInput = confirmInv.prepareConfirmInventoryInput
export const registerUsageStep = registerUsage.registerUsageStep
