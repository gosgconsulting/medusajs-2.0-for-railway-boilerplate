import { sdk } from "./sdk"

function tracksInventory(
  v: { manage_inventory?: boolean | string | number | null }
): boolean {
  const m = v.manage_inventory
  return m === true || m === "true" || m === 1 || m === "1"
}

type VariantLike = {
  id?: string
  manage_inventory?: boolean | string | number | null
  inventory_quantity?: number | null
}

type ProductLike = {
  variants?: VariantLike[] | null
}

const VARIANT_FIELDS =
  "id,manage_inventory,inventory_quantity" as const

const CONCURRENCY = 12

async function fetchInventoryByVariantId(
  ids: string[]
): Promise<Map<string, number | null>> {
  const qtyByVariantId = new Map<string, number | null>()

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const slice = ids.slice(i, i + CONCURRENCY)
    const tuples = await Promise.all(
      slice.map(async (id) => {
        const res = await sdk.admin.productVariant.list({
          id,
          limit: 1,
          fields: VARIANT_FIELDS,
        } as Parameters<typeof sdk.admin.productVariant.list>[0])
        const v = res.variants?.[0]
        if (!v || v.id !== id) {
          return [id, null] as const
        }
        const q = v.inventory_quantity
        const value: number | null =
          typeof q === "number" ? q : q === null ? null : null
        return [id, value] as const
      })
    )
    for (const [id, value] of tuples) {
      qtyByVariantId.set(id, value)
    }
  }

  return qtyByVariantId
}

/**
 * Medusa does not compute `inventory_quantity` on `GET /admin/products` variants.
 * Load totals from `GET /admin/product-variants` (which applies inventory middleware)
 * and merge into the product payload in place.
 *
 * Uses one list request per variant id so the `id` filter is unambiguous (SDK qs
 * array encoding is not always parsed as an array). Requests run in small parallel batches.
 */
export async function hydrateProductVariantsInventoryQuantity(
  products: ProductLike[]
): Promise<void> {
  const managedIds = new Set<string>()
  for (const p of products) {
    for (const v of p.variants ?? []) {
      if (v?.id && tracksInventory(v)) managedIds.add(v.id)
    }
  }
  const ids = [...managedIds]
  if (ids.length === 0) return

  const qtyByVariantId = await fetchInventoryByVariantId(ids)

  for (const p of products) {
    for (const v of p.variants ?? []) {
      if (!v?.id || !tracksInventory(v)) continue
      const q = qtyByVariantId.get(v.id)
      if (q !== undefined) {
        v.inventory_quantity = q
      }
    }
  }
}
