import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import { deeplTranslateTexts } from "./deepl-translate"
import {
  computeProductI18nContentHash,
  hasAllTargetLocales,
  normalizeLocaleKey,
  parseProductI18nFromMetadata,
  PRODUCT_I18N_METADATA_KEY,
  PRODUCT_I18N_SCHEMA_LATEST,
  serializeProductI18n,
  type ProductI18nPayload,
} from "./product-i18n-metadata"
import {
  DEEPL_API_BASE,
  DEEPL_AUTH_KEY,
  DEEPL_METADATA_TRANSLATION_KEYS,
  DEEPL_SOURCE_LANG,
  DEEPL_TARGET_LANGS,
} from "./constants"

function stripHtmlToPlain(raw: string | null | undefined): string {
  if (raw == null || raw === "") return ""
  return raw.replace(/<[^>]*>/g, "").replace(/\u00a0/g, " ").trim()
}

function parseCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Sorted unique metadata keys to translate (excludes `i18n`). */
function resolveMetadataTranslationKeys(): string[] {
  const raw = parseCommaList(DEEPL_METADATA_TRANSLATION_KEYS)
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of raw) {
    if (!k || k === PRODUCT_I18N_METADATA_KEY) continue
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  out.sort()
  return out
}

function metadataValueToPlainString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return stripHtmlToPlain(v)
  try {
    return stripHtmlToPlain(JSON.stringify(v))
  } catch {
    return stripHtmlToPlain(String(v))
  }
}

function sliceMetadataForTranslation(
  metadata: Record<string, unknown> | null,
  keysSorted: readonly string[]
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!metadata || keysSorted.length === 0) return out
  for (const k of keysSorted) {
    out[k] = metadataValueToPlainString(metadata[k])
  }
  return out
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
  metadataKeysTranslated?: string[]
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
  const targetLangs = parseCommaList(DEEPL_TARGET_LANGS)
  if (targetLangs.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No target languages configured (set DEEPL_TARGET_LANGS, e.g. DE,FR)."
    )
  }

  const metadataKeyOrder = resolveMetadataTranslationKeys()

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
  const metadataSlice = sliceMetadataForTranslation(
    product.metadata,
    metadataKeyOrder
  )

  const contentHash = computeProductI18nContentHash(
    title,
    subtitle,
    description,
    metadataSlice,
    metadataKeyOrder
  )

  const existingMeta = product.metadata ?? {}
  const previous = parseProductI18nFromMetadata(existingMeta)

  const requiredKeys = targetLangs.map((l) => normalizeLocaleKey(l))
  const needsMetadataInTargets = metadataKeyOrder.length > 0
  const previousMissingMetadataLayout =
    needsMetadataInTargets &&
    previous != null &&
    previous.schemaVersion !== PRODUCT_I18N_SCHEMA_LATEST

  if (
    !options?.force &&
    previous &&
    previous.source.contentHash === contentHash &&
    hasAllTargetLocales(previous, requiredKeys, metadataKeyOrder) &&
    !previousMissingMetadataLayout
  ) {
    return {
      productId,
      skipped: true,
      reason: "Translations already match current product text (contentHash).",
      contentHash,
      targetsWritten: [],
      ...(metadataKeyOrder.length > 0
        ? { metadataKeysTranslated: [...metadataKeyOrder] }
        : {}),
    }
  }

  const texts: string[] = [title, subtitle, description]
  for (const k of metadataKeyOrder) {
    texts.push(metadataSlice[k] ?? "")
  }

  const targets: Record<string, ProductI18nPayload["targets"][string]> = {}

  for (const targetLang of targetLangs) {
    const { translations } = await deeplTranslateTexts({
      apiBase,
      authKey,
      sourceLang,
      targetLang,
      texts,
    })
    if (translations.length !== texts.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `DeepL returned ${translations.length} segments, expected ${texts.length}`
      )
    }
    const key = normalizeLocaleKey(targetLang)
    const metaOut: Record<string, string> = {}
    for (let i = 0; i < metadataKeyOrder.length; i++) {
      const mk = metadataKeyOrder[i]
      metaOut[mk] = translations[3 + i] ?? ""
    }
    targets[key] = {
      title: translations[0] ?? "",
      subtitle: translations[1] ?? "",
      description: translations[2] ?? "",
      ...(metadataKeyOrder.length > 0 ? { metadata: metaOut } : {}),
    }
  }

  const source: ProductI18nPayload["source"] = {
    locale: sourceLang.toLowerCase(),
    contentHash,
    title,
    subtitle,
    description,
    ...(metadataKeyOrder.length > 0 ? { metadata: { ...metadataSlice } } : {}),
  }

  const payload: ProductI18nPayload = {
    schemaVersion: PRODUCT_I18N_SCHEMA_LATEST,
    source,
    generatedAt: new Date().toISOString(),
    by: "deepl",
    targets,
  }

  const mergedMetadata: Record<string, unknown> = {
    ...existingMeta,
    [PRODUCT_I18N_METADATA_KEY]: serializeProductI18n(payload),
  }

  // Dynamic import avoids loading `@medusajs/medusa/core-flows` during parallel
  // API route registration (can trigger duplicate workflow registration in some setups).
  const { updateProductsWorkflow } = await import("@medusajs/medusa/core-flows")
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
    ...(metadataKeyOrder.length > 0
      ? { metadataKeysTranslated: [...metadataKeyOrder] }
      : {}),
  }
}
