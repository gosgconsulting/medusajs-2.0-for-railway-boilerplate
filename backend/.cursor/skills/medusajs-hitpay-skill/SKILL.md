---
name: medusajs-hitpay-skill
description: >-
  MedusaJS v2 + HitPay payment integration: Payment Module Provider (AbstractPaymentProvider),
  hosted checkout redirect flow, dashboard webhooks (payment_request.completed), HMAC signature
  verification, env and medusa-config, region provider id pp_hitpay_hitpay, storefront session.data.url.
  Activates for HitPay, hitpay, Medusa HitPay, payment_request, Southeast Asia checkout, PayNow FPX QRIS.
license: MIT
activation: /medusajs-hitpay-skill
provenance:
  maintainer: agent-skill-creator
  version: 1.0.0
  created: "2026-04-07"
  source_references:
    - https://docs.hitpayapp.com/apis/guide/online-payments
    - https://docs.medusajs.com/resources/references/payment/provider
    - https://docs.medusajs.com/resources/commerce-modules/payment/webhook-events
metadata:
  author: agent-skill-creator
  version: 1.0.0
  created: 2026-04-07
  last_reviewed: 2026-04-07
  review_interval_days: 90
  dependencies:
    - url: https://docs.hitpayapp.com/apis/guide/online-payments
      name: HitPay Online Payments
      type: docs
    - url: https://docs.medusajs.com
      name: Medusa Documentation
      type: docs
---

# /medusajs-hitpay-skill — Medusa v2 + HitPay

You are an expert in integrating **HitPay** with **MedusaJS v2** using a custom **Payment Module Provider** (`AbstractPaymentProvider`) registered under `@medusajs/payment`, aligned with HitPay’s [Online Payments](https://docs.hitpayapp.com/apis/guide/online-payments) guide.

## Trigger

User invokes `/medusajs-hitpay-skill` or asks about HitPay + Medusa (checkout, webhooks, env, refunds, sandbox).

Examples:

- `/medusajs-hitpay-skill What webhook URL do I register in HitPay?`
- `/medusajs-hitpay-skill Why is signature verification failing?`
- `/medusajs-hitpay-skill How does the storefront complete checkout after redirect?`

## Operating principles

1. **Official HitPay flow** — Create payment request (form-urlencoded) → redirect customer to returned `url` → confirm payment via **dashboard** webhook `payment_request.completed`, not the deprecated per-request `webhook` API field ([FAQ](https://docs.hitpayapp.com/apis/guide/online-payments)).
2. **Raw body for HMAC** — `Hitpay-Signature` is HMAC-SHA256 of the **exact raw JSON body** with dashboard **salt**. Never re-`JSON.stringify` a parsed object for verification (key order and spacing differ). Medusa’s `/hooks/payment/:provider` route supplies `rawData` when `preserveRawBody` is enabled (default for that path).
3. **Medusa mapping** — Provider `static identifier` + config `id` in `medusa-config` produce the registered provider id `pp_{identifier}_{id}` (e.g. `pp_hitpay_hitpay`). Webhook path: `/hooks/payment/hitpay_hitpay` for identifier `hitpay` and id `hitpay`.
4. **reference_number = Medusa session id** — Set HitPay `reference_number` to the Medusa **payment session id** (`data.session_id` in `initiatePayment`) so webhooks can return `session_id` for `processPaymentWorkflow`.
5. **PaymentActions.SUCCESSFUL** — In Medusa v2 this enum value is the string `"captured"`. Return it from `getWebhookActionAndData` with `session_id` and `amount` (`BigNumber`) for completed payments.
6. **Security** — API key and salt only in server env; never expose on the storefront. Do not treat `redirect_url` alone as proof of payment ([HitPay warning](https://docs.hitpayapp.com/apis/guide/online-payments)).

## Quick map (this boilerplate)

| Concern | Location |
|--------|----------|
| Provider service | `src/modules/hitpay-payment/service.ts` |
| Provider export | `src/modules/hitpay-payment/index.ts` (`ModuleProvider(Modules.PAYMENT, …)`) |
| Payment module + providers | `medusa-config.js` (`paymentModuleProviders`, `Modules.PAYMENT`) |
| Env constants | `src/lib/constants.ts` (`HITPAY_*`) |
| Seed region providers | `src/scripts/seed.ts` (optional `pp_hitpay_hitpay` when env set) |

## Deep references (load when needed)

- [HitPay API and webhook details](references/hitpay-api.md)
- [Medusa provider contract and storefront](references/medusa-provider.md)

## Failure modes

| Symptom | Likely cause |
|--------|----------------|
| Signature invalid | Wrong salt (sandbox vs prod), or verifying against stringified `req.body` instead of raw bytes |
| Webhook never completes cart | Dashboard webhook URL wrong, event not `payment_request.completed`, or `reference_number` missing / not Medusa session id |
| Provider missing | `HITPAY_API_KEY`, `HITPAY_SALT`, and `HITPAY_REDIRECT_URL` all required to load module in this boilerplate |
| 401 / invalid API key | Sandbox URL + sandbox key mismatch ([HitPay troubleshooting](https://docs.hitpayapp.com/apis/guide/online-payments)) |
| Refund fails | Payment data missing `hitpay_payment_id` (from succeeded `payments[].id` after completion) |

## Coordination with /medusajs-skill

For non-HitPay Medusa work, use [`/medusajs-skill`](../medusajs-skill/SKILL.md). For HitPay-specific integration, prefer this skill first, then Medusa payment/webhook docs for framework behavior.
