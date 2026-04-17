import { Module } from "@medusajs/framework/utils"
import AdminProductTablePrefModuleService from "./service"
import { ADMIN_PRODUCT_TABLE_PREF_MODULE } from "./constants"

export { ADMIN_PRODUCT_TABLE_PREF_MODULE }

export default Module(ADMIN_PRODUCT_TABLE_PREF_MODULE, {
  service: AdminProductTablePrefModuleService,
})
