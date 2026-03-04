import Medusa from "@medusajs/js-sdk"

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
})
