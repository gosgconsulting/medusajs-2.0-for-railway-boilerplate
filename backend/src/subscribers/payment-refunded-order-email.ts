import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { resolveOrderIdFromPaymentId } from "../lib/resolve-order-for-notification"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

export default async function paymentRefundedOrderEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = await resolveOrderIdFromPaymentId(container, data.id)
  if (!orderId) return

  try {
    await sendOrderNotificationEmail({
      container,
      orderId,
      templateKey: OrderNotificationEmailKeys.ORDER_REFUNDED,
      defaultSubject: DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_REFUNDED],
      preview: "Refund processed",
      noticeHeadline: "Your order was refunded",
      noticeMessage:
        "A refund has been issued for your order. Depending on your bank, it may take a few days to appear.",
    })
  } catch (e) {
    console.error("Error sending refund notification email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
