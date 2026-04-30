/** Store metadata snapshot key (`hitpay_from_env`) — kept free of `@medusajs/medusa` imports so HitPay runtime code does not bundle core-flows. */
export const STORE_METADATA_HITPAY_ENV_KEY = "hitpay_from_env"

/** Snapshot stored in Store metadata (`hitpay_from_env`) — no raw secrets beyond optional API suffix. */
export type HitPayEnvMetadataSnapshot = {
  configured: boolean
  sandbox: boolean
  redirect_url: string | null
  salt_configured: boolean
  api_key_last4: string | null
  credentials_encrypted: boolean
  synced_at: string
}
