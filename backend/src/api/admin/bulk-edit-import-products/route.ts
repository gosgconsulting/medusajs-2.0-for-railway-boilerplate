import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { batchProductsWorkflow } from "@medusajs/medusa/core-flows"

/**
 * Custom CSV import for the "Edit with spreadsheet" page.
 *
 * Pairs with /admin/bulk-edit-export-products. Accepts the SAME column
 * shape the export emits (Product Metadata <key>, Variant Price <CCY>,
 * Variant Metadata <key>, etc.) so a round-trip export → edit → import
 * is lossless for the fields the spreadsheet exposes.
 *
 * Scope (v1):
 *   ✓ Update: title, subtitle, description, handle, status, thumbnail,
 *     material, weight, width, height
 *   ✓ Update: product metadata (per CSV column present)
 *   ✓ Update: variant title, sku, barcode
 *   ✓ Update: variant prices (per currency column)
 *   ✓ Update: variant metadata (per CSV column present)
 *   ✓ Update: variant manage_inventory + inventory level (uses the same
 *     create-item / link-to-variant / create-level flow as the bulk-edit
 *     save so first-time stock activation works through CSV too)
 *   ✗ Categories, collection, type, tags, sales channels, options
 *     (relational diffs are too risky to drive from CSV — edit those
 *     in the spreadsheet UI instead).
 *
 * Body: { csv: string } — UTF-8 CSV text. Rows without Product Id are
 * skipped; products are NOT created.
 */

const PRODUCT_FIELDS_BY_HEADER: Record<string, string> = {
  "Product Title": "title",
  "Product Subtitle": "subtitle",
  "Product Description": "description",
  "Product Handle": "handle",
  "Product Status": "status",
  "Product Thumbnail": "thumbnail",
  "Product Material": "material",
  "Product Weight": "weight",
  "Product Width": "width",
  "Product Height": "height",
}

const NUMERIC_PRODUCT_FIELDS = new Set(["weight", "width", "height"])

const VARIANT_FIELDS_BY_HEADER: Record<string, string> = {
  "Variant Title": "title",
  "Variant SKU": "sku",
  "Variant Barcode": "barcode",
}

function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"' && cell === "") {
      inQuotes = true
      i++
      continue
    }
    if (c === ",") {
      row.push(cell)
      cell = ""
      i++
      continue
    }
    if (c === "\r") {
      i++
      continue
    }
    if (c === "\n") {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ""
      i++
      continue
    }
    cell += c
    i++
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

type VariantPlan = {
  id: string
  fields: Record<string, unknown>
  metadata: Record<string, unknown> | null
  prices: Array<{ currency_code: string; amount: number; id?: string }> | null
  /** New stock level to apply (multiplied by required_quantity). null = no change. */
  stockedQuantity: number | null
  /** true = manage_inventory needs to be set to true in the variant patch */
  enableManageInventory: boolean
  /** true = manage_inventory needs to be set to false in the variant patch */
  disableManageInventory: boolean
}

type ProductPlan = {
  id: string
  fields: Record<string, unknown>
  metadata: Record<string, unknown> | null
  variants: Map<string, VariantPlan>
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body ?? {}) as { csv?: string }
  if (!body.csv || typeof body.csv !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Missing 'csv' field with the CSV file contents."
    )
  }

  const rows = parseCsv(body.csv)
  if (rows.length < 2) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "CSV is empty or has no data rows."
    )
  }

  const headers = rows[0].map((h) => h.trim())
  const headerIndex = new Map<string, number>()
  headers.forEach((h, idx) => headerIndex.set(h, idx))

  const productMetaCols: Array<{ idx: number; key: string }> = []
  const variantMetaCols: Array<{ idx: number; key: string }> = []
  const priceCols: Array<{ idx: number; currency: string }> = []
  for (const [h, idx] of headerIndex) {
    if (h.startsWith("Product Metadata ")) {
      productMetaCols.push({ idx, key: h.substring("Product Metadata ".length) })
    } else if (h.startsWith("Variant Metadata ")) {
      variantMetaCols.push({ idx, key: h.substring("Variant Metadata ".length) })
    } else if (h.startsWith("Variant Price ")) {
      const ccy = h.substring("Variant Price ".length).trim()
      if (ccy) priceCols.push({ idx, currency: ccy.toLowerCase() })
    }
  }

  const productIdIdx = headerIndex.get("Product Id")
  const variantIdIdx = headerIndex.get("Variant Id")
  if (productIdIdx == null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "CSV must include a 'Product Id' column."
    )
  }

  const manageInvIdx = headerIndex.get("Variant Manage Inventory")
  const invQtyIdx = headerIndex.get("Variant Inventory Quantity")

  // ── Build the plan from CSV ────────────────────────────────────────────────
  const plan = new Map<string, ProductPlan>()
  let skippedNoProductId = 0
  let skippedRows = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0].trim() === "") continue

    const productId = (row[productIdIdx] ?? "").trim()
    if (!productId) {
      skippedNoProductId++
      continue
    }

    let pp = plan.get(productId)
    if (!pp) {
      pp = { id: productId, fields: {}, metadata: null, variants: new Map() }
      plan.set(productId, pp)

      // Apply product-level fields once per product (first occurrence wins).
      for (const [header, fieldName] of Object.entries(PRODUCT_FIELDS_BY_HEADER)) {
        const idx = headerIndex.get(header)
        if (idx == null) continue
        const raw = (row[idx] ?? "").trim()
        if (NUMERIC_PRODUCT_FIELDS.has(fieldName)) {
          if (raw === "") {
            pp.fields[fieldName] = null
          } else {
            const n = Number(raw)
            if (Number.isFinite(n)) pp.fields[fieldName] = n
          }
        } else {
          pp.fields[fieldName] = raw === "" ? null : raw
        }
      }

      if (productMetaCols.length) {
        pp.metadata = {}
        for (const { idx, key } of productMetaCols) {
          const raw = (row[idx] ?? "").trim()
          pp.metadata[key] = raw === "" ? null : raw
        }
      }
    }

    const variantId = variantIdIdx != null ? (row[variantIdIdx] ?? "").trim() : ""
    if (!variantId) {
      // No variant id — skip variant-level changes. Product-level fields above
      // were already captured on first occurrence.
      continue
    }
    if (pp.variants.has(variantId)) {
      // Same variant appearing twice in CSV — skip duplicates.
      skippedRows++
      continue
    }

    const vp: VariantPlan = {
      id: variantId,
      fields: {},
      metadata: null,
      prices: null,
      stockedQuantity: null,
      enableManageInventory: false,
      disableManageInventory: false,
    }

    for (const [header, fieldName] of Object.entries(VARIANT_FIELDS_BY_HEADER)) {
      const idx = headerIndex.get(header)
      if (idx == null) continue
      const raw = (row[idx] ?? "").trim()
      vp.fields[fieldName] = raw === "" ? null : raw
    }

    if (variantMetaCols.length) {
      vp.metadata = {}
      for (const { idx, key } of variantMetaCols) {
        const raw = (row[idx] ?? "").trim()
        vp.metadata[key] = raw === "" ? null : raw
      }
    }

    if (priceCols.length) {
      const prices: Array<{ currency_code: string; amount: number }> = []
      for (const { idx, currency } of priceCols) {
        const raw = (row[idx] ?? "").trim()
        if (raw === "") continue
        const amt = Number(raw)
        if (Number.isFinite(amt)) prices.push({ currency_code: currency, amount: amt })
      }
      vp.prices = prices.length ? prices : null
    }

    if (manageInvIdx != null && invQtyIdx != null) {
      const mraw = (row[manageInvIdx] ?? "").trim().toLowerCase()
      const qraw = (row[invQtyIdx] ?? "").trim()
      const wantManaged =
        mraw === "true" || mraw === "1" || mraw === "yes" || qraw !== ""
      if (!wantManaged) {
        // Either explicit "false" or empty qty → unmanaged (the "-" UX).
        vp.disableManageInventory = mraw === "false" || mraw === "0" || mraw === "no"
      } else {
        vp.enableManageInventory = true
        if (qraw !== "") {
          const q = Number(qraw)
          if (Number.isFinite(q)) vp.stockedQuantity = Math.max(0, Math.round(q))
        }
      }
    }

    pp.variants.set(variantId, vp)
  }

  if (plan.size === 0) {
    return res.json({
      products_updated: 0,
      variants_updated: 0,
      skipped_rows: skippedRows,
      skipped_no_product_id: skippedNoProductId,
      message: "Nothing to import — no rows with a Product Id found.",
    })
  }

  // ── Resolve current state so we can merge metadata / build prices payload ──
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const productIds = Array.from(plan.keys())

  type CurrentVariant = {
    id: string
    metadata?: Record<string, unknown> | null
    manage_inventory?: boolean | null
    inventory_items?: Array<{ inventory_item_id: string; required_quantity?: number | null }>
    prices?: Array<{ id?: string; amount?: number | null; currency_code?: string | null }>
  }
  type CurrentProduct = {
    id: string
    metadata?: Record<string, unknown> | null
    variants?: CurrentVariant[]
  }

  const { data: currentProducts } = (await query.graph({
    entity: "product",
    fields: [
      "id",
      "metadata",
      "variants.id",
      "variants.metadata",
      "variants.manage_inventory",
      "variants.inventory_items.inventory_item_id",
      "variants.inventory_items.required_quantity",
      "variants.prices.id",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: { id: productIds },
  } as any)) as { data: CurrentProduct[] }

  const currentById = new Map(currentProducts.map((p) => [p.id, p]))

  // ── Build the workflow batch + post-batch inventory work ───────────────────
  const updates: Array<Record<string, unknown>> = []
  const inventoryNeeds: Array<{
    productId: string
    variantId: string
    inventoryItemId: string | null
    requiredQuantity: number
    stockedQuantity: number
    isNewlyManaged: boolean
  }> = []

  const errors: string[] = []

  for (const [productId, pp] of plan) {
    const current = currentById.get(productId)
    if (!current) {
      errors.push(`Product ${productId} not found — row skipped.`)
      continue
    }

    const patch: Record<string, unknown> = { id: productId }
    for (const [k, v] of Object.entries(pp.fields)) {
      patch[k] = v
    }
    if (pp.metadata) {
      // Merge with existing: CSV values overwrite, missing CSV columns leave
      // existing values alone (CSV always exports every discovered key, so
      // round-tripping won't accidentally erase keys not in the export).
      const merged = { ...(current.metadata ?? {}), ...pp.metadata }
      patch.metadata = merged
    }

    const variantPatches: Array<Record<string, unknown>> = []
    for (const v of current.variants ?? []) {
      const csvVariant = pp.variants.get(v.id)
      if (!csvVariant) {
        // Untouched variant — include as-is so Medusa's replace semantics
        // don't drop it.
        variantPatches.push({ id: v.id })
        continue
      }
      const vPatch: Record<string, unknown> = { id: v.id }
      for (const [k, val] of Object.entries(csvVariant.fields)) {
        vPatch[k] = val
      }
      if (csvVariant.metadata) {
        vPatch.metadata = { ...(v.metadata ?? {}), ...csvVariant.metadata }
      }
      if (csvVariant.prices) {
        // Merge with existing: keep existing IDs by currency where possible
        // so Medusa updates instead of duplicating.
        const existingByCcy = new Map(
          (v.prices ?? [])
            .filter(
              (p): p is { id: string; amount: number; currency_code: string } =>
                !!p.currency_code && typeof p.id === "string" && p.amount != null
            )
            .map((p) => [p.currency_code.toLowerCase(), p])
        )
        const out: Array<Record<string, unknown>> = []
        const seen = new Set<string>()
        for (const np of csvVariant.prices) {
          const ccy = np.currency_code.toLowerCase()
          const existing = existingByCcy.get(ccy)
          out.push({
            ...(existing ? { id: existing.id } : {}),
            currency_code: ccy,
            amount: np.amount,
          })
          seen.add(ccy)
        }
        // Preserve prices for currencies not present in CSV (don't accidentally
        // drop region-specific price rules).
        for (const [ccy, p] of existingByCcy) {
          if (!seen.has(ccy)) {
            out.push({ id: p.id, currency_code: ccy, amount: p.amount })
          }
        }
        vPatch.prices = out
      }
      if (csvVariant.enableManageInventory && v.manage_inventory !== true) {
        vPatch.manage_inventory = true
      }
      if (csvVariant.disableManageInventory && v.manage_inventory !== false) {
        vPatch.manage_inventory = false
      }
      variantPatches.push(vPatch)

      // Stock level work happens AFTER the workflow so we can read the
      // (possibly newly-created) inventory item id.
      if (csvVariant.enableManageInventory && csvVariant.stockedQuantity != null) {
        const link = v.inventory_items?.[0]
        const reqQty = Math.max(1, link?.required_quantity ?? 1)
        inventoryNeeds.push({
          productId,
          variantId: v.id,
          inventoryItemId: link?.inventory_item_id ?? null,
          requiredQuantity: reqQty,
          stockedQuantity: csvVariant.stockedQuantity * reqQty,
          isNewlyManaged: v.manage_inventory !== true,
        })
      }
    }
    if (variantPatches.length) patch.variants = variantPatches

    updates.push(patch)
  }

  // ── Apply product/variant updates in a single batch workflow ───────────────
  if (updates.length) {
    try {
      await batchProductsWorkflow(req.scope).run({
        input: { update: updates as any },
      })
    } catch (e) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Batch product update failed: ${(e as Error)?.message ?? "unknown"}`
      )
    }
  }

  // ── Apply inventory levels (and create item+link for newly-managed) ────────
  if (inventoryNeeds.length) {
    const inventoryService = req.scope.resolve(Modules.INVENTORY)
    const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
    const stockLocationService = req.scope.resolve(Modules.STOCK_LOCATION)
    const locations = await stockLocationService.listStockLocations(
      {},
      { take: 100 } as any
    )
    const sortedLocs = [...(locations as Array<{ id: string; name?: string | null }>)].sort(
      (a, b) =>
        (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" })
    )
    const primaryLocationId = sortedLocs[0]?.id
    if (!primaryLocationId) {
      errors.push(
        "Cannot apply stock quantities — no stock location exists. Create one in Settings → Inventory → Locations."
      )
    } else {
      // Newly managed: refetch to get the newly-created inventory_item_id (if
      // any), or create + link our own.
      const newlyManagedNeedingLookup = inventoryNeeds.filter(
        (n) => n.isNewlyManaged && !n.inventoryItemId
      )
      if (newlyManagedNeedingLookup.length) {
        const { data: refetched } = (await query.graph({
          entity: "variant",
          fields: ["id", "sku", "inventory_items.inventory_item_id"],
          filters: { id: newlyManagedNeedingLookup.map((n) => n.variantId) },
        } as any)) as {
          data: Array<{
            id: string
            sku?: string | null
            inventory_items?: Array<{ inventory_item_id: string }>
          }>
        }
        const refById = new Map(refetched.map((v) => [v.id, v]))

        for (const n of newlyManagedNeedingLookup) {
          const ref = refById.get(n.variantId)
          const existingLink = ref?.inventory_items?.[0]?.inventory_item_id
          if (existingLink) {
            n.inventoryItemId = existingLink
            continue
          }
          // No inventory item exists → create + link
          try {
            const sku = ref?.sku?.trim() || undefined
            const created = (await inventoryService.createInventoryItems(
              sku ? [{ sku }] : [{}]
            )) as Array<{ id: string }>
            const newId = created?.[0]?.id
            if (!newId) throw new Error("create returned no id")
            await link.create([
              {
                [Modules.PRODUCT]: { variant_id: n.variantId },
                [Modules.INVENTORY]: { inventory_item_id: newId },
                data: { required_quantity: 1 },
              },
            ] as any)
            n.inventoryItemId = newId
          } catch (e) {
            errors.push(
              `Could not provision inventory item for variant ${n.variantId}: ${(e as Error)?.message ?? "unknown"}`
            )
          }
        }
      }

      // Now apply levels: create or update at primary location
      const usable = inventoryNeeds.filter((n) => !!n.inventoryItemId)
      if (usable.length) {
        // Group by item so each pair (item, location) becomes one create OR update
        const itemIds = usable.map((n) => n.inventoryItemId!)
        const { data: itemLevels } = (await query.graph({
          entity: "inventory_item",
          fields: ["id", "location_levels.id", "location_levels.location_id"],
          filters: { id: itemIds },
        } as any)) as {
          data: Array<{
            id: string
            location_levels?: Array<{ id: string; location_id: string }>
          }>
        }
        const existingLevelByItem = new Map<string, string>()
        for (const it of itemLevels) {
          const lvl = it.location_levels?.find(
            (l) => l.location_id === primaryLocationId
          )
          if (lvl) existingLevelByItem.set(it.id, lvl.id)
        }

        const create: Array<{
          inventory_item_id: string
          location_id: string
          stocked_quantity: number
        }> = []
        const update: Array<{
          inventory_item_id: string
          location_id: string
          stocked_quantity: number
        }> = []
        for (const n of usable) {
          const entry = {
            inventory_item_id: n.inventoryItemId!,
            location_id: primaryLocationId,
            stocked_quantity: n.stockedQuantity,
          }
          if (existingLevelByItem.has(n.inventoryItemId!)) update.push(entry)
          else create.push(entry)
        }

        if (create.length) {
          try {
            await inventoryService.createInventoryLevels(create)
          } catch (e) {
            errors.push(
              `Create inventory levels failed: ${(e as Error)?.message ?? "unknown"}`
            )
          }
        }
        if (update.length) {
          try {
            await inventoryService.updateInventoryLevels(update)
          } catch (e) {
            errors.push(
              `Update inventory levels failed: ${(e as Error)?.message ?? "unknown"}`
            )
          }
        }
      }
    }
  }

  res.status(200).json({
    products_updated: updates.length,
    variants_updated: updates.reduce(
      (acc, u) => acc + ((u.variants as unknown[] | undefined)?.length ?? 0),
      0
    ),
    inventory_levels_applied: inventoryNeeds.length,
    skipped_rows: skippedRows,
    skipped_no_product_id: skippedNoProductId,
    errors,
  })
}
