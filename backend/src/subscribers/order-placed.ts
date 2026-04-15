import { Modules } from '@medusajs/framework/utils'
import { INotificationModuleService, IOrderModuleService } from '@medusajs/framework/types'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/medusa'
import { applyDbEmailTemplate } from '../lib/apply-db-email-template'
import { resolveCustomerOrderNotificationLocale } from '../lib/notification-email-locales'
import { DEFAULT_SUBJECT_BY_KEY } from '../lib/default-notification-email-templates'
import { sendAdminOrderStaffNotification } from '../lib/send-admin-order-staff-notification'
import { EmailTemplates } from '../modules/email-notifications/templates'

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<any>) {
  const notificationModuleService: INotificationModuleService = container.resolve(Modules.NOTIFICATION)
  const orderModuleService: IOrderModuleService = container.resolve(Modules.ORDER)
  
  const order = await orderModuleService.retrieveOrder(data.id, { relations: ['items', 'summary', 'shipping_address'] })

  const meta = order.metadata as Record<string, unknown> | null | undefined
  if (meta?.deferred_checkout === true) {
    return
  }

  if (!order.shipping_address?.id) {
    return
  }

  const shippingAddress = await (orderModuleService as any).orderAddressService_.retrieve(order.shipping_address.id)

  try {
    const locale = await resolveCustomerOrderNotificationLocale(container, order)
    const payload = await applyDbEmailTemplate(
      container,
      EmailTemplates.ORDER_PLACED,
      {
        template: EmailTemplates.ORDER_PLACED,
        data: {
          emailOptions: {
            replyTo: 'info@example.com',
            subject: 'Your order has been placed'
          },
          order,
          shippingAddress,
          preview: 'Thank you for your order!'
        }
      },
      { locale }
    )

    await notificationModuleService.createNotifications({
      to: order.email,
      channel: 'email',
      ...payload
    })
  } catch (error) {
    console.error('Error sending order confirmation notification:', error)
  }

  try {
    await sendAdminOrderStaffNotification({
      container,
      templateKey: EmailTemplates.ADMIN_ORDER_PLACED,
      idempotencyPrefix: 'admin-order-placed',
      order,
      shippingAddress,
      preview: 'New customer order',
      fallbackSubject: DEFAULT_SUBJECT_BY_KEY[EmailTemplates.ADMIN_ORDER_PLACED] ?? 'New order',
    })
  } catch (error) {
    console.error('Error sending admin new-order notification:', error)
  }
}

export const config: SubscriberConfig = {
  event: 'order.placed'
}
