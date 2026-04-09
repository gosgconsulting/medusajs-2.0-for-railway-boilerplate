import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { resolveOrderIdFromFulfillmentId } from "../lib/resolve-order-for-notification"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

export default async function deliveryCreatedOrderEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = await resolveOrderIdFromFulfillmentId(container, data.id)
  if (!orderId) return

  try {
    await sendOrderNotificationEmail({
      container,
      orderId,
      templateKey: OrderNotificationEmailKeys.ORDER_DELIVERED,
      defaultSubject: DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_DELIVERED],
      preview: "Your order was delivered",
      noticeHeadline: "Delivered",
      noticeMessage:
        "Your order has been marked as delivered. Thank you for shopping with us!",
    })
  } catch (e) {
    console.error("Error sending delivered notification email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}
