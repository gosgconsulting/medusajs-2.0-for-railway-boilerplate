import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import HitPayPaymentProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [HitPayPaymentProviderService],
})
