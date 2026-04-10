import type {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { updateCustomersWorkflow } from "@medusajs/medusa/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"

/** Mirrors Medusa core defaults for store customer retrieve (see @medusajs/medusa store customers query-config). */
const DEFAULT_STORE_CUSTOMER_RETRIEVE_FIELDS = [
  "id",
  "email",
  "company_name",
  "first_name",
  "last_name",
  "phone",
  "metadata",
  "has_account",
  "deleted_at",
  "created_at",
  "updated_at",
  "*addresses",
] as const

function buildCustomerRetrieveFields(fields: string[] | undefined): string[] {
  const base = fields?.length ? fields : [...DEFAULT_STORE_CUSTOMER_RETRIEVE_FIELDS]
  return [...base]
}

type CustomerGroupSummary = { id: string; name: string }

async function listCustomerGroupSummaries(
  scope: MedusaRequest["scope"],
  customerId: string
): Promise<CustomerGroupSummary[]> {
  const customerModuleService = scope.resolve(Modules.CUSTOMER)
  const links = await customerModuleService.listCustomerGroupCustomers(
    { customer_id: customerId },
    { take: 100 }
  )
  const groupIds = [
    ...new Set(links.map((l) => l.customer_group_id).filter(Boolean)),
  ]
  if (!groupIds.length) {
    return []
  }
  const groups = await customerModuleService.listCustomerGroups(
    { id: groupIds },
    { take: 100 }
  )
  return groups
    .filter((g) => g.id && g.name != null)
    .map((g) => ({ id: g.id, name: g.name }))
}

async function refetchCustomer(
  customerId: string,
  scope: MedusaRequest["scope"],
  fields: string[] | undefined
) {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "customer",
    variables: {
      filters: { id: customerId },
    },
    fields: buildCustomerRetrieveFields(fields),
  })
  const customers = await remoteQuery(queryObject)
  return customers[0]
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const id = req.auth_context.actor_id
  const customer = await refetchCustomer(id, req.scope, req.queryConfig?.fields)
  if (!customer) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Customer with id: ${id} was not found`
    )
  }
  const groups = await listCustomerGroupSummaries(req.scope, id)
  const metadata = { ...customer.metadata, groups, role: groups.length ? groups[0].name : null }
  res.json({ customer: { ...customer, metadata }, groups, role: groups.length ? groups[0].name : null })
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const customerId = req.auth_context.actor_id
  await updateCustomersWorkflow(req.scope).run({
    input: {
      selector: { id: customerId },
      update: req.validatedBody,
    },
  })
  const customer = await refetchCustomer(
    customerId,
    req.scope,
    req.queryConfig?.fields
  )
  const groups = await listCustomerGroupSummaries(req.scope, customerId)
  res.status(200).json({ customer: { ...customer, groups, role: groups.length ? groups[0].name : null } })
}
