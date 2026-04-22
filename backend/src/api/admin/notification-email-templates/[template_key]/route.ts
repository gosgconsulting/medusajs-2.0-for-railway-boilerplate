import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../../../../modules/notification-email-template/constants"
import { NOTIFICATION_TEMPLATE_CATALOG } from "../../../../lib/notification-template-catalog"
import {
  getConfiguredNotificationLocales,
  normalizeNotificationLocale,
  resolveDefaultNotificationLocale,
} from "../../../../lib/notification-email-locales"
import { getNotificationFromByProvider } from "../../../../lib/constants"
import {
  getDefaultHtmlBodyForTemplateKey,
  getDefaultSubjectForTemplateKey,
} from "../../../../lib/notification-template-defaults"

type TemplateRow = {
  id: string
  template_key: string
  locale?: string | null
  subject: string
  reply_to: string | null
  is_enabled: boolean
  html_body: string
}

type UpsertBody = {
  subject?: string
  reply_to?: string | null
  is_enabled?: boolean
  html_body?: string
  reset_to_defaults?: boolean
  locale?: string
}

function catalogMeta(templateKey: string) {
  const entry = NOTIFICATION_TEMPLATE_CATALOG.find((e) => e.template_key === templateKey)
  if (!entry) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Unknown notification template key: ${templateKey}`
    )
  }
  return entry
}

async function resolveLocaleParam(
  scope: { resolve: (key: string) => unknown },
  raw: string | undefined | null
): Promise<string> {
  const configured = await getConfiguredNotificationLocales(scope)
  const fallback = await resolveDefaultNotificationLocale(scope)
  if (raw == null || raw === "") {
    return fallback
  }
  const n = normalizeNotificationLocale(raw)
  if (!configured.includes(n)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Locale "${raw}" is not in the configured list (${configured.join(", ")}).`
    )
  }
  return n
}

function firstStringParam(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value) && typeof value[0] === "string") return value[0]
  return undefined
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const templateKey = req.params.template_key as string
  catalogMeta(templateKey)

  const locale = await resolveLocaleParam(
    req.scope,
    firstStringParam((req.query as Record<string, unknown>)?.locale)
  )

  const mod = req.scope.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as {
    listNotificationEmailTemplates: (
      filters?: { template_key?: string; locale?: string },
      config?: { take?: number }
    ) => Promise<TemplateRow[]>
  }

  const rows = await mod.listNotificationEmailTemplates(
    { template_key: templateKey, locale },
    { take: 1 }
  )
  const row = rows[0]

  res.status(200).json({
    template_key: templateKey,
    locale,
    configured: !!row,
    id: row?.id ?? null,
    subject: row?.subject ?? "",
    reply_to: row?.reply_to ?? "",
    is_enabled: row?.is_enabled ?? false,
    html_body: row?.html_body ?? "",
    email_from: getNotificationFromByProvider(),
    defaults: {
      subject: getDefaultSubjectForTemplateKey(templateKey),
      html_body: getDefaultHtmlBodyForTemplateKey(templateKey),
    },
  })
}

export async function POST(
  req: MedusaRequest<UpsertBody>,
  res: MedusaResponse
): Promise<void> {
  const templateKey = req.params.template_key as string
  catalogMeta(templateKey)

  const body = req.body ?? {}
  const locale = await resolveLocaleParam(req.scope, firstStringParam(body.locale))

  const mod = req.scope.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as {
    listNotificationEmailTemplates: (
      filters?: { template_key?: string; locale?: string },
      config?: { take?: number }
    ) => Promise<TemplateRow[]>
    createNotificationEmailTemplates: (data: Record<string, unknown>) => Promise<TemplateRow>
    updateNotificationEmailTemplates: (data: { id: string } & Record<string, unknown>) => Promise<TemplateRow>
  }

  const reset = body.reset_to_defaults === true

  const subject = reset
    ? getDefaultSubjectForTemplateKey(templateKey)
    : typeof body.subject === "string"
      ? body.subject
      : ""
  const html_body = reset
    ? getDefaultHtmlBodyForTemplateKey(templateKey)
    : typeof body.html_body === "string"
      ? body.html_body
      : ""
  const reply_to =
    reset ? null : body.reply_to === undefined ? null : (body.reply_to as string | null)
  const is_enabled = reset ? true : body.is_enabled !== false

  if (!reset && !html_body.trim()) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Body text is required unless reset_to_defaults is true"
    )
  }

  const existing = await mod.listNotificationEmailTemplates(
    { template_key: templateKey, locale },
    { take: 1 }
  )
  const row = existing[0]

  let saved: TemplateRow
  if (row) {
    saved = await mod.updateNotificationEmailTemplates({
      id: row.id,
      subject,
      html_body,
      reply_to: reply_to?.trim() ? reply_to.trim() : null,
      is_enabled,
    })
  } else {
    saved = await mod.createNotificationEmailTemplates({
      template_key: templateKey,
      locale,
      subject,
      html_body,
      reply_to: reply_to?.trim() ? reply_to.trim() : null,
      is_enabled,
    })
  }

  res.status(200).json({
    template_key: saved.template_key,
    locale: normalizeNotificationLocale(saved.locale ?? locale),
    id: saved.id,
    subject: saved.subject,
    reply_to: saved.reply_to,
    is_enabled: saved.is_enabled,
    html_body: saved.html_body,
  })
}
