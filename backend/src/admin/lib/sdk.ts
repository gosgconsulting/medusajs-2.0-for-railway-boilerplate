import Medusa from "@medusajs/js-sdk"

/**
 * Mutable object merged into every request via JS SDK `globalHeaders`.
 * `active-store-context` sets `x-medusa-store-id` for store-scoped Admin lists.
 */
export const adminSdkGlobalHeaders: Record<string, string> = {}

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
