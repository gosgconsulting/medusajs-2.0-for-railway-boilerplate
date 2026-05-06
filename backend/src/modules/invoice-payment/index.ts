import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import InvoicePaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [InvoicePaymentProviderService],
})

