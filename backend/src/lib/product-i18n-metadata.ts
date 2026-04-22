import { createHash } from "node:crypto"

/** Reserved product metadata key (JSON string). Do not use for other purposes. */
export const PRODUCT_I18N_METADATA_KEY = "i18n" as const

export const PRODUCT_I18N_SCHEMA_VERSION = 1 as const

export type ProductI18nTargetFields = {
  title: string
  subtitle: string
  description: string
}

export type ProductI18nSource = {
  locale: string
  contentHash: string
  title: string
  subtitle: string
  description: string
}

export type ProductI18nPayload = {
  schemaVersion: typeof PRODUCT_I18N_SCHEMA_VERSION
  source: ProductI18nSource
  generatedAt: string
  by: "deepl"
  targets: Record<string, ProductI18nTargetFields>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

export function computeProductContentHash(
  title: string,
  subtitle: string,
  description: string
): string {
  const normalized = [title, subtitle, description]
    .map((s) => (s ?? "").replace(/\r\n/g, "\n").trim())
    .join("\u001e")
  return createHash("sha256").update(normalized, "utf8").digest("hex")
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
  if (parsed.schemaVersion !== PRODUCT_I18N_SCHEMA_VERSION) return null
  if (parsed.by !== "deepl") return null
  const source = parsed.source
  if (!isRecord(source)) return null
  const contentHash = source.contentHash
  const locale = source.locale
  if (typeof contentHash !== "string" || typeof locale !== "string") return null
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
    outTargets[normalizeLocaleKey(lang)] = {
      title: t,
      subtitle: st,
      description: d,
    }
  }
  return {
    schemaVersion: PRODUCT_I18N_SCHEMA_VERSION,
    source: {
      locale,
      contentHash,
      title: typeof source.title === "string" ? source.title : "",
      subtitle: typeof source.subtitle === "string" ? source.subtitle : "",
      description:
        typeof source.description === "string" ? source.description : "",
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
  requiredLocales: string[]
): boolean {
  if (!payload) return false
  for (const lang of requiredLocales) {
    const key = normalizeLocaleKey(lang)
    if (!payload.targets[key]) return false
  }
  return true
}
