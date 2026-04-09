import type { INotificationModuleService, IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { applyDbEmailTemplate } from "./apply-db-email-template"
import type { OrderNotificationEmailKey } from "./order-notification-email-keys"

const DEFAULT_REPLY_TO = "info@example.com"

export type SendOrderNotificationEmailParams = {
  container: { resolve: (key: string) => unknown }
  orderId: string
  templateKey: OrderNotificationEmailKey | string
  defaultSubject: string
  preview: string
  noticeHeadline: string
  noticeMessage: string
  idempotencyKey?: string
}

export async function sendOrderNotificationEmail(
  params: SendOrderNotificationEmailParams
): Promise<void> {
  const {
    container,
    orderId,
    templateKey,
    defaultSubject,
    preview,
    noticeHeadline,
    noticeMessage,
    idempotencyKey,
  } = params

  const orderModuleService = container.resolve(Modules.ORDER) as IOrderModuleService
  const notificationModuleService = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const order = await orderModuleService.retrieveOrder(orderId, {
    relations: ["items", "summary", "shipping_address"],
  })

  const email = order.email?.trim()
  if (!email) return

  const shippingAddress = await (
    orderModuleService as unknown as {
      orderAddressService_: { retrieve: (id: string) => Promise<unknown> }
    }
  ).orderAddressService_.retrieve(order.shipping_address.id)

  const payload = await applyDbEmailTemplate(container, templateKey, {
    template: templateKey,
    data: {
      emailOptions: {
        replyTo: DEFAULT_REPLY_TO,
        subject: defaultSubject,
      },
      order,
      shippingAddress,
      preview,
      noticeHeadline,
      noticeMessage,
    },
  })

  await notificationModuleService.createNotifications({
    to: email,
    channel: "email",
    ...payload,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  })
}
