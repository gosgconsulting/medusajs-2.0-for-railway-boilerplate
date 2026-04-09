import type { AuthenticationInput } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { updateCustomersWorkflow } from "@medusajs/medusa/core-flows"

const EMAILPASS_PROVIDER = "emailpass"
const MIN_PASSWORD_LENGTH = 8

type SetPasswordBody = {
  password?: string
}

function isMissingAuthIdentityMessage(message: string | undefined): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes("not found") &&
    (m.includes("authidentity") || m.includes("auth identity"))
  )
}

async function linkAuthIdentityToCustomer(
  authService: {
    updateAuthIdentities: (data: {
      id: string
      app_metadata: Record<string, unknown>
    }) => Promise<unknown>
  },
  authIdentity: { id: string; app_metadata?: Record<string, unknown> | null },
  customerId: string
): Promise<void> {
  const meta: Record<string, unknown> = {
    ...(authIdentity.app_metadata ?? {}),
  }
  const existing = meta.customer_id
  if (typeof existing === "string" && existing && existing !== customerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This email is already linked to another customer account."
    )
  }
  if (!existing) {
    meta.customer_id = customerId
    await authService.updateAuthIdentities({
      id: authIdentity.id,
      app_metadata: meta,
    })
  }
}

export async function POST(
  req: MedusaRequest<SetPasswordBody>,
  res: MedusaResponse
): Promise<void> {
  const { id: customerId } = req.params
  const password = req.body?.password

  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Password must be a string of at least ${MIN_PASSWORD_LENGTH} characters.`
    )
  }

  const customerService = req.scope.resolve(Modules.CUSTOMER)
  const customers = await customerService.listCustomers({ id: customerId })
  const customer = customers[0]
  if (!customer) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Customer with id "${customerId}" not found`
    )
  }

  const email = customer.email?.trim()
  if (!email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Customer must have an email address to set a store password."
    )
  }

  const authService = req.scope.resolve(Modules.AUTH)

  const registerAuthInput: AuthenticationInput = {
    url: req.url ?? "",
    headers: {},
    query: {},
    protocol: req.protocol ?? "https",
  }

  const updateResult = await authService.updateProvider(EMAILPASS_PROVIDER, {
    entity_id: email,
    password,
  })

  let authIdentity = updateResult.authIdentity

  if (updateResult.success && authIdentity) {
    await linkAuthIdentityToCustomer(authService, authIdentity, customerId)
  } else if (!updateResult.success) {
    if (!isMissingAuthIdentityMessage(updateResult.error)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        updateResult.error ?? "Failed to update customer password."
      )
    }

    const registerResult = await authService.register(EMAILPASS_PROVIDER, {
      ...registerAuthInput,
      body: { email, password },
    })

    if (!registerResult.success || !registerResult.authIdentity) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        registerResult.error ??
          updateResult.error ??
          "Failed to set customer password."
      )
    }

    authIdentity = registerResult.authIdentity
    await linkAuthIdentityToCustomer(authService, authIdentity, customerId)
  } else {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Failed to set customer password."
    )
  }

  if (!customer.has_account) {
    await updateCustomersWorkflow(req.scope).run({
      input: {
        selector: { id: customerId },
        // has_account exists on the customer model; workflow typings omit it from the public DTO.
        update: { has_account: true } as never,
      },
    })
  }

  res.status(200).json({ success: true })
}
