import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import { STRIPE_STORE_SECRET_ENCRYPTION_KEY } from "../../../../../lib/constants"
import {
  STORE_METADATA_STRIPE_ENV_KEY,
  type StripeEnvMetadataSnapshot,
} from "../../../../../lib/stripe-metadata-shared"
import {
  encryptStripeCredentialsPayload,
  parseStoreCredentialsEncryptionKey,
  STORE_METADATA_STRIPE_CREDENTIALS_ENC_KEY,
} from "../../../../../lib/store-credentials-crypto"

type StripeCredentialsBody = {
  secretKey?: string
  webhookSecret?: string
  clearSecrets?: boolean
}

function readSnapshot(
  metadata: Record<string, unknown> | null | undefined
): StripeEnvMetadataSnapshot | null {
  const raw = metadata?.[STORE_METADATA_STRIPE_ENV_KEY]
  if (!raw || typeof raw !== "object") {
    return null
  }
  return raw as StripeEnvMetadataSnapshot
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = req.params.id as string
  const storeModule = req.scope.resolve(Modules.STORE)
  let store: { metadata?: Record<string, unknown> | null }
  try {
    store = await storeModule.retrieveStore(id)
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Store with id "${id}" not found`
    )
  }

  const encryptionConfigured = Boolean(
    parseStoreCredentialsEncryptionKey(STRIPE_STORE_SECRET_ENCRYPTION_KEY)
  )
  const snapshot = readSnapshot(store.metadata ?? undefined)

  res.status(200).json({
    encryptionConfigured,
    snapshot,
  })
}

export async function POST(
  req: MedusaRequest<StripeCredentialsBody>,
  res: MedusaResponse
): Promise<void> {
  const id = req.params.id as string
  const body = req.body ?? {}
  const storeModule = req.scope.resolve(Modules.STORE)

  let store: { metadata?: Record<string, unknown> | null }
  try {
    store = await storeModule.retrieveStore(id)
  } catch {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Store with id "${id}" not found`
    )
  }

  const prevMeta = { ...(store.metadata ?? {}) }
  const prevSnap = readSnapshot(prevMeta)

  const sk =
    typeof body.secretKey === "string" ? body.secretKey.trim() : ""
  const wh =
    typeof body.webhookSecret === "string" ? body.webhookSecret.trim() : ""

  if (sk && !wh) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Stripe webhook signing secret is required when updating the secret key."
    )
  }
  if (wh && !sk) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Stripe secret key is required when updating the webhook signing secret."
    )
  }

  const encKey = parseStoreCredentialsEncryptionKey(
    STRIPE_STORE_SECRET_ENCRYPTION_KEY
  )

  const nextMeta: Record<string, unknown> = { ...prevMeta }

  if (body.clearSecrets === true) {
    delete nextMeta[STORE_METADATA_STRIPE_CREDENTIALS_ENC_KEY]
  }

  if (sk && wh) {
    if (!encKey) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Server is not configured for encrypted Stripe storage (set STRIPE_STORE_SECRET_ENCRYPTION_KEY)."
      )
    }
    nextMeta[STORE_METADATA_STRIPE_CREDENTIALS_ENC_KEY] =
      encryptStripeCredentialsPayload(
        { secretKey: sk, webhookSecret: wh },
        encKey
      )
  }

  const hasBlob =
    typeof nextMeta[STORE_METADATA_STRIPE_CREDENTIALS_ENC_KEY] === "string" &&
    String(nextMeta[STORE_METADATA_STRIPE_CREDENTIALS_ENC_KEY]).length > 0

  const snapshot: StripeEnvMetadataSnapshot = {
    configured: hasBlob,
    secret_key_last4: !hasBlob
      ? null
      : sk.length >= 4
        ? sk.slice(-4)
        : (prevSnap?.secret_key_last4 ?? null),
    webhook_secret_configured: hasBlob,
    credentials_encrypted: hasBlob,
    synced_at: new Date().toISOString(),
  }

  nextMeta[STORE_METADATA_STRIPE_ENV_KEY] = snapshot

  await updateStoresWorkflow(req.scope).run({
    input: {
      selector: { id },
      update: { metadata: nextMeta },
    },
  })

  const encryptionConfigured = Boolean(encKey)
  res.status(200).json({
    encryptionConfigured,
    snapshot,
  })
}
