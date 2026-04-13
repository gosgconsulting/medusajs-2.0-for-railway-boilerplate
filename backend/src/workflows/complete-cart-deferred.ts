import type {
  CartCreditLineDTO,
  CartWorkflowDTO,
  UsageComputedActions,
} from "@medusajs/framework/types"
import {
  isDefined,
  Modules,
  OrderStatus,
  OrderWorkflowEvents,
} from "@medusajs/framework/utils"
import {
  createHook,
  createWorkflow,
  parallelize,
  transform,
  when,
  WorkflowData,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  acquireLockStep,
  createOrdersStep,
  createRemoteLinkStep,
  emitEventStep,
  releaseLockStep,
  reserveInventoryStep,
  updateCartsStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows"
import { completeCartQueryFields } from "../lib/complete-cart-query-fields"
import {
  prepareAdjustmentsData,
  prepareLineItemData,
  prepareTaxLinesData,
  prepareConfirmInventoryInput,
  registerUsageStep,
} from "../lib/core-flows-cart-completion-internals"

const THREE_DAYS = 60 * 60 * 24 * 3
const THIRTY_SECONDS = 30
const TWO_MINUTES = 60 * 2

export const completeCartDeferredWorkflowId = "complete-cart-deferred"

export type CompleteCartDeferredWorkflowInput = { id: string }
export type CompleteCartDeferredWorkflowOutput = { id: string }

/**
 * Like core `complete-cart`, but skips payment session validation/authorization
 * and shipping validation so storefront can place a pending order; admin adds
 * shipping and payment later.
 */
export const completeCartDeferredWorkflow = createWorkflow(
  {
    name: completeCartDeferredWorkflowId,
    store: true,
    idempotent: false,
    retentionTime: THREE_DAYS,
  },
  (input: WorkflowData) => {
    const cartInput = input as unknown as CompleteCartDeferredWorkflowInput
    acquireLockStep({
      key: cartInput.id,
      timeout: THIRTY_SECONDS,
      ttl: TWO_MINUTES,
    })

    const [orderCart, cartData] = parallelize(
      useQueryGraphStep({
        entity: "order_cart",
        fields: ["cart_id", "order_id"],
        filters: { cart_id: cartInput.id },
        options: {
          isList: false,
        },
      }),
      useQueryGraphStep({
        entity: "cart",
        fields: [...completeCartQueryFields],
        filters: { id: cartInput.id },
        options: {
          isList: false,
        },
      }).config({
        name: "cart-query-deferred",
      })
    )

    const orderId = transform({ orderCart }, ({ orderCart: oc }) => {
      return oc?.data?.order_id
    })

    const validate = createHook("validate", {
      input,
      cart: cartData.data,
    })

    const order = when("create-order-deferred", { orderId }, ({ orderId: oid }) => {
      return !oid
    }).then(() => {
      const { variants, sales_channel_id } = transform(
        { cart: cartData.data },
        (data) => {
          const variantsMap: Record<string, unknown> = {}
          const allItems = data.cart?.items?.map((item: { variant_id: string; variant: unknown; id: string; quantity: unknown }) => {
            variantsMap[item.variant_id] = item.variant
            return {
              id: item.id,
              variant_id: item.variant_id,
              quantity: item.quantity,
            }
          })
          return {
            variants: Object.values(variantsMap),
            items: allItems,
            sales_channel_id: data.cart.sales_channel_id,
          }
        }
      )

      const cartToOrder = transform({ cart: cartData.data }, ({ cart }) => {
        const c = cart as CartWorkflowDTO
        const allItems = (c.items ?? []).map((item) => {
          const line = item as CartWorkflowDTO["items"][number] & {
            variant?: unknown
          }
          const liInput = {
            item: line,
            variant: line.variant,
            cartId: c.id,
            unitPrice: line.unit_price,
            isTaxInclusive: line.is_tax_inclusive,
            taxLines: line.tax_lines ?? [],
            adjustments: line.adjustments ?? [],
          }
          return prepareLineItemData(liInput as never)
        })

        const shippingMethods = (c.shipping_methods ?? []).map((sm) => {
          const method = sm as typeof sm & { raw_amount?: unknown }
          return {
            name: sm.name,
            description: sm.description,
            amount: method.raw_amount ?? sm.amount,
            is_tax_inclusive: sm.is_tax_inclusive,
            shipping_option_id: sm.shipping_option_id,
            data: sm.data,
            metadata: sm.metadata,
            tax_lines: prepareTaxLinesData(sm.tax_lines ?? []),
            adjustments: prepareAdjustmentsData(sm.adjustments ?? []),
          }
        })

        const creditLines = (c.credit_lines ?? []).map(
          (creditLine: CartCreditLineDTO) => {
            return {
              amount: creditLine.amount,
              raw_amount: creditLine.raw_amount,
              reference: creditLine.reference,
              reference_id: creditLine.reference_id,
              metadata: creditLine.metadata,
            }
          }
        )

        const itemAdjustments = allItems
          .map((item) => (item.adjustments as unknown[] | undefined) ?? [])
          .flat(1)
        const shippingAdjustments = shippingMethods
          .map((sm) => sm.adjustments ?? [])
          .flat(1)

        const promoCodes = [...itemAdjustments, ...shippingAdjustments]
          .map((adjustment: { code?: string }) => adjustment.code)
          .filter(Boolean)

        const shippingAddress = c.shipping_address
          ? { ...c.shipping_address }
          : null
        const billingAddress = c.billing_address
          ? { ...c.billing_address }
          : null

        if (shippingAddress) {
          delete (shippingAddress as { id?: string }).id
        }

        if (billingAddress) {
          delete (billingAddress as { id?: string }).id
        }

        const baseMeta =
          c.metadata && typeof c.metadata === "object" && !Array.isArray(c.metadata)
            ? { ...c.metadata }
            : {}

        return {
          region_id: c.region?.id,
          customer_id: c.customer?.id,
          sales_channel_id: c.sales_channel_id,
          status: OrderStatus.PENDING,
          email: c.email,
          currency_code: c.currency_code,
          shipping_address: shippingAddress,
          billing_address: billingAddress,
          no_notification: false,
          items: allItems,
          shipping_methods: shippingMethods,
          metadata: { ...baseMeta, deferred_checkout: true },
          promo_codes: promoCodes,
          credit_lines: creditLines,
        }
      })

      const createdOrders = createOrdersStep([cartToOrder] as never)
      const createdOrder = transform({ createdOrders }, ({ createdOrders: co }) => {
        return co[0]
      })

      const reservationItemsData = transform({ createdOrder }, ({ createdOrder: o }) =>
        (o.items ?? []).map((i) => ({
          variant_id: i.variant_id,
          quantity: i.quantity,
          id: i.id,
        }))
      )

      const formatedInventoryItems = transform(
        {
          input: {
            sales_channel_id,
            variants,
            items: reservationItemsData,
          },
        },
        prepareConfirmInventoryInput as never
      )

      const updateCompletedAt = transform({ cart: cartData.data }, ({ cart }) => {
        return {
          id: cart.id,
          completed_at: new Date(),
        }
      })

      const promotionUsage = transform({ cart: cartData.data }, ({ cart }) => {
        const c = cart as CartWorkflowDTO
        const usage: UsageComputedActions[] = []

        const itemAdj = (c.items ?? [])
          .map((item) => item.adjustments ?? [])
          .flat(1)

        const shipAdj = (c.shipping_methods ?? [])
          .map((item) => item.adjustments ?? [])
          .flat(1)

        for (const adjustment of itemAdj) {
          usage.push({
            amount: adjustment.amount,
            code: adjustment.code!,
          })
        }

        for (const adjustment of shipAdj) {
          usage.push({
            amount: adjustment.amount,
            code: adjustment.code!,
          })
        }

        return {
          computedActions: usage,
          registrationContext: {
            customer_id: c.customer?.id || null,
            customer_email: c.email || null,
          },
        }
      })

      const linksToCreate = transform(
        { cart: cartData.data, createdOrder },
        ({ cart, createdOrder: o }) => {
          const c = cart as CartWorkflowDTO & {
            promotions?: { id: string }[]
          }
          const links: Array<Record<string, Record<string, string>>> = [
            {
              [Modules.ORDER]: { order_id: o.id },
              [Modules.CART]: { cart_id: c.id },
            },
          ]

          if (c.promotions?.length) {
            c.promotions.forEach((promotion) => {
              links.push({
                [Modules.ORDER]: { order_id: o.id },
                [Modules.PROMOTION]: { promotion_id: promotion.id },
              })
            })
          }

          if (isDefined(c.payment_collection?.id)) {
            links.push({
              [Modules.ORDER]: { order_id: o.id },
              [Modules.PAYMENT]: {
                payment_collection_id: c.payment_collection.id,
              },
            })
          }

          return links
        }
      )

      parallelize(
        createRemoteLinkStep(linksToCreate),
        updateCartsStep([updateCompletedAt]),
        reserveInventoryStep(formatedInventoryItems as never),
        registerUsageStep(promotionUsage),
        emitEventStep({
          eventName: OrderWorkflowEvents.PLACED,
          data: { id: createdOrder.id },
        })
      )

      createHook("orderCreatedDeferred", {
        order_id: createdOrder.id,
        cart_id: cartData.data.id,
      })

      return createdOrder
    })

    releaseLockStep({
      key: cartInput.id,
    })

    const result = transform({ order, orderId }, ({ order: ord, orderId: oid }) => {
      return { id: ord?.id ?? oid } as CompleteCartDeferredWorkflowOutput
    })

    return new WorkflowResponse(result, {
      hooks: [validate],
    })
  }
)
