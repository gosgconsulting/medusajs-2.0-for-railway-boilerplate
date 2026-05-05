/** Store metadata snapshot key — no `@medusajs/medusa` imports. */
export const STORE_METADATA_STRIPE_ENV_KEY = "stripe_from_env"

/** Snapshot in Store metadata — no raw secrets beyond optional key suffix. */
export type StripeEnvMetadataSnapshot = {
  configured: boolean
  secret_key_last4: string | null
  webhook_secret_configured: boolean
  credentials_encrypted: boolean
  synced_at: string
}
