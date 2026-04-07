import { createHmac, timingSafeEqual } from "crypto"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  BigNumberInput,
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
  BigNumber,
  MedusaError,
  PaymentActions,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
])

export type HitPayOptions = {
  apiKey: string
  salt: string
  sandbox?: boolean
  redirectUrl: string
  /** Optional HitPay payment method codes (e.g. paynow_online, card) */
  paymentMethods?: string[]
}

type HitPayPaymentRequestResponse = {
  id: string
  url?: string
  status?: string
  amount?: string
  currency?: string
  reference_number?: string
  payments?: Array<{
    id: string
    status?: string
    amount?: string
    currency?: string
  }>
}

function formatMajorAmountForHitPay(amount: BigNumberInput, currencyCode: string): string {
  const currency = currencyCode.toUpperCase()
  const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2
  const n = new BigNumber(amount).numeric
  return Number(n).toFixed(decimals)
}

function parseAmountString(value: string | number | undefined): BigNumber {
  if (value === undefined || value === null) {
    return new BigNumber(0)
  }
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""))
  if (Number.isNaN(n)) {
    return new BigNumber(0)
  }
  return new BigNumber(n)
}

function verifyHitPaySignature(rawBody: Buffer | string, signatureHeader: unknown, salt: string): boolean {
  if (signatureHeader == null || !salt) {
    return false
  }
  const signature = Array.isArray(signatureHeader) ? String(signatureHeader[0]) : String(signatureHeader)
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8")
  const computed = createHmac("sha256", salt).update(payload).digest("hex")
  try {
    const a = Buffer.from(computed, "utf8")
    const b = Buffer.from(signature, "utf8")
    if (a.length !== b.length) {
      return false
    }
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function mapRequestStatusToSession(
  pr: HitPayPaymentRequestResponse
): { status: PaymentSessionStatus; hitpayPaymentId?: string; data: Record<string, unknown> } {
  const status = (pr.status ?? "pending").toLowerCase()
  const succeededPayment = pr.payments?.find((p) => (p.status ?? "").toLowerCase() === "succeeded")
  const hitpayPaymentId = succeededPayment?.id

  const baseData: Record<string, unknown> = {
    id: pr.id,
    status: pr.status,
    amount: pr.amount,
    currency: pr.currency,
    reference_number: pr.reference_number,
    url: pr.url,
    ...(hitpayPaymentId ? { hitpay_payment_id: hitpayPaymentId } : {}),
  }

  if (status === "completed" && hitpayPaymentId) {
    return { status: PaymentSessionStatus.CAPTURED, hitpayPaymentId, data: baseData }
  }
  if (status === "failed" || status === "canceled" || status === "cancelled") {
    return { status: PaymentSessionStatus.CANCELED, data: baseData }
  }
  if (status === "expired" || status === "inactive") {
    return { status: PaymentSessionStatus.CANCELED, data: baseData }
  }
  return { status: PaymentSessionStatus.PENDING, data: baseData }
}

export default class HitPayPaymentProviderService extends AbstractPaymentProvider<HitPayOptions> {
  static identifier = "hitpay"

  static validateOptions(options: Record<string, unknown>): void {
    if (!options?.apiKey) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "HitPay: apiKey is required in the provider options.")
    }
    if (!options?.salt) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "HitPay: salt is required for webhook verification.")
    }
    if (!options?.redirectUrl) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "HitPay: redirectUrl is required (customer return URL after checkout).",
      )
    }
  }

  protected options_: HitPayOptions

  constructor(container: Record<string, unknown>, options: HitPayOptions) {
    super(container, options)
    this.options_ = options
  }

  protected get baseUrl(): string {
    return this.options_.sandbox ? "https://api.sandbox.hit-pay.com" : "https://api.hit-pay.com"
  }

  protected buildError(message: string, error: unknown): Error {
    const err = error instanceof Error ? error : new Error(String(error))
    return new Error(`${message}: ${err.message}`)
  }

  protected async hitpayFetch<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, init)
    const text = await res.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw this.buildError(`HitPay invalid JSON response (${res.status})`, new Error(text.slice(0, 200)))
    }
    if (!res.ok) {
      const msg =
        typeof json === "object" && json !== null && "message" in json
          ? String((json as { message: string }).message)
          : text.slice(0, 200)
      throw this.buildError(`HitPay API error ${res.status}`, new Error(msg))
    }
    return json as T
  }

  protected async createPaymentRequest(body: URLSearchParams): Promise<HitPayPaymentRequestResponse> {
    return this.hitpayFetch<HitPayPaymentRequestResponse>("/v1/payment-requests", {
      method: "POST",
      headers: {
        "X-BUSINESS-API-KEY": this.options_.apiKey,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
    })
  }

  protected async getPaymentRequest(requestId: string): Promise<HitPayPaymentRequestResponse> {
    return this.hitpayFetch<HitPayPaymentRequestResponse>(`/v1/payment-requests/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers: {
        "X-BUSINESS-API-KEY": this.options_.apiKey,
      },
    })
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = input.data?.session_id as string | undefined
    if (!sessionId) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "HitPay: missing payment session id in initiatePayment data.")
    }

    const currency = input.currency_code.toUpperCase()
    const amountStr = formatMajorAmountForHitPay(input.amount, currency)

    const params = new URLSearchParams()
    params.set("amount", amountStr)
    params.set("currency", currency)
    params.set("reference_number", sessionId)
    params.set("redirect_url", this.options_.redirectUrl)

    const customer = input.context?.customer
    if (customer?.email) {
      params.set("email", customer.email)
    }
    const name =
      customer?.first_name || customer?.last_name
        ? [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim()
        : customer?.company_name
    if (name) {
      params.set("name", name)
    }
    if (customer?.phone) {
      params.set("phone", customer.phone)
    }

    const methods = this.options_.paymentMethods
    if (methods?.length) {
      for (const m of methods) {
        params.append("payment_methods[]", m)
      }
    }

    const pr = await this.createPaymentRequest(params)

    if (!pr.url) {
      throw this.buildError("HitPay: payment request created without checkout url", new Error(JSON.stringify(pr)))
    }

    return {
      id: pr.id,
      status: PaymentSessionStatus.PENDING,
      data: {
        id: pr.id,
        url: pr.url,
        status: pr.status ?? "pending",
        reference_number: sessionId,
      },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    const id = input.data?.id as string | undefined
    if (!id) {
      throw this.buildError("HitPay authorizePayment: missing payment request id", new Error("no id in session data"))
    }
    const pr = await this.getPaymentRequest(id)
    const mapped = mapRequestStatusToSession(pr)
    return {
      status: mapped.status,
      data: mapped.data,
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    const id = input.data?.id as string | undefined
    if (!id) {
      return { data: input.data as Record<string, unknown> }
    }
    const pr = await this.getPaymentRequest(id)
    const mapped = mapRequestStatusToSession(pr)
    if (mapped.status !== PaymentSessionStatus.CAPTURED) {
      return { data: { ...(input.data as Record<string, unknown>), ...mapped.data } }
    }
    return { data: { ...(input.data as Record<string, unknown>), ...mapped.data } }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    const id = input.data?.id as string | undefined
    if (!id) {
      throw this.buildError("HitPay getPaymentStatus: missing payment request id", new Error("no id"))
    }
    const pr = await this.getPaymentRequest(id)
    const mapped = mapRequestStatusToSession(pr)
    return {
      status: mapped.status,
      data: mapped.data,
    }
  }

  async refundPayment(input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    const paymentId =
      (input.data?.hitpay_payment_id as string | undefined) ||
      (input.data?.payment_id as string | undefined)
    if (!paymentId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "HitPay refund: missing hitpay_payment_id on payment data (complete a payment first).",
      )
    }
    const amountNum = new BigNumber(input.amount).numeric
    await this.hitpayFetch("/v1/refund", {
      method: "POST",
      headers: {
        "X-BUSINESS-API-KEY": this.options_.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        payment_id: paymentId,
        amount: Number(amountNum),
      }),
    })
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    const id = input.data?.id as string | undefined
    if (!id) {
      throw this.buildError("HitPay retrievePayment: missing id", new Error("no id"))
    }
    const pr = await this.getPaymentRequest(id)
    return { data: pr as unknown as Record<string, unknown> }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    const id = input.data?.id as string | undefined
    if (!id) {
      throw this.buildError("HitPay updatePayment: missing id", new Error("no id"))
    }
    const pr = await this.getPaymentRequest(id)
    const currentAmount = pr.amount != null ? parseAmountString(pr.amount).numeric : null
    const nextAmount = new BigNumber(input.amount).numeric
    const sameMajor =
      currentAmount !== null && Math.abs(Number(currentAmount) - Number(nextAmount)) < 1e-9
    const sameCurrency = (pr.currency ?? "").toLowerCase() === input.currency_code.toLowerCase()
    if (sameMajor && sameCurrency) {
      const mapped = mapRequestStatusToSession(pr)
      return { status: mapped.status, data: mapped.data }
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "HitPay does not support changing amount or currency on an existing payment request. Remove and re-select the payment method.",
    )
  }

  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"],
  ): Promise<WebhookActionResult> {
    const signature = payload.headers["hitpay-signature"] ?? payload.headers["Hitpay-Signature"]
    const raw = payload.rawData
    if (raw == null) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "HitPay webhook: missing raw body for signature verification.")
    }
    if (!verifyHitPaySignature(raw, signature, this.options_.salt)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "HitPay webhook: invalid signature.")
    }

    const body = payload.data as Record<string, unknown>
    const eventObject = String(
      payload.headers["hitpay-event-object"] ?? payload.headers["Hitpay-Event-Object"] ?? "",
    ).toLowerCase()
    const eventType = String(payload.headers["hitpay-event-type"] ?? payload.headers["Hitpay-Event-Type"] ?? "").toLowerCase()

    if (eventObject === "payment_request") {
      const referenceNumber = body.reference_number != null ? String(body.reference_number) : ""
      const status = String(body.status ?? "").toLowerCase()
      const payments = (body.payments as HitPayPaymentRequestResponse["payments"]) ?? []
      const hasSucceeded = payments.some((p) => (p.status ?? "").toLowerCase() === "succeeded")

      const isCompleted = eventType === "completed" || status === "completed"
      const paymentsOk = payments.length === 0 || hasSucceeded
      if (isCompleted && paymentsOk && referenceNumber) {
        const amountBn = parseAmountString(body.amount as string | number | undefined)
        return {
          action: PaymentActions.SUCCESSFUL,
          data: {
            session_id: referenceNumber,
            amount: amountBn,
          },
        }
      }

      if (eventType === "failed" || status === "failed") {
        return {
          action: PaymentActions.FAILED,
          data: {
            session_id: referenceNumber || "",
            amount: parseAmountString(body.amount as string | number | undefined),
          },
        }
      }
    }

    return { action: PaymentActions.NOT_SUPPORTED }
  }
}
