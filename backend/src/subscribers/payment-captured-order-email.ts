import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { DEFAULT_SUBJECT_BY_KEY } from "../lib/default-notification-email-templates"
import { OrderNotificationEmailKeys } from "../lib/order-notification-email-keys"
import {
  resolveOrderIdFromPaymentId,
  resolvePaymentIdFromSubscriberData,
} from "../lib/resolve-order-for-notification"
import { sendAdminOrderStaffNotification } from "../lib/send-admin-order-staff-notification"
import {
  resolveShippingAddressForOrderEmail,
  sendOrderNotificationEmail,
} from "../lib/send-order-notification-email"
import { EmailTemplates } from "../modules/email-notifications/templates"

export default async function paymentCapturedOrderEmailHandler({
  event,
  container,
}: SubscriberArgs<{ id?: string; payment_id?: string }>) {
  const eventName = (event as { name?: string }).name
  const data = event.data

  const paymentId = resolvePaymentIdFromSubscriberData(data)
  if (!paymentId) return

  const orderId = await resolveOrderIdFromPaymentId(container, paymentId)
  if (!orderId) return

  const sendCustomerProcessingEmail = eventName !== "payment.authorized"

  if (sendCustomerProcessingEmail) {
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

  const idempotencyEventSegment = (eventName ?? "payment.captured").replace(/\./g, "-")

  try {
    const orderModuleService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order = await orderModuleService.retrieveOrder(orderId, {
      relations: ["items", "summary", "shipping_address", "billing_address"],
    })
    const meta = order.metadata as Record<string, unknown> | null | undefined
    if (meta?.deferred_checkout !== true) {
      return
    }

    const shippingAddress = await resolveShippingAddressForOrderEmail(orderModuleService, order)

    await sendAdminOrderStaffNotification({
      container,
      templateKey: EmailTemplates.ADMIN_DEFERRED_ORDER_PAID,
      idempotencyPrefix: "admin-deferred-order-paid",
      idempotencyEventSegment,
      order,
      shippingAddress,
      preview:
        eventName === "payment.authorized"
          ? "Deferred checkout — payment authorized"
          : "Deferred checkout — payment received",
      fallbackSubject:
        DEFAULT_SUBJECT_BY_KEY[EmailTemplates.ADMIN_DEFERRED_ORDER_PAID] ?? "Order paid",
    })
  } catch (e) {
    console.error("Error sending admin deferred-checkout paid notification:", e)
  }
}

export const config: SubscriberConfig = {
  event: ["payment.captured", "payment.authorized"],
}
