import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../../../modules/notification-email-template/constants"
import { NOTIFICATION_TEMPLATE_CATALOG } from "../../../lib/notification-template-catalog"

type TemplateRow = {
  id: string
  template_key: string
  subject: string
  reply_to: string | null
  is_enabled: boolean
  html_body: string
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const mod = req.scope.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as {
    listNotificationEmailTemplates: () => Promise<TemplateRow[]>
  }

  const rows = await mod.listNotificationEmailTemplates()
  const byKey = new Map(rows.map((r) => [r.template_key, r]))

  const templates = NOTIFICATION_TEMPLATE_CATALOG.map((entry) => {
    const row = byKey.get(entry.template_key)
    return {
      ...entry,
      configured: !!row,
      id: row?.id ?? null,
      subject: row?.subject ?? "",
      reply_to: row?.reply_to ?? "",
      is_enabled: row?.is_enabled ?? false,
      html_body: row?.html_body ?? "",
    }
  })

  res.status(200).json({ templates })
}
