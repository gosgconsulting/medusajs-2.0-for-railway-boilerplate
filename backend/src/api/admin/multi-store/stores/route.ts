import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createSalesChannelsWorkflow,
  createStoresWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

function parseCreateBody(body: unknown): {
  name: string
  default_currency_code: string
} {
  if (!body || typeof body !== "object") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Expected JSON body.")
  }
  const b = body as Record<string, unknown>
  const name = typeof b.name === "string" ? b.name.trim() : ""
  const ccRaw =
    typeof b.default_currency_code === "string"
      ? b.default_currency_code.trim().toLowerCase()
      : "usd"
  if (!name.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "name is required.")
  }
  if (ccRaw.length !== 3) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "default_currency_code must be a 3-letter ISO code."
    )
  }
  return { name, default_currency_code: ccRaw }
}

/**
 * Creates a new Store plus a default Sales Channel tagged with metadata.store_id
 * so all channels for that store can be resolved together (see active-store-sales-channels).
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const { name, default_currency_code } = parseCreateBody(req.body)
  const container = req.scope

  const { result: createdStores } = await createStoresWorkflow(container).run({
    input: {
      stores: [
        {
          name,
          supported_currencies: [
            {
              currency_code: default_currency_code.toLowerCase(),
              is_default: true,
            },
          ],
        },
      ],
    },
  })

  const store = createdStores[0]
  if (!store?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Store creation returned no store."
    )
  }

  const { result: channels } = await createSalesChannelsWorkflow(container).run({
    input: {
      salesChannelsData: [
        {
          name: `${name} — default`,
        },
      ],
    },
  })

  const channel = channels[0]
  if (!channel?.id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Sales channel creation failed."
    )
  }

  const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
  await salesChannelModule.updateSalesChannels(channel.id, {
    metadata: { store_id: store.id },
  })

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: channel.id,
      },
    },
  })

  const storeModuleService = container.resolve(Modules.STORE)
  const refreshed = await storeModuleService.retrieveStore(store.id)

  res.status(201).json({ store: refreshed })
}
