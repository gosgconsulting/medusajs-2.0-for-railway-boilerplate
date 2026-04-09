import { EmailTemplates } from "../modules/email-notifications/templates"

export type NotificationTemplateCatalogEntry = {
  template_key: string
  label: string
  description: string
}

/** Built-in notification template keys that merchants can override from the admin. */
export const NOTIFICATION_TEMPLATE_CATALOG: NotificationTemplateCatalogEntry[] = [
  {
    template_key: EmailTemplates.ORDER_PLACED,
    label: "Order confirmation",
    description: "Sent when an order is placed (order.placed).",
  },
  {
    template_key: EmailTemplates.INVITE_USER,
    label: "Admin invite",
    description: "Sent when a user is invited to the admin (invite.created / invite.resent).",
  },
]
