import { EmailTemplates } from "../modules/email-notifications/templates"
import { OrderNotificationEmailKeys } from "./order-notification-email-keys"

export type NotificationTemplateAudience = "customer" | "admin"

export type NotificationTemplateCatalogEntry = {
  template_key: string
  label: string
  description: string
  /** Who receives this email — used by the admin UI to group templates. */
  audience: NotificationTemplateAudience
}

/** Built-in notification template keys that merchants can override from the admin. */
export const NOTIFICATION_TEMPLATE_CATALOG: NotificationTemplateCatalogEntry[] = [
  {
    template_key: EmailTemplates.ORDER_PLACED,
    label: "Order placed (pending)",
    description:
      "Sent when an order is placed (order.placed). In Medusa the order status is usually `pending` until payment is fully settled.",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_PROCESSING,
    label: "Processing (payment captured)",
    description: "Sent when a payment is captured (payment.captured).",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_PAYMENT_FAILED,
    label: "Payment / action required",
    description:
      "Sent when an order is updated and status is `requires_action` (order.updated). At most one email per order for this template (idempotency).",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_IN_FULFILLMENT,
    label: "In fulfillment",
    description:
      "Sent when a fulfillment is created for the order (order.fulfillment_created). Respects `no_notification` on the fulfillment request.",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_SHIPMENT_IN_PROGRESS,
    label: "Shipment in progress",
    description:
      "Sent when a shipment is created (shipment.created). Respects `no_notification`. The event id is the fulfillment id.",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_DELIVERED,
    label: "Delivered",
    description: "Sent when a fulfillment is marked delivered (delivery.created).",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_CANCELLED,
    label: "Cancelled",
    description: "Sent when the order is canceled (order.canceled).",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_REFUNDED,
    label: "Refunded",
    description: "Sent when a payment refund is recorded (payment.refunded).",
    audience: "customer",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_DEFERRED_INVOICE,
    label: "Deferred checkout — pay link",
    description:
      "Sent when an admin sends a pay link from the order (deferred checkout). A module row is created on first send with defaults including {{pay_url}}; edit under Notification email templates.",
    audience: "customer",
  },
  {
    template_key: EmailTemplates.ADMIN_ORDER_PLACED,
    label: "New order (staff)",
    description:
      "Sent to staff on order.placed for normal checkout (not deferred). Set ADMIN_ORDER_NOTIFICATION_EMAIL or STORE_SUPPORT_EMAIL.",
    audience: "admin",
  },
  {
    template_key: EmailTemplates.ADMIN_DEFERRED_ORDER_PAID,
    label: "Deferred checkout — customer paid (staff)",
    description:
      "Sent to staff when payment is captured or authorized (payment.captured / payment.authorized) on a deferred-checkout order. Same recipient env vars as other staff order emails; idempotency is per event so both can notify if your provider emits both.",
    audience: "admin",
  },
  {
    template_key: EmailTemplates.INVITE_USER,
    label: "Admin invite",
    description: "Sent when a user is invited to the admin (invite.created / invite.resent).",
    audience: "admin",
  },
]
