import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  translateProductMetadataI18n,
  updateProductI18nAutoLocalesOnly,
} from "../../../../../lib/translate-product-metadata-i18n"

type TranslatePostBody = {
  enableAutoOnUpdateForLocales?: string[]
  disableAutoOnUpdateForLocales?: string[]
}

/**
 * POST /admin/products/:id/translate
 * Generates DeepL translations into product metadata key `i18n`.
 * Query: `force=true` to re-translate even when contentHash matches.
 *
 * JSON body (optional):
 * - `enableAutoOnUpdateForLocales`: per locale, translate if needed and add to
 *   `i18n_auto_on_update` so `product.updated` refreshes that locale.
 * - `disableAutoOnUpdateForLocales`: remove locales from `i18n_auto_on_update` only.
 *
 * With an empty body, all configured target languages are translated (legacy behavior).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const productId = req.params.id as string
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing product id"
    )
  }

  const force =
    String(req.query?.force ?? "").toLowerCase() === "true" ||
    String(req.query?.force ?? "") === "1"

  const body =
    typeof req.body === "object" && req.body !== null
      ? (req.body as TranslatePostBody)
      : {}

  const enable = Array.isArray(body.enableAutoOnUpdateForLocales)
    ? body.enableAutoOnUpdateForLocales.filter(
        (x): x is string => typeof x === "string" && x.trim() !== ""
      )
    : []
  const disable = Array.isArray(body.disableAutoOnUpdateForLocales)
    ? body.disableAutoOnUpdateForLocales.filter(
        (x): x is string => typeof x === "string" && x.trim() !== ""
      )
    : []

  const hasScopedBody = enable.length > 0 || disable.length > 0

  try {
    if (!hasScopedBody) {
      const result = await translateProductMetadataI18n(req.scope, productId, {
        force,
      })
      res.status(200).json(result)
      return
    }

    if (enable.length > 0) {
      const result = await translateProductMetadataI18n(req.scope, productId, {
        force,
        targetLocalesOnly: enable,
        addAutoOnUpdateLocales: enable,
        ...(disable.length > 0
          ? { removeAutoOnUpdateLocales: disable }
          : {}),
      })
      res.status(200).json(result)
      return
    }

    const result = await updateProductI18nAutoLocalesOnly(req.scope, productId, {
      remove: disable,
    })
    res.status(200).json({
      productId: result.productId,
      skipped: true,
      reason: "Auto-translate locales removed.",
      contentHash: "",
      targetsWritten: [] as string[],
      autoOnUpdateLocales: result.autoOnUpdateLocales,
    })
  } catch (e) {
    if (e instanceof MedusaError) {
      const status =
        e.type === MedusaError.Types.NOT_FOUND
          ? 404
          : e.type === MedusaError.Types.NOT_ALLOWED
            ? 503
            : 400
      res.status(status).json({ message: e.message, type: e.type })
      return
    }
    const msg = e instanceof Error ? e.message : String(e)
    res.status(500).json({ message: msg })
  }
}
