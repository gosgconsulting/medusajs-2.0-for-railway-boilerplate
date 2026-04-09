import { Text, Section, Hr } from "@react-email/components"
import * as React from "react"
import { Base } from "./base"
import type { OrderDTO, OrderAddressDTO } from "@medusajs/framework/types"

export interface OrderSimpleNoticeTemplateProps {
  order: OrderDTO & {
    display_id: string | number
    summary: { raw_current_order_total: { value: number } }
  }
  shippingAddress: OrderAddressDTO
  noticeHeadline: string
  noticeMessage: string
  preview?: string
}

export const isOrderSimpleNoticeTemplateData = (
  data: unknown
): data is OrderSimpleNoticeTemplateProps => {
  if (!data || typeof data !== "object") return false
  const d = data as Record<string, unknown>
  return (
    typeof d.noticeHeadline === "string" &&
    typeof d.noticeMessage === "string" &&
    typeof d.order === "object" &&
    d.order != null &&
    typeof d.shippingAddress === "object" &&
    d.shippingAddress != null
  )
}

export const OrderSimpleNoticeTemplate: React.FC<OrderSimpleNoticeTemplateProps> = ({
  order,
  shippingAddress,
  noticeHeadline,
  noticeMessage,
  preview = "Order update",
}) => {
  return (
    <Base preview={preview}>
      <Section>
        <Text
          style={{
            fontSize: "22px",
            fontWeight: "bold",
            textAlign: "center",
            margin: "0 0 24px",
          }}
        >
          {noticeHeadline}
        </Text>
        <Text style={{ margin: "0 0 16px" }}>
          Dear {shippingAddress.first_name} {shippingAddress.last_name},
        </Text>
        <Text style={{ margin: "0 0 24px" }}>{noticeMessage}</Text>
        <Hr style={{ margin: "20px 0" }} />
        <Text style={{ fontSize: "16px", fontWeight: "bold", margin: "0 0 8px" }}>
          Order
        </Text>
        <Text style={{ margin: "0 0 4px" }}>Order ID: {order.display_id}</Text>
        <Text style={{ margin: "0 0 4px" }}>
          Date: {new Date(order.created_at).toLocaleDateString()}
        </Text>
        <Text style={{ margin: "0 0 16px" }}>
          Total: {order.summary.raw_current_order_total.value} {order.currency_code}
        </Text>
      </Section>
    </Base>
  )
}

export default OrderSimpleNoticeTemplate
