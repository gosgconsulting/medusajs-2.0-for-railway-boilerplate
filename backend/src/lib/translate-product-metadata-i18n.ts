import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import { deeplTranslateTexts } from "./deepl-translate"
import {
  computeProductI18nContentHash,
  hasAllTargetLocales,
  localeTranslationComplete,
  normalizeLocaleKey,
  parseProductI18nAutoOnUpdateLocales,
  parseProductI18nFromMetadata,
  PRODUCT_I18N_AUTO_ON_UPDATE_METADATA_KEY,
  PRODUCT_I18N_METADATA_KEY,
  PRODUCT_I18N_SCHEMA_LATEST,
  serializeProductI18n,
  serializeProductI18nAutoOnUpdateLocales,
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

function cloneTargetFields(
  t: ProductI18nPayload["targets"][string]
): ProductI18nPayload["targets"][string] {
  return {
    title: t.title,
    subtitle: t.subtitle,
    description: t.description,
    ...(t.metadata ? { metadata: { ...t.metadata } } : {}),
  }
}

function mergeAutoLocalesIntoMetadata(
  existingMeta: Record<string, unknown>,
  configuredNorm: Set<string>,
  add?: string[],
  remove?: string[]
): Record<string, unknown> {
  const current = new Set(
    parseProductI18nAutoOnUpdateLocales(existingMeta).filter((k) =>
      configuredNorm.has(k)
    )
  )
  for (const raw of add ?? []) {
    const k = normalizeLocaleKey(raw)
    if (k && configuredNorm.has(k)) current.add(k)
  }
  for (const raw of remove ?? []) {
    current.delete(normalizeLocaleKey(raw))
  }
  const next = [...current].sort()
  const out: Record<string, unknown> = { ...existingMeta }
  if (next.length === 0) {
    delete out[PRODUCT_I18N_AUTO_ON_UPDATE_METADATA_KEY]
  } else {
    out[PRODUCT_I18N_AUTO_ON_UPDATE_METADATA_KEY] =
      serializeProductI18nAutoOnUpdateLocales(next)
  }
  return out
}

async function persistProductMetadata(
  container: MedusaRequest["scope"],
  productId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { updateProductsWorkflow } = await import("@medusajs/medusa/core-flows")
  await updateProductsWorkflow(container).run({
    input: {
      products: [
        {
          id: productId,
          metadata,
        } as any,
      ],
    },
  })
}

export type TranslateProductMetadataI18nOptions = {
  force?: boolean
  /**
   * When set, only these locales are considered for this run (must each appear in
   * `DEEPL_TARGET_LANGS`). Other existing `i18n.targets` entries are preserved.
   */
  targetLocalesOnly?: string[]
  /** Normalized locale keys to add to `i18n_auto_on_update` (filtered to configured targets). */
  addAutoOnUpdateLocales?: string[]
  /** Normalized locale keys to remove from `i18n_auto_on_update`. */
  removeAutoOnUpdateLocales?: string[]
}

export type TranslateProductMetadataI18nResult = {
  productId: string
  skipped: boolean
  reason?: string
  contentHash: string
  targetsWritten: string[]
  metadataKeysTranslated?: string[]
  autoOnUpdateLocales?: string[]
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
 * Updates only `i18n_auto_on_update` on the product (no DeepL calls).
 */
export async function updateProductI18nAutoLocalesOnly(
  container: MedusaRequest["scope"],
  productId: string,
  opts: { add?: string[]; remove?: string[] }
): Promise<{ productId: string; autoOnUpdateLocales: string[] }> {
  const targetLangs = parseCommaList(DEEPL_TARGET_LANGS)
  if (targetLangs.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No target languages configured (set DEEPL_TARGET_LANGS, e.g. DE,FR)."
    )
  }
  const configuredNorm = new Set(targetLangs.map((l) => normalizeLocaleKey(l)))

  const product = await retrieveProductForI18n(container, productId)
  if (!product) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Product not found: ${productId}`
    )
  }

  const existingMeta = { ...(product.metadata ?? {}) }
  const merged = mergeAutoLocalesIntoMetadata(
    existingMeta,
    configuredNorm,
    opts.add,
    opts.remove
  )

  await persistProductMetadata(container, productId, merged)
  return {
    productId,
    autoOnUpdateLocales: parseProductI18nAutoOnUpdateLocales(merged),
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
  const configuredNorm = new Set(requiredKeys)
  const isPartial =
    Array.isArray(options?.targetLocalesOnly) &&
    options!.targetLocalesOnly!.length > 0

  const requestedLocalesNorm: string[] = []
  const seenReq = new Set<string>()
  const rawRequested = isPartial
    ? (options!.targetLocalesOnly as string[])
    : targetLangs
  for (const raw of rawRequested) {
    const k = normalizeLocaleKey(raw)
    if (!k || seenReq.has(k)) continue
    if (!configuredNorm.has(k)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Locale "${raw}" is not in DEEPL_TARGET_LANGS.`
      )
    }
    seenReq.add(k)
    requestedLocalesNorm.push(k)
  }

  const needsMetadataInTargets = metadataKeyOrder.length > 0
  const previousMissingMetadataLayout =
    needsMetadataInTargets &&
    previous != null &&
    previous.schemaVersion !== PRODUCT_I18N_SCHEMA_LATEST

  const hasAutoMutation =
    (options?.addAutoOnUpdateLocales?.length ?? 0) > 0 ||
    (options?.removeAutoOnUpdateLocales?.length ?? 0) > 0

  const langsToDeepL = new Set<string>()
  for (const k of requestedLocalesNorm) {
    if (options?.force) {
      langsToDeepL.add(k)
      continue
    }
    if (previousMissingMetadataLayout) {
      langsToDeepL.add(k)
      continue
    }
    if (!localeTranslationComplete(previous, k, metadataKeyOrder)) {
      langsToDeepL.add(k)
      continue
    }
    if (previous?.source.contentHash !== contentHash) {
      langsToDeepL.add(k)
    }
  }

  if (
    !options?.force &&
    !isPartial &&
    previous &&
    previous.source.contentHash === contentHash &&
    hasAllTargetLocales(previous, requiredKeys, metadataKeyOrder) &&
    !previousMissingMetadataLayout &&
    langsToDeepL.size === 0 &&
    !hasAutoMutation
  ) {
    return {
      productId,
      skipped: true,
      reason: "Translations already match current product text (contentHash).",
      contentHash,
      targetsWritten: [],
      autoOnUpdateLocales: parseProductI18nAutoOnUpdateLocales(existingMeta),
      ...(metadataKeyOrder.length > 0
        ? { metadataKeysTranslated: [...metadataKeyOrder] }
        : {}),
    }
  }

  const texts: string[] = [title, subtitle, description]
  for (const mk of metadataKeyOrder) {
    texts.push(metadataSlice[mk] ?? "")
  }

  const targets: Record<string, ProductI18nPayload["targets"][string]> = {}

  if (isPartial && previous?.targets) {
    for (const [k, v] of Object.entries(previous.targets)) {
      if (!requestedLocalesNorm.includes(k)) {
        targets[k] = cloneTargetFields(v)
      }
    }
  }

  for (const k of requestedLocalesNorm) {
    if (!langsToDeepL.has(k) && previous?.targets?.[k]) {
      targets[k] = cloneTargetFields(previous.targets[k]!)
    }
  }

  const resolveDeepLCode = (normKey: string): string =>
    targetLangs.find((tl) => normalizeLocaleKey(tl) === normKey) ?? normKey

  for (const normKey of langsToDeepL) {
    const targetLang = resolveDeepLCode(normKey)
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
    const metaOut: Record<string, string> = {}
    for (let i = 0; i < metadataKeyOrder.length; i++) {
      const mk = metadataKeyOrder[i]
      metaOut[mk] = translations[3 + i] ?? ""
    }
    targets[normKey] = {
      title: translations[0] ?? "",
      subtitle: translations[1] ?? "",
      description: translations[2] ?? "",
      ...(metadataKeyOrder.length > 0 ? { metadata: metaOut } : {}),
    }
  }

  if (!isPartial) {
    for (const k of requiredKeys) {
      if (targets[k]) continue
      if (previous?.targets?.[k]) {
        targets[k] = cloneTargetFields(previous.targets[k]!)
      }
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

  const shouldWriteI18n =
    langsToDeepL.size > 0 || previousMissingMetadataLayout

  if (!shouldWriteI18n && !hasAutoMutation) {
    return {
      productId,
      skipped: true,
      reason: "Nothing to update.",
      contentHash,
      targetsWritten: [],
      autoOnUpdateLocales: parseProductI18nAutoOnUpdateLocales(existingMeta),
      ...(metadataKeyOrder.length > 0
        ? { metadataKeysTranslated: [...metadataKeyOrder] }
        : {}),
    }
  }

  let mergedMetadata: Record<string, unknown> = { ...existingMeta }
  if (shouldWriteI18n) {
    mergedMetadata[PRODUCT_I18N_METADATA_KEY] = serializeProductI18n(payload)
  }

  mergedMetadata = mergeAutoLocalesIntoMetadata(
    mergedMetadata,
    configuredNorm,
    options?.addAutoOnUpdateLocales,
    options?.removeAutoOnUpdateLocales
  )

  const autoOnUpdateLocales =
    parseProductI18nAutoOnUpdateLocales(mergedMetadata)

  await persistProductMetadata(container, product.id, mergedMetadata)

  return {
    productId: product.id,
    skipped: langsToDeepL.size === 0,
    ...(langsToDeepL.size === 0
      ? { reason: "Auto-translate on update saved; translations unchanged." }
      : {}),
    contentHash,
    targetsWritten: [...langsToDeepL],
    autoOnUpdateLocales,
    ...(metadataKeyOrder.length > 0
      ? { metadataKeysTranslated: [...metadataKeyOrder] }
        : {}),
  }
}
