/**
 * Template keys for customer order notification emails (beyond `order-placed`).
 * `order-placed` remains the key for order.placed / pending confirmation.
 */
export const OrderNotificationEmailKeys = {
  /** payment.captured — payment succeeded; merchant-facing “processing” */
  ORDER_PROCESSING: "order-email-processing",
  /**
   * order.updated when order.status === `requires_action` (e.g. payment needs attention).
   * At most one email per order (idempotency) — see subscriber.
   */
  ORDER_PAYMENT_FAILED: "order-email-payment-failed",
  /** order.fulfillment_created */
  ORDER_IN_FULFILLMENT: "order-email-in-fulfillment",
  /** shipment.created */
  ORDER_SHIPMENT_IN_PROGRESS: "order-email-shipment-in-progress",
  /** delivery.created */
  ORDER_DELIVERED: "order-email-delivered",
  /** order.canceled */
  ORDER_CANCELLED: "order-email-cancelled",
  /** payment.refunded */
  ORDER_REFUNDED: "order-email-refunded",
  /** Admin-triggered: deferred checkout — pay link after shipping/total is finalized */
  ORDER_DEFERRED_INVOICE: "order-email-deferred-invoice",
} as const

export type OrderNotificationEmailKey =
  (typeof OrderNotificationEmailKeys)[keyof typeof OrderNotificationEmailKeys]
