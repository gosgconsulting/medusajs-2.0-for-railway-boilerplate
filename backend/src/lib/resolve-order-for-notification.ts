import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { IPaymentModuleService } from "@medusajs/framework/types"

type QueryGraph = {
  graph: (args: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }) => Promise<{ data?: unknown[] }>
}

/** Payment subscriber payloads use `id` (core) or sometimes `payment_id`. */
export function resolvePaymentIdFromSubscriberData(
  data: { id?: string; payment_id?: string } | null | undefined
): string | null {
  if (!data || typeof data !== "object") return null
  if (typeof data.id === "string" && data.id.trim()) return data.id.trim()
  if (typeof data.payment_id === "string" && data.payment_id.trim()) {
    return data.payment_id.trim()
  }
  return null
}

export async function resolveOrderIdFromPaymentId(
  container: { resolve: (k: string) => unknown },
  paymentId: string
): Promise<string | null> {
  const paymentService = container.resolve(
    Modules.PAYMENT
  ) as IPaymentModuleService
  const payment = await paymentService.retrievePayment(paymentId)
  const pcId = payment.payment_collection_id
  if (!pcId) return null

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const { data } = await query.graph({
    entity: "payment_collection",
    fields: ["id", "order.id"],
    filters: { id: pcId },
  })
  const row = data?.[0] as { order?: { id?: string } } | undefined
  return row?.order?.id ?? null
}

export async function resolveOrderIdFromFulfillmentId(
  container: { resolve: (k: string) => unknown },
  fulfillmentId: string
): Promise<string | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph
  const { data } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "order.id"],
    filters: { id: fulfillmentId },
  })
  const row = data?.[0] as { order?: { id?: string } } | undefined
  return row?.order?.id ?? null
}
