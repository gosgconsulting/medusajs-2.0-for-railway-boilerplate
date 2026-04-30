import type { MedusaContainer } from "@medusajs/framework/types"
import type { Knex } from "@medusajs/framework/mikro-orm/knex"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
 * Payment module providers receive the Awilix `localContainer.cradle`, not the app container.
 * Do not use `cradle.resolve` (Awilix treats `"resolve"` as a dependency key). Use bracket reads.
 * `query` / remote Graph are not registered on this cradle; use `paymentSessionService` and `__pg_connection__`.
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

async function paymentCollectionIdFromSession(
  cradle: MedusaContainer,
  medusaPaymentSessionId: string
): Promise<string | null> {
  const paymentSessionService = cradleGet<{
    retrieve: (
      id: string,
      config?: { select?: string[] }
    ) => Promise<{ payment_collection_id?: string | null }>
  }>(cradle, "paymentSessionService")

  const row = await paymentSessionService.retrieve(medusaPaymentSessionId.trim(), {
    select: ["payment_collection_id"],
  })
  const pid = row?.payment_collection_id
  return typeof pid === "string" && pid.trim() ? pid.trim() : null
}

async function salesChannelIdFromPaymentCollection(
  knex: Knex,
  paymentCollectionId: string
): Promise<string | undefined> {
  const cartLink = await knex("cart_payment_collection")
    .select("cart_id")
    .where("payment_collection_id", paymentCollectionId)
    .first()

  if (cartLink?.cart_id) {
    const cart = await knex("cart")
      .select("sales_channel_id")
      .where("id", cartLink.cart_id as string)
      .whereNull("deleted_at")
      .first()
    const sid = cart?.sales_channel_id as string | null | undefined
    if (typeof sid === "string" && sid.length) {
      return sid
    }
  }

  const orderLink = await knex("order_payment_collection")
    .select("order_id")
    .where("payment_collection_id", paymentCollectionId)
    .first()

  if (!orderLink?.order_id) {
    return undefined
  }

  const orderRes = await knex.raw(
    `select sales_channel_id from "order" where id = ? and deleted_at is null limit 1`,
    [orderLink.order_id as string],
  ) as { rows?: { sales_channel_id?: string | null }[] }

  const sid = orderRes.rows?.[0]?.sales_channel_id
  return typeof sid === "string" && sid.length ? sid : undefined
}

async function resolveStoreIdFromPaymentCollection(
  cradle: MedusaContainer,
  paymentCollectionId: string
): Promise<string | null> {
  const knex = cradleGet<Knex>(cradle, ContainerRegistrationKeys.PG_CONNECTION)

  const salesChannelId = await salesChannelIdFromPaymentCollection(
    knex,
    paymentCollectionId
  )
  if (!salesChannelId) {
    return null
  }

  const sc = await knex("sales_channel")
    .select("metadata")
    .where("id", salesChannelId)
    .first()

  const scMeta = sc?.metadata as Record<string, unknown> | null | undefined
  const fromMeta =
    typeof scMeta?.store_id === "string" ? scMeta.store_id.trim() : ""
  if (fromMeta.length) {
    return fromMeta
  }

  const storeRow = await knex("store")
    .select("id")
    .where("default_sales_channel_id", salesChannelId)
    .first()

  return (storeRow?.id as string | undefined) ?? null
}

/**
 * Decrypt HitPay secrets from Store metadata plus non-secret flags from snapshot.
 * Returns null if the session/store cannot be resolved or ciphertext is missing/invalid.
 */
export async function resolveHitPayConfigFromSessionId(
  cradle: MedusaContainer,
  medusaPaymentSessionId: string
): Promise<ResolvedHitPayConfig | null> {
  if (
    typeof medusaPaymentSessionId !== "string" ||
    !medusaPaymentSessionId.trim()
  ) {
    return null
  }

  const paymentCollectionId = await paymentCollectionIdFromSession(
    cradle,
    medusaPaymentSessionId
  )
  if (!paymentCollectionId) {
    return null
  }

  const storeId = await resolveStoreIdFromPaymentCollection(
    cradle,
    paymentCollectionId
  )
  if (!storeId) {
    return null
  }

  const knex = cradleGet<Knex>(cradle, ContainerRegistrationKeys.PG_CONNECTION)
  const storeRow = await knex("store")
    .select("metadata")
    .where("id", storeId)
    .first()

  const meta = storeRow?.metadata as Record<string, unknown> | null | undefined
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
