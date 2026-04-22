import type { SubscriberArgs, SubscriberConfig } from "@medusajs/medusa"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE,
  DEEPL_TARGET_LANGS,
} from "../lib/constants"
import {
  normalizeLocaleKey,
  parseProductI18nAutoOnUpdateLocales,
} from "../lib/product-i18n-metadata"
import { translateProductMetadataI18n } from "../lib/translate-product-metadata-i18n"

function parseCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * When DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE=true, refreshes metadata `i18n`
 * after product updates if source text changed (see contentHash in translator).
 *
 * When that env is false, the same refresh runs only for locales listed on the
 * product under metadata `i18n_auto_on_update` (JSON array of locale keys).
 */
export default async function productUpdatedDeeplI18nHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const productId = data?.id
  if (!productId) return

  let scoped: string[] = []
  if (!DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    let metadata: Record<string, unknown> | null = null
    try {
      const { data: rows } = await query.graph({
        entity: "product",
        fields: ["id", "metadata"],
        filters: { id: productId },
      })
      const row = rows?.[0] as
        | { metadata?: Record<string, unknown> | null }
        | undefined
      metadata = row?.metadata ?? null
    } catch {
      return
    }

    const autoLocales = parseProductI18nAutoOnUpdateLocales(metadata)
    const configured = new Set(
      parseCommaList(DEEPL_TARGET_LANGS).map((l) => normalizeLocaleKey(l))
    )
    scoped = autoLocales.filter((l) => configured.has(l))

    if (scoped.length === 0) {
      return
    }
  }

  try {
    if (DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE) {
      await translateProductMetadataI18n(container, productId, { force: false })
    } else {
      await translateProductMetadataI18n(container, productId, {
        force: false,
        targetLocalesOnly: scoped,
      })
    }
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
