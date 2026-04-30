import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  HITPAY_API_KEY,
  HITPAY_REDIRECT_URL,
  HITPAY_SALT,
  HITPAY_SANDBOX,
  HITPAY_STORE_SECRET_ENCRYPTION_KEY,
} from "./constants"
import {
  encryptHitPayCredentialsPayload,
  parseStoreCredentialsEncryptionKey,
  STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY,
} from "./store-credentials-crypto"
import {
  STORE_METADATA_HITPAY_ENV_KEY,
  type HitPayEnvMetadataSnapshot,
} from "./hitpay-metadata-shared"

export { STORE_METADATA_HITPAY_ENV_KEY, type HitPayEnvMetadataSnapshot }

export function buildHitPayEnvMetadataSnapshot(
  credentialsEncrypted: boolean
): HitPayEnvMetadataSnapshot {
  const key = HITPAY_API_KEY ?? ""
  const configured = Boolean(
    HITPAY_API_KEY && HITPAY_SALT && HITPAY_REDIRECT_URL
  )
  return {
    configured,
    sandbox: HITPAY_SANDBOX,
    redirect_url: HITPAY_REDIRECT_URL ?? null,
    salt_configured: Boolean(HITPAY_SALT),
    api_key_last4: key.length >= 4 ? key.slice(-4) : null,
    credentials_encrypted: credentialsEncrypted,
    synced_at: new Date().toISOString(),
  }
}

/**
 * Writes env-derived HitPay flags into each store's metadata when the HitPay
 * payment module is enabled (same env gate as medusa-config).
 */
export async function syncHitPayEnvToStoreMetadata(
  container: MedusaContainer
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
    info: (msg: string) => void
    warn: (msg: string, err?: unknown) => void
  }
  const storeModule = container.resolve(Modules.STORE) as {
    listStores: (
      filters?: Record<string, unknown>,
      config?: Record<string, unknown>
    ) => Promise<{ id: string; metadata?: Record<string, unknown> | null }[]>
  }

  const encKey = parseStoreCredentialsEncryptionKey(
    HITPAY_STORE_SECRET_ENCRYPTION_KEY
  )
  let encryptedBlob: string | undefined
  if (encKey && HITPAY_API_KEY && HITPAY_SALT) {
    encryptedBlob = encryptHitPayCredentialsPayload(
      { apiKey: HITPAY_API_KEY, salt: HITPAY_SALT },
      encKey
    )
  }
  const snapshot = buildHitPayEnvMetadataSnapshot(Boolean(encryptedBlob))
  const stores = await storeModule.listStores()
  for (const store of stores) {
    const prev = store.metadata ?? {}
    const metadata: Record<string, unknown> = {
      ...prev,
      [STORE_METADATA_HITPAY_ENV_KEY]: snapshot,
    }
    if (encryptedBlob) {
      metadata[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY] = encryptedBlob
    } else {
      delete metadata[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY]
    }
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          metadata,
        },
      },
    })
  }
  logger.info(
    `Synced HitPay env snapshot to store metadata (${stores.length} store(s)).`
  )
  if (
    HITPAY_API_KEY &&
    HITPAY_SALT &&
    HITPAY_REDIRECT_URL &&
    !encryptedBlob
  ) {
    const hint =
      HITPAY_STORE_SECRET_ENCRYPTION_KEY &&
      !parseStoreCredentialsEncryptionKey(HITPAY_STORE_SECRET_ENCRYPTION_KEY)
        ? " HITPAY_STORE_SECRET_ENCRYPTION_KEY is set but invalid (use 64-char hex or base64 of 32 raw bytes)."
        : " Set HITPAY_STORE_SECRET_ENCRYPTION_KEY to persist encrypted apiKey/salt in metadata."
    logger.warn(
      `HitPay credentials were not written to store metadata (encrypted blob skipped).${hint}`
    )
  }
}

let hitpayMetadataSyncedThisProcess = false

/**
 * Runs once per server process after HitPay env vars are present (same gate as
 * registering `pp_hitpay_hitpay`). Keeps admin-visible metadata aligned with env.
 */
export function hitpayStoreMetadataSyncMiddleware() {
  return async (
    req: MedusaRequest,
    _res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> => {
    const configured =
      HITPAY_API_KEY && HITPAY_SALT && HITPAY_REDIRECT_URL
    if (!configured || hitpayMetadataSyncedThisProcess) {
      next()
      return
    }
    hitpayMetadataSyncedThisProcess = true
    try {
      await syncHitPayEnvToStoreMetadata(req.scope)
    } catch (err) {
      hitpayMetadataSyncedThisProcess = false
      const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as {
        warn: (msg: string, e?: unknown) => void
      }
      logger.warn("HitPay store metadata sync failed", err)
    }
    next()
  }
}
