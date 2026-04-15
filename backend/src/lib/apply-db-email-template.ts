import Handlebars from "handlebars"
import { MedusaError } from "@medusajs/framework/utils"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../modules/notification-email-template/constants"
import {
  augmentNotificationTemplateData,
  isLegacyHtmlBody,
  plainTextAfterHandlebarsToEmailHtml,
} from "./notification-email-template-body"
import {
  buildNotificationLocaleFallbackChain,
  getConfiguredNotificationLocales,
  normalizeNotificationLocale,
  resolveDefaultNotificationLocale,
} from "./notification-email-locales"

let handlebarsInitialized = false

function ensureHandlebarsHelpers() {
  if (handlebarsInitialized) return
  handlebarsInitialized = true
  Handlebars.registerHelper(
    "formatDate",
    (value: string | number | Date | null | undefined) => {
      if (value == null || value === "") return ""
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()
    }
  )
}

type DbTemplateRow = {
  id: string
  template_key: string
  locale?: string | null
  subject: string
  reply_to: string | null
  is_enabled: boolean
  html_body: string
}

type TemplateModuleList = {
  listNotificationEmailTemplates: (
    filters?: { template_key?: string; locale?: string },
    config?: { take?: number }
  ) => Promise<DbTemplateRow[]>
}

async function findEnabledTemplateRow(
  mod: TemplateModuleList,
  templateKey: string,
  preferredLocale: string,
  configuredLocales: string[]
): Promise<DbTemplateRow | null> {
  const chain = buildNotificationLocaleFallbackChain(
    preferredLocale,
    configuredLocales
  )
  for (const loc of chain) {
    const rows = await mod.listNotificationEmailTemplates(
      { template_key: templateKey, locale: loc },
      { take: 1 }
    )
    const row = rows[0]
    if (row?.is_enabled && row.html_body?.trim()) {
      return row
    }
  }
  const all = await mod.listNotificationEmailTemplates({ template_key: templateKey })
  const hit = all.find((r) => r.is_enabled && r.html_body?.trim())
  return hit ?? null
}

export type ApplyDbEmailTemplateResult = {
  template?: string | null
  data?: Record<string, unknown> | null
  content?: { subject?: string; html?: string; text?: string } | null
  provider_data?: { _preRenderedEmail?: { html: string; subject: string } } | null
}

export type ApplyDbEmailTemplateOptions = {
  /** Resolved against DB rows with fallback across configured store/env locales. */
  locale?: string
}

/**
 * When a matching row exists and is enabled with a non-empty `html_body`, compiles Handlebars
 * against notification `data` (with simple aliases like `{{customer_name}}`) and returns
 * `content.html`. Plain-text bodies are wrapped as HTML; stored full-HTML bodies are
 * detected and left as-is. Subject lines are compiled with the same context.
 * Otherwise returns the original payload (React-email templates).
 */
export async function applyDbEmailTemplate(
  container: { resolve: (key: string) => unknown },
  templateKey: string,
  payload: ApplyDbEmailTemplateResult,
  options?: ApplyDbEmailTemplateOptions
): Promise<ApplyDbEmailTemplateResult> {
  ensureHandlebarsHelpers()

  let mod: TemplateModuleList
  try {
    mod = container.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as TemplateModuleList
  } catch {
    return payload
  }

  const configuredLocales = await getConfiguredNotificationLocales(container)
  const preferred =
    options?.locale != null && options.locale !== ""
      ? normalizeNotificationLocale(options.locale)
      : await resolveDefaultNotificationLocale(container)

  const row = await findEnabledTemplateRow(
    mod,
    templateKey,
    preferred,
    configuredLocales
  )
  if (!row) {
    return payload
  }

  let compiled: ReturnType<typeof Handlebars.compile>
  try {
    compiled = Handlebars.compile(row.html_body, { strict: false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid Handlebars in notification template "${templateKey}": ${msg}`
    )
  }

  const templateData = JSON.parse(JSON.stringify(payload.data ?? {})) as Record<
    string,
    unknown
  >
  const augmented = augmentNotificationTemplateData(templateData)

  let html: string
  try {
    const rendered = compiled(augmented)
    html = isLegacyHtmlBody(row.html_body)
      ? rendered
      : plainTextAfterHandlebarsToEmailHtml(rendered)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Failed to render notification template "${templateKey}": ${msg}`
    )
  }

  const emailOptions = (templateData.emailOptions ?? {}) as Record<string, unknown>
  const fallbackSubject =
    (typeof emailOptions.subject === "string" ? emailOptions.subject : "") ||
    "Notification"
  const subjectFromRow = row.subject?.trim()
  const subjectTemplate = subjectFromRow || fallbackSubject
  let subject: string
  try {
    const subCompiled = Handlebars.compile(subjectTemplate, { strict: false })
    subject = subCompiled(augmented).trim() || fallbackSubject
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid Handlebars in notification subject for "${templateKey}": ${msg}`
    )
  }

  const replyTo = row.reply_to?.trim()
  const mergedData = {
    ...templateData,
    emailOptions: {
      ...emailOptions,
      subject,
      ...(replyTo ? { replyTo } : {}),
    },
    /** Fallback for providers if top-level `content` is dropped before send. */
    _preRenderedEmail: { html, subject },
  }

  return {
    template: payload.template ?? templateKey,
    data: mergedData,
    content: {
      subject,
      html,
    },
    provider_data: {
      _preRenderedEmail: { html, subject },
    },
  }
}
