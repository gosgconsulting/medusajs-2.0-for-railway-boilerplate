/**
 * Default plain-text bodies (Handlebars). The backend wraps them in a simple HTML layout when sending.
 * Merchants may still use nested paths (e.g. {{order.display_id}}) or legacy full-HTML bodies; those are detected at send time.
 */
export const DEFAULT_ORDER_PLACED_HTML = `Hi {{customer_name}},

Thank you for your order #{{order_id}}.

Total: {{total}} {{currency}}
Items: {{items_count}}

We'll send updates to {{customer_email}}.

Shipping to:
{{shipping_address}}

— {{store_name}}`

/** Shared default for all \`order-email-*\` status templates (Handlebars). */
export const DEFAULT_ORDER_STATUS_NOTICE_HTML = `Hi {{customer_name}},

{{noticeHeadline}}

{{noticeMessage}}

Order #{{order_id}} · {{formatDate order.created_at}}
Total: {{total}} {{currency}}

If you have any questions, reach us at {{support_email}}.

— {{store_name}}`

/**
 * Deferred checkout invoice (notification_email_template module).
 * `{{pay_url}}` is set when an admin sends the pay link; override this body in Admin → Notification email templates.
 */
export const DEFAULT_DEFERRED_INVOICE_EMAIL_HTML = `Hi {{customer_name}},

{{noticeHeadline}}

{{noticeMessage}}

Pay securely (copy and paste if needed):
{{pay_url}}

Order #{{order_id}} · {{formatDate order.created_at}}
Total: {{total}} {{currency}}

If you have any questions, reach us at {{support_email}}.

— {{store_name}}`

export const DEFAULT_INVITE_USER_HTML = `Hi,

You've been invited to join {{store_name}} as an administrator.

Open this link to accept:
{{inviteLink}}

If you were not expecting this invitation, you can ignore this email.

— {{store_name}}`

/** Staff alert when a shopper places an order (Handlebars). */
export const DEFAULT_ADMIN_ORDER_PLACED_HTML = `New order on {{store_name}}

Customer: {{customer_name}} <{{customer_email}}>
Order: #{{order_id}}
Placed: {{formatDate order.created_at}}
Total: {{total}} {{currency}} · {{items_count}} line item(s)

Shipping:
{{shipping_address}}

Open in Medusa Admin:
{{admin_order_url}}

— {{store_name}}`

/** Staff alert when a deferred-checkout order is paid (Handlebars). */
export const DEFAULT_ADMIN_DEFERRED_ORDER_PAID_HTML = `Payment received (deferred checkout) — {{store_name}}

Customer: {{customer_name}} <{{customer_email}}>
Order: #{{order_id}}
Placed: {{formatDate order.created_at}}
Total: {{total}} {{currency}} · {{items_count}} line item(s)

Shipping:
{{shipping_address}}

Open in Medusa Admin:
{{admin_order_url}}

— {{store_name}}`

export const DEFAULT_SUBJECT_BY_KEY: Record<string, string> = {
  "order-placed": "Your order has been placed",
  "invite-user": "You've been invited to Medusa!",
  "order-email-processing": "We are processing your order",
  "order-email-payment-failed": "Action needed for your order payment",
  "order-email-in-fulfillment": "Your order is being prepared",
  "order-email-shipment-in-progress": "Your order has shipped",
  "order-email-delivered": "Your order was delivered",
  "order-email-cancelled": "Your order was cancelled",
  "order-email-refunded": "Your order was refunded",
  "order-email-deferred-invoice": "Complete payment for your order",
  "admin-order-placed": "New order #{{order_id}} — {{store_name}}",
  "admin-deferred-order-paid": "Paid: order #{{order_id}} — {{store_name}}",
}
