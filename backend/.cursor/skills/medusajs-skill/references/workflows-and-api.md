# Workflows, API routes, subscribers, jobs

## Workflows

- Define under `src/workflows`. Use `createStep` / `createWorkflow` from `@medusajs/workflows-sdk`.
- Steps return `StepResponse(payload, compensateFn?)`. Keep steps **idempotent** where possible; use compensation for multi-step side effects.
- Run from routes, subscribers, or jobs:

```ts
const { result } = await myWorkflow(req.scope).run({
  input: { /* typed input */ },
})
```

- Prefer **core flows** from `@medusajs/medusa/core-flows` when they already match the use case (create cart, add line item, complete cart, etc.) instead of duplicating logic.

## API routes

- File: `src/api/<area>/.../route.ts` exporting `GET`, `POST`, etc.
- Path segments become URL segments; `[id]` folders map to dynamic params on `req.params`.
- Access services: `req.scope.resolve(ModuleRegistrationName.PRODUCT)` (example).
- **Middleware**: `src/api/middlewares.ts` exports `config` with `matcher` + middleware chain.

## Subscribers

- React to domain events (e.g. `order.placed`). Register in subscriber config; handler receives event payload and container.
- Use for side effects: notifications, ERP sync, analytics — not for synchronous user-facing responses.

## Scheduled jobs

- Under `src/jobs` with default export describing schedule and handler.
- Ensure **worker** process runs if you rely on Redis + worker mode for events/jobs.

## Store vs Admin

- **Store API**: public/customer flows; respect publishable keys and region/currency context.
- **Admin API**: privileged; protect routes and validate input; prefer admin user JWT or secret headers as per your setup.

## Common pitfalls

- Calling a workflow with wrong **input schema** → runtime errors; align with workflow generics.
- **Transaction boundaries**: multi-step operations should use workflows or explicit transactions, not scattered partial updates.
- **Large imports** in admin-only routes pulling client bundles — keep server-only code server-only.
