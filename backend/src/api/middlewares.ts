import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { defineMiddlewares } from "@medusajs/framework/http"
import { validateAndTransformQuery } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { StoreGetOrderParams } from "@medusajs/medusa/api/store/orders/validators"
import * as OrderQueryConfig from "@medusajs/medusa/api/store/orders/query-config"
import { STORE_DEFERRED_CHECKOUT } from "lib/constants"

function requireDeferredCheckoutEnabled(
  _req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): void {
  if (!STORE_DEFERRED_CHECKOUT) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Deferred cart completion is not enabled (set STORE_DEFERRED_CHECKOUT=true)."
    )
  }
  next()
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/carts/:id/complete-deferred",
      methods: ["POST"],
      middlewares: [
        validateAndTransformQuery(
          StoreGetOrderParams,
          OrderQueryConfig.retrieveTransformQueryConfig
        ),
        requireDeferredCheckoutEnabled,
      ],
    },
    {
      matcher: "/admin/orders/:id/deferred-shipping-options",
      methods: ["GET"],
      middlewares: [requireDeferredCheckoutEnabled],
    },
    {
      matcher: "/admin/orders/:id/deferred-update-shipping-fee",
      methods: ["POST"],
      middlewares: [requireDeferredCheckoutEnabled],
    },
    {
      matcher: "/admin/orders/:id/deferred-send-invoice",
      methods: ["POST"],
      middlewares: [requireDeferredCheckoutEnabled],
    },
  ],
})
