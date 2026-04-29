import Medusa from "@medusajs/js-sdk"
import {
  ADMIN_ACTIVE_STORE_COOKIE,
  ADMIN_ACTIVE_STORE_HEADER,
  ADMIN_ACTIVE_STORE_STORAGE_KEY,
} from "./active-store-keys"

/**
 * Mutable object merged into every request via JS SDK `globalHeaders`.
 * `active-store-context` sets `x-medusa-store-id` for store-scoped Admin lists.
 */
export const adminSdkGlobalHeaders: Record<string, string> = {}

/** Apply stored selection immediately so list routes (e.g. /app/products) send the header on first fetch. */
if (typeof window !== "undefined") {
  try {
    const sid = window.localStorage.getItem(ADMIN_ACTIVE_STORE_STORAGE_KEY)
    const t = typeof sid === "string" ? sid.trim() : ""
    if (t.length) {
      adminSdkGlobalHeaders[ADMIN_ACTIVE_STORE_HEADER] = t
      document.cookie = `${ADMIN_ACTIVE_STORE_COOKIE}=${encodeURIComponent(
        t
      )}; path=/; SameSite=Lax`
    }
  } catch {
    /* ignore */
  }
}

/**
 * Admin SDK for authenticated requests to the Medusa backend.
 * Used by custom admin routes (e.g. product edit) to fetch and update data.
 */
export const sdk = new Medusa({
  baseUrl: typeof import.meta !== "undefined" && import.meta.env?.VITE_BACKEND_URL
    ? import.meta.env.VITE_BACKEND_URL
    : "/",
  debug: typeof import.meta !== "undefined" && import.meta.env?.DEV === true,
  auth: {
    type: "session",
  },
  globalHeaders: adminSdkGlobalHeaders,
})
