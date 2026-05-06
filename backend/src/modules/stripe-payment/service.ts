import type { MedusaContainer } from "@medusajs/framework/types"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  resolveStripeConfigFromSessionId,
} from "../../lib/stripe-resolve-runtime-config"
import { STRIPE_STORE_SECRET_ENCRYPTION_KEY_BUFFER } from "../../lib/constants"

export type StripePaymentOptions = {
  apiKey?: string
  webhookSecret?: string
  capture?: boolean
  automaticPaymentMethods?: boolean
  paymentDescription?: string
}

// Loaded via require so the stripe package resolves relative to @medusajs/payment-stripe's node_modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const StripeDelegateCtor: new (container: any, options: any) => any =
  require("@medusajs/payment-stripe/dist/services/stripe-provider").default

export default class StripePaymentProviderService extends AbstractPaymentProvider<StripePaymentOptions> {
  static identifier = "stripe"

  static validateOptions(options: Record<string, unknown>): void {
    const hasStaticKey = !!(options?.apiKey)
    const hasEncKey = !!STRIPE_STORE_SECRET_ENCRYPTION_KEY_BUFFER
    if (!hasStaticKey && !hasEncKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Stripe: set STRIPE_STORE_SECRET_ENCRYPTION_KEY (store metadata credentials) or apiKey in provider options (legacy env mode).",
      )
    }
  }

  protected options_: StripePaymentOptions

  constructor(container: Record<string, unknown>, options: StripePaymentOptions) {
    super(container, options)
    this.options_ = options
  }

  private extractSessionId(data?: Record<string, unknown> | null): string | undefined {
    if (!data) return undefined
    // Direct session_id set by MedusaJS on initiatePayment
    if (typeof data.session_id === "string" && data.session_id.trim()) {
      return data.session_id.trim()
    }
    // Nested in PaymentIntent metadata for authorize/capture/refund/etc.
    const meta = data.metadata as Record<string, unknown> | undefined
    if (typeof meta?.session_id === "string" && meta.session_id.trim()) {
      return meta.session_id.trim()
    }
    return undefined
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async resolveDelegate(data?: Record<string, unknown> | null): Promise<any> {
    const sid = this.extractSessionId(data)
    const fromMeta =
      sid != null
        ? await resolveStripeConfigFromSessionId(
            this.container as MedusaContainer,
            sid
          )
        : null

    const secretKey = (fromMeta?.secretKey ?? this.options_.apiKey ?? "").trim()
    const webhookSecret = (fromMeta?.webhookSecret ?? this.options_.webhookSecret ?? "").trim()

    if (!secretKey) {
      const hint = sid == null
        ? "session_id not found in payment data — data keys: " +
          (data ? Object.keys(data).join(", ") || "(empty)" : "null")
        : `store credentials not resolved for session_id=${sid} — check STRIPE_STORE_SECRET_ENCRYPTION_KEY is set and credentials were saved via admin UI`
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Stripe: no API key available (${hint}).`,
      )
    }

    return new StripeDelegateCtor(this.container as Record<string, unknown>, {
      apiKey: secretKey,
      webhookSecret: webhookSecret || "whsec_unconfigured",
      capture: this.options_.capture,
      automaticPaymentMethods: this.options_.automaticPaymentMethods,
      paymentDescription: this.options_.paymentDescription,
    })
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.initiatePayment(input)
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.authorizePayment(input)
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.capturePayment(input)
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.cancelPayment(input)
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.deletePayment(input)
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.getPaymentStatus(input)
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.refundPayment(input)
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.retrievePayment(input)
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const delegate = await this.resolveDelegate(input.data ?? undefined)
    return delegate.updatePayment(input)
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    // Parse the raw body to extract session_id from PaymentIntent metadata so we
    // can look up the store's webhook secret before verifying the signature.
    // This mirrors HitPay's approach of reading reference_number from the body
    // to find the salt before verifying.
    const raw = payload.rawData
    let sessionId: string | undefined
    try {
      const bodyStr =
        typeof raw === "string"
          ? raw
          : Buffer.isBuffer(raw)
            ? raw.toString("utf8")
            : ""
      const event = JSON.parse(bodyStr) as Record<string, unknown>
      const intent = (event?.data as Record<string, unknown> | undefined)
        ?.object as Record<string, unknown> | undefined
      const meta = intent?.metadata as Record<string, unknown> | undefined
      if (typeof meta?.session_id === "string") {
        sessionId = meta.session_id
      }
    } catch { /* delegate will verify signature and surface the real error */ }

    const delegate = await this.resolveDelegate(
      sessionId ? { session_id: sessionId } : null
    )
    return delegate.getWebhookActionAndData(payload)
  }
}
