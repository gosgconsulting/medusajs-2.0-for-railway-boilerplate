# Medusa 2 — Architecture

## Mental model

Medusa 2 is a **modular commerce backend**. Business logic lives in **modules** (product, cart, order, payment, fulfillment, etc.). Cross-cutting orchestration uses **workflows** (steps with compensation). HTTP is exposed via **file-based API routes** under `src/api`. The **dependency injection container** (`req.scope` in routes, `container` in workflows/subscribers) resolves module services and framework utilities.

## Key packages (typical)

- `@medusajs/medusa` — application core, HTTP layer patterns
- `@medusajs/framework` — utilities shared with plugins (`@medusajs/framework/utils`)
- `@medusajs/workflows-sdk` — `createWorkflow`, `createStep`, `StepResponse`
- `@medusajs/js-sdk` — typed client for Store/Admin APIs from storefronts or scripts
- `@medusajs/types` — interfaces such as `IProductModuleService`

Prefer **module services** from `@medusajs/types` + `ModuleRegistrationName` (or `Modules` from utils) instead of reaching into internal tables unless you have a deliberate reason.

## Configuration

- Entry: `medusa-config.js` or `medusa-config.ts` using `defineConfig` / project config.
- **CORS**: `adminCors`, `storeCors`, `authCors` must include your Admin app, storefront, and auth origins or browsers will block requests.
- **Secrets**: `JWT_SECRET`, `COOKIE_SECRET`, DB URL, Redis URL — never commit; use env vars (see deployment reference).

## Modules vs plugins

- **Module**: bounded context (product, pricing, region…). Custom modules live under `src/modules` and are registered in config.
- **Plugin / provider**: payment provider, notification provider, file provider — configured under the parent module’s `options.providers`.

## Admin and Dashboard

Admin UI is often served by `@medusajs/dashboard` with `admin.backendUrl` pointing at this server. Custom admin widgets/extensions follow Medusa’s admin extension docs for the version you run.

## When something “is not found”

1. Confirm the **API prefix** (`/store`, `/admin`, `/auth`, custom).
2. Confirm **publishable API key** / **JWT** for admin routes.
3. Check **workflow** export and that you `await workflow(req.scope).run({ input })` with correct input shape.
4. Check **migrations** ran after model changes (`medusa db:migrate` in production workflows).
