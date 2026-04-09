import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260409041352 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "notification_email_template" drop constraint if exists "notification_email_template_template_key_unique";`);
    this.addSql(`create table if not exists "notification_email_template" ("id" text not null, "template_key" text not null, "subject" text not null, "reply_to" text null, "is_enabled" boolean not null default true, "html_body" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "notification_email_template_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_notification_email_template_template_key_unique" ON "notification_email_template" ("template_key") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_email_template_deleted_at" ON "notification_email_template" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "notification_email_template" cascade;`);
  }

}
