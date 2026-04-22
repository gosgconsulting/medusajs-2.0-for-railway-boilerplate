### local setup
Video instructions: https://youtu.be/PPxenu7IjGM

- `cd /backend`
- `pnpm install` or `npm i`
- Rename `.env.template` ->  `.env`
- To connect to your online database from your local machine, copy the `DATABASE_URL` value auto-generated on Railway and add it to your `.env` file.
  - If connecting to a new database, for example a local one, run `pnpm ib` or `npm run ib` to seed the database.
- `pnpm dev` or `npm run dev`

### requirements
- **postgres database** (Automatic setup when using the Railway template)
- **redis** (Automatic setup when using the Railway template) - fallback to simulated redis.
- **MinIO storage** (Automatic setup when using the Railway template) - fallback to local storage.
- **Meilisearch** (Automatic setup when using the Railway template)

### Product translations (DeepL)

When `DEEPL_AUTH_KEY` and `DEEPL_TARGET_LANGS` (comma-separated, e.g. `DE,FR`) are set, the admin product editor shows **Translate (DeepL)**. That calls `POST /admin/products/:id/translate` and stores a JSON blob on the product under metadata key **`i18n`** (`schemaVersion` 2 for new runs, `source` with `contentHash` and plain-text fields, `targets` keyed by lowercase locale, e.g. `de`).

Optional **`DEEPL_METADATA_TRANSLATION_KEYS`**: comma-separated metadata keys on the product (e.g. `fabrication_et_composition,moq`). Their string values are translated in the same DeepL requests as title/subtitle/description; results appear as `targets.<locale>.metadata.<key>` while the original keys on `product.metadata` stay unchanged.

**Storefront:** read `product.metadata.i18n` (parse JSON if your client receives a string). For locale `de`, use `targets.de.title`, `targets.de.subtitle`, `targets.de.description` when present; otherwise fall back to `product.title`, `product.subtitle`, `product.description`. For translated custom fields, use `targets.de.metadata?.<yourKey>`. Optional: `POST .../translate?force=true` re-runs DeepL even if the content hash matches.

Optional `DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE=true` runs the same logic on `product.updated` (failures are logged; product save is not blocked).

### commands

`cd backend/`
`npm run ib` or `pnpm ib` will initialize the backend by running migrations and seed the database with required system data.
`npm run dev` or `pnpm dev` will start the backend (and admin dashboard frontend on `localhost:9000/app`) in development mode.
`pnpm build && pnpm start` will compile the project and run from compiled source. This can be useful for reproducing issues on your cloud instance.
