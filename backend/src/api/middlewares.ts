import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { defineMiddlewares } from "@medusajs/framework/http"
import {
  injectAdminActiveStoreProductList,
  injectAdminOrdersListQuery,
  injectAdminStoresListScope,
} from "lib/inject-admin-active-store-query"
import { validateAndTransformQuery } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { StoreGetOrderParams } from "@medusajs/medusa/api/store/orders/validators"
import * as OrderQueryConfig from "@medusajs/medusa/api/store/orders/query-config"
import { StoreGetPaymentCollectionParams } from "@medusajs/medusa/api/store/payment-collections/validators"
import * as PaymentCollectionQueryConfig from "@medusajs/medusa/api/store/payment-collections/query-config"
import { StoreGetCartsCart } from "@medusajs/medusa/api/store/carts/validators"
import * as StoreCartQueryConfig from "@medusajs/medusa/api/store/carts/query-config"
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
      matcher: "/admin/stores",
      methods: ["GET"],
      middlewares: [injectAdminStoresListScope()],
    },
    {
      matcher: "/admin/products",
      methods: ["GET"],
      middlewares: [injectAdminActiveStoreProductList()],
    },
    {
      matcher: "/admin/orders",
      methods: ["GET"],
      middlewares: [injectAdminOrdersListQuery()],
    },
    {
      matcher: "/admin/uploads",
      methods: ["POST"],
      bodyParser: { sizeLimit: "10mb" },
    },
    {
      matcher: "/admin/bulk-edit-import-products",
      methods: ["POST"],
      bodyParser: { sizeLimit: "50mb" },
    },
    {
      matcher: "/admin/uploads/protected",
      methods: ["POST"],
      bodyParser: { sizeLimit: "10mb" },
    },
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
      matcher: "/store/carts/:id/b2b-sync-line-prices",
      methods: ["POST"],
      middlewares: [
        validateAndTransformQuery(
          StoreGetCartsCart,
          StoreCartQueryConfig.retrieveTransformQueryConfig
        ),
      ],
    },
    {
      matcher:
        "/store/payment-collections/:id/payment-sessions/:session_id/authorize",
      methods: ["POST"],
      middlewares: [
        validateAndTransformQuery(
          StoreGetPaymentCollectionParams,
          PaymentCollectionQueryConfig.retrievePaymentCollectionTransformQueryConfig
        ),
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
