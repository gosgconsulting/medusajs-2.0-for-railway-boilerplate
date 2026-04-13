import type {
  INotificationModuleService,
  IOrderModuleService,
  OrderAddressDTO,
} from "@medusajs/framework/types"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { applyDbEmailTemplate } from "./apply-db-email-template"
import type { OrderNotificationEmailKey } from "./order-notification-email-keys"

const DEFAULT_REPLY_TO = "info@example.com"

const EMPTY_ADDRESS = {
  first_name: "",
  last_name: "",
  address_1: "",
  city: "",
  country_code: "",
  province: "",
  postal_code: "",
} as OrderAddressDTO

export type SendOrderNotificationEmailParams = {
  container: { resolve: (key: string) => unknown }
  orderId: string
  templateKey: OrderNotificationEmailKey | string
  defaultSubject: string
  preview: string
  noticeHeadline: string
  noticeMessage: string
  idempotencyKey?: string
  /** Merged into template data (e.g. payUrl, pay_url, payButtonLabel). */
  extraTemplateData?: Record<string, unknown>
  /** When true, missing order email throws instead of no-op. */
  throwIfNoEmail?: boolean
}

export async function sendOrderNotificationEmail(
  params: SendOrderNotificationEmailParams
): Promise<void> {
  const {
    container,
    orderId,
    templateKey,
    defaultSubject,
    preview,
    noticeHeadline,
    noticeMessage,
    idempotencyKey,
    extraTemplateData,
    throwIfNoEmail,
  } = params

  const orderModuleService = container.resolve(Modules.ORDER) as IOrderModuleService
  const notificationModuleService = container.resolve(
    Modules.NOTIFICATION
  ) as INotificationModuleService

  const order = await orderModuleService.retrieveOrder(orderId, {
    relations: ["items", "summary", "shipping_address", "billing_address"],
  })

  const email = order.email?.trim()
  if (!email) {
    if (throwIfNoEmail) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Order has no customer email address."
      )
    }
    return
  }

  const orderAddressService = (
    orderModuleService as unknown as {
      orderAddressService_: { retrieve: (id: string) => Promise<OrderAddressDTO> }
    }
  ).orderAddressService_

  const sa = order.shipping_address as
    | (OrderAddressDTO & { id?: string })
    | null
    | undefined
  const ba = order.billing_address as
    | (OrderAddressDTO & { id?: string })
    | null
    | undefined

  const hasInline = (a: OrderAddressDTO | null | undefined) =>
    !!(a && (a.address_1 || a.first_name || a.city))

  let shippingAddress: OrderAddressDTO
  if (hasInline(sa)) {
    shippingAddress = sa as OrderAddressDTO
  } else if (sa?.id) {
    shippingAddress = await orderAddressService.retrieve(sa.id)
  } else if (hasInline(ba)) {
    shippingAddress = ba as OrderAddressDTO
  } else if (ba?.id) {
    shippingAddress = await orderAddressService.retrieve(ba.id)
  } else {
    shippingAddress = EMPTY_ADDRESS
  }

  const payload = await applyDbEmailTemplate(container, templateKey, {
    template: templateKey,
    data: {
      emailOptions: {
        replyTo: DEFAULT_REPLY_TO,
        subject: defaultSubject,
      },
      order,
      shippingAddress,
      preview,
      noticeHeadline,
      noticeMessage,
      ...(extraTemplateData ?? {}),
    },
  })

  await notificationModuleService.createNotifications({
    to: email,
    channel: "email",
    ...payload,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  })
}
