import { adminSdkGlobalHeaders } from "./sdk"
import {
  ADMIN_ACTIVE_STORE_COOKIE,
  ADMIN_ACTIVE_STORE_HEADER,
  ADMIN_ACTIVE_STORE_STORAGE_KEY,
} from "./active-store-keys"

export {
  ADMIN_ACTIVE_STORE_COOKIE,
  ADMIN_ACTIVE_STORE_HEADER,
  ADMIN_ACTIVE_STORE_STORAGE_KEY,
  ADMIN_LIST_ALL_STORES_HEADER,
  readActiveStoreIdFromStorage,
} from "./active-store-keys"

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
