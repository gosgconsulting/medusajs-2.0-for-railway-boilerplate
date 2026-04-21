/**
 * Pure helpers for `metadata.b2b_discount` on Medusa products (and optional line metadata).
 * Safe for Store API routes and storefronts.
 */

const B2B_DISCOUNT_METADATA_ALIASES = [
  "b2b_discount",
  "B2B_Discount",
  "b2b-discount",
] as const

function unwrapMetadataValue(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return (raw as { value: unknown }).value
  }
  return raw
}

function parsePercentFromRaw(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 0
  const unwrapped = unwrapMetadataValue(raw)
  if (typeof unwrapped === "number") {
    if (!Number.isFinite(unwrapped) || unwrapped <= 0) return 0
    return Math.min(100, unwrapped)
  }
  const s = String(unwrapped).trim().replace(/%$/, "").replace(",", ".")
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(100, n)
}

export function parseB2bDiscountPercent(
  metadata: Record<string, unknown> | undefined | null
): number {
  if (!metadata) return 0
  for (const key of B2B_DISCOUNT_METADATA_ALIASES) {
    const v = metadata[key]
    if (v === undefined || v === null || v === "") continue
    const p = parsePercentFromRaw(v)
    if (p > 0) return p
  }
  return 0
}

export function applyB2bDiscountPercentToPrice(basePrice: number, percent: number): number {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return basePrice
  if (!Number.isFinite(percent) || percent <= 0) return basePrice
  const p = Math.min(100, percent)
  const next = basePrice * (1 - p / 100)
  return Math.max(0, Number(next.toFixed(4)))
}

/**
 * Medusa Store cart/order line `unit_price` is in the smallest currency unit (e.g. cents for EUR).
 * Integer values are converted to major units (2790 → 27.90); fractional values pass through.
 */
export function medusaStoreLineUnitPriceToMajor(unitPrice: number | string | undefined | null): number {
  if (unitPrice == null || unitPrice === "") return 0
  const num = typeof unitPrice === "string" ? parseFloat(unitPrice) : Number(unitPrice)
  if (!Number.isFinite(num) || num <= 0) return 0
  if (Number.isInteger(num)) return num / 100
  return num
}

/**
 * Compute new Store `unit_price` (minor units when input is an integer) after `b2b_discount` %.
 * Returns `null` if no discount or invalid input — caller should skip updates.
 */
export function discountedCartLineUnitPriceForB2bMetadata(
  unitPriceRaw: number | string | undefined | null,
  metadata: Record<string, unknown> | undefined | null
): number | null {
  const pct = parseB2bDiscountPercent(metadata)
  if (pct <= 0) return null
  const currentMajor = medusaStoreLineUnitPriceToMajor(unitPriceRaw)
  if (!Number.isFinite(currentMajor) || currentMajor <= 0) return null
  const discountedMajor = applyB2bDiscountPercentToPrice(currentMajor, pct)
  const num = typeof unitPriceRaw === "string" ? parseFloat(unitPriceRaw) : Number(unitPriceRaw)
  if (!Number.isFinite(num) || num <= 0) return null
  if (Number.isInteger(num)) {
    return Math.max(1, Math.round(discountedMajor * 100))
  }
  return Number(discountedMajor.toFixed(4))
}
