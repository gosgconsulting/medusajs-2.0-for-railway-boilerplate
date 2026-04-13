import Handlebars from "handlebars"
import { MedusaError } from "@medusajs/framework/utils"
import {
  DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE,
  STOREFRONT_URL,
} from "./constants"

export type BuildDeferredInvoicePayUrlInput = {
  orderId: string
  orderDisplayId: string | number
  paymentCollectionId: string | null
}

/**
 * Customer-facing URL for completing payment. Set `STOREFRONT_URL` and optionally
 * `DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE` (Handlebars: storefront_url, order_id,
 * order_display_id, payment_collection_id).
 */
export function buildDeferredInvoicePayUrl(
  input: BuildDeferredInvoicePayUrlInput
): string {
  const base = STOREFRONT_URL.replace(/\/$/, "")
  const ctx = {
    storefront_url: base,
    order_id: input.orderId,
    order_display_id: String(input.orderDisplayId),
    payment_collection_id: input.paymentCollectionId ?? "",
  }

  if (DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE) {
    try {
      const compiled = Handlebars.compile(
        DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE,
        { strict: false }
      )
      const url = compiled(ctx).trim()
      if (!url) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE rendered an empty URL."
        )
      }
      return url
    } catch (e) {
      if (e instanceof MedusaError) throw e
      const msg = e instanceof Error ? e.message : String(e)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE: ${msg}`
      )
    }
  }

  if (!base) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Set STOREFRONT_URL (or DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE) so the invoice email can include a payment link."
    )
  }

  const q = input.paymentCollectionId
    ? `?payment_collection_id=${encodeURIComponent(input.paymentCollectionId)}`
    : ""
  return `${base}/order/${input.orderId}/pay${q}`
}
