/**
 * Shared column definitions for product tables (bulk edit + custom products index).
 */

export const TOGGLEABLE_COLUMNS = [
  { id: "category", label: "Category" },
  { id: "sku", label: "SKU" },
  { id: "basePrice", label: "Base price" },
  { id: "salePrice", label: "Sale price" },
  { id: "clientA", label: "Client A" },
  { id: "clientB", label: "Client B" },
  { id: "clientC", label: "Client C" },
  { id: "clientD", label: "Client D" },
  { id: "manageStock", label: "Manage Stock" },
  { id: "stockQty", label: "Stock qty" },
  { id: "subtitle", label: "Subtitle" },
  { id: "description", label: "Description" },
  { id: "handle", label: "Handle" },
  { id: "tags", label: "Tags" },
  { id: "material", label: "Material" },
  { id: "weight", label: "Weight (g)" },
  { id: "width", label: "Width" },
  { id: "height", label: "Height" },
  { id: "color", label: "Color" },
  { id: "changed", label: "Changed" },
] as const

export type ToggleableColumnId = (typeof TOGGLEABLE_COLUMNS)[number]["id"]

export const DEFAULT_VISIBLE_COLUMNS = new Set<string>(
  TOGGLEABLE_COLUMNS.map((c) => c.id)
)

export function getMeta(
  metadata: Record<string, unknown> | undefined,
  key: string
): string {
  const val = metadata?.[key]
  if (val == null) return ""
  return String(val)
}

/** Price range from variant metadata numeric field (e.g. wcwp_client-a, b2b_price). */
export function getVariantPriceRange(
  variants: { metadata?: Record<string, unknown> }[],
  metaKey: string
): string {
  const nums = variants
    .map((v) => {
      const val = v.metadata?.[metaKey]
      if (val == null) return NaN
      const n = Number(val)
      return Number.isFinite(n) ? n : NaN
    })
    .filter((n) => !Number.isNaN(n))
  if (nums.length === 0) return ""
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return min === max ? String(min) : `${min} - ${max}`
}

export function tagsToString(
  tags?: { value?: string }[] | null
): string {
  if (!tags || tags.length === 0) return ""
  return tags.map((t) => t.value ?? "").filter(Boolean).join(", ")
}

/** Amount in main currency units → "59.00" */
export function amountToDisplay(amount?: number): string {
  if (amount == null) return ""
  return Number(amount).toFixed(2)
}

export function basePriceRangeFromVariants(
  variants: {
    prices?: { amount?: number | null; currency_code?: string | null }[] | null
  }[]
): string {
  const nums: number[] = []
  for (const v of variants) {
    for (const p of v.prices ?? []) {
      if (p.amount == null) continue
      const n = Number(p.amount)
      if (Number.isFinite(n)) nums.push(n)
    }
  }
  if (nums.length === 0) return ""
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return min === max ? amountToDisplay(min) : `${amountToDisplay(min)} - ${amountToDisplay(max)}`
}

export function skusDisplay(
  variants: { sku?: string | null }[]
): string {
  const s = variants.map((v) => (v.sku ?? "").trim()).filter(Boolean)
  if (s.length === 0) return ""
  if (s.length <= 3) return s.join(", ")
  return `${s.slice(0, 2).join(", ")} … (+${s.length - 2})`
}

export function colorDisplay(
  variants: { metadata?: Record<string, unknown> | null }[]
): string {
  const colors = [
    ...new Set(
      variants
        .map((v) => getMeta(v.metadata ?? undefined, "color_hex"))
        .filter(Boolean)
    ),
  ]
  return colors.join(", ")
}

export function manageStockSummary(
  variants: { manage_inventory?: boolean | null }[]
): string {
  const any = variants.some((v) => v.manage_inventory === true)
  return any ? "Yes" : "No"
}

export function stockQtySummary(
  variants: {
    manage_inventory?: boolean | null
    inventory_quantity?: number | null
  }[]
): string {
  const managed = variants.filter((v) => v.manage_inventory === true)
  if (managed.length === 0) return ""
  const sum = managed.reduce(
    (acc, v) => acc + (v.inventory_quantity ?? 0),
    0
  )
  return String(sum)
}

export function categoriesDisplay(
  categories?: { name?: string | null }[] | null
): string {
  if (!categories?.length) return ""
  return categories
    .map((c) => (c.name ?? "").trim())
    .filter(Boolean)
    .join(", ")
}
