import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { resolveOrderIdFromFulfillmentId } from "../lib/resolve-order-for-notification"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

export default async function shipmentCreatedOrderEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
  if (data.no_notification) return

  const orderId = await resolveOrderIdFromFulfillmentId(container, data.id)
  if (!orderId) return

  try {
    await sendOrderNotificationEmail({
      container,
      orderId,
      templateKey: OrderNotificationEmailKeys.ORDER_SHIPMENT_IN_PROGRESS,
      defaultSubject:
        DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_SHIPMENT_IN_PROGRESS],
      preview: "Your order has shipped",
      noticeHeadline: "Your order is on the way",
      noticeMessage:
        "A shipment was created for your order. Use your tracking details in the store or carrier site if provided.",
    })
  } catch (e) {
    console.error("Error sending shipment notification email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}
