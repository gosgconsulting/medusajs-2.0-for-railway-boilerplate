/**
 * Default Handlebars bodies used when seeding or resetting templates from the admin.
 * Variables match subscriber payloads: see order-placed and invite-created subscribers.
 */
export const DEFAULT_ORDER_PLACED_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h1 style="text-align: center;">Order Confirmation</h1>
  <p>Dear {{shippingAddress.first_name}} {{shippingAddress.last_name}},</p>
  <p>Thank you for your recent order! Here are your order details:</p>
  <h2>Order Summary</h2>
  <p>Order ID: {{order.display_id}}</p>
  <p>Order Date: {{formatDate order.created_at}}</p>
  <p>Total: {{order.summary.raw_current_order_total.value}} {{order.currency_code}}</p>
  <hr />
  <h2>Shipping Address</h2>
  <p>{{shippingAddress.address_1}}</p>
  <p>{{shippingAddress.city}}, {{shippingAddress.province}} {{shippingAddress.postal_code}}</p>
  <p>{{shippingAddress.country_code}}</p>
  <hr />
  <h2>Order Items</h2>
  <table style="width:100%; border-collapse: collapse; border: 1px solid #ddd;">
    <tr style="background: #f2f2f2;">
      <th style="padding:8px; text-align:left;">Item</th>
      <th style="padding:8px;">Qty</th>
      <th style="padding:8px;">Price</th>
    </tr>
    {{#each order.items}}
    <tr>
      <td style="padding:8px; border-bottom:1px solid #ddd;">{{title}} — {{product_title}}</td>
      <td style="padding:8px; border-bottom:1px solid #ddd; text-align:center;">{{quantity}}</td>
      <td style="padding:8px; border-bottom:1px solid #ddd;">{{unit_price}} {{../order.currency_code}}</td>
    </tr>
    {{/each}}
  </table>
</body>
</html>
`

export const DEFAULT_INVITE_USER_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
  <p>You've been invited to be an administrator.</p>
  <p style="margin: 24px 0;">
    <a href="{{inviteLink}}" style="background:#000; color:#fff; padding:12px 20px; text-decoration:none; border-radius:4px;">
      Accept invitation
    </a>
  </p>
  <p>Or open this link:</p>
  <p style="word-break: break-all;"><a href="{{inviteLink}}">{{inviteLink}}</a></p>
  <hr style="margin: 26px 0;" />
  <p style="color:#666; font-size:12px;">
    If you were not expecting this invitation, you can ignore this email.
  </p>
</body>
</html>
`

export const DEFAULT_SUBJECT_BY_KEY: Record<string, string> = {
  "order-placed": "Your order has been placed",
  "invite-user": "You've been invited to Medusa!",
}
