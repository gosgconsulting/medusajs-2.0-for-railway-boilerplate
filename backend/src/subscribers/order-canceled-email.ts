import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

export default async function orderCanceledEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    await sendOrderNotificationEmail({
      container,
      orderId: data.id,
      templateKey: OrderNotificationEmailKeys.ORDER_CANCELLED,
      defaultSubject: DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_CANCELLED],
      preview: "Your order was cancelled",
      noticeHeadline: "Order cancelled",
      noticeMessage:
        "Your order has been cancelled. If you did not request this, please contact us.",
    })
  } catch (e) {
    console.error("Error sending order cancelled notification email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
