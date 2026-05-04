import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Resolves the multi-tenant `brand_id` for a Medusa Store, and looks up entity
 * ids that belong to that brand for entities Medusa cannot natively filter by
 * `sales_channel_id` (customers, inventory items, api keys).
 *
 * The convention across this codebase is `brand_id` = `shop_brands.supabase_brand_id`,
 * stored as a column on `store`, `sales_channel`, `api_key`, `customer`,
 * `inventory_item` (added by a previous migration). On dev databases without
 * those columns, the helpers degrade to a no-op (`null`) so callers can pass
 * through unchanged.
 *
 * Pairs with `inject-admin-active-store-query.ts` (which scopes
 * sales-channel-aware endpoints — products / orders / stores) by covering
 * the entities that don't have a sales_channel link.
 */

const CACHE_TTL_MS = 30_000
const brandIdCache = new Map<
  string,
  { value: string | null; expiresAt: number }
>()

/** Per-table memo: does the `brand_id` column exist? Set on first query. */
const brandIdColumnExists = new Map<string, boolean>()

async function hasBrandIdColumn(knex: any, table: string): Promise<boolean> {
  if (brandIdColumnExists.has(table)) return brandIdColumnExists.get(table)!
  try {
    const exists: boolean = await knex.schema.hasColumn(table, "brand_id")
    brandIdColumnExists.set(table, exists)
    return exists
  } catch {
    brandIdColumnExists.set(table, false)
    return false
  }
}

export async function getBrandIdForStore(
  scope: { resolve: (key: string) => any },
  storeId: string
): Promise<string | null> {
  if (!storeId) return null

  const cached = brandIdCache.get(storeId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any

  if (!(await hasBrandIdColumn(knex, "store"))) {
    brandIdCache.set(storeId, { value: null, expiresAt: Date.now() + CACHE_TTL_MS })
    return null
  }

  const row = await knex("store")
    .select("brand_id")
    .where({ id: storeId })
    .whereNull("deleted_at")
    .first()

  const value: string | null = row?.brand_id ?? null
  brandIdCache.set(storeId, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  return value
}

/**
 * Pre-fetch ids for an entity scoped via a direct `brand_id` column. Returns
 * `null` if the column doesn't exist on this database (caller should skip
 * scoping in that case rather than emptying the list).
 */
export async function fetchIdsForBrand(
  scope: { resolve: (key: string) => any },
  table: "customer" | "customer_group" | "inventory_item" | "api_key",
  brandId: string
): Promise<string[] | null> {
  const knex = scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
  if (!(await hasBrandIdColumn(knex, table))) return null
  const rows: { id: string }[] = await knex(table)
    .select("id")
    .where({ brand_id: brandId })
    .whereNull("deleted_at")
  return rows.map((r) => r.id)
}

export function invalidateBrandIdCache(storeId?: string): void {
  if (storeId) brandIdCache.delete(storeId)
  else brandIdCache.clear()
}
