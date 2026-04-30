import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGO = "aes-256-gcm"
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

/** Metadata key for encrypted HitPay apiKey + salt (single blob). */
export const STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY =
  "hitpay_credentials_enc_v1"

export type HitPayCredentialPayload = {
  apiKey: string
  salt: string
}

/**
 * Derive a 32-byte AES key from env.
 * Accepts 64-char hex or base64 / base64url (decoded length must be 32 bytes).
 */
export function parseStoreCredentialsEncryptionKey(
  raw: string | undefined | null
): Buffer | null {
  const t = typeof raw === "string" ? raw.trim() : ""
  if (!t.length) {
    return null
  }
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    return Buffer.from(t, "hex")
  }
  let b64 = t.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4
  if (pad) {
    b64 += "=".repeat(4 - pad)
  }
  try {
    const buf = Buffer.from(b64, "base64")
    return buf.length === KEY_LENGTH ? buf : null
  } catch {
    return null
  }
}

export function encryptHitPayCredentialsPayload(
  payload: HitPayCredentialPayload,
  key: Buffer
): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      "Invalid encryption key length (expected 32 bytes after decoding)."
    )
  }
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)
  const plaintext = JSON.stringify(payload)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext]).toString("base64")
}

export function decryptHitPayCredentialsPayload(
  blob: string,
  key: Buffer
): HitPayCredentialPayload {
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      "Invalid encryption key length (expected 32 bytes after decoding)."
    )
  }
  const raw = Buffer.from(blob, "base64")
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid ciphertext length.")
  }
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const parsed = JSON.parse(plain.toString("utf8")) as unknown
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as HitPayCredentialPayload).apiKey !== "string" ||
    typeof (parsed as HitPayCredentialPayload).salt !== "string"
  ) {
    throw new Error("Invalid decrypted credential payload shape.")
  }
  return parsed as HitPayCredentialPayload
}

/**
 * Server-side only: decrypt HitPay credentials from store metadata when present.
 */
export function tryDecryptHitPayCredentialsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  keyRaw?: string | null
): HitPayCredentialPayload | null {
  const enc = metadata?.[STORE_METADATA_HITPAY_CREDENTIALS_ENC_KEY]
  if (typeof enc !== "string" || !enc.length) {
    return null
  }
  const key = parseStoreCredentialsEncryptionKey(
    keyRaw ?? process.env.HITPAY_STORE_SECRET_ENCRYPTION_KEY
  )
  if (!key) {
    return null
  }
  try {
    return decryptHitPayCredentialsPayload(enc, key)
  } catch {
    return null
  }
}
