import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260415120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "notification_email_template" add column if not exists "locale" text not null default 'en';`
    )
    this.addSql(
      `update "notification_email_template" set "locale" = 'en' where "locale" is null or "locale" = '';`
    )
    this.addSql(
      `drop index if exists "IDX_notification_email_template_template_key_unique";`
    )
    this.addSql(
      `create unique index if not exists "IDX_notification_email_template_key_locale_unique" on "notification_email_template" ("template_key", "locale") where deleted_at is null;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index if exists "IDX_notification_email_template_key_locale_unique";`
    )
    this.addSql(
      `delete from "notification_email_template" where coalesce(locale, 'en') is distinct from 'en';`
    )
    this.addSql(
      `create unique index if not exists "IDX_notification_email_template_template_key_unique" on "notification_email_template" ("template_key") where deleted_at is null;`
    )
    this.addSql(
      `alter table if exists "notification_email_template" drop column if exists "locale";`
    )
  }
}
