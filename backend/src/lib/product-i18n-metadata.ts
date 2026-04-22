import { createHash } from "node:crypto"

/** Reserved product metadata key (JSON string). Do not use for other purposes. */
export const PRODUCT_I18N_METADATA_KEY = "i18n" as const

/** New writes use v2 (optional `metadata` on source and per-target). */
export const PRODUCT_I18N_SCHEMA_LATEST = 2 as const

export type ProductI18nSchemaVersion = 1 | typeof PRODUCT_I18N_SCHEMA_LATEST

export type ProductI18nTargetFields = {
  title: string
  subtitle: string
  description: string
  /** Translated copies of configured metadata keys (same keys as `source.metadata`). */
  metadata?: Record<string, string>
}

export type ProductI18nSource = {
  locale: string
  contentHash: string
  title: string
  subtitle: string
  description: string
  /** Source strings for metadata keys included in this translation run. */
  metadata?: Record<string, string>
}

export type ProductI18nPayload = {
  schemaVersion: ProductI18nSchemaVersion
  source: ProductI18nSource
  generatedAt: string
  by: "deepl"
  targets: Record<string, ProductI18nTargetFields>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseMetadataBlock(
  raw: unknown
): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Content fingerprint for skip/retranslate logic. When `metadataKeyOrder` is empty,
 * matches the original v1 hash (title + subtitle + description only).
 */
export function computeProductI18nContentHash(
  title: string,
  subtitle: string,
  description: string,
  metadataByKey: Record<string, string>,
  metadataKeyOrder: readonly string[]
): string {
  const normalized = [title, subtitle, description]
    .map((s) => (s ?? "").replace(/\r\n/g, "\n").trim())
    .join("\u001e")
  if (metadataKeyOrder.length === 0) {
    return createHash("sha256").update(normalized, "utf8").digest("hex")
  }
  const metaParts = metadataKeyOrder.map((k) => {
    const v = (metadataByKey[k] ?? "").replace(/\r\n/g, "\n").trim()
    return `${k}\u001d${v}`
  })
  const withMeta = `${normalized}\u001fMETA\u001f${metaParts.join("\u001f")}`
  return createHash("sha256").update(withMeta, "utf8").digest("hex")
}

export function parseProductI18nFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): ProductI18nPayload | null {
  if (!metadata) return null
  const raw = metadata[PRODUCT_I18N_METADATA_KEY]
  if (raw == null || raw === "") return null
  let parsed: unknown
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
  } else if (isRecord(raw)) {
    parsed = raw
  } else {
    return null
  }
  if (!isRecord(parsed)) return null
  const sv = parsed.schemaVersion
  if (sv !== 1 && sv !== PRODUCT_I18N_SCHEMA_LATEST) return null
  if (parsed.by !== "deepl") return null
  const source = parsed.source
  if (!isRecord(source)) return null
  const contentHash = source.contentHash
  const locale = source.locale
  if (typeof contentHash !== "string" || typeof locale !== "string") return null
  const sourceMetadata = parseMetadataBlock(source.metadata)
  const targets = parsed.targets
  if (!isRecord(targets)) return null
  const outTargets: Record<string, ProductI18nTargetFields> = {}
  for (const [lang, fields] of Object.entries(targets)) {
    if (!isRecord(fields)) continue
    const t = fields.title
    const st = fields.subtitle
    const d = fields.description
    if (
      typeof t !== "string" ||
      typeof st !== "string" ||
      typeof d !== "string"
    ) {
      continue
    }
    const tm = parseMetadataBlock(fields.metadata)
    outTargets[normalizeLocaleKey(lang)] = {
      title: t,
      subtitle: st,
      description: d,
      ...(tm ? { metadata: tm } : {}),
    }
  }
  return {
    schemaVersion: sv as ProductI18nSchemaVersion,
    source: {
      locale,
      contentHash,
      title: typeof source.title === "string" ? source.title : "",
      subtitle: typeof source.subtitle === "string" ? source.subtitle : "",
      description:
        typeof source.description === "string" ? source.description : "",
      ...(sourceMetadata ? { metadata: sourceMetadata } : {}),
    },
    generatedAt:
      typeof parsed.generatedAt === "string"
        ? parsed.generatedAt
        : new Date(0).toISOString(),
    by: "deepl",
    targets: outTargets,
  }
}

export function serializeProductI18n(payload: ProductI18nPayload): string {
  return JSON.stringify(payload)
}

/** Lowercase locale segment for map keys (e.g. DE -> de, en-US -> en-us). */
export function normalizeLocaleKey(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, "-")
}

export function hasAllTargetLocales(
  payload: ProductI18nPayload | null,
  requiredLocales: string[],
  requiredMetadataKeys: readonly string[]
): boolean {
  if (!payload) return false
  for (const lang of requiredLocales) {
    const key = normalizeLocaleKey(lang)
    const t = payload.targets[key]
    if (!t) return false
    if (requiredMetadataKeys.length === 0) continue
    const meta = t.metadata
    if (!meta) return false
    for (const mk of requiredMetadataKeys) {
      if (typeof meta[mk] !== "string") return false
    }
  }
  return true
}
