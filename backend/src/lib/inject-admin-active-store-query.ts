import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { getSalesChannelIdsForStore } from "./active-store-sales-channels"

export const ADMIN_ACTIVE_STORE_HEADER = "x-medusa-store-id"
export const ADMIN_ACTIVE_STORE_COOKIE = "active_medusa_store_id"

function readActiveStoreId(req: MedusaRequest): string | undefined {
  const h = req.headers[ADMIN_ACTIVE_STORE_HEADER]
  if (typeof h === "string" && h.trim()) return h.trim()
  const cookies = (
    req as MedusaRequest & { cookies?: Record<string, string | undefined> }
  ).cookies
  const c = cookies?.[ADMIN_ACTIVE_STORE_COOKIE]
  if (typeof c === "string" && c.trim()) return c.trim()
  return undefined
}

/**
 * Before query validation on Admin product/order list endpoints, merges `sales_channel_id`
 * query params derived from the active Medusa Store (see `getSalesChannelIdsForStore`).
 *
 * Store-level UX is implemented by resolving **all** sales channels that belong to that store
 * (default channel + channels tagged with `metadata.store_id`), then filtering lists that
 * Medusa already scopes by sales channel.
 */
export function injectAdminActiveStoreListQuery() {
  return async (
    req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    if (req.method !== "GET") {
      next()
      return
    }
    const storeId = readActiveStoreId(req)
    if (!storeId) {
      next()
      return
    }
    const path = req.path ?? ""
    if (path !== "/admin/products" && path !== "/admin/orders") {
      next()
      return
    }
    try {
      const ids = await getSalesChannelIdsForStore(req.scope, storeId)
      if (!ids.length) {
        next()
        return
      }
      req.query = {
        ...req.query,
        sales_channel_id: ids,
      } as typeof req.query
    } catch {
      /* ignore */
    }
    next()
  }
}
