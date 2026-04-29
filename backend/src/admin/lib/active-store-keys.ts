/** Header sent with Admin API requests so the backend can scope list endpoints by store. */
export const ADMIN_ACTIVE_STORE_HEADER = "x-medusa-store-id"

/** Cookie mirrored for requests that do not use the JS SDK (core dashboard fetch). */
export const ADMIN_ACTIVE_STORE_COOKIE = "active_medusa_store_id"

/** localStorage key for the selected Medusa Store id (survives reload). */
export const ADMIN_ACTIVE_STORE_STORAGE_KEY = "admin-active-database-v1"

/**
 * When set to `"true"` on GET `/admin/stores`, returns every store (store switcher).
 * Without it, the list is narrowed to the active store so Settings → Store uses `stores[0]`.
 */
export const ADMIN_LIST_ALL_STORES_HEADER = "x-medusa-list-all-stores"
export function readActiveStoreIdFromStorage(): string | null {
  if (typeof window === "undefined") return null
  try {
    const v = window.localStorage.getItem(ADMIN_ACTIVE_STORE_STORAGE_KEY)
    const t = typeof v === "string" ? v.trim() : ""
    return t.length ? t : null
  } catch {
    return null
  }
}
