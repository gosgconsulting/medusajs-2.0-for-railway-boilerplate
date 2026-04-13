import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  listShippingOptionsForCartWorkflow,
  listShippingOptionsForOrderWorkflow,
} from "@medusajs/medusa/core-flows"

function isDeferredCheckout(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.deferred_checkout === true
}

/**
 * Lists shipping options for deferred-checkout orders using the same rules as the
 * storefront (cart workflow + `enabled_in_store` context). Core
 * `GET /admin/orders/:id/shipping-options` uses a graph-only query and often returns
 * no options when options are restricted to in-store fulfillment.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params.id as string
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: orderId },
  })

  const order = orders[0]
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} was not found`)
  }

  if (!isDeferredCheckout(order.metadata as Record<string, unknown> | null)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Shipping options on this route are only available for deferred-checkout orders."
    )
  }

  const { data: links } = await query.graph({
    entity: "order_cart",
    fields: ["cart_id", "order_id"],
    filters: { order_id: orderId },
  })

  const cartId = links[0]?.cart_id as string | undefined
  let shipping_options: unknown[] = []

  if (cartId) {
    try {
      const { result } = await listShippingOptionsForCartWorkflow(req.scope).run({
        input: { cart_id: cartId },
      })
      shipping_options = result ?? []
    } catch {
      shipping_options = []
    }
  }

  if (shipping_options.length === 0) {
    const { result } = await listShippingOptionsForOrderWorkflow(req.scope).run({
      input: { order_id: orderId },
    })
    shipping_options = result ?? []
  }

  res.status(200).json({ shipping_options })
}
