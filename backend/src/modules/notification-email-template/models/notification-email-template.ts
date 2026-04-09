import { model } from "@medusajs/framework/utils"

const NotificationEmailTemplate = model.define("notification_email_template", {
  id: model.id().primaryKey(),
  template_key: model.text().unique().searchable(),
  subject: model.text(),
  reply_to: model.text().nullable(),
  is_enabled: model.boolean().default(true),
  html_body: model.text(),
})

export default NotificationEmailTemplate
