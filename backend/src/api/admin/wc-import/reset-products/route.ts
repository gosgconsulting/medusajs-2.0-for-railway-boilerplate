import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { deleteProductsWorkflow } from "@medusajs/medusa/core-flows"

const RESET_CONFIRM_PHRASE = "DELETE_ALL_PRODUCTS"

type ResetBody = {
  confirm?: string
}

async function listAllProductIds(query: {
  graph: (args: unknown) => Promise<{ data?: { id?: string }[] }>
}): Promise<string[]> {
  const take = 100
  let skip = 0
  const ids: string[] = []
  for (;;) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id"],
      pagination: { skip, take },
    })
    if (!Array.isArray(data) || data.length === 0) break
    for (const row of data) {
      if (row?.id) ids.push(String(row.id))
    }
    if (data.length < take) break
    skip += take
  }
  return ids
}

export async function POST(
  req: MedusaRequest<ResetBody>,
  res: MedusaResponse
): Promise<void> {
  const body = req.body ?? {}
  if (body.confirm !== RESET_CONFIRM_PHRASE) {
    res.status(400).json({
      message: `Send JSON { "confirm": "${RESET_CONFIRM_PHRASE}" } to permanently delete every product.`,
    })
    return
  }

  const container = req.scope
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const ids = await listAllProductIds(query)
  if (ids.length === 0) {
    res.status(200).json({
      deletedCount: 0,
      message: "No products in the database.",
    })
    return
  }

  const chunkSize = 40
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    await deleteProductsWorkflow(container).run({
      input: { ids: slice },
    })
  }

  res.status(200).json({
    deletedCount: ids.length,
    message: `Deleted ${ids.length} product(s).`,
  })
}
