import { model } from "@medusajs/framework/utils"

const AdminProductTablePref = model.define("admin_product_table_pref", {
  id: model.id().primaryKey(),
  /** Admin user id (`auth_context.actor_id`) */
  user_id: model.text().searchable(),
  /** JSON: { mode, visible: string[], customColumns: [...] } */
  payload: model.text(),
})

export default AdminProductTablePref
