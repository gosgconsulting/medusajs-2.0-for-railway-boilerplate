import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Custom CSV export for the "Edit with spreadsheet" page.
 *
 * Why this exists instead of `sdk.admin.product.export`:
 * 1. Medusa's built-in export DROPS `metadata` (see core-flows
 *    normalize-for-export.js: `delete res["Product Metadata"]`). Our store
 *    relies on metadata for b2b_discount, sale_price, color_hex, the
 *    wcwp_client-* discounts, etc. — losing them on round-trip would be a bug.
 * 2. Medusa's built-in export throws on the FIRST bad price entry (region
 *    not found) which is what causes the "Failed to export products" toasts
 *    when a single legacy price references a deleted region. We tolerate
 *    those rows here.
 * 3. Direct response (no notification round-trip) is simpler UX in a
 *    spreadsheet workflow.
 *
 * The response body is the CSV. The frontend triggers a save-as via
 * Content-Disposition: attachment.
 */

type Filters = {
  q?: string
  status?: string[]
  tag_id?: string[]
  type_id?: string[]
  sales_channel_id?: string[]
  collection_id?: string[]
  category_id?: string[]
  created_at?: { $gte?: string; $lte?: string }
  updated_at?: { $gte?: string; $lte?: string }
}

const escapeCell = (value: unknown): string => {
  if (value == null) return ""
  let s: string
  if (typeof value === "string") s = value
  else if (typeof value === "number" || typeof value === "boolean") s = String(value)
  else {
    try {
      s = JSON.stringify(value)
    } catch {
      s = String(value)
    }
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

const flattenMetaKeys = (
  records: Array<{ metadata?: Record<string, unknown> | null }>
): string[] => {
  const set = new Set<string>()
  for (const r of records) {
    if (r.metadata && typeof r.metadata === "object") {
      for (const k of Object.keys(r.metadata)) set.add(k)
    }
  }
  return [...set].sort()
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const filters = (req.body ?? {}) as Filters
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Pagination through the query module to avoid loading 4000+ products in one
  // shot. The remote query is the same one Medusa's standard export uses, so
  // it honors the same access rules.
  const PAGE = 200
  const fields = [
    "id",
    "title",
    "subtitle",
    "description",
    "handle",
    "status",
    "thumbnail",
    "material",
    "weight",
    "width",
    "height",
    "metadata",
    "tags.value",
    "categories.id",
    "categories.name",
    "collection.id",
    "collection.title",
    "type.id",
    "type.value",
    "sales_channels.id",
    "sales_channels.name",
    "options.id",
    "options.title",
    "options.values.value",
    "variants.id",
    "variants.title",
    "variants.sku",
    "variants.barcode",
    "variants.manage_inventory",
    "variants.inventory_quantity",
    "variants.metadata",
    "variants.options.value",
    "variants.options.option_id",
    "variants.prices.amount",
    "variants.prices.currency_code",
  ]

  type Product = {
    id: string
    title?: string | null
    subtitle?: string | null
    description?: string | null
    handle?: string | null
    status?: string | null
    thumbnail?: string | null
    material?: string | null
    weight?: number | null
    width?: number | null
    height?: number | null
    metadata?: Record<string, unknown> | null
    tags?: Array<{ value?: string | null }> | null
    categories?: Array<{ id?: string | null; name?: string | null }> | null
    collection?: { id?: string | null; title?: string | null } | null
    type?: { id?: string | null; value?: string | null } | null
    sales_channels?: Array<{ id?: string | null; name?: string | null }> | null
    options?: Array<{ id?: string | null; title?: string | null }> | null
    variants?: Array<{
      id?: string | null
      title?: string | null
      sku?: string | null
      barcode?: string | null
      manage_inventory?: boolean | null
      inventory_quantity?: number | null
      metadata?: Record<string, unknown> | null
      options?: Array<{ value?: string | null; option_id?: string | null }> | null
      prices?: Array<{ amount?: number | null; currency_code?: string | null }> | null
    }> | null
  }

  // Build a filter object accepted by the remote query
  const queryFilters: Record<string, unknown> = {}
  if (filters.q && filters.q.trim()) queryFilters.q = filters.q.trim()
  if (filters.status?.length) queryFilters.status = filters.status
  if (filters.tag_id?.length) queryFilters.tags = { id: filters.tag_id }
  if (filters.type_id?.length) queryFilters.type_id = filters.type_id
  if (filters.sales_channel_id?.length) queryFilters.sales_channels = { id: filters.sales_channel_id }
  if (filters.collection_id?.length) queryFilters.collection_id = filters.collection_id
  if (filters.category_id?.length) queryFilters.categories = { id: filters.category_id }
  if (filters.created_at && (filters.created_at.$gte || filters.created_at.$lte)) {
    queryFilters.created_at = filters.created_at
  }
  if (filters.updated_at && (filters.updated_at.$gte || filters.updated_at.$lte)) {
    queryFilters.updated_at = filters.updated_at
  }

  const products: Product[] = []
  let skip = 0
  while (true) {
    const { data } = (await query.graph({
      entity: "product",
      fields,
      filters: queryFilters,
      pagination: { skip, take: PAGE },
    } as any)) as { data: Product[] }

    if (!data?.length) break
    products.push(...data)
    if (data.length < PAGE) break
    skip += PAGE
    if (skip > 50000) break // sanity guard
  }

  // Discover dynamic metadata keys
  const productMetaKeys = flattenMetaKeys(products)
  const allVariants = products.flatMap((p) => p.variants ?? [])
  const variantMetaKeys = flattenMetaKeys(allVariants)
  // All currency codes seen across variant prices
  const currencyCodes = new Set<string>()
  for (const v of allVariants) {
    for (const pr of v.prices ?? []) {
      if (pr.currency_code) currencyCodes.add(pr.currency_code.toLowerCase())
    }
  }
  const sortedCurrencies = [...currencyCodes].sort()

  const headers: string[] = [
    "Product Id",
    "Product Title",
    "Product Subtitle",
    "Product Description",
    "Product Handle",
    "Product Status",
    "Product Thumbnail",
    "Product Material",
    "Product Weight",
    "Product Width",
    "Product Height",
    "Product Tags",
    "Product Collection Id",
    "Product Collection Title",
    "Product Type Id",
    "Product Type Value",
    "Product Categories",
    "Product Sales Channels",
    ...productMetaKeys.map((k) => `Product Metadata ${k}`),
    "Variant Id",
    "Variant Title",
    "Variant SKU",
    "Variant Barcode",
    "Variant Manage Inventory",
    "Variant Inventory Quantity",
    ...sortedCurrencies.map((c) => `Variant Price ${c.toUpperCase()}`),
    ...variantMetaKeys.map((k) => `Variant Metadata ${k}`),
    "Variant Options",
  ]

  const rows: string[] = [headers.map(escapeCell).join(",")]

  for (const p of products) {
    const baseProductCells: Record<string, unknown> = {
      "Product Id": p.id,
      "Product Title": p.title ?? "",
      "Product Subtitle": p.subtitle ?? "",
      "Product Description": p.description ?? "",
      "Product Handle": p.handle ?? "",
      "Product Status": p.status ?? "",
      "Product Thumbnail": p.thumbnail ?? "",
      "Product Material": p.material ?? "",
      "Product Weight": p.weight ?? "",
      "Product Width": p.width ?? "",
      "Product Height": p.height ?? "",
      "Product Tags": (p.tags ?? []).map((t) => t.value ?? "").filter(Boolean).join("|"),
      "Product Collection Id": p.collection?.id ?? "",
      "Product Collection Title": p.collection?.title ?? "",
      "Product Type Id": p.type?.id ?? "",
      "Product Type Value": p.type?.value ?? "",
      "Product Categories": (p.categories ?? [])
        .map((c) => `${c.id ?? ""}:${c.name ?? ""}`)
        .filter((s) => s !== ":")
        .join("|"),
      "Product Sales Channels": (p.sales_channels ?? [])
        .map((s) => s.id ?? "")
        .filter(Boolean)
        .join("|"),
    }
    for (const k of productMetaKeys) {
      baseProductCells[`Product Metadata ${k}`] = p.metadata?.[k] ?? ""
    }

    const variants = p.variants ?? []
    if (variants.length === 0) {
      // One row for the product with empty variant cells
      const cells: unknown[] = headers.map((h) => baseProductCells[h] ?? "")
      rows.push(cells.map(escapeCell).join(","))
      continue
    }

    const optionTitleById = new Map<string, string>()
    for (const o of p.options ?? []) {
      if (o.id && o.title) optionTitleById.set(o.id, o.title)
    }

    for (const v of variants) {
      const priceByCurrency: Record<string, number | undefined> = {}
      for (const pr of v.prices ?? []) {
        if (pr.currency_code && pr.amount != null) {
          priceByCurrency[pr.currency_code.toLowerCase()] = pr.amount
        }
      }
      const optionsStr = (v.options ?? [])
        .map((opt) => {
          const optionId = opt.option_id ?? ""
          const title = optionId ? optionTitleById.get(optionId) ?? optionId : ""
          return `${title}:${opt.value ?? ""}`
        })
        .filter((s) => s !== ":")
        .join("|")

      const variantCells: Record<string, unknown> = {
        ...baseProductCells,
        "Variant Id": v.id ?? "",
        "Variant Title": v.title ?? "",
        "Variant SKU": v.sku ?? "",
        "Variant Barcode": v.barcode ?? "",
        "Variant Manage Inventory": v.manage_inventory ? "true" : "false",
        "Variant Inventory Quantity": v.inventory_quantity ?? "",
        "Variant Options": optionsStr,
      }
      for (const c of sortedCurrencies) {
        variantCells[`Variant Price ${c.toUpperCase()}`] = priceByCurrency[c] ?? ""
      }
      for (const k of variantMetaKeys) {
        variantCells[`Variant Metadata ${k}`] = v.metadata?.[k] ?? ""
      }

      const cells: unknown[] = headers.map((h) => variantCells[h] ?? "")
      rows.push(cells.map(escapeCell).join(","))
    }
  }

  const csv = rows.join("\r\n")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="bulk-edit-products-${stamp}.csv"`)
  // BOM helps Excel detect UTF-8 (e.g. for é, ü in product titles like "Bordeaux foncé")
  res.status(200).send("\uFEFF" + csv)
}
