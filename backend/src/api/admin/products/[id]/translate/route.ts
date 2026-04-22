import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { translateProductMetadataI18n } from "lib/translate-product-metadata-i18n"

/**
 * POST /admin/products/:id/translate
 * Generates DeepL translations into product metadata key `i18n`.
 * Query: `force=true` to re-translate even when contentHash matches.
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

  try {
    const result = await translateProductMetadataI18n(req.scope, productId, {
      force,
    })
    res.status(200).json(result)
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
