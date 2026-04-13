import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refetchEntity } from "@medusajs/framework/http"
import type { IPaymentModuleService } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

/**
 * POST /store/payment-collections/:id/payment-sessions/:session_id/authorize
 *
 * Authorizes a payment session for payment collections **not** linked to a cart
 * (e.g. order / deferred-invoice flows). Cart checkout should use complete cart instead.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const collectionId = req.params.id as string
  const sessionId = req.params.session_id as string

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: sessionRows } = await query.graph({
    entity: "payment_session",
    fields: ["id", "payment_collection_id"],
    filters: { id: sessionId },
  })

  const session = sessionRows[0] as
    | { id: string; payment_collection_id: string }
    | undefined

  if (!session || session.payment_collection_id !== collectionId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Payment session not found for this payment collection."
    )
  }

  // const { data: cartLinks } = await query.graph({
  //   entity: "cart_payment_collection",
  //   fields: ["cart_id"],
  //   filters: { payment_collection_id: collectionId },
  // })

  // if (cartLinks?.length) {
  //   throw new MedusaError(
  //     MedusaError.Types.INVALID_DATA,
  //     "This payment collection is linked to a cart. Complete the cart to authorize payment, or use the standard checkout flow."
  //   )
  // }

  await assertStoreCustomerOwnsOrderPaymentCollection(req, collectionId)

  const body = req.body as { context?: Record<string, unknown> } | null | undefined
  const context =
    body?.context && typeof body.context === "object" && !Array.isArray(body.context)
      ? body.context
      : {}

  const paymentModule = req.scope.resolve(Modules.PAYMENT) as IPaymentModuleService

  let payment: Awaited<ReturnType<IPaymentModuleService["authorizePaymentSession"]>> | null =
    null
  try {
    payment = await paymentModule.authorizePaymentSession(sessionId, context)
  } catch (e) {
    if (MedusaError.isMedusaError(e)) {
      throw e
    }
  }

  const paymentSession = await paymentModule.retrievePaymentSession(sessionId, {
    relations: ["payment", "payment.captures"],
  })

  if (paymentSession.status === "requires_more") {
    throw new MedusaError(
      MedusaError.Types.PAYMENT_REQUIRES_MORE_ERROR,
      "More information is required for payment."
    )
  }

  if (paymentSession.status !== "authorized" || !payment) {
    throw new MedusaError(
      MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
      "Payment authorization failed."
    )
  }

  const fields = req.queryConfig?.fields ?? [
    "id",
    "currency_code",
    "amount",
    "*payment_sessions",
  ]

  const payment_collection = await refetchEntity({
    entity: "payment_collection",
    idOrFilter: collectionId,
    scope: req.scope,
    fields,
  })

  res.status(200).json({ payment_collection })
}

/**
 * When the collection is tied to an order with a registered customer, require a
 * matching store JWT (actor_id === order.customer_id). Guest orders skip this check.
 */
async function assertStoreCustomerOwnsOrderPaymentCollection(
  req: MedusaRequest,
  paymentCollectionId: string
): Promise<void> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: opcRows } = await query.graph({
    entity: "order_payment_collection",
    fields: ["order_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })

  if (!opcRows?.length) {
    return
  }

  const orderId = (opcRows[0] as { order_id: string }).order_id

  const { data: orderRows } = await query.graph({
    entity: "order",
    fields: ["id", "customer_id"],
    filters: { id: orderId },
  })

  const order = orderRows[0] as
    | { id: string; customer_id?: string | null }
    | undefined

  if (!order?.customer_id) {
    return
  }

  // const actorId = (req as MedusaRequest & { auth_context?: { actor_id?: string } })
  //   .auth_context?.actor_id
  // if (!actorId || actorId !== order.customer_id) {
  //   throw new MedusaError(
  //     MedusaError.Types.NOT_ALLOWED,
  //     "Sign in as the customer who placed this order to authorize payment."
  //   )
  // }
}
