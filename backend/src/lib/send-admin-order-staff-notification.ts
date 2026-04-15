import type { INotificationModuleService, OrderAddressDTO } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { applyDbEmailTemplate } from "./apply-db-email-template"
import { ensureNotificationEmailTemplateRow } from "./ensure-notification-email-template"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../modules/notification-email-template/constants"
import { resolveDefaultNotificationLocale } from "./notification-email-locales"

export type SendAdminOrderStaffNotificationParams = {
  container: { resolve: (key: string) => unknown }
  templateKey: string
  /** Prefix for idempotency_key: `${prefix}[:${eventSegment}]:${orderId}:${recipient}` */
  idempotencyPrefix: string
  /** When set (e.g. `payment-captured` vs `payment-authorized`), avoids clashing idempotency across events. */
  idempotencyEventSegment?: string
  order: object
  shippingAddress: OrderAddressDTO
  preview: string
  fallbackSubject: string
}

/**
 * Sends a staff notification using the notification-email-template module + Resend.
 * Recipients: ADMIN_ORDER_NOTIFICATION_EMAIL or STORE_SUPPORT_EMAIL (comma-separated OK).
 */
export async function sendAdminOrderStaffNotification(
  params: SendAdminOrderStaffNotificationParams
): Promise<void> {
  const {
    container,
    templateKey,
    idempotencyPrefix,
    idempotencyEventSegment,
    order,
    shippingAddress,
    preview,
    fallbackSubject,
  } = params

  const staffRecipients =
    process.env.ADMIN_ORDER_NOTIFICATION_EMAIL?.trim() ||
    process.env.STORE_SUPPORT_EMAIL?.trim() ||
    ""

  if (!staffRecipients) {
    return
  }

  const notificationModuleService = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const staffLocale = await resolveDefaultNotificationLocale(container)

  await ensureNotificationEmailTemplateRow(container, templateKey, staffLocale)

  let skipSend = false
  try {
    const templateMod = container.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as {
      listNotificationEmailTemplates: (
        filters?: { template_key?: string; locale?: string },
        config?: { take?: number }
      ) => Promise<{ is_enabled: boolean }[]>
    }
    const rows = await templateMod.listNotificationEmailTemplates(
      { template_key: templateKey, locale: staffLocale },
      { take: 1 }
    )
    if (rows[0] && rows[0].is_enabled === false) {
      skipSend = true
    }
  } catch {
    // Module unavailable — still attempt send with React-email fallback payload.
  }

  if (skipSend) {
    return
  }

  const oid = (order as { id?: unknown }).id
  const orderId = typeof oid === "string" ? oid : ""

  const adminPayload = await applyDbEmailTemplate(
    container,
    templateKey,
    {
      template: templateKey,
      data: {
        emailOptions: {
          replyTo: "info@example.com",
          subject: fallbackSubject,
        },
        order,
        shippingAddress,
        preview,
      },
    },
    { locale: staffLocale }
  )

  const toList = staffRecipients
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const idemMid = idempotencyEventSegment
    ? `${idempotencyPrefix}:${idempotencyEventSegment}`
    : idempotencyPrefix

  for (const to of toList) {
    await notificationModuleService.createNotifications({
      to,
      channel: "email",
      ...adminPayload,
      idempotency_key: `${idemMid}:${orderId}:${to}`,
    })
  }
}
