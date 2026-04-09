import { EmailTemplates } from "../modules/email-notifications/templates"
import { OrderNotificationEmailKeys } from "./order-notification-email-keys"

export type NotificationTemplateCatalogEntry = {
  template_key: string
  label: string
  description: string
}

/** Built-in notification template keys that merchants can override from the admin. */
export const NOTIFICATION_TEMPLATE_CATALOG: NotificationTemplateCatalogEntry[] = [
  {
    template_key: EmailTemplates.ORDER_PLACED,
    label: "Order placed (pending)",
    description:
      "Sent when an order is placed (order.placed). In Medusa the order status is usually `pending` until payment is fully settled.",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_PROCESSING,
    label: "Processing (payment captured)",
    description: "Sent when a payment is captured (payment.captured).",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_PAYMENT_FAILED,
    label: "Payment / action required",
    description:
      "Sent when an order is updated and status is `requires_action` (order.updated). At most one email per order for this template (idempotency).",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_IN_FULFILLMENT,
    label: "In fulfillment",
    description:
      "Sent when a fulfillment is created for the order (order.fulfillment_created). Respects `no_notification` on the fulfillment request.",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_SHIPMENT_IN_PROGRESS,
    label: "Shipment in progress",
    description:
      "Sent when a shipment is created (shipment.created). Respects `no_notification`. The event id is the fulfillment id.",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_DELIVERED,
    label: "Delivered",
    description: "Sent when a fulfillment is marked delivered (delivery.created).",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_CANCELLED,
    label: "Cancelled",
    description: "Sent when the order is canceled (order.canceled).",
  },
  {
    template_key: OrderNotificationEmailKeys.ORDER_REFUNDED,
    label: "Refunded",
    description: "Sent when a payment refund is recorded (payment.refunded).",
  },
  {
    template_key: EmailTemplates.INVITE_USER,
    label: "Admin invite",
    description: "Sent when a user is invited to the admin (invite.created / invite.resent).",
  },
]
