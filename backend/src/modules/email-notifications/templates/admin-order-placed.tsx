import { Text, Section, Hr } from "@react-email/components"
import * as React from "react"
import { Base } from "./base"
import type { OrderAddressDTO, OrderDTO } from "@medusajs/framework/types"

export const ADMIN_ORDER_PLACED = "admin-order-placed"

/** Staff alert when a deferred-checkout order is paid or authorized (payment.captured / payment.authorized). */
export const ADMIN_DEFERRED_ORDER_PAID = "admin-deferred-order-paid"

interface AdminOrderPlacedPreviewProps {
  order: OrderDTO & { display_id: string; summary: { raw_current_order_total: { value: number } } }
  shippingAddress: OrderAddressDTO
}

export interface AdminOrderPlacedTemplateProps {
  order: OrderDTO & { display_id: string; summary: { raw_current_order_total: { value: number } } }
  shippingAddress: OrderAddressDTO
  preview?: string
  /** Main heading (React-email fallback when DB template is disabled). */
  headline?: string
}

export const isAdminOrderPlacedTemplateData = (data: unknown): data is AdminOrderPlacedTemplateProps =>
  typeof data === "object" &&
  data !== null &&
  typeof (data as { order?: unknown }).order === "object" &&
  typeof (data as { shippingAddress?: unknown }).shippingAddress === "object"

export const AdminOrderPlacedTemplate: React.FC<AdminOrderPlacedTemplateProps> & {
  PreviewProps: AdminOrderPlacedPreviewProps
} = ({
  order,
  shippingAddress,
  preview = "New customer order",
  headline = "New order received",
}) => {
  return (
    <Base preview={preview}>
      <Section>
        <Text style={{ fontSize: "24px", fontWeight: "bold", margin: "0 0 20px" }}>{headline}</Text>

        <Text style={{ margin: "0 0 12px" }}>
          <strong>Customer</strong> {shippingAddress.first_name} {shippingAddress.last_name} ·{" "}
          {order.email}
        </Text>

        <Text style={{ margin: "0 0 8px" }}>
          <strong>Order</strong> #{order.display_id}
        </Text>
        <Text style={{ margin: "0 0 8px" }}>
          <strong>Date</strong> {new Date(order.created_at).toLocaleString()}
        </Text>
        <Text style={{ margin: "0 0 20px" }}>
          <strong>Total</strong> {order.summary.raw_current_order_total.value} {order.currency_code}
        </Text>

        <Hr style={{ margin: "20px 0" }} />

        <Text style={{ fontSize: "16px", fontWeight: "bold", margin: "0 0 10px" }}>Shipping</Text>
        <Text style={{ margin: "0 0 4px" }}>{shippingAddress.address_1}</Text>
        <Text style={{ margin: "0 0 20px" }}>
          {shippingAddress.city}, {shippingAddress.province} {shippingAddress.postal_code}{" "}
          {shippingAddress.country_code}
        </Text>

        <Text style={{ fontSize: "16px", fontWeight: "bold", margin: "0 0 10px" }}>Line items</Text>
        {order.items.map((item) => (
          <Text key={item.id} style={{ margin: "0 0 6px" }}>
            {item.title} × {item.quantity} — {item.unit_price} {order.currency_code}
          </Text>
        ))}
      </Section>
    </Base>
  )
}

AdminOrderPlacedTemplate.PreviewProps = {
  order: {
    id: "ord_preview",
    display_id: "42",
    created_at: new Date().toISOString(),
    email: "buyer@example.com",
    currency_code: "USD",
    items: [
      {
        id: "li-1",
        title: "Sample product",
        product_title: "Sample",
        quantity: 1,
        unit_price: 99,
      },
    ],
    shipping_address: {
      first_name: "Sam",
      last_name: "Customer",
      address_1: "1 Main St",
      city: "Paris",
      province: "",
      postal_code: "75001",
      country_code: "FR",
    },
    summary: { raw_current_order_total: { value: 99 } },
  },
  shippingAddress: {
    first_name: "Sam",
    last_name: "Customer",
    address_1: "1 Main St",
    city: "Paris",
    province: "",
    postal_code: "75001",
    country_code: "FR",
  },
} as AdminOrderPlacedPreviewProps

export default AdminOrderPlacedTemplate
