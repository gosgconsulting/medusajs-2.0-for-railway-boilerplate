import { MedusaService } from "@medusajs/framework/utils"
import NotificationEmailTemplate from "./models/notification-email-template"

class NotificationEmailTemplateModuleService extends MedusaService({
  NotificationEmailTemplate,
}) {}

export default NotificationEmailTemplateModuleService
