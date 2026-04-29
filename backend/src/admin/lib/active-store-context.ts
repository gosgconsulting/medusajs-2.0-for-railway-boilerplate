import { adminSdkGlobalHeaders } from "./sdk"

/** Header sent with Admin API requests so the backend can scope list endpoints by store. */
export const ADMIN_ACTIVE_STORE_HEADER = "x-medusa-store-id"

/** Cookie mirrored for requests that do not use the JS SDK (core dashboard fetch). */
export const ADMIN_ACTIVE_STORE_COOKIE = "active_medusa_store_id"

/** localStorage key for the selected Medusa Store id (survives reload). */
export const ADMIN_ACTIVE_STORE_STORAGE_KEY = "admin-active-database-v1"

/**
 * Persists the active store id for SDK headers, cookie (dashboard fetch), and localStorage.
 */
export function setActiveAdminStoreId(storeId: string | null): void {
  if (typeof window === "undefined") return
  if (storeId) {
    adminSdkGlobalHeaders[ADMIN_ACTIVE_STORE_HEADER] = storeId
    try {
      window.localStorage.setItem(ADMIN_ACTIVE_STORE_STORAGE_KEY, storeId)
    } catch {
      /* ignore */
    }
    document.cookie = `${ADMIN_ACTIVE_STORE_COOKIE}=${encodeURIComponent(
      storeId
    )}; path=/; SameSite=Lax`
  } else {
    delete adminSdkGlobalHeaders[ADMIN_ACTIVE_STORE_HEADER]
    try {
      window.localStorage.removeItem(ADMIN_ACTIVE_STORE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    document.cookie = `${ADMIN_ACTIVE_STORE_COOKIE}=; path=/; Max-Age=0`
  }
}
