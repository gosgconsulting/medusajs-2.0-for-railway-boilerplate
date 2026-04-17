import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { CustomerGroupSelectWidget } from "./customer-group-select-shared"

export const config = defineWidgetConfig({
  zone: "customer.edit.after",
})

export default CustomerGroupSelectWidget
