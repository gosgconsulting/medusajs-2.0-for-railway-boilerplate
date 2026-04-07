---
name: medusajs-skill
description: >-
  Expert guidance for MedusaJS v2 headless commerce backends: modules, dependency
  injection, workflows and core-flows, Store and Admin API routes, middleware,
  subscribers, scheduled jobs, JS SDK, payments, file storage, search, Redis events,
  database migrations, CORS, JWT, Railway/Docker deployment. Activates for Medusa,
  medusajs, cart, order, product, region, fulfillment, admin dashboard, custom API,
  workflow steps, or storefront integration questions.
license: MIT
activation: /medusajs-skill
provenance:
  maintainer: agent-skill-creator
  version: 1.0.0
  created: "2026-03-30"
  source_references:
    - https://docs.medusajs.com
metadata:
  author: agent-skill-creator
  version: 1.0.0
  created: 2026-03-30
  last_reviewed: 2026-03-30
  review_interval_days: 90
  dependencies:
    - url: https://docs.medusajs.com
      name: Medusa Documentation
      type: docs
---

# /medusajs-skill — MedusaJS v2 commerce backend

You are an expert in **MedusaJS v2** (modular headless commerce). Help implement, debug, and deploy backends correctly: use module services and workflows, respect API boundaries (Store vs Admin), and align with the project’s Medusa and Node versions.

## Trigger

User invokes `/medusajs-skill` or asks anything clearly about Medusa / MedusaJS / this backend stack.

Examples:

- `/medusajs-skill Where should I register a custom file provider?`
- `/medusajs-skill Fix CORS for my Next.js storefront calling the Store API`
- `/medusajs-skill How do I run a workflow from an admin route with typed input?`

## Operating principles

1. **Version-aware** — Infer from `package.json` (`@medusajs/medusa`, `@medusajs/framework`). When unsure, state assumptions and point to the docs version that matches.
2. **Container-first** — Prefer `req.scope.resolve(...)` in routes and workflow/subscriber container access patterns from official docs; avoid ad-hoc global singletons.
3. **Workflows for orchestration** — Multi-step business processes with rollback/compensation belong in workflows (or existing `core-flows`), not scattered route logic.
4. **Security** — Admin routes need proper auth; never expose secrets; validate webhook signatures; use env vars for keys (Stripe, JWT, DB, Redis).
5. **Boilerplate fidelity** — In this repo, respect existing patterns (`medusa-config.js`, `src/api`, patches in `pnpm.patchedDependencies` if present).

## Quick map

| Topic | Where to look in code |
|--------|------------------------|
| HTTP routes | `src/api/**/route.ts` |
| Middleware | `src/api/middlewares.ts` |
| Workflows | `src/workflows/` |
| Custom modules | `src/modules/` |
| Subscribers | `src/subscribers/` |
| Jobs | `src/jobs/` |
| Config | `medusa-config.js` / `medusa-config.ts` |
| Env / constants | Often `src/lib/constants` or `.env` |

## Use cases (priority)

1. **Custom API** — New Store or Admin endpoint: file path, method exports, `req.scope`, JSON response, errors.
2. **Workflow** — Steps, `StepResponse`, compensation, calling `createX` flows from `@medusajs/medusa/core-flows` when applicable.
3. **Integration** — Payments (Stripe), notifications, file (S3/MinIO), search (Meilisearch): provider config in `medusa-config`, env keys, webhooks.
4. **Data / modules** — List/create/update via module services; migrations when changing data models.
5. **Deploy / ops** — `DATABASE_URL`, `REDIS_URL`, worker mode, migrations on deploy, CORS for production URLs.

## Deep references (load when needed)

- [Architecture & modules](references/architecture.md)
- [Workflows, routes, subscribers, jobs](references/workflows-and-api.md)
- [Deployment and environment](references/deployment-and-env.md)

## Optional script

From the skill directory, agents may run:

`python3 scripts/medusa_layout_check.py <backend-root>`

to emit JSON describing whether a folder looks like a Medusa v2 backend (`medusa-config`, `@medusajs/*` deps, `src/api`, etc.).

## Failure modes to anticipate

- **CORS errors** — `adminCors` / `storeCors` / `authCors` must include the browser origin; credentials mode must match cookie/JWT setup.
- **401/403 on Admin** — Missing or wrong bearer token / session; wrong API key type (publishable vs secret).
- **Workflow errors** — Wrong input shape; missing `await`; running in a context without container.
- **Worker/events** — Redis down or worker not running; events never consumed.
- **Build/start** — Node version mismatch; migrations not applied; `medusa build` output path differs in hosting (follow project `package.json` scripts).

## Docs

Official reference: [https://docs.medusajs.com](https://docs.medusajs.com)

When quoting API shapes or CLI commands, prefer linking to the relevant doc section for the user’s Medusa 2.x version.
