import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { linkCustomersToCustomerGroupWorkflow } from "@medusajs/medusa/core-flows"
import { refetchCustomerGroup } from "@medusajs/medusa/api/admin/customer-groups/helpers"

type LinkCustomersBody = {
  add?: string[]
  remove?: string[]
}

async function removeCustomerFromAllGroups(
  scope: MedusaRequest["scope"],
  customerId: string
): Promise<void> {
  const customerModule = scope.resolve(Modules.CUSTOMER)
  const links = await customerModule.listCustomerGroupCustomers(
    { customer_id: customerId },
    { take: 100 }
  )
  if (!links.length) {
    return
  }
  await customerModule.removeCustomerFromGroup(
    links
      .filter((l) => l.customer_group_id)
      .map((l) => ({
        customer_id: customerId,
        customer_group_id: l.customer_group_id as string,
      }))
  )
}

/**
 * Overrides core POST /admin/customer-groups/:id/customers so each customer
 * belongs to at most one group: before linking, drop all existing memberships
 * (including the target group) so the standard workflow re-adds cleanly.
 */
export async function POST(
  req: MedusaRequest<LinkCustomersBody>,
  res: MedusaResponse
): Promise<void> {
  const { id } = req.params
  const { add, remove } = req.validatedBody

  for (const customerId of add ?? []) {
    await removeCustomerFromAllGroups(req.scope, customerId)
  }

  const workflow = linkCustomersToCustomerGroupWorkflow(req.scope)
  await workflow.run({
    input: {
      id,
      add,
      remove,
    },
  })

  const customer_group = await refetchCustomerGroup(
    req.params.id,
    req.scope,
    req.queryConfig?.fields
  )
  res.status(200).json({ customer_group })
}
