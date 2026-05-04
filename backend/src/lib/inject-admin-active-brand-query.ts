import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ADMIN_ACTIVE_STORE_COOKIE,
  ADMIN_ACTIVE_STORE_HEADER,
} from "admin/lib/active-store-keys"
import {
  fetchIdsForBrand,
  getBrandIdForStore,
} from "./active-store-brand-id"

/**
 * Active-store scoping for admin list endpoints whose entities are NOT linked
 * to a sales channel: customers, inventory items, publishable api keys.
 *
 * For sales-channel-aware endpoints (products, orders, stores) see
 * `inject-admin-active-store-query.ts` — that one resolves the active store to
 * its sales channels and merges `sales_channel_id` into the query. This file
 * uses the parallel `brand_id` column (= `shop_brands.supabase_brand_id`)
 * already present on `customer` / `inventory_item` / `api_key` to filter by id.
 *
 * Reads the active store id from the same header + cookie + matchers as the
 * sister file so the dashboard's existing top-bar selector "just works".
 */

function parseCookieHeader(
  header: string | undefined,
  name: string
): string | undefined {
  if (!header || typeof header !== "string") return undefined
  for (const part of header.split(";")) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    if (part.slice(0, idx).trim() !== name) continue
    const v = part.slice(idx + 1).trim()
    try {
      return decodeURIComponent(v)
    } catch {
      return v
    }
  }
  return undefined
}

function readActiveStoreId(req: MedusaRequest): string | undefined {
  const h = req.headers[ADMIN_ACTIVE_STORE_HEADER]
  if (typeof h === "string" && h.trim()) return h.trim()
  const cookies = (
    req as MedusaRequest & { cookies?: Record<string, string | undefined> }
  ).cookies
  const fromParsed = cookies?.[ADMIN_ACTIVE_STORE_COOKIE]
  if (typeof fromParsed === "string" && fromParsed.trim()) {
    return fromParsed.trim()
  }
  const fromRaw = parseCookieHeader(
    req.headers.cookie,
    ADMIN_ACTIVE_STORE_COOKIE
  )
  if (typeof fromRaw === "string" && fromRaw.trim()) return fromRaw.trim()
  return undefined
}

function adminPathname(req: MedusaRequest): string {
  const raw = req.originalUrl ?? req.url ?? ""
  return raw.split("?")[0] ?? ""
}

/**
 * Sentinel id used when a brand resolves to zero rows for the target table.
 * We inject this so the underlying handler returns an empty list instead of
 * silently returning every row (which is what an empty `id[]` would do).
 */
const NO_MATCH_SENTINEL = "__active_brand_no_match__"

function intersectIdQuery(
  req: MedusaRequest,
  allowedIds: string[]
): void {
  const q = req.query as Record<string, any>
  const existing = (() => {
    const v = q.id
    if (v == null) return []
    return Array.isArray(v) ? v.map(String) : [String(v)]
  })()
  let next: string[]
  if (existing.length === 0) {
    next = allowedIds.slice()
  } else {
    const allow = new Set(allowedIds)
    next = existing.filter((v) => allow.has(v))
  }
  if (next.length === 0) next = [NO_MATCH_SENTINEL]
  q.id = next
}

function buildBrandScopedListMiddleware(
  matchPath: string,
  table: "customer" | "customer_group" | "inventory_item" | "api_key"
) {
  return () =>
    async (
      req: MedusaRequest,
      _res: MedusaResponse,
      next: MedusaNextFunction
    ) => {
      if (req.method !== "GET") return next()
      if (adminPathname(req) !== matchPath) return next()

      const storeId = readActiveStoreId(req)
      if (!storeId) return next()

      try {
        const brandId = await getBrandIdForStore(req.scope, storeId)
        if (!brandId) return next()

        const ids = await fetchIdsForBrand(req.scope, table, brandId)
        // null = column missing → degrade to no-op so the dashboard still works
        if (ids === null) return next()

        intersectIdQuery(req, ids)
      } catch {
        /* on any unexpected error, leave the query unchanged */
      }
      next()
    }
}

export const injectAdminCustomersListQuery = buildBrandScopedListMiddleware(
  "/admin/customers",
  "customer"
)

export const injectAdminCustomerGroupsListQuery =
  buildBrandScopedListMiddleware("/admin/customer-groups", "customer_group")

export const injectAdminInventoryItemsListQuery =
  buildBrandScopedListMiddleware("/admin/inventory-items", "inventory_item")

export const injectAdminApiKeysListQuery = buildBrandScopedListMiddleware(
  "/admin/api-keys",
  "api_key"
)
