# Medusa v2 — HitPay Payment Module Provider (reference)

## Framework concepts

- **Payment module:** `@medusajs/payment` with `options.providers[]` in `medusa-config`.
- **Custom provider:** Class extending `AbstractPaymentProvider<Options>` from `@medusajs/framework/utils`, exported via `ModuleProvider(Modules.PAYMENT, { services: [YourService] })` (same pattern as `@medusajs/payment-stripe`).
- **Official provider guide:** [Create a Payment Module Provider](https://docs.medusajs.com/resources/references/payment/provider).
- **Webhooks:** [Payment webhook events](https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events) — built-in route `/hooks/payment/{identifier}_{providerConfigId}`.

Medusa passes webhook payload to `getWebhookActionAndData` with:

- `data` — parsed `req.body`
- `rawData` — raw body buffer/string (required for HitPay HMAC)
- `headers` — lowercased keys in Node (e.g. `hitpay-signature`)

## Provider id and webhook URL

If the service defines `static identifier = "hitpay"` and `medusa-config` registers the provider with `id: "hitpay"`:

- Registered Medusa provider id: **`pp_hitpay_hitpay`**
- Webhook URL (HTTPS, publicly reachable): **`{BACKEND_URL}/hooks/payment/hitpay_hitpay`**

Register that URL in the HitPay dashboard for `payment_request.completed`.

## Environment variables (this boilerplate)

| Variable | Purpose |
|----------|---------|
| `HITPAY_API_KEY` | `X-BUSINESS-API-KEY` |
| `HITPAY_SALT` | Webhook HMAC secret |
| `HITPAY_REDIRECT_URL` | HitPay `redirect_url` after payment |
| `HITPAY_SANDBOX` | `true` → `api.sandbox.hit-pay.com` |

All of `HITPAY_API_KEY`, `HITPAY_SALT`, and `HITPAY_REDIRECT_URL` are required for the payment module to register the HitPay provider in `medusa-config.js`.

## initiatePayment contract

- Read `input.data.session_id` — Medusa’s payment session id; send to HitPay as **`reference_number`**.
- Amount: Medusa passes **major currency units** (`BigNumberInput`); format for HitPay with correct decimal places (0 for JPY-style currencies, 2 for most).
- Return `InitiatePaymentOutput`: `id` = HitPay payment request id; `data` must include **`url`** for storefront redirect (no secrets in `data`).

## getWebhookActionAndData contract

For `payment_request` + completed payment:

- Verify signature using **`payload.rawData`** and `HITPAY_SALT`.
- Resolve Medusa `session_id` from HitPay **`reference_number`** (must match what you set in `initiatePayment`).
- Return:

```ts
{
  action: PaymentActions.SUCCESSFUL, // enum maps to "captured"
  data: {
    session_id: referenceNumber,
    amount: /* BigNumber, major units, from webhook body.amount */
  },
}
```

For failures, return `PaymentActions.FAILED` with `session_id` when known.

Unrecognized events: `{ action: PaymentActions.NOT_SUPPORTED }`.

`processPaymentWorkflow` uses this to authorize/capture and complete the cart when appropriate.

## authorizePayment / getPaymentStatus / capturePayment

Hosted checkout is effectively **captured** when HitPay marks the request completed with a succeeded payment. Implementations typically **GET** `/v1/payment-requests/{id}` and map HitPay `status` + `payments[].status` to `PaymentSessionStatus` (`PENDING`, `CAPTURED`, `CANCELED`, etc.), persisting **`hitpay_payment_id`** from `payments[].id` for refunds.

## refundPayment

HitPay **POST `/v1/refund`** expects `payment_id` (the succeeded payment id, not only the payment request id). Store `hitpay_payment_id` on the Medusa payment/session data after completion.

## updatePayment

HitPay does not support editing amount/currency on an existing payment request. Throw `MedusaError` with a clear message, or no-op only when amount/currency unchanged (pattern in boilerplate).

## Regions and Admin

Enable **`pp_hitpay_hitpay`** on regions (Admin or seed). Seed example: add to `payment_providers` when HitPay env is present so fresh dev DB can select HitPay.

## Storefront responsibilities

1. Create/update payment session with provider **`pp_hitpay_hitpay`** (or correct id for your `identifier` + config `id`).
2. Read **`payment_session.data.url`** from the Store API and **redirect** the customer to HitPay.
3. After `redirect_url` return, show UX based on query params but **do not** trust redirect alone for fulfillment — rely on webhook-processed order state ([HitPay](https://docs.hitpayapp.com/apis/guide/online-payments)).
4. Optionally poll or refresh order/cart after delay if webhook is slow.

## Coexistence with Stripe

Register multiple entries in `options.providers` (Stripe + HitPay). Payment module loads if **any** provider is configured.

## Testing

- Use HitPay sandbox keys + `HITPAY_SANDBOX=true`.
- Expose backend with **HTTPS** (e.g. tunnel) so HitPay can POST webhooks.
- Confirm `payment_request.completed` in HitPay dashboard delivery logs if carts never complete.
