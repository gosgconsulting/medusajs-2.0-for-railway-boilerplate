import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  beginOrderEditOrderWorkflow,
  confirmOrderEditRequestWorkflow,
  updateOrderTaxLinesWorkflow,
} from "@medusajs/medusa/core-flows"

const ACTIVE_ORDER_CHANGE_SUBSTRING = "already has an existing active order change"

function isDeferredCheckout(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.deferred_checkout === true
}

function shouldIgnoreBeginOrderEditError(e: unknown): boolean {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" &&
          e !== null &&
          "message" in e &&
          typeof (e as { message: unknown }).message === "string"
        ? (e as { message: string }).message
        : ""
  return msg.includes(ACTIVE_ORDER_CHANGE_SUBSTRING)
}

/**
 * Updates the shipping fee on a deferred order that already has a confirmed shipping line.
 * Core `POST /admin/order-edits/:orderId/shipping-method/:actionId` only supports
 * `SHIPPING_ADD` actions (pending adds). Existing lines require a `SHIPPING_UPDATE`
 * action, same pattern as draft-order shipping updates.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params.id as string
  const raw = (req.body as { amount?: unknown })?.amount
  const parsed = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Body must include a non-negative numeric `amount` in smallest currency units."
    )
  }
  const amount = Math.round(parsed)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const orderModule = req.scope.resolve(Modules.ORDER)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata", "shipping_methods.id"],
    filters: { id: orderId },
  })

  const row = orders[0] as
    | {
        id: string
        metadata?: Record<string, unknown> | null
        shipping_methods?: { id: string }[]
      }
    | undefined

  if (!row) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  }

  if (!isDeferredCheckout(row.metadata)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This route is only for deferred-checkout orders."
    )
  }

  const methods = row.shipping_methods ?? []
  if (methods.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order must have exactly one shipping method to update the fee here."
    )
  }

  const shippingMethodId = methods[0].id

  try {
    await beginOrderEditOrderWorkflow(req.scope).run({
      input: { order_id: orderId },
    })
  } catch (e: unknown) {
    if (!shouldIgnoreBeginOrderEditError(e)) {
      throw e
    }
  }

  const [before] = await orderModule.listOrderShippingMethods(
    { id: shippingMethodId },
    { take: 1, select: ["id", "shipping_option_id", "amount"] }
  )

  if (!before) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Shipping method ${shippingMethodId} was not found on this order.`
    )
  }

  await orderModule.updateOrderShippingMethods([{ id: shippingMethodId, amount }])

  const [after] = await orderModule.listOrderShippingMethods(
    { id: shippingMethodId },
    { take: 1, select: ["id", "shipping_option_id", "amount"] }
  )

  if (!after) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Shipping method disappeared after update."
    )
  }

  await updateOrderTaxLinesWorkflow(req.scope).run({
    input: {
      order_id: orderId,
      shipping_method_ids: [shippingMethodId],
    },
  })

  const orderRow = await orderModule.retrieveOrder(orderId, { select: ["id"] })
  const changeId = orderRow.order_change?.id
  if (!changeId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No active order edit found after starting an edit. Try again or cancel any draft edit in the admin."
    )
  }

  const orderChange = await orderModule.retrieveOrderChange(changeId, {
    relations: ["actions"],
  })

  await orderModule.addOrderAction({
    order_change_id: orderChange.id,
    reference: "order_shipping_method",
    reference_id: shippingMethodId,
    order_id: orderId,
    version: orderChange.version,
    action: "SHIPPING_UPDATE",
    details: {
      old_shipping_option_id: before.shipping_option_id ?? null,
      new_shipping_option_id: after.shipping_option_id ?? null,
      old_amount: before.amount,
      new_amount: after.amount,
    },
  })

  await confirmOrderEditRequestWorkflow(req.scope).run({
    input: { order_id: orderId },
  })

  res.status(200).json({ ok: true })
}
