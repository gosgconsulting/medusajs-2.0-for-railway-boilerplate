import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ADMIN_ACTIVE_STORE_COOKIE,
  ADMIN_ACTIVE_STORE_HEADER,
  ADMIN_LIST_ALL_STORES_HEADER,
} from "admin/lib/active-store-keys"
import { getSalesChannelIdsForStore } from "./active-store-sales-channels"

function parseCookieHeader(
  header: string | undefined,
  name: string
): string | undefined {
  if (!header || typeof header !== "string") return undefined
  const parts = header.split(";")
  for (const part of parts) {
    const idx = part.indexOf("=")
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    if (k !== name) continue
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
 * Intercepts GET `/admin/stores` JSON so `stores[0]` is the active Medusa Store.
 *
 * The dashboard always treats `retrieveActiveStore()` as `stores?.[0]`.
 *
 * Pass {@link ADMIN_LIST_ALL_STORES_HEADER}: `"true"` on requests that must keep the full list
 * (top-bar switcher).
 */
export function injectAdminStoresListScope() {
  return (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    if (req.method !== "GET") {
      next()
      return
    }
    if (adminPathname(req) !== "/admin/stores") {
      next()
      return
    }
    const listAll = req.headers[ADMIN_LIST_ALL_STORES_HEADER]
    if (listAll === "true" || listAll === "1") {
      next()
      return
    }
    const storeId = readActiveStoreId(req)
    if (!storeId) {
      next()
      return
    }

    const sendJson = res.json.bind(res)
    res.json = function patchStoresListBody(body: unknown) {
      res.json = sendJson
      if (body && typeof body === "object" && "stores" in body) {
        const raw = body as { stores?: { id: string }[] }
        const stores = raw.stores
        if (Array.isArray(stores) && stores.length > 0) {
          const idx = stores.findIndex((s) => s.id === storeId)
          if (idx !== -1) {
            const selected = stores[idx]
            const rest = stores.filter((_, i) => i !== idx)
            return sendJson({ ...raw, stores: [selected, ...rest] })
          }
        }
      }
      return sendJson(body)
    }

    next()
  }
}

/**
 * Dashboard default Products UI (`sdk.admin.product.list` without our headers): merges
 * `sales_channel_id` into the query and patches JSON using each row's `sales_channels`.
 */
export function injectAdminActiveStoreProductList() {
  return async (
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => {
    if (req.method !== "GET") {
      next()
      return
    }
    if (adminPathname(req) !== "/admin/products") {
      next()
      return
    }
    const storeId = readActiveStoreId(req)
    if (!storeId) {
      next()
      return
    }
    let channelIds: string[]
    try {
      channelIds = await getSalesChannelIdsForStore(req.scope, storeId)
    } catch {
      next()
      return
    }
    if (!channelIds.length) {
      next()
      return
    }
    const allowed = new Set(channelIds)

    req.query = {
      ...req.query,
      sales_channel_id: channelIds,
    } as typeof req.query

    const sendJson = res.json.bind(res)
    res.json = function patchProductListBody(body: unknown) {
      res.json = sendJson
      if (!body || typeof body !== "object" || !("products" in body)) {
        return sendJson(body)
      }
      const raw = body as {
        products?: {
          id: string
          sales_channels?: { id?: string | null }[] | null
        }[]
        count?: number
        estimate_count?: number
      }
      const products = raw.products
      if (!Array.isArray(products)) {
        return sendJson(body)
      }
      const filtered = products.filter((p) => {
        const chans = p.sales_channels ?? []
        return chans.some((c) => c?.id && allowed.has(c.id))
      })
      const nextCount =
        typeof raw.count === "number"
          ? Math.min(filtered.length, raw.count)
          : filtered.length
      return sendJson({
        ...raw,
        products: filtered,
        count: nextCount,
        ...(typeof raw.estimate_count === "number"
          ? {
              estimate_count: Math.min(filtered.length, raw.estimate_count),
            }
          : {}),
      })
    }

    next()
  }
}

/** Active-store scoping for Admin GET `/admin/orders` list. */
export function injectAdminOrdersListQuery() {
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
    const pathname = adminPathname(req)
    if (pathname !== "/admin/orders") {
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
