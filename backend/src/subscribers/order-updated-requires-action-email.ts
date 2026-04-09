import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

/**
 * Medusa order status `requires_action` usually means the customer must complete
 * a payment step (e.g. 3DS). This is the closest built-in signal to “payment failed”
 * or “action required” without a dedicated payment-failure event.
 *
 * Idempotency: at most one email per order for this template key.
 */
export default async function orderUpdatedRequiresActionEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderModuleService = container.resolve(Modules.ORDER) as IOrderModuleService

  let status: string | undefined
  try {
    const order = await orderModuleService.retrieveOrder(data.id)
    status = order.status
  } catch {
    return
  }

  if (status !== "requires_action") return

  try {
    await sendOrderNotificationEmail({
      container,
      orderId: data.id,
      templateKey: OrderNotificationEmailKeys.ORDER_PAYMENT_FAILED,
      defaultSubject:
        DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_PAYMENT_FAILED],
      preview: "Action needed for your order",
      noticeHeadline: "Action needed for your payment",
      noticeMessage:
        "We could not complete your payment automatically. Please return to checkout or your order page to try again or use another payment method.",
      idempotencyKey: `order-payment-attention-${data.id}`,
    })
  } catch (e) {
    console.error("Error sending payment action required email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "order.updated",
}
