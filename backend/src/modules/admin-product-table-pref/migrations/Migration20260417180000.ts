import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260417180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table if not exists "admin_product_table_pref" ("id" text not null, "user_id" text not null, "payload" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "admin_product_table_pref_pkey" primary key ("id"));`
    )
    this.addSql(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_product_table_pref_user_id_unique" ON "admin_product_table_pref" ("user_id") WHERE deleted_at IS NULL;`
    )
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_product_table_pref_deleted_at" ON "admin_product_table_pref" ("deleted_at") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "admin_product_table_pref" cascade;`)
  }
}
