import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "../modules/notification-email-template/constants"
import {
  normalizeNotificationLocale,
  resolveDefaultNotificationLocale,
} from "./notification-email-locales"
import {
  getDefaultHtmlBodyForTemplateKey,
  getDefaultSubjectForTemplateKey,
} from "./notification-template-defaults"

type TemplateModule = {
  listNotificationEmailTemplates: (
    filters?: { template_key?: string; locale?: string },
    config?: { take?: number }
  ) => Promise<{ id: string }[]>
  createNotificationEmailTemplates: (
    data: Record<string, unknown>
  ) => Promise<unknown>
}

/**
 * If no row exists for `templateKey` + `locale`, creates one from code defaults so
 * {@link applyDbEmailTemplate} can send using the notification template module.
 */
export async function ensureNotificationEmailTemplateRow(
  container: { resolve: (key: string) => unknown },
  templateKey: string,
  locale?: string
): Promise<void> {
  const mod = container.resolve(
    NOTIFICATION_EMAIL_TEMPLATE_MODULE
  ) as TemplateModule

  const resolvedLocale =
    locale != null && locale !== ""
      ? normalizeNotificationLocale(locale)
      : await resolveDefaultNotificationLocale(container)

  const existing = await mod.listNotificationEmailTemplates(
    { template_key: templateKey, locale: resolvedLocale },
    { take: 1 }
  )
  if (existing[0]) {
    return
  }

  await mod.createNotificationEmailTemplates({
    template_key: templateKey,
    locale: resolvedLocale,
    subject: getDefaultSubjectForTemplateKey(templateKey),
    html_body: getDefaultHtmlBodyForTemplateKey(templateKey),
    reply_to: null,
    is_enabled: true,
  })
}
