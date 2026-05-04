import { ModuleProviderExports } from "@medusajs/framework/types"
import SupabaseFileProviderService from "./service"

const services = [SupabaseFileProviderService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
