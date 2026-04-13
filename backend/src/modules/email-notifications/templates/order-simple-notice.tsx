import { Text, Section, Hr, Button } from "@react-email/components"
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
  /** HTTPS payment link (deferred invoice, etc.) */
  payUrl?: string
  payButtonLabel?: string
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
  payUrl,
  payButtonLabel = "Pay now",
}) => {
  const customerName = [shippingAddress.first_name, shippingAddress.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()
  const dateStr = new Date(order.created_at).toLocaleDateString()

  return (
    <Base preview={preview}>
      <Section className="text-[#111] text-[15px] leading-[1.55]">
        <Text className="m-0 mb-4">
          Hi{customerName ? ` ${customerName}` : ""},
        </Text>
        <Text className="m-0 mb-3 font-semibold">{noticeHeadline}</Text>
        <Text className="m-0 mb-6 whitespace-pre-line">{noticeMessage}</Text>
        {payUrl ? (
          <Section className="text-center mb-6">
            <Button
              href={payUrl}
              className="rounded-md bg-[#111] px-5 py-3 text-center text-[14px] font-semibold text-white no-underline"
            >
              {payButtonLabel}
            </Button>
          </Section>
        ) : null}
        <Hr className="border-[#eaeaea] my-6" />
        <Text className="m-0 mb-2">
          Order #{order.display_id} · {dateStr}
        </Text>
        <Text className="m-0 mb-6">
          Total: {order.summary.raw_current_order_total.value}{" "}
          {String(order.currency_code).toUpperCase()}
        </Text>
      </Section>
    </Base>
  )
}

export default OrderSimpleNoticeTemplate
