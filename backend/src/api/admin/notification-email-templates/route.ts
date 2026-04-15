import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../../../modules/notification-email-template/constants"
import { NOTIFICATION_TEMPLATE_CATALOG } from "../../../lib/notification-template-catalog"
import {
  getConfiguredNotificationLocales,
  normalizeNotificationLocale,
  resolveDefaultNotificationLocale,
} from "../../../lib/notification-email-locales"

type TemplateRow = {
  id: string
  template_key: string
  locale?: string | null
  subject: string
  reply_to: string | null
  is_enabled: boolean
  html_body: string
}

function pickRowForCatalogEntry(
  rows: TemplateRow[],
  templateKey: string,
  listLocale: string
): TemplateRow | undefined {
  const forKey = rows.filter((r) => r.template_key === templateKey)
  if (!forKey.length) return undefined
  const want = normalizeNotificationLocale(listLocale)
  return (
    forKey.find(
      (r) => normalizeNotificationLocale(r.locale ?? "en") === want
    ) ??
    forKey.find(
      (r) => normalizeNotificationLocale(r.locale ?? "en") === "en"
    ) ??
    forKey[0]
  )
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const mod = req.scope.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as {
    listNotificationEmailTemplates: () => Promise<TemplateRow[]>
  }

  const rows = await mod.listNotificationEmailTemplates()
  const available_locales = await getConfiguredNotificationLocales(req.scope)
  const default_locale = await resolveDefaultNotificationLocale(req.scope)
  const listLocale = default_locale

  const byKeyDisplay = new Map(
    NOTIFICATION_TEMPLATE_CATALOG.map((entry) => {
      const row = pickRowForCatalogEntry(rows, entry.template_key, listLocale)
      return [entry.template_key, row] as const
    })
  )

  const templates = NOTIFICATION_TEMPLATE_CATALOG.map((entry) => {
    const row = byKeyDisplay.get(entry.template_key)
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

  res.status(200).json({
    available_locales,
    default_locale,
    templates,
  })
}
