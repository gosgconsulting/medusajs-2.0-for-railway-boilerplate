import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

/**
 * Resolves all sales channel IDs that belong to a Medusa Store for admin scoping.
 *
 * - Always includes `default_sales_channel_id` when set on the store.
 * - Includes any sales channel whose `metadata.store_id` matches this store (extra
 *   channels beyond the default, since SalesChannel has no native `store_id` column).
 */
export async function getSalesChannelIdsForStore(
  container: MedusaContainer,
  storeId: string
): Promise<string[]> {
  const storeModule = container.resolve(Modules.STORE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const store = await storeModule.retrieveStore(storeId)
  const ids = new Set<string>()

  if (store.default_sales_channel_id) {
    ids.add(store.default_sales_channel_id)
  }

  try {
    const { data } = await query.graph({
      entity: "sales_channel",
      fields: ["id"],
      filters: {
        metadata: {
          store_id: storeId,
        },
      },
    })
    for (const row of data ?? []) {
      const id = (row as { id?: string }).id
      if (id) ids.add(id)
    }
  } catch {
    /* graph metadata filter may vary by Medusa version; default channel still applies */
  }

  return [...ids]
}
