import { MedusaService } from "@medusajs/framework/utils"
import AdminProductTablePref from "./models/admin-product-table-pref"

class AdminProductTablePrefModuleService extends MedusaService({
  AdminProductTablePref,
}) {}

export default AdminProductTablePrefModuleService
