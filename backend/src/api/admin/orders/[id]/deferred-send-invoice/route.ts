import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { createOrUpdateOrderPaymentCollectionWorkflow } from "@medusajs/medusa/core-flows"
import { buildDeferredInvoicePayUrl } from "lib/deferred-invoice-pay-url"
import { ensureNotificationEmailTemplateRow } from "lib/ensure-notification-email-template"
import { getDefaultSubjectForTemplateKey } from "lib/notification-template-defaults"
import { OrderNotificationEmailKeys } from "lib/order-notification-email-keys"
import { sendOrderNotificationEmail } from "lib/send-order-notification-email"

function isDeferredCheckout(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  return metadata?.deferred_checkout === true
}

function pendingMinorUnits(summary: unknown): number {
  if (!summary || typeof summary !== "object") return 0
  const s = summary as Record<string, unknown>
  const raw = s.raw_pending_difference
  if (raw && typeof raw === "object" && raw !== null && "value" in raw) {
    const v = Number((raw as { value: string }).value)
    return Number.isFinite(v) ? Math.round(v) : 0
  }
  const pd = s.pending_difference
  if (typeof pd === "number" && Number.isFinite(pd)) return Math.round(pd)
  if (typeof pd === "string") {
    const n = Number(pd)
    return Number.isFinite(n) ? Math.round(n) : 0
  }
  return 0
}

function normalizePaymentCollectionResult(
  result: unknown
): { id: string } | null {
  if (result == null) return null
  if (Array.isArray(result)) {
    const first = result[0] as { id?: string } | undefined
    return first?.id ? { id: first.id } : null
  }
  const one = result as { id?: string }
  return one?.id ? { id: one.id } : null
}

/**
 * Syncs the order payment collection to the outstanding balance, builds a storefront pay URL,
 * and emails the customer (order-email-deferred-invoice / DB override).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = req.params.id as string
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "metadata", "email", "display_id", "summary"],
    filters: { id: orderId },
  })

  const row = orders[0] as
    | {
        id: string
        metadata?: Record<string, unknown> | null
        email?: string | null
        display_id?: string | number | null
        summary?: unknown
      }
    | undefined

  if (!row) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${orderId} was not found`
    )
  }

  if (!isDeferredCheckout(row.metadata)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This route is only for deferred-checkout orders."
    )
  }

  const email = row.email?.trim()
  if (!email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Order has no customer email address."
    )
  }

  const pending = pendingMinorUnits(row.summary)
  if (pending <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "There is no outstanding balance to collect on this order."
    )
  }

  const { result } = await createOrUpdateOrderPaymentCollectionWorkflow(
    req.scope
  ).run({
    input: { order_id: orderId },
  })

  const pc = normalizePaymentCollectionResult(result)
  const paymentCollectionId = pc?.id ?? null

  const payUrl = buildDeferredInvoicePayUrl({
    orderId: row.id,
    orderDisplayId: row.display_id ?? row.id,
    paymentCollectionId,
  })

  const templateKey = OrderNotificationEmailKeys.ORDER_DEFERRED_INVOICE

  await ensureNotificationEmailTemplateRow(req.scope, templateKey)

  await sendOrderNotificationEmail({
    container: req.scope,
    orderId,
    templateKey,
    defaultSubject: getDefaultSubjectForTemplateKey(templateKey),
    preview: "Complete your payment",
    noticeHeadline: "Your order is ready for payment",
    noticeMessage:
      "We have updated your order total (including shipping where applicable). Use the payment link below to complete checkout.",
    throwIfNoEmail: true,
    extraTemplateData: {
      payUrl,
      pay_url: payUrl,
      payment_collection_id: paymentCollectionId ?? "",
      payButtonLabel: "Pay now",
    },
  })

  res.status(200).json({
    success: true,
    payment_collection_id: paymentCollectionId,
  })
}
