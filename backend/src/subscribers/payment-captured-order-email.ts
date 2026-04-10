import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import { resolveOrderIdFromPaymentId } from "../lib/resolve-order-for-notification"
import { sendOrderNotificationEmail } from "../lib/send-order-notification-email"

export default async function paymentCapturedOrderEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = await resolveOrderIdFromPaymentId(container, data.id)
  if (!orderId) return

  try {
    await sendOrderNotificationEmail({
      container,
      orderId,
      templateKey: OrderNotificationEmailKeys.ORDER_PROCESSING,
      defaultSubject: DEFAULT_SUBJECT_BY_KEY[OrderNotificationEmailKeys.ORDER_PROCESSING],
      preview: "Your payment was received",
      noticeHeadline: "We are processing your order",
      noticeMessage:
        "Thank you — your payment was captured successfully. We are preparing your order.",
    })
  } catch (e) {
    console.error("Error sending processing / payment captured email:", e)
  }
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
