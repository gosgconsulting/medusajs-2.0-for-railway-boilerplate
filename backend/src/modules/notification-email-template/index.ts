import { Module } from "@medusajs/framework/utils"
import NotificationEmailTemplateModuleService from "./service"
import { NOTIFICATION_EMAIL_TEMPLATE_MODULE } from "./constants"

export { NOTIFICATION_EMAIL_TEMPLATE_MODULE }

export default Module(NOTIFICATION_EMAIL_TEMPLATE_MODULE, {
  service: NotificationEmailTemplateModuleService,
})
