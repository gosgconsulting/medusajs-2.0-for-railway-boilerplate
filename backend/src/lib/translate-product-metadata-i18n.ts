import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { MedusaRequest } from "@medusajs/framework/http"
import { deeplTranslateTexts } from "./deepl-translate"
import {
  computeProductContentHash,
  hasAllTargetLocales,
  normalizeLocaleKey,
  parseProductI18nFromMetadata,
  PRODUCT_I18N_METADATA_KEY,
  PRODUCT_I18N_SCHEMA_VERSION,
  serializeProductI18n,
  type ProductI18nPayload,
} from "./product-i18n-metadata"
import {
  DEEPL_API_BASE,
  DEEPL_AUTH_KEY,
  DEEPL_SOURCE_LANG,
  DEEPL_TARGET_LANGS,
} from "./constants"

function stripHtmlToPlain(raw: string | null | undefined): string {
  if (raw == null || raw === "") return ""
  return raw.replace(/<[^>]*>/g, "").replace(/\u00a0/g, " ").trim()
}

function parseTargetLangList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export type TranslateProductMetadataI18nOptions = {
  force?: boolean
}

export type TranslateProductMetadataI18nResult = {
  productId: string
  skipped: boolean
  reason?: string
  contentHash: string
  targetsWritten: string[]
}

async function retrieveProductForI18n(
  container: MedusaRequest["scope"],
  productId: string
): Promise<{
  id: string
  title: string | null
  subtitle: string | null
  description: string | null
  metadata: Record<string, unknown> | null
} | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "title", "subtitle", "description", "metadata"],
    filters: { id: productId },
  })
  const row = data?.[0] as
    | {
        id?: string
        title?: string | null
        subtitle?: string | null
        description?: string | null
        metadata?: Record<string, unknown> | null
      }
    | undefined
  if (!row?.id) return null
  return {
    id: row.id,
    title: row.title ?? "",
    subtitle: row.subtitle ?? "",
    description: row.description ?? "",
    metadata: row.metadata ?? null,
  }
}

/**
 * Fetches product copy, calls DeepL for each configured target language, and
 * writes JSON under metadata {@link PRODUCT_I18N_METADATA_KEY}.
 */
export async function translateProductMetadataI18n(
  container: MedusaRequest["scope"],
  productId: string,
  options?: TranslateProductMetadataI18nOptions
): Promise<TranslateProductMetadataI18nResult> {
  const authKey = DEEPL_AUTH_KEY?.trim()
  if (!authKey) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "DeepL is not configured (set DEEPL_AUTH_KEY)."
    )
  }

  const apiBase = (DEEPL_API_BASE ?? "https://api-free.deepl.com/v2").trim()
  const sourceLang = (DEEPL_SOURCE_LANG ?? "EN").trim() || "EN"
  const targetLangs = parseTargetLangList(DEEPL_TARGET_LANGS)
  if (targetLangs.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No target languages configured (set DEEPL_TARGET_LANGS, e.g. DE,FR)."
    )
  }

  const product = await retrieveProductForI18n(container, productId)
  if (!product) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product not found: ${productId}`
    )
  }

  const title = stripHtmlToPlain(product.title)
  const subtitle = stripHtmlToPlain(product.subtitle)
  const description = stripHtmlToPlain(product.description)
  const contentHash = computeProductContentHash(title, subtitle, description)

  const existingMeta = product.metadata ?? {}
  const previous = parseProductI18nFromMetadata(existingMeta)

  const requiredKeys = targetLangs.map((l) => normalizeLocaleKey(l))
  if (
    !options?.force &&
    previous &&
    previous.source.contentHash === contentHash &&
    hasAllTargetLocales(previous, requiredKeys)
  ) {
    return {
      productId,
      skipped: true,
      reason: "Translations already match current product text (contentHash).",
      contentHash,
      targetsWritten: [],
    }
  }

  const texts = [title, subtitle, description]
  const targets: Record<string, ProductI18nPayload["targets"][string]> = {}

  for (const targetLang of targetLangs) {
    const { translations } = await deeplTranslateTexts({
      apiBase,
      authKey,
      sourceLang,
      targetLang,
      texts,
    })
    const key = normalizeLocaleKey(targetLang)
    targets[key] = {
      title: translations[0] ?? "",
      subtitle: translations[1] ?? "",
      description: translations[2] ?? "",
    }
  }

  const payload: ProductI18nPayload = {
    schemaVersion: PRODUCT_I18N_SCHEMA_VERSION,
    source: {
      locale: sourceLang.toLowerCase(),
      contentHash,
      title,
      subtitle,
      description,
    },
    generatedAt: new Date().toISOString(),
    by: "deepl",
    targets,
  }

  const mergedMetadata: Record<string, unknown> = {
    ...existingMeta,
    [PRODUCT_I18N_METADATA_KEY]: serializeProductI18n(payload),
  }

  await updateProductsWorkflow(container).run({
    input: {
      products: [
        {
          id: product.id,
          metadata: mergedMetadata,
        } as any,
      ],
    },
  })

  return {
    productId: product.id,
    skipped: false,
    contentHash,
    targetsWritten: Object.keys(targets),
  }
}
