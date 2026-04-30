import type { MedusaContainer, RemoteQueryFunction } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { HITPAY_STORE_SECRET_ENCRYPTION_KEY } from "./constants"
import {
  STORE_METADATA_HITPAY_ENV_KEY,
  type HitPayEnvMetadataSnapshot,
} from "./hitpay-metadata-shared"
import { tryDecryptHitPayCredentialsFromMetadata } from "./store-credentials-crypto"

export type ResolvedHitPayConfig = {
  apiKey: string
  salt: string
  sandbox: boolean
  redirectUrl?: string | undefined
}

export function extractMedusaPaymentSessionId(
  data: Record<string, unknown> | undefined | null
): string | null {
  if (!data) {
    return null
  }
  const sid = data.session_id
  if (typeof sid === "string" && sid.trim().length > 0) {
    return sid.trim()
  }
  const ref = data.reference_number
  if (typeof ref === "string" && ref.trim().length > 0) {
    return ref.trim()
  }
  return null
}

/**
 * Payment module providers receive the Awilix cradle, not the app `MedusaContainer`.
 * Property `cradle.resolve` is intercepted as a dependency named "resolve" and throws.
 * Read injections with bracket notation (same pattern as @medusajs/payment PaymentProviderService).
 */
function cradleGet<T>(cradle: MedusaContainer, key: string): T {
  const v = (cradle as unknown as Record<string, unknown>)[key]
  if (v === undefined) {
    throw new Error(
      `HitPay: payment module cradle is missing "${key}" (cannot load per-store HitPay config).`,
    )
  }
  return v as T
}

async function resolveStoreIdFromPaymentCollection(
  container: MedusaContainer,
  paymentCollectionId: string
): Promise<string | null> {
  const query = cradleGet<RemoteQueryFunction>(
    container,
    ContainerRegistrationKeys.QUERY,
  )

  const { data: cpcRows } = await query.graph({
    entity: "cart_payment_collection",
    fields: ["cart_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })

  let salesChannelId: string | undefined

  if (cpcRows?.length) {
    const cartId = (cpcRows[0] as { cart_id: string }).cart_id
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["sales_channel_id"],
      filters: { id: cartId },
    })
    salesChannelId = (carts?.[0] as { sales_channel_id?: string | null })
      ?.sales_channel_id ?? undefined
  }

  if (!salesChannelId) {
    const { data: opcRows } = await query.graph({
      entity: "order_payment_collection",
      fields: ["order_id"],
      filters: { payment_collection_id: paymentCollectionId },
    })
    if (opcRows?.length) {
      const orderId = (opcRows[0] as { order_id: string }).order_id
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["sales_channel_id"],
        filters: { id: orderId },
      })
      salesChannelId = (orders?.[0] as { sales_channel_id?: string | null })
        ?.sales_channel_id ?? undefined
    }
  }

  if (!salesChannelId) {
    return null
  }

  const { data: scRows } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "metadata"],
    filters: { id: salesChannelId },
  })
  const scMeta = (
    scRows?.[0] as { metadata?: Record<string, unknown> | null } | undefined
  )?.metadata
  const fromMeta =
    typeof scMeta?.store_id === "string" ? scMeta.store_id.trim() : ""
  if (fromMeta.length) {
    return fromMeta
  }

  const storeModule = cradleGet<{
    listStores: () => Promise<
      { id: string; default_sales_channel_id?: string | null }[]
    >
  }>(container, Modules.STORE)
  const stores = await storeModule.listStores()
  const match = stores.find(
    (s) => s.default_sales_channel_id === salesChannelId
  )
  return match?.id ?? null
}

/**
 * Decrypt HitPay secrets from Store metadata plus non-secret flags from snapshot.
 * Returns null if the session/store cannot be resolved or ciphertext is missing/invalid.
 */
export async function resolveHitPayConfigFromSessionId(
  container: MedusaContainer,
  medusaPaymentSessionId: string
): Promise<ResolvedHitPayConfig | null> {
  if (
    typeof medusaPaymentSessionId !== "string" ||
    !medusaPaymentSessionId.trim()
  ) {
    return null
  }

  const query = cradleGet<RemoteQueryFunction>(
    container,
    ContainerRegistrationKeys.QUERY,
  )
  const { data: sessRows } = await query.graph({
    entity: "payment_session",
    fields: ["id", "payment_collection_id"],
    filters: { id: medusaPaymentSessionId.trim() },
  })
  const paymentCollectionId = (
    sessRows?.[0] as { payment_collection_id?: string } | undefined
  )?.payment_collection_id

  if (typeof paymentCollectionId !== "string" || !paymentCollectionId.trim()) {
    return null
  }

  const storeId = await resolveStoreIdFromPaymentCollection(
    container,
    paymentCollectionId
  )
  if (!storeId) {
    return null
  }

  const storeModule = cradleGet<{ retrieveStore: (id: string) => Promise<{ metadata?: Record<string, unknown> | null }> }>(
    container,
    Modules.STORE,
  )
  let store: { metadata?: Record<string, unknown> | null }
  try {
    store = await storeModule.retrieveStore(storeId)
  } catch {
    return null
  }

  const meta = store.metadata ?? undefined
  if (!meta) {
    return null
  }

  const decrypted = tryDecryptHitPayCredentialsFromMetadata(
    meta,
    HITPAY_STORE_SECRET_ENCRYPTION_KEY ?? null
  )

  if (!decrypted) {
    return null
  }

  const snapshot = meta[STORE_METADATA_HITPAY_ENV_KEY] as
    | HitPayEnvMetadataSnapshot
    | undefined

  const redirect =
    snapshot &&
    typeof snapshot.redirect_url === "string" &&
    snapshot.redirect_url.trim().length > 0
      ? snapshot.redirect_url.trim()
      : undefined

  const sandbox =
    typeof snapshot?.sandbox === "boolean" ? snapshot.sandbox : false

  return {
    apiKey: decrypted.apiKey,
    salt: decrypted.salt,
    sandbox,
    redirectUrl: redirect,
  }
}
