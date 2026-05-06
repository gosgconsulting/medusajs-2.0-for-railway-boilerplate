import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import StripePaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [StripePaymentProviderService],
})
