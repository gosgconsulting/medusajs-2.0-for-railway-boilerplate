import { MedusaError } from "@medusajs/framework/utils"
import { EmailTemplates } from "../modules/email-notifications/templates"
import {
  DEFAULT_DEFERRED_INVOICE_EMAIL_HTML,
  DEFAULT_INVITE_USER_HTML,
  DEFAULT_ORDER_PLACED_HTML,
  DEFAULT_ORDER_STATUS_NOTICE_HTML,
  DEFAULT_SUBJECT_BY_KEY,
} from "./default-notification-email-templates"
import { OrderNotificationEmailKeys } from "./order-notification-email-keys"

const ORDER_STATUS_TEMPLATE_KEYS = new Set<string>(
  Object.values(OrderNotificationEmailKeys)
)

/**
 * Default Handlebars/plain body for a catalog template key (admin UI + auto-provision).
 */
export function getDefaultHtmlBodyForTemplateKey(templateKey: string): string {
  if (templateKey === EmailTemplates.ORDER_PLACED) {
    return DEFAULT_ORDER_PLACED_HTML
  }
  if (templateKey === EmailTemplates.INVITE_USER) {
    return DEFAULT_INVITE_USER_HTML
  }
  if (templateKey === OrderNotificationEmailKeys.ORDER_DEFERRED_INVOICE) {
    return DEFAULT_DEFERRED_INVOICE_EMAIL_HTML
  }
  if (ORDER_STATUS_TEMPLATE_KEYS.has(templateKey)) {
    return DEFAULT_ORDER_STATUS_NOTICE_HTML
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    `No default HTML for template key: ${templateKey}`
  )
}

export function getDefaultSubjectForTemplateKey(templateKey: string): string {
  return DEFAULT_SUBJECT_BY_KEY[templateKey] ?? "Notification"
}
