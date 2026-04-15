import { INotificationModuleService, IUserModuleService } from '@medusajs/framework/types'
import { Modules } from '@medusajs/framework/utils'
import { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { applyDbEmailTemplate } from '../lib/apply-db-email-template'
import { resolveDefaultNotificationLocale } from '../lib/notification-email-locales'
import { BACKEND_URL } from '../lib/constants'
import { EmailTemplates } from '../modules/email-notifications/templates'

export default async function userInviteHandler({
    event: { data },
    container,
  }: SubscriberArgs<any>) {

  const notificationModuleService: INotificationModuleService = container.resolve(
    Modules.NOTIFICATION,
  )
  const userModuleService: IUserModuleService = container.resolve(Modules.USER)
  const invite = await userModuleService.retrieveInvite(data.id)

  try {
    const locale = await resolveDefaultNotificationLocale(container)
    const payload = await applyDbEmailTemplate(
      container,
      EmailTemplates.INVITE_USER,
      {
        template: EmailTemplates.INVITE_USER,
        data: {
          emailOptions: {
            replyTo: 'info@example.com',
            subject: "You've been invited to Medusa!"
          },
          inviteLink: `${BACKEND_URL}/app/invite?token=${invite.token}`,
          preview: 'The administration dashboard awaits...'
        }
      },
      { locale }
    )

    await notificationModuleService.createNotifications({
      to: invite.email,
      channel: 'email',
      ...payload
    })
  } catch (error) {
    console.error(error)
  }
}

export const config: SubscriberConfig = {
  event: ['invite.created', 'invite.resent']
}
