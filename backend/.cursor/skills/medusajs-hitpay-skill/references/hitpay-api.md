# HitPay — Online Payments API (reference)

Primary source: [Online Payments guide](https://docs.hitpayapp.com/apis/guide/online-payments).

## Endpoints

| Environment | Base URL |
|-------------|----------|
| Sandbox | `https://api.sandbox.hit-pay.com` |
| Production | `https://api.hit-pay.com` |

## Step 1: Create payment request

- **Method / path:** `POST /v1/payment-requests`
- **Content-Type:** `application/x-www-form-urlencoded` (mandatory per HitPay)
- **Headers:**
  - `X-BUSINESS-API-KEY` — from Dashboard → Settings → API Keys
  - `Content-Type: application/x-www-form-urlencoded`
  - `X-Requested-With: XMLHttpRequest` (recommended in HitPay examples)

**Required fields:** `amount`, `currency`.

**Integration-critical optional fields:**

- `reference_number` — stable internal reference; for Medusa, use the **payment session id** so webhooks can target the correct session.
- `redirect_url` — where the customer returns after checkout; query params include payment request id and status per HitPay.
- `email`, `name`, `phone` — buyer details when available.
- `payment_methods[]` — repeat key for each method (e.g. `paynow_online`, `card`); omit to use account defaults ([payment methods reference](https://docs.hitpayapp.com/apis/guide/payment-methods-reference)).

**Response:** JSON includes `id` (payment request UUID), `url` (hosted checkout URL), `status`, `amount`, `currency`, `reference_number`, etc.

## Step 2: Checkout UI

**Option A — Redirect (what the boilerplate provider assumes):** send the browser to `url` from the create response.

**Option B — Drop-in UI:** requires dashboard **default link** + `payment_request_id`; separate storefront work ([example](https://github.com/hit-pay/hitpay-js-example/blob/master/index.html)). Apple Pay not supported in drop-in per HitPay.

## Step 3: Webhooks (dashboard)

Per [HitPay FAQ](https://docs.hitpayapp.com/apis/guide/online-payments), the **`webhook` field on create payment request is deprecated**. Register endpoints in **Developers → Webhook Endpoints** and subscribe at least to **`payment_request.completed`**.

**Headers on delivery:**

| Header | Typical value |
|--------|----------------|
| `Hitpay-Signature` | HMAC-SHA256(hex) of raw body, key = salt |
| `Hitpay-Event-Type` | e.g. `completed` |
| `Hitpay-Event-Object` | `payment_request` |
| `User-Agent` | `HitPay v2.0` |

**Validation:** `HMAC_SHA256(raw_request_body, salt)` compared with `Hitpay-Signature` using a constant-time compare. Use the **raw** HTTP body, not a re-serialization of parsed JSON.

## Other APIs used in the boilerplate provider

- **GET `/v1/payment-requests/{request_id}`** — status polling / authorize / capture alignment ([Get Payment Status](https://docs.hitpayapp.com/apis/payment-request/get-payment-status)).
- **POST `/v1/refund`** — JSON body with `payment_id` and `amount` (major currency units); requires `X-BUSINESS-API-KEY` ([Create Refund](https://docs.hitpayapp.com/apis/payment-request/refund)).

## Rate limits (awareness)

HitPay documents general and payment-request-specific limits; prefer webhooks over aggressive polling ([Online Payments](https://docs.hitpayapp.com/apis/guide/online-payments)).

## Production checklist

From HitPay docs: production base URL, production keys and salt, payment methods enabled for live, update drop-in default link if used.
