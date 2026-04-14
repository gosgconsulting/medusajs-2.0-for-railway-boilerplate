import { ReactNode } from 'react'
import { MedusaError } from '@medusajs/framework/utils'
import {
  AdminOrderPlacedTemplate,
  ADMIN_DEFERRED_ORDER_PAID,
  ADMIN_ORDER_PLACED,
  isAdminOrderPlacedTemplateData,
} from './admin-order-placed'
import { InviteUserEmail, INVITE_USER, isInviteUserData } from './invite-user'
import { OrderPlacedTemplate, ORDER_PLACED, isOrderPlacedTemplateData } from './order-placed'
import {
  OrderSimpleNoticeTemplate,
  isOrderSimpleNoticeTemplateData,
} from './order-simple-notice'

export const EmailTemplates = {
  INVITE_USER,
  ORDER_PLACED,
  ADMIN_ORDER_PLACED,
  ADMIN_DEFERRED_ORDER_PAID,
} as const

export type EmailTemplateType = keyof typeof EmailTemplates

export function generateEmailTemplate(templateKey: string, data: unknown): ReactNode {
  switch (templateKey) {
    case EmailTemplates.INVITE_USER:
      if (!isInviteUserData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.INVITE_USER}"`
        )
      }
      return <InviteUserEmail {...data} />

    case EmailTemplates.ORDER_PLACED:
      if (!isOrderPlacedTemplateData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.ORDER_PLACED}"`
        )
      }
      return <OrderPlacedTemplate {...data} />

    case EmailTemplates.ADMIN_ORDER_PLACED:
      if (!isAdminOrderPlacedTemplateData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.ADMIN_ORDER_PLACED}"`
        )
      }
      return <AdminOrderPlacedTemplate {...data} />

    case EmailTemplates.ADMIN_DEFERRED_ORDER_PAID:
      if (!isAdminOrderPlacedTemplateData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.ADMIN_DEFERRED_ORDER_PAID}"`
        )
      }
      return (
        <AdminOrderPlacedTemplate
          {...data}
          headline="Payment received (deferred checkout)"
          preview={data.preview ?? "Deferred checkout — payment received"}
        />
      )

    default:
      if (
        templateKey.startsWith('order-email-') &&
        isOrderSimpleNoticeTemplateData(data)
      ) {
        return <OrderSimpleNoticeTemplate {...data} />
      }

      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown template key: "${templateKey}"`
      )
  }
}

export { AdminOrderPlacedTemplate, InviteUserEmail, OrderPlacedTemplate }
