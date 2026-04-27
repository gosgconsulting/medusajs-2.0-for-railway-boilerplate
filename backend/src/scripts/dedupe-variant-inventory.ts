import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Cleanup script for the bulk-edit "Edit with spreadsheet" stock-save bug.
 *
 * Three operations, each safe by default:
 *
 *   A) MULTI-LINK: variants with > 1 inventory_item linked. We keep the one with
 *      the most stock data (any inventory_levels), or the oldest if none have
 *      levels — and dismiss + delete the others.
 *
 *   B) ORPHAN LINK: an inventory item exists with a SKU matching an existing
 *      variant, has REAL STOCK at some location, but no variant link. The
 *      stock data is valuable — we LINK the item to the matching variant
 *      (only if that variant currently has zero linked items, so we don't
 *      accidentally cause a multi-link situation).
 *
 *   C) ORPHAN DELETE: an inventory item exists with a SKU matching an existing
 *      variant, has NO stock anywhere, and no variant link. These are leftovers
 *      from a save where item creation succeeded but linking failed. Safe to
 *      delete.
 *
 * Items with no SKU, or SKU that doesn't match any variant, are NEVER touched.
 *
 * Run:        npx medusa exec ./src/scripts/dedupe-variant-inventory.ts
 * Dry-run:    npx medusa exec ./src/scripts/dedupe-variant-inventory.ts -- --dry-run
 */
export default async function dedupeVariantInventory({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const inventoryService = container.resolve(Modules.INVENTORY)

  const dryRun = process.argv.includes("--dry-run")
  logger.info(`Scanning${dryRun ? " (dry-run)" : ""}…`)

  // ── Variants → linked inventory items ───────────────────────────────────────
  const { data: variants } = (await query.graph({
    entity: "variant",
    fields: ["id", "title", "sku", "inventory_items.inventory_item_id"],
  } as any)) as {
    data: Array<{
      id: string
      title?: string | null
      sku?: string | null
      inventory_items?: Array<{ inventory_item_id: string }>
    }>
  }

  const linkedIds = new Set<string>()
  const variantBySku = new Map<string, { id: string; title?: string | null; linkedCount: number }>()
  for (const v of variants) {
    const linkedCount = v.inventory_items?.length ?? 0
    if (v.sku && v.sku.trim()) {
      variantBySku.set(v.sku.trim(), { id: v.id, title: v.title, linkedCount })
    }
    for (const i of v.inventory_items ?? []) linkedIds.add(i.inventory_item_id)
  }

  // ── A) Multi-link variants ──────────────────────────────────────────────────
  const linksToDismiss: Array<Record<string, unknown>> = []
  const itemIdsToDelete = new Set<string>()
  let multiLinkAffected = 0

  const dupeVariants = variants.filter((v) => (v.inventory_items?.length ?? 0) > 1)
  if (dupeVariants.length) {
    const candidateIds = Array.from(
      new Set(dupeVariants.flatMap((v) => (v.inventory_items ?? []).map((i) => i.inventory_item_id)))
    )
    const { data: details } = (await query.graph({
      entity: "inventory_item",
      fields: ["id", "created_at", "location_levels.id"],
      filters: { id: candidateIds },
    } as any)) as {
      data: Array<{ id: string; created_at: string | Date; location_levels?: Array<{ id: string }> }>
    }
    const byId = new Map(details.map((d) => [d.id, d]))

    for (const v of dupeVariants) {
      multiLinkAffected++
      const items = (v.inventory_items ?? [])
        .map((i) => byId.get(i.inventory_item_id))
        .filter((d): d is NonNullable<typeof d> => !!d)
      const sorted = [...items].sort((a, b) => {
        const aHas = (a.location_levels?.length ?? 0) > 0
        const bHas = (b.location_levels?.length ?? 0) > 0
        if (aHas !== bHas) return aHas ? -1 : 1
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
      const keep = sorted[0]
      const remove = sorted.slice(1)
      logger.info(
        `[multi-link] ${v.title ?? v.id} [${v.sku ?? "no sku"}]: keep ${keep.id}, drop ${remove.map((r) => r.id).join(", ")}`
      )
      for (const r of remove) {
        linksToDismiss.push({
          [Modules.PRODUCT]: { variant_id: v.id },
          [Modules.INVENTORY]: { inventory_item_id: r.id },
        })
        itemIdsToDelete.add(r.id)
      }
    }
  }

  // ── B & C) Orphan inventory items ───────────────────────────────────────────
  const allItems = (await inventoryService.listInventoryItems({}, { take: 100000 } as any)) as Array<{
    id: string
    sku?: string | null
  }>
  const orphans = allItems.filter((i) => !linkedIds.has(i.id))
  const orphansMatchingVariant = orphans.filter(
    (i) => i.sku && i.sku.trim() && variantBySku.has(i.sku.trim())
  )

  const linksToCreate: Array<Record<string, unknown>> = []
  let orphansToLink = 0
  let orphansToDeleteCount = 0
  let orphansBlockedByExistingLink = 0

  if (orphansMatchingVariant.length) {
    const { data: orphanDetails } = (await query.graph({
      entity: "inventory_item",
      fields: ["id", "sku", "location_levels.stocked_quantity"],
      filters: { id: orphansMatchingVariant.map((o) => o.id) },
    } as any)) as {
      data: Array<{
        id: string
        sku: string | null
        location_levels?: Array<{ stocked_quantity?: number | null }>
      }>
    }

    for (const item of orphanDetails) {
      const sku = (item.sku ?? "").trim()
      const variant = variantBySku.get(sku)
      if (!variant) continue
      const totalStock = (item.location_levels ?? []).reduce(
        (acc, l) => acc + (l.stocked_quantity ?? 0),
        0
      )

      if (totalStock > 0) {
        if (variant.linkedCount === 0) {
          linksToCreate.push({
            [Modules.PRODUCT]: { variant_id: variant.id },
            [Modules.INVENTORY]: { inventory_item_id: item.id },
            data: { required_quantity: 1 },
          })
          // Mark the variant as now linked so we don't link two stocked
          // orphans to the same variant in this run.
          variant.linkedCount = 1
          orphansToLink++
          logger.info(`[orphan-link] ${item.id} (sku=${sku}, ${totalStock} units) → variant ${variant.id}`)
        } else {
          orphansBlockedByExistingLink++
          logger.info(
            `[orphan-skip] ${item.id} (sku=${sku}) has stock but its variant ${variant.id} already has ${variant.linkedCount} item(s) linked — manual review`
          )
        }
      } else {
        orphansToDeleteCount++
        itemIdsToDelete.add(item.id)
        logger.info(`[orphan-delete] ${item.id} (sku=${sku}, no stock)`)
      }
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  logger.info("──")
  logger.info(`Multi-link variants affected:    ${multiLinkAffected}`)
  logger.info(`Links to dismiss:                ${linksToDismiss.length}`)
  logger.info(`Orphan items to link to variants:${orphansToLink}`)
  logger.info(`Orphan items to delete (no stock):${orphansToDeleteCount}`)
  logger.info(`Orphan items needing manual review (variant already linked): ${orphansBlockedByExistingLink}`)
  logger.info(`Total inventory items to remove: ${itemIdsToDelete.size}`)

  const totalChanges =
    linksToDismiss.length + linksToCreate.length + itemIdsToDelete.size
  if (totalChanges === 0) {
    logger.info("Nothing to do.")
    return
  }

  if (dryRun) {
    logger.info("Dry-run — no changes applied. Re-run without --dry-run to commit.")
    return
  }

  if (linksToDismiss.length) {
    await link.dismiss(linksToDismiss as any)
    logger.info(`Dismissed ${linksToDismiss.length} variant↔inventory link(s).`)
  }
  if (linksToCreate.length) {
    await link.create(linksToCreate as any)
    logger.info(`Created ${linksToCreate.length} variant↔inventory link(s).`)
  }
  if (itemIdsToDelete.size) {
    await inventoryService.deleteInventoryItems(Array.from(itemIdsToDelete))
    logger.info(`Deleted ${itemIdsToDelete.size} inventory item(s).`)
  }
  logger.info("Cleanup complete.")
}
