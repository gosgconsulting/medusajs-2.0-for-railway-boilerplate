import React, { useEffect, useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Heading, Input, Switch, Text, toast } from "@medusajs/ui"
import { sdk } from "../lib/sdk"
import type { HitPayEnvMetadataSnapshot } from "lib/sync-hitpay-env-to-store-metadata"

type StoreWidgetData = {
  id?: string
}

type HitpayCredentialsGetResponse = {
  encryptionConfigured: boolean
  snapshot: HitPayEnvMetadataSnapshot | null
}

const HitPayStoreCredentialsWidget = ({ data }: { data: StoreWidgetData }) => {
  const storeId = data?.id
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [encryptionConfigured, setEncryptionConfigured] = useState(false)
  const [snapshot, setSnapshot] = useState<HitPayEnvMetadataSnapshot | null>(
    null
  )

  const [apiKey, setApiKey] = useState("")
  const [salt, setSalt] = useState("")
  const [sandbox, setSandbox] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState("")

  const load = async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const res = await sdk.client.fetch<HitpayCredentialsGetResponse>(
        `/admin/stores/${storeId}/hitpay-credentials`,
        { method: "GET" }
      )
      setEncryptionConfigured(res.encryptionConfigured)
      setSnapshot(res.snapshot)
      setSandbox(res.snapshot?.sandbox ?? false)
      setRedirectUrl(res.snapshot?.redirect_url ?? "")
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not load HitPay settings."
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [storeId])

  if (!storeId) {
    return null
  }

  const ciphertextPresent = !!snapshot?.credentials_encrypted

  /** Server can decrypt and metadata has ciphertext */
  const credentialsOnFile =
    encryptionConfigured && ciphertextPresent

  const submit = async () => {
    const ak = apiKey.trim()
    const sl = salt.trim()
    if ((ak && !sl) || (!ak && sl)) {
      toast.error("API key and salt must both be filled to update credentials.")
      return
    }
    if ((ak || sl) && !encryptionConfigured) {
      toast.error(
        "Server encryption key is not set (HITPAY_STORE_SECRET_ENCRYPTION_KEY)."
      )
      return
    }

    setSaving(true)
    try {
      const res = await sdk.client.fetch<HitpayCredentialsGetResponse>(
        `/admin/stores/${storeId}/hitpay-credentials`,
        {
          method: "POST",
          body: {
            ...(ak && sl ? { apiKey: ak, salt: sl } : {}),
            sandbox,
            redirectUrl: redirectUrl.trim() || null,
          },
        }
      )
      setSnapshot(res.snapshot)
      setEncryptionConfigured(res.encryptionConfigured)
      setApiKey("")
      setSalt("")
      toast.success("HitPay settings saved.")
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not save HitPay settings."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const clearSecrets = async () => {
    setSaving(true)
    try {
      const res = await sdk.client.fetch<HitpayCredentialsGetResponse>(
        `/admin/stores/${storeId}/hitpay-credentials`,
        {
          method: "POST",
          body: { clearSecrets: true, sandbox, redirectUrl: redirectUrl.trim() || null },
        }
      )
      setSnapshot(res.snapshot)
      setApiKey("")
      setSalt("")
      toast.success("Stored HitPay credentials removed.")
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not clear credentials."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="shadow-elevation-card-rest bg-ui-bg-base w-full rounded-lg p-0">
      <div className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Heading level="h2" className="font-sans font-medium h2-core">
            HitPay
          </Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Store the HitPay{" "}
            <strong className="font-medium">business API key</strong> and{" "}
            <strong className="font-medium">webhook salt</strong> as one AES
            blob in store metadata (
            <code className="txt-compact-xsmall font-mono">
              hitpay_credentials_enc_v1
            </code>
            ). The server needs{" "}
            <code className="txt-compact-xsmall font-mono">
              HITPAY_STORE_SECRET_ENCRYPTION_KEY
            </code>{" "}
            to encrypt or decrypt them. Checkout and webhooks read these values
            from this store when the payment session can be linked here.
            Optional fallback: set{" "}
            <code className="txt-compact-xsmall font-mono">HITPAY_*</code> env
            for the same trio if resolver cannot load metadata.
          </Text>
        </div>
      </div>

      <div className="flex h-full w-full flex-col gap-y-4 overflow-hidden border-t p-6">
        {loading ? (
          <Text size="small" className="text-ui-fg-muted">
            Loading…
          </Text>
        ) : (
          <>
            {!encryptionConfigured && (
              <Text size="small" className="text-ui-tag-orange-icon">
                Encryption key missing on the server — you can still edit
                sandbox and redirect URL; credential save is disabled until{" "}
                <code className="txt-compact-xsmall font-mono">
                  HITPAY_STORE_SECRET_ENCRYPTION_KEY
                </code>{" "}
                is configured.
              </Text>
            )}

            {ciphertextPresent && !encryptionConfigured ? (
              <Text size="small" className="text-ui-tag-orange-icon">
                Encrypted credential data exists but the server decryption key is
                missing — configure{" "}
                <code className="txt-compact-xsmall font-mono">
                  HITPAY_STORE_SECRET_ENCRYPTION_KEY
                </code>{" "}
                to unlock, or remove the blob via API if migrating keys.
              </Text>
            ) : null}

            <div className="flex flex-col gap-y-4">
              <div>
                <Text size="xsmall" weight="plus" className="text-ui-fg-base">
                  API key & webhook salt
                </Text>
                <Text
                  size="small"
                  className="text-ui-fg-muted mt-0.5"
                  id="hitpay-secret-section-desc"
                >
                  Values below are masked; after save they cannot be previewed.
                  Enter a{" "}
                  <span className="text-ui-fg-subtle font-medium">
                    new API key and new salt together
                  </span>{" "}
                  only when rotating.
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label
                    htmlFor="hitpay-api-key-input"
                    className="txt-compact-xsmall-plus text-ui-fg-subtle"
                  >
                    Business API key
                  </label>
                  {credentialsOnFile ? (
                    <Badge color="green" size="2xsmall">
                      Saved · encrypted with server key
                    </Badge>
                  ) : ciphertextPresent && !encryptionConfigured ? (
                    <Badge color="grey" size="2xsmall">
                      Encrypted blob present · unlocked when server key is set
                    </Badge>
                  ) : encryptionConfigured ? (
                    <Badge color="orange" size="2xsmall">
                      Not saved yet — enter both fields
                    </Badge>
                  ) : null}
                </div>
                {credentialsOnFile ? (
                  <Text
                    size="small"
                    className="text-ui-fg-muted"
                    id="hitpay-api-key-hint"
                  >
                    Current key fingerprint (last four): …
                    <span className="font-mono txt-compact-xsmall">
                      {snapshot?.api_key_last4 ?? "????"}
                    </span>
                    . Leave the field blank to keep this key.
                  </Text>
                ) : (
                  <Text
                    size="small"
                    className="text-ui-fg-muted"
                    id="hitpay-api-key-hint"
                  >
                    {ciphertextPresent && !encryptionConfigured
                      ? "Cannot show fingerprint until the server encryption key matches this credential bundle."
                      : "Paste the full HitPay business API key. Saving also requires the webhook salt in the field below."}
                  </Text>
                )}
                <Input
                  id="hitpay-api-key-input"
                  type="password"
                  autoComplete="off"
                  aria-describedby="hitpay-secret-section-desc hitpay-api-key-hint"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    !encryptionConfigured
                      ? ciphertextPresent
                        ? "Unavailable until server decryption key is set"
                        : "HitPay API key"
                      : credentialsOnFile
                        ? "Leave blank · or paste new key to rotate"
                        : "HitPay API key"
                  }
                  disabled={!encryptionConfigured}
                />
              </div>

              <div className="flex flex-col gap-y-2 border-t border-dashed border-ui-border-base pt-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label
                    htmlFor="hitpay-webhook-salt-input"
                    className="txt-compact-xsmall-plus text-ui-fg-subtle"
                  >
                    Webhook salt (HMAC)
                  </label>
                  {credentialsOnFile ? (
                    <Badge color="green" size="2xsmall">
                      Saved · same blob as API key
                    </Badge>
                  ) : ciphertextPresent && !encryptionConfigured ? (
                    <Badge color="grey" size="2xsmall">
                      Locked with ciphertext until server key is set
                    </Badge>
                  ) : encryptionConfigured ? (
                    <Badge color="orange" size="2xsmall">
                      Not saved yet — enter salt with key
                    </Badge>
                  ) : null}
                </div>
                <Text
                  size="small"
                  className="text-ui-fg-muted"
                  id="hitpay-salt-hint"
                >
                  {credentialsOnFile
                    ? "Webhook salt lives in that blob (never echoed back). Leave blank unless you rotate with a new key + matching new salt."
                    : ciphertextPresent && !encryptionConfigured
                      ? "Salt is inside the ciphertext; once the server key is configured, HitPay checkout can use stored credentials."
                      : "Webhook HMAC salt. Stored only encrypted next to your API key."}
                </Text>
                <Input
                  id="hitpay-webhook-salt-input"
                  type="password"
                  autoComplete="off"
                  aria-describedby="hitpay-secret-section-desc hitpay-salt-hint"
                  value={salt}
                  onChange={(e) => setSalt(e.target.value)}
                  placeholder={
                    !encryptionConfigured
                      ? ciphertextPresent
                        ? "Unavailable until server decryption key is set"
                        : "Webhook salt"
                      : credentialsOnFile
                        ? "Leave blank · or paste new salt to rotate"
                        : "Webhook salt"
                  }
                  disabled={!encryptionConfigured}
                />
              </div>
            </div>
            <div className="flex flex-col gap-y-2">
              <label className="txt-compact-xsmall-plus text-ui-fg-subtle">
                Redirect URL after checkout
              </label>
              <Input
                type="url"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://your-storefront.com/checkout/confirmed"
              />
            </div>

            <div className="flex items-center justify-between gap-x-4">
              <Text size="small" className="text-ui-fg-subtle">
                Sandbox API
              </Text>
              <Switch checked={sandbox} onCheckedChange={setSandbox} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="small"
                variant="secondary"
                isLoading={saving}
                onClick={() => void submit()}
              >
                Save
              </Button>
              <Button
                type="button"
                size="small"
                variant="transparent"
                isLoading={saving}
                disabled={!snapshot?.credentials_encrypted}
                onClick={() => void clearSecrets()}
              >
                Clear stored credentials
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "store.details.after",
})

export default HitPayStoreCredentialsWidget
