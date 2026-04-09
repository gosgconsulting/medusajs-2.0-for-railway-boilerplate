import Handlebars from "handlebars"
import { MedusaError } from "@medusajs/framework/utils"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../modules/notification-email-template/constants"
import {
  augmentNotificationTemplateData,
  isLegacyHtmlBody,
  plainTextAfterHandlebarsToEmailHtml,
} from "./notification-email-template-body"

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

export type ApplyDbEmailTemplateResult = {
  template?: string | null
  data?: Record<string, unknown> | null
  content?: { subject?: string; html?: string; text?: string } | null
}

/**
 * When a row exists and is enabled with a non-empty `html_body`, compiles Handlebars
 * against notification `data` (with simple aliases like `{{customer_name}}`) and returns
 * `content.html`. Plain-text bodies are wrapped as HTML; stored full-HTML bodies are
 * detected and left as-is. Subject lines are compiled with the same context.
 * Otherwise returns the original payload (React-email templates).
 */
export async function applyDbEmailTemplate(
  container: { resolve: (key: string) => unknown },
  templateKey: string,
  payload: ApplyDbEmailTemplateResult
): Promise<ApplyDbEmailTemplateResult> {
  ensureHandlebarsHelpers()

  let mod: {
    listNotificationEmailTemplates: (
      filters?: { template_key?: string },
      config?: { take?: number }
    ) => Promise<
      {
        id: string
        template_key: string
        subject: string
        reply_to: string | null
        is_enabled: boolean
        html_body: string
      }[]
    >
  }
  try {
    mod = container.resolve(NOTIFICATION_EMAIL_TEMPLATE_MODULE) as typeof mod
  } catch {
    return payload
  }

  const rows = await mod.listNotificationEmailTemplates(
    { template_key: templateKey },
    { take: 1 }
  )
  const row = rows[0]
  if (!row?.is_enabled || !row.html_body?.trim()) {
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
  }

  return {
    template: payload.template ?? templateKey,
    data: mergedData,
    content: {
      subject,
      html,
    },
  }
}
