import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import {
  HITPAY_REDIRECT_URL,
  HITPAY_SANDBOX,
  HITPAY_STORE_SECRET_ENCRYPTION_KEY,
} from "../../../../../lib/constants"
import {
  STORE_METADATA_HITPAY_ENV_KEY,
  type HitPayEnvMetadataSnapshot,
} from "../../../../../lib/sync-hitpay-env-to-store-metadata"
import {
  encryptHitPayCredentialsPayload,
  parseStoreCredentialsEncryptionKey,
  STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY,
} from "../../../../../lib/store-credentials-crypto"

type HitPayCredentialsBody = {
  apiKey?: string
  salt?: string
  sandbox?: boolean
  redirectUrl?: string | null
  clearSecrets?: boolean
}

function readSnapshot(
  metadata: Record<string, unknown> | null | undefined
): HitPayEnvMetadataSnapshot | null {
  const raw = metadata?.[STORE_METADATA_HITPAY_ENV_KEY]
  if (!raw || typeof raw !== "object") {
    return null
  }
  return raw as HitPayEnvMetadataSnapshot
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
    parseStoreCredentialsEncryptionKey(HITPAY_STORE_SECRET_ENCRYPTION_KEY)
  )
  const snapshot = readSnapshot(store.metadata ?? undefined)

  res.status(200).json({
    encryptionConfigured,
    snapshot,
  })
}

export async function POST(
  req: MedusaRequest<HitPayCredentialsBody>,
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

  const ak =
    typeof body.apiKey === "string" ? body.apiKey.trim() : ""
  const sl = typeof body.salt === "string" ? body.salt.trim() : ""

  if (ak && !sl) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "HitPay salt is required when updating the API key."
    )
  }
  if (sl && !ak) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "HitPay API key is required when updating the salt."
    )
  }

  const encKey = parseStoreCredentialsEncryptionKey(
    HITPAY_STORE_SECRET_ENCRYPTION_KEY
  )

  const nextMeta: Record<string, unknown> = { ...prevMeta }

  if (body.clearSecrets === true) {
    delete nextMeta[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY]
  }

  if (ak && sl) {
    if (!encKey) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Server is not configured for encrypted HitPay storage (set HITPAY_STORE_SECRET_ENCRYPTION_KEY)."
      )
    }
    nextMeta[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY] =
      encryptHitPayCredentialsPayload({ apiKey: ak, salt: sl }, encKey)
  }

  const hasBlob =
    typeof nextMeta[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY] === "string" &&
    String(nextMeta[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY]).length > 0

  const sandbox =
    typeof body.sandbox === "boolean"
      ? body.sandbox
      : (prevSnap?.sandbox ?? HITPAY_SANDBOX)

  let redirect_url: string | null
  if ("redirectUrl" in body) {
    const t =
      typeof body.redirectUrl === "string" ? body.redirectUrl.trim() : ""
    redirect_url = t.length ? t : null
  } else {
    redirect_url =
      prevSnap?.redirect_url ?? HITPAY_REDIRECT_URL ?? null
  }

  const snapshot: HitPayEnvMetadataSnapshot = {
    configured: hasBlob,
    sandbox,
    redirect_url,
    salt_configured: hasBlob,
    api_key_last4: !hasBlob
      ? null
      : ak.length >= 4
        ? ak.slice(-4)
        : (prevSnap?.api_key_last4 ?? null),
    credentials_encrypted: hasBlob,
    synced_at: new Date().toISOString(),
  }

  nextMeta[STORE_METADATA_HITPAY_ENV_KEY] = snapshot

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
