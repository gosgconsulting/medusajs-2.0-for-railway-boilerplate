import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Backfill the multi-tenant `brand_id` columns so the active-store admin
 * scoping (see `inject-admin-active-brand-query.ts`) actually filters
 * customers / inventory items / api keys per active Medusa Store.
 * Idempotent — safe to re-run.
 *
 * Convention: `brand_id` everywhere = `shop_brands.supabase_brand_id`. The
 * Medusa-side columns `store.brand_id`, `sales_channel.brand_id`,
 * `api_key.brand_id`, `customer.brand_id`, `inventory_item.brand_id` are
 * added by an earlier migration.
 *
 * Steps:
 *   1. store.brand_id        <- shop_brands.supabase_brand_id  (matched by name, active brand)
 *   2. sales_channel.brand_id <- store.brand_id                (via store.default_sales_channel_id)
 *   3. api_key.brand_id      <- sales_channel.brand_id         (via publishable_api_key_sales_channel)
 *   4. customer.brand_id     <- sales_channel.brand_id         (via the customer's orders)
 *
 * Run: npx medusa exec ./src/scripts/backfill-tenant-brand-ids.ts
 */
export default async function backfillTenantBrandIds({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pgConn = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  const run = async (trx: any, label: string, sql: string) => {
    const res = await trx.raw(sql)
    const count = res?.rowCount ?? 0
    logger.info(`  ${label}: ${count} row(s) updated`)
    return count
  }

  await pgConn.transaction(async (trx: any) => {
    logger.info("Backfilling tenant brand_id columns…")

    await run(
      trx,
      "store.brand_id from shop_brands (name match, active)",
      `UPDATE store s
       SET brand_id = b.supabase_brand_id
       FROM shop_brands b
       WHERE LOWER(s.name) = LOWER(b.name)
         AND b.status = 'active'
         AND s.brand_id IS NULL`
    )

    await run(
      trx,
      "sales_channel.brand_id from store.default_sales_channel_id",
      `UPDATE sales_channel sc
       SET brand_id = s.brand_id
       FROM store s
       WHERE s.default_sales_channel_id = sc.id
         AND sc.brand_id IS NULL
         AND s.brand_id IS NOT NULL`
    )

    await run(
      trx,
      "api_key.brand_id from linked sales_channel",
      `UPDATE api_key ak
       SET brand_id = sc.brand_id
       FROM publishable_api_key_sales_channel pak
       JOIN sales_channel sc ON sc.id = pak.sales_channel_id
       WHERE ak.id = pak.publishable_key_id
         AND ak.brand_id IS NULL
         AND sc.brand_id IS NOT NULL`
    )

    await run(
      trx,
      "customer.brand_id from their orders",
      `UPDATE customer c
       SET brand_id = sc.brand_id
       FROM "order" o
       JOIN sales_channel sc ON sc.id = o.sales_channel_id
       WHERE o.customer_id = c.id
         AND c.brand_id IS NULL
         AND sc.brand_id IS NOT NULL`
    )
  })

  logger.info("Done.")
}
