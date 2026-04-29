import {
  ADMIN_ACTIVE_STORE_COOKIE,
  ADMIN_ACTIVE_STORE_STORAGE_KEY,
} from "./active-store-keys"

/**
 * Runs before dashboard fetch (which uses `@medusajs/js-sdk` without our globalHeaders).
 * Mirrors localStorage → cookie so GET /admin/* middleware can scope lists.
 */
function sync(): void {
  if (typeof window === "undefined") return
  try {
    const id = window.localStorage.getItem(ADMIN_ACTIVE_STORE_STORAGE_KEY)?.trim()
    if (!id) return
    const secure = typeof window.location?.protocol === "string"
      ? window.location.protocol === "https:"
      : false
    document.cookie = `${ADMIN_ACTIVE_STORE_COOKIE}=${encodeURIComponent(
      id
    )}; path=/; SameSite=Lax${secure ? "; Secure" : ""}`
  } catch {
    /* ignore */
  }
}

sync()
