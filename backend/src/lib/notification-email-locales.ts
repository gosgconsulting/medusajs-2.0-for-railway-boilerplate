import { Modules } from "@medusajs/framework/utils"

export const NOTIFICATION_EMAIL_DEFAULT_LOCALE_ENV = "NOTIFICATION_EMAIL_DEFAULT_LOCALE"
export const NOTIFICATION_EMAIL_LOCALES_ENV = "NOTIFICATION_EMAIL_LOCALES"

/** Store `metadata` key: string[] or comma-separated string, e.g. `["en","de"]` or `"en,de"`. */
export const STORE_METADATA_SUPPORTED_NOTIFICATION_LOCALES = "supported_notification_locales"

const FALLBACK_LOCALE = "en"

export function normalizeNotificationLocale(
  raw: string | undefined | null
): string {
  if (raw == null || typeof raw !== "string") return FALLBACK_LOCALE
  const t = raw.trim().toLowerCase().replace(/_/g, "-")
  return t || FALLBACK_LOCALE
}

function uniqueNormalizedLocales(codes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of codes) {
    if (typeof c !== "string" || !c.trim()) continue
    const n = normalizeNotificationLocale(c)
    if (!seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out.length ? out : [FALLBACK_LOCALE]
}

function parseLocalesFromStoreMetadata(
  metadata: Record<string, unknown> | null | undefined
): string[] | null {
  if (!metadata) return null
  const raw = metadata[STORE_METADATA_SUPPORTED_NOTIFICATION_LOCALES]
  if (raw == null) return null
  if (Array.isArray(raw)) {
    return uniqueNormalizedLocales(
      raw.filter((x): x is string => typeof x === "string")
    )
  }
  if (typeof raw === "string") {
    return uniqueNormalizedLocales(raw.split(","))
  }
  return null
}

/**
 * Locales available for editing and sending.
 * Precedence: `NOTIFICATION_EMAIL_LOCALES` env → store metadata `supported_notification_locales` → `["en"]`.
 */
export async function getConfiguredNotificationLocales(
  container: { resolve: (key: string) => unknown }
): Promise<string[]> {
  const envRaw = process.env[NOTIFICATION_EMAIL_LOCALES_ENV]?.trim()
  if (envRaw) {
    return uniqueNormalizedLocales(envRaw.split(","))
  }

  try {
    const storeModule = container.resolve(Modules.STORE) as {
      listStores: (
        filters?: unknown,
        config?: { take?: number }
      ) => Promise<{ metadata?: Record<string, unknown> | null }[]>
    }
    const stores = await storeModule.listStores({}, { take: 1 })
    const fromMeta = parseLocalesFromStoreMetadata(stores[0]?.metadata)
    if (fromMeta?.length) return fromMeta
  } catch {
    // module unavailable in tests / odd contexts
  }

  return [FALLBACK_LOCALE]
}

/**
 * Default locale for admin UI and staff-only templates when the order does not choose a language.
 */
export async function resolveDefaultNotificationLocale(
  container: { resolve: (key: string) => unknown }
): Promise<string> {
  const configured = await getConfiguredNotificationLocales(container)
  const envDefault = process.env[NOTIFICATION_EMAIL_DEFAULT_LOCALE_ENV]?.trim()
  if (envDefault) {
    const n = normalizeNotificationLocale(envDefault)
    if (configured.includes(n)) return n
  }
  return configured[0] ?? FALLBACK_LOCALE
}

/**
 * Locale for customer order emails: `order.metadata.locale` when allowed, else default.
 */
export async function resolveCustomerOrderNotificationLocale(
  container: { resolve: (key: string) => unknown },
  order: { metadata?: Record<string, unknown> | null }
): Promise<string> {
  const configured = await getConfiguredNotificationLocales(container)
  const metaLoc = order.metadata?.locale
  if (typeof metaLoc === "string" && metaLoc.trim()) {
    const n = normalizeNotificationLocale(metaLoc)
    if (configured.includes(n)) return n
  }
  return resolveDefaultNotificationLocale(container)
}

export function buildNotificationLocaleFallbackChain(
  preferred: string,
  configuredLocales: string[]
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (code: string) => {
    const n = normalizeNotificationLocale(code)
    if (!seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  push(preferred)
  for (const c of configuredLocales) push(c)
  push(FALLBACK_LOCALE)
  return out
}
