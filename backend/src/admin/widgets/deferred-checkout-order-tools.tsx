import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { FetchError } from "@medusajs/js-sdk"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from "@tanstack/react-query"
import { Button, Container, Heading, Input, Text, toast } from "@medusajs/ui"
import React, { useEffect, useState } from "react"
import { sdk } from "../lib/sdk"

const ACTIVE_ORDER_CHANGE_SUBSTRING = "already has an existing active order change"

/**
 * Ensures a draft order edit exists for API routes that expect `/admin/order-edits/:orderId/...`.
 * POST /admin/order-edits fails if a draft already exists; that case is treated as success.
 */
async function ensureDraftOrderEdit(orderId: string): Promise<void> {
  try {
    await sdk.admin.orderEdit.initiateRequest({ order_id: orderId })
  } catch (e: unknown) {
    const msg =
      e instanceof FetchError
        ? e.message
        : e instanceof Error
          ? e.message
          : typeof e === "object" &&
              e !== null &&
              "message" in e &&
              typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : ""
    if (msg.includes(ACTIVE_ORDER_CHANGE_SUBSTRING)) {
      return
    }
    throw e
  }
}

const selectInputClass =
  "w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-2 text-sm"

type OrderStub = {
  id: string
  metadata?: Record<string, unknown> | null
}

const ORDER_FIELDS =
  "id,metadata,status,*shipping_methods,*shipping_address"

type AdminOrder = {
  id: string
  metadata?: Record<string, unknown> | null
  shipping_methods?: { id: string; name?: string; amount?: number }[]
  shipping_address?: { id?: string; country_code?: string | null } | null
}

function isDeferredCheckout(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.deferred_checkout === true
}

/** Medusa Admin dashboard uses `orders` query keys from `queryKeysFactory` (e.g. detail, preview). */
function orderQueryKeyTouchesId(query: Query, orderId: string): boolean {
  const walk = (key: unknown): boolean => {
    if (key === orderId) return true
    if (Array.isArray(key)) return key.some(walk)
    return false
  }
  const k = query.queryKey
  return Array.isArray(k) && k[0] === "orders" && walk(k)
}

const DeferredCheckoutOrderTools = ({ data }: { data: OrderStub }) => {
  const orderId = data?.id
  const queryClient = useQueryClient()
  const [shippingOptionId, setShippingOptionId] = useState("")
  const [shippingFee, setShippingFee] = useState("")

  const { data: orderRes, isLoading } = useQuery({
    queryKey: ["admin-order-deferred-tools", orderId],
    queryFn: async () => {
      const res = await sdk.admin.order.retrieve(orderId, { fields: ORDER_FIELDS })
      return res.order as AdminOrder
    },
    enabled: !!orderId && isDeferredCheckout(data?.metadata),
  })

  const order = orderRes

  const { data: shippingOptionsRes } = useQuery({
    queryKey: ["admin-order-deferred-shipping-options", orderId],
    queryFn: async () => {
      return sdk.client.fetch<{ shipping_options: { id: string; name?: string }[] }>(
        `/admin/orders/${orderId}/deferred-shipping-options`
      )
    },
    enabled: !!orderId && isDeferredCheckout(data?.metadata) && !!order,
  })

  const shippingOptions = shippingOptionsRes?.shipping_options ?? []

  const shippingMethodCount = order?.shipping_methods?.length ?? 0
  const singleShippingMethod =
    shippingMethodCount === 1 ? order?.shipping_methods?.[0] : undefined

  useEffect(() => {
    if (shippingOptions.length === 1 && !shippingOptionId) {
      setShippingOptionId(shippingOptions[0].id)
    }
  }, [shippingOptions, shippingOptionId])

  useEffect(() => {
    if (
      shippingMethodCount === 1 &&
      singleShippingMethod &&
      typeof singleShippingMethod.amount === "number"
    ) {
      setShippingFee(String(singleShippingMethod.amount))
    }
  }, [orderId, shippingMethodCount, singleShippingMethod?.id, singleShippingMethod?.amount])

  useEffect(() => {
    if (shippingMethodCount === 0) {
      setShippingFee("")
    }
  }, [orderId, shippingMethodCount])

  const saveShippingFee = useMutation({
    mutationFn: async () => {
      const raw = shippingFee.trim()
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Enter a non-negative shipping fee (smallest currency unit).")
      }
      const customAmount = Math.round(amount)

      const latest =
        queryClient.getQueryData<AdminOrder>(["admin-order-deferred-tools", orderId]) ?? order
      const methods = latest?.shipping_methods ?? []
      if (methods.length > 1) {
        throw new Error(
          "This order has more than one shipping line. Remove extras in Order → Edit order, then set a single fee here."
        )
      }

      if (methods.length === 0) {
        await ensureDraftOrderEdit(orderId)
        if (!shippingOptionId) {
          throw new Error("Choose a shipping method (carrier / rate).")
        }
        await sdk.client.fetch(`/admin/order-edits/${orderId}/shipping-method`, {
          method: "POST",
          body: {
            shipping_option_id: shippingOptionId,
            custom_amount: customAmount,
          },
        })
        await sdk.admin.orderEdit.confirm(orderId)
        return
      }

      await sdk.client.fetch(`/admin/orders/${orderId}/deferred-update-shipping-fee`, {
        method: "POST",
        body: { amount: customAmount },
      })
    },
    onSuccess: async () => {
      toast.success("Shipping fee saved.")
      await queryClient.invalidateQueries({ queryKey: ["admin-order-deferred-tools", orderId] })
      await queryClient.invalidateQueries({
        queryKey: ["admin-order-deferred-shipping-options", orderId],
      })
      await queryClient.invalidateQueries({
        predicate: (q) => orderQueryKeyTouchesId(q, orderId),
      })
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to save shipping fee.")
    },
  })

  const sendInvoiceEmail = useMutation({
    mutationFn: async () => {
      return sdk.client.fetch<{
        success: boolean
        payment_collection_id?: string | null
      }>(`/admin/orders/${orderId}/deferred-send-invoice`, {
        method: "POST",
      })
    },
    onSuccess: async () => {
      toast.success("Invoice email sent to the customer.")
      await queryClient.invalidateQueries({ queryKey: ["admin-order-deferred-tools", orderId] })
      await queryClient.invalidateQueries({
        predicate: (q) => orderQueryKeyTouchesId(q, orderId),
      })
    },
    onError: (e: unknown) => {
      const msg =
        e instanceof FetchError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to send invoice email."
      toast.error(msg)
    },
  })

  if (!orderId || !isDeferredCheckout(data?.metadata)) {
    return null
  }

  if (isLoading || !order) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Text size="small" className="text-ui-fg-muted">
            Loading deferred checkout tools…
          </Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Shipping fee</Heading>
      </div>

      <div className="px-6 py-4 flex flex-col gap-4">
        <div>
          <Heading level="h3" className="mb-2 txt-compact-small">
            Set shipping fee
          </Heading>
          {shippingMethodCount > 1 ? (
            <Text size="small" className="text-ui-fg-muted max-w-md">
              This order has multiple shipping lines. This widget supports a single shipping fee. Open{" "}
              <strong>Edit order</strong> and remove extra shipping methods, then set the fee here.
            </Text>
          ) : !order.shipping_address?.country_code ? (
            <Text size="small" className="text-ui-fg-muted">
              Set a shipping address (at least country) so carrier options match the region.
            </Text>
          ) : (
            <div className="flex flex-col gap-3 max-w-md">
              {shippingMethodCount === 1 && singleShippingMethod ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {singleShippingMethod.name ?? "Shipping"} — adjust the amount below to change the order
                  shipping fee.
                </Text>
              ) : null}
              {shippingMethodCount === 0 ? (
                <div>
                  <Text size="small" className="mb-1 text-ui-fg-subtle">
                    Carrier / rate (one shipping line will be added)
                  </Text>
                  <select
                    className={selectInputClass}
                    value={shippingOptionId}
                    onChange={(e) => setShippingOptionId(e.target.value)}
                  >
                    <option value="">
                      {shippingOptions.length === 0
                        ? "No shipping options for this address"
                        : "Select a shipping method…"}
                    </option>
                    {shippingOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name ?? o.id}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <Text size="small" className="mb-1 text-ui-fg-subtle">
                  Shipping fee
                </Text>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={shippingFee}
                  onChange={(e) => setShippingFee(e.target.value)}
                />
              </div>
              <Button
                variant="secondary"
                size="small"
                isLoading={saveShippingFee.isPending}
                onClick={() => saveShippingFee.mutate()}
              >
                {shippingMethodCount === 0 ? "Add shipping fee" : "Update shipping fee"}
              </Button>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-ui-border-base">
          <Heading level="h3" className="mb-2 txt-compact-small">
            Customer payment
          </Heading>
          <Text size="small" className="text-ui-fg-muted mb-3 max-w-md">
            Email the customer a secure pay link. Requires{" "}
            <code className="text-xs bg-ui-bg-subtle px-1 rounded">STOREFRONT_URL</code> (or a
            payment URL template) on the server and an outstanding order balance.
          </Text>
          <Button
            variant="primary"
            size="small"
            isLoading={sendInvoiceEmail.isPending}
            onClick={() => sendInvoiceEmail.mutate()}
          >
            Send invoice / pay link
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.after",
})

export default DeferredCheckoutOrderTools
