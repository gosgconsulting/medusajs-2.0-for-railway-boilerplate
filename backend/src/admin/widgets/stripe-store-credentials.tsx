import React, { useEffect, useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { sdk } from "../lib/sdk"
import type { StripeEnvMetadataSnapshot } from "lib/stripe-metadata-shared"

type StoreWidgetData = {
  id?: string
}

type StripeCredentialsGetResponse = {
  encryptionConfigured: boolean
  snapshot: StripeEnvMetadataSnapshot | null
}

const StripeStoreCredentialsWidget = ({ data }: { data: StoreWidgetData }) => {
  const storeId = data?.id
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [encryptionConfigured, setEncryptionConfigured] = useState(false)
  const [snapshot, setSnapshot] = useState<StripeEnvMetadataSnapshot | null>(
    null
  )

  const [secretKey, setSecretKey] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")

  const load = async () => {
    if (!storeId) return
    setLoading(true)
    try {
      const res = await sdk.client.fetch<StripeCredentialsGetResponse>(
        `/admin/stores/${storeId}/stripe-credentials`,
        { method: "GET" }
      )
      setEncryptionConfigured(res.encryptionConfigured)
      setSnapshot(res.snapshot)
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not load Stripe settings."
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

  const credentialsOnFile =
    encryptionConfigured && ciphertextPresent

  const submit = async () => {
    const sk = secretKey.trim()
    const wh = webhookSecret.trim()
    if ((sk && !wh) || (!sk && wh)) {
      toast.error(
        "Secret key and webhook signing secret must both be filled to update credentials."
      )
      return
    }
    if ((sk || wh) && !encryptionConfigured) {
      toast.error(
        "Server encryption key is not set (STRIPE_STORE_SECRET_ENCRYPTION_KEY)."
      )
      return
    }

    setSaving(true)
    try {
      const res = await sdk.client.fetch<StripeCredentialsGetResponse>(
        `/admin/stores/${storeId}/stripe-credentials`,
        {
          method: "POST",
          body: {
            ...(sk && wh ? { secretKey: sk, webhookSecret: wh } : {}),
          },
        }
      )
      setSnapshot(res.snapshot)
      setEncryptionConfigured(res.encryptionConfigured)
      setSecretKey("")
      setWebhookSecret("")
      toast.success("Stripe settings saved.")
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not save Stripe settings."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  const clearSecrets = async () => {
    setSaving(true)
    try {
      const res = await sdk.client.fetch<StripeCredentialsGetResponse>(
        `/admin/stores/${storeId}/stripe-credentials`,
        {
          method: "POST",
          body: { clearSecrets: true },
        }
      )
      setSnapshot(res.snapshot)
      setSecretKey("")
      setWebhookSecret("")
      toast.success("Stored Stripe credentials removed.")
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
            Stripe
          </Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Store the Stripe{" "}
            <strong className="font-medium">secret API key</strong> and{" "}
            <strong className="font-medium">webhook signing secret</strong> as
            one AES blob in store metadata (
            <code className="txt-compact-xsmall font-mono">
              stripe_credentials_enc_v1
            </code>
            ). The server needs{" "}
            <code className="txt-compact-xsmall font-mono">
              STRIPE_STORE_SECRET_ENCRYPTION_KEY
            </code>{" "}
            to encrypt or decrypt them. Checkout and webhooks can read these
            values from this store when the payment session can be linked here.
            Optional fallback: set{" "}
            <code className="txt-compact-xsmall font-mono">STRIPE_API_KEY</code>{" "}
            and{" "}
            <code className="txt-compact-xsmall font-mono">
              STRIPE_WEBHOOK_SECRET
            </code>{" "}
            in env if resolver cannot load metadata.
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
                Encryption key missing on the server — credential save is
                disabled until{" "}
                <code className="txt-compact-xsmall font-mono">
                  STRIPE_STORE_SECRET_ENCRYPTION_KEY
                </code>{" "}
                is configured.
              </Text>
            )}

            {ciphertextPresent && !encryptionConfigured ? (
              <Text size="small" className="text-ui-tag-orange-icon">
                Encrypted credential data exists but the server decryption key is
                missing — configure{" "}
                <code className="txt-compact-xsmall font-mono">
                  STRIPE_STORE_SECRET_ENCRYPTION_KEY
                </code>{" "}
                to unlock, or remove the blob via API if migrating keys.
              </Text>
            ) : null}

            <div className="flex flex-col gap-y-4">
              <div>
                <Text size="xsmall" weight="plus" className="text-ui-fg-base">
                  Secret key & webhook signing secret
                </Text>
                <Text
                  size="small"
                  className="text-ui-fg-muted mt-0.5"
                  id="stripe-secret-section-desc"
                >
                  Values below are masked; after save they cannot be previewed.
                  Enter a{" "}
                  <span className="text-ui-fg-subtle font-medium">
                    new secret key and new webhook signing secret together
                  </span>{" "}
                  only when rotating.
                </Text>
              </div>

              <div className="flex flex-col gap-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label
                    htmlFor="stripe-secret-key-input"
                    className="txt-compact-xsmall-plus text-ui-fg-subtle"
                  >
                    Secret API key
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
                    id="stripe-secret-key-hint"
                  >
                    Current key fingerprint (last four): …
                    <span className="font-mono txt-compact-xsmall">
                      {snapshot?.secret_key_last4 ?? "????"}
                    </span>
                    . Leave the field blank to keep this key.
                  </Text>
                ) : (
                  <Text
                    size="small"
                    className="text-ui-fg-muted"
                    id="stripe-secret-key-hint"
                  >
                    {ciphertextPresent && !encryptionConfigured
                      ? "Cannot show fingerprint until the server encryption key matches this credential bundle."
                      : "Paste the full Stripe secret key (sk_live_… or sk_test_…). Saving also requires the webhook signing secret below."}
                  </Text>
                )}
                <Input
                  id="stripe-secret-key-input"
                  type="password"
                  autoComplete="off"
                  aria-describedby="stripe-secret-section-desc stripe-secret-key-hint"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder={
                    !encryptionConfigured
                      ? ciphertextPresent
                        ? "Unavailable until server decryption key is set"
                        : "Stripe secret API key"
                      : credentialsOnFile
                        ? "Leave blank · or paste new key to rotate"
                        : "Stripe secret API key"
                  }
                  disabled={!encryptionConfigured}
                />
              </div>

              <div className="flex flex-col gap-y-2 border-t border-dashed border-ui-border-base pt-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <label
                    htmlFor="stripe-webhook-secret-input"
                    className="txt-compact-xsmall-plus text-ui-fg-subtle"
                  >
                    Webhook signing secret
                  </label>
                  {credentialsOnFile ? (
                    <Badge color="green" size="2xsmall">
                      Saved · same blob as secret key
                    </Badge>
                  ) : ciphertextPresent && !encryptionConfigured ? (
                    <Badge color="grey" size="2xsmall">
                      Locked with ciphertext until server key is set
                    </Badge>
                  ) : encryptionConfigured ? (
                    <Badge color="orange" size="2xsmall">
                      Not saved yet — enter secret with key
                    </Badge>
                  ) : null}
                </div>
                <Text
                  size="small"
                  className="text-ui-fg-muted"
                  id="stripe-webhook-hint"
                >
                  {credentialsOnFile
                    ? "Webhook signing secret lives in that blob (never echoed back). Leave blank unless you rotate with a new key + matching new whsec."
                    : ciphertextPresent && !encryptionConfigured
                      ? "Secret is inside the ciphertext; once the server key is configured, integrations can use stored credentials."
                      : "From Stripe Dashboard → Webhooks → signing secret (whsec_…). Stored only encrypted next to your secret key."}
                </Text>
                <Input
                  id="stripe-webhook-secret-input"
                  type="password"
                  autoComplete="off"
                  aria-describedby="stripe-secret-section-desc stripe-webhook-hint"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={
                    !encryptionConfigured
                      ? ciphertextPresent
                        ? "Unavailable until server decryption key is set"
                        : "Webhook signing secret"
                      : credentialsOnFile
                        ? "Leave blank · or paste new whsec to rotate"
                        : "Webhook signing secret"
                  }
                  disabled={!encryptionConfigured}
                />
              </div>
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

export default StripeStoreCredentialsWidget
