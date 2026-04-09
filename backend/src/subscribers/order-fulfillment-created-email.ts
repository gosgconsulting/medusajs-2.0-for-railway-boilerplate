import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

export default async function orderFulfillmentCreatedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  order_id: string
  fulfillment_id: string
  no_notification?: boolean
}>) {
  if (data.no_notification) return

  try {
    await sendOrderNotificationEmail({
      container,
      orderId: data.order_id,
      templateKey: OrderNotificationEmailKeys.ORDER_IN_FULFILLMENT,
      defaultSubject: DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_IN_FULFILLMENT],
      preview: "Your order is being fulfilled",
      noticeHeadline: "Your order is being prepared",
      noticeMessage:
        "We have started fulfilling your order. You will receive another update when it ships.",
    })
  } catch (e) {
    console.error("Error sending in-fulfillment notification email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
