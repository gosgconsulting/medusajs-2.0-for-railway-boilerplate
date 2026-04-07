# Deployment, env, and operations

## Build and run

- Typical scripts: `medusa build`, `medusa develop`, `medusa start` (often targeting `.medusa/server` after build in hosted setups — follow your boilerplate’s `package.json`).
- **Node**: match `engines` in `package.json` (e.g. Node 22).

## Database

- **Postgres** is the usual production database. `DATABASE_URL` must be reachable from the app container.
- Run migrations as part of deploy: `medusa db:migrate` (exact CLI may vary slightly by version; check project scripts).

## Redis

- Used for event bus, session/cache layers, and workflow engine when `@medusajs/workflow-engine-redis` (or equivalent) is configured. **Worker + server** may need separate processes or combined mode per `WORKER_MODE` / docs for your version.

## File storage

- Local dev often uses `@medusajs/file-local`; production often uses S3-compatible (e.g. MinIO) via a custom or community provider. Ensure **public URLs** for storefront-visible assets match `backend_url` / CDN settings.

## Search

- Meilisearch, Algolia, or other integrations are optional. Indexing jobs must run where the indexer can reach the DB and search cluster.

## Payments and webhooks

- Stripe (or other) keys and **webhook secrets** belong in env. Webhook URL must be publicly reachable (HTTPS). Verify signature in the provider’s flow.

## Railway / Docker

- Set all env vars in the platform dashboard. Use the same **build** and **start** commands as local production simulation.
- If the app binds to `0.0.0.0`, respect the platform’s **PORT** env if required.

## Health checks

- Expose a simple route or use framework health endpoints if configured; ensure checks don’t require admin auth.
