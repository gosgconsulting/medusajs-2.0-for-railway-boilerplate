import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE } from "../lib/constants"
import { translateProductMetadataI18n } from "../lib/translate-product-metadata-i18n"

/**
 * When DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE=true, refreshes metadata `i18n`
 * after product updates if source text changed (see contentHash in translator).
 */
export default async function productUpdatedDeeplI18nHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE) {
    return
  }

  const productId = data?.id
  if (!productId) return

  try {
    await translateProductMetadataI18n(container, productId, { force: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(
      `[product-updated-deepl-i18n] DeepL translation failed for product ${productId}: ${msg}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "product.updated",
}
