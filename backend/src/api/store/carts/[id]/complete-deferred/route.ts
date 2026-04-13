import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  completeCartDeferredWorkflowId,
} from "../../../../../workflows/complete-cart-deferred"

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const cart_id = req.params.id as string
  const we = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const { errors, result, transaction } = await we.run(completeCartDeferredWorkflowId, {
    input: { id: cart_id },
    throwOnError: false,
  })

  if (!transaction.hasFinished()) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Cart is already being completed by another request"
    )
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  if (errors?.[0]) {
    const error = errors[0].error
    throw error ?? new MedusaError(MedusaError.Types.INVALID_DATA, "Cart completion failed")
  }

  const { data } = await query.graph({
    entity: "order",
    fields: req.queryConfig.fields,
    filters: { id: result.id },
  })

  res.status(200).json({
    type: "order",
    order: data[0],
  })
}
