import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  QueryContext,
} from "@medusajs/framework/utils"
import { updateLineItemInCartWorkflowId } from "@medusajs/medusa/core-flows"
import { refetchCart } from "@medusajs/medusa/api/store/carts/helpers"
import { defaultStoreCartFields } from "@medusajs/medusa/api/store/carts/query-config"
import {
  discountedCartLineUnitPriceForB2bMetadata,
  parseB2bDiscountPercent,
} from "../../../../../lib/medusa-b2b-discount-math"

type CartRow = {
  id: string
  completed_at?: string | null
  currency_code?: string | null
  region_id?: string | null
  sales_channel_id?: string | null
  customer_id?: string | null
  region?: Record<string, unknown> | null
  customer?: Record<string, unknown> | null
  items?: CartLineRow[] | null
}

type CartLineRow = {
  id: string
  variant_id?: string | null
  quantity?: number | null
  unit_price?: number | string | null
  variant?: {
    id?: string
    product?: { metadata?: Record<string, unknown> | null } | null
  } | null
}

type VariantPriceRow = {
  id?: string
  calculated_price?: { calculated_amount?: number | null } | null
}

/**
 * POST /store/carts/:id/b2b-sync-line-prices
 *
 * For each line with a variant whose **product** metadata includes `b2b_discount`,
 * sets `unit_price` to the catalog calculated price for the cart context, minus that discount.
 * Lines without a positive discount percentage are left unchanged.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const cart_id = req.params.id as string
  if (!cart_id?.trim()) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart id is required")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const we = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const { data: carts } = await query.graph({
    entity: "cart",
    filters: { id: cart_id },
    fields: [
      "id",
      "completed_at",
      "currency_code",
      "region_id",
      "sales_channel_id",
      "customer_id",
      "region.*",
      "customer.*",
      "items.id",
      "items.variant_id",
      "items.quantity",
      "items.unit_price",
      "items.variant.id",
      "items.variant.product.metadata",
    ],
  })

  const cart = (carts?.[0] ?? undefined) as CartRow | undefined
  if (!cart) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Cart with id '${cart_id}' was not found`)
  }
  if (cart.completed_at) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot sync line prices on a completed cart."
    )
  }

  const items = cart.items ?? []
  const results: {
    line_item_id: string
    variant_id: string | null
    status: "updated" | "unchanged" | "skipped"
    detail?: string
    previous_unit_price?: number | string | null
    next_unit_price?: number | null
  }[] = []

  for (const line of items) {
    const variantId = line.variant_id ?? null
    if (!variantId) {
      results.push({
        line_item_id: line.id,
        variant_id: null,
        status: "skipped",
        detail: "No variant on line",
      })
      continue
    }

    const productMeta = line.variant?.product?.metadata ?? undefined
    const pct = parseB2bDiscountPercent(productMeta ?? null)
    if (pct <= 0) {
      results.push({
        line_item_id: line.id,
        variant_id: variantId,
        status: "unchanged",
        detail: "No b2b_discount on product",
      })
      continue
    }

    const qty = typeof line.quantity === "number" && line.quantity > 0 ? line.quantity : 1
    const rawCurrency = cart.currency_code ?? (cart.region as { currency_code?: string } | null)?.currency_code
    const currency_code =
      typeof rawCurrency === "string" && rawCurrency.trim() ? rawCurrency.toLowerCase() : "usd"

    const { data: variants } = await query.graph({
      entity: "variants",
      filters: { id: variantId },
      fields: ["id", "calculated_price.calculated_amount"],
      context: {
        calculated_price: QueryContext({
          currency_code,
          region_id: cart.region_id,
          sales_channel_id: cart.sales_channel_id,
          customer_id: cart.customer_id ?? undefined,
          quantity: qty,
          region: cart.region,
          customer: cart.customer,
        }),
      },
    })

    const variantRow = variants?.[0] as VariantPriceRow | undefined
    const catalogAmount = variantRow?.calculated_price?.calculated_amount
    if (catalogAmount == null || !Number.isFinite(Number(catalogAmount))) {
      results.push({
        line_item_id: line.id,
        variant_id: variantId,
        status: "skipped",
        detail: "Could not resolve catalog price for variant",
      })
      continue
    }

    const nextUnit = discountedCartLineUnitPriceForB2bMetadata(catalogAmount, productMeta ?? null)
    if (nextUnit == null) {
      results.push({
        line_item_id: line.id,
        variant_id: variantId,
        status: "skipped",
        detail: "Discount produced no valid unit price",
      })
      continue
    }

    const prev = line.unit_price
    const prevNum = typeof prev === "string" ? parseFloat(prev) : Number(prev)
    const nextNum = typeof nextUnit === "number" ? nextUnit : Number(nextUnit)
    if (Number.isFinite(prevNum) && Number.isFinite(nextNum) && prevNum === nextNum) {
      results.push({
        line_item_id: line.id,
        variant_id: variantId,
        status: "unchanged",
        previous_unit_price: prev,
        next_unit_price: nextUnit,
        detail: "Already at discounted catalog price",
      })
      continue
    }

    const { errors } = await we.run(updateLineItemInCartWorkflowId, {
      input: {
        cart_id,
        item_id: line.id,
        update: {
          quantity: qty,
          unit_price: nextUnit,
        },
      },
      throwOnError: false,
    })
    if (errors?.length) {
      const err = errors[0]?.error
      throw err instanceof Error
        ? err
        : new MedusaError(
            MedusaError.Types.INVALID_DATA,
            "Failed to update cart line item for B2B pricing."
          )
    }

    results.push({
      line_item_id: line.id,
      variant_id: variantId,
      status: "updated",
      previous_unit_price: prev,
      next_unit_price: nextUnit,
    })
  }

  const fields =
    req.queryConfig?.fields?.length ? req.queryConfig.fields : defaultStoreCartFields
  const updatedCart = await refetchCart(cart_id, req.scope, fields)

  res.status(200).json({
    cart: updatedCart,
    synced: results,
  })
}
