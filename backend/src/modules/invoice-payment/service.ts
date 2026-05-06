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
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
} from "@medusajs/framework/types"
import { AbstractPaymentProvider, PaymentSessionStatus } from "@medusajs/framework/utils"

export type InvoicePaymentOptions = Record<string, never>

/**
 * Manual / invoice-later payment provider.
 *
 * This provider intentionally does not create any external payment intent.
 * It exists solely to satisfy Medusa's requirement that a cart must have a
 * payment session in order to be completed into an order.
 */
export default class InvoicePaymentProviderService extends AbstractPaymentProvider<InvoicePaymentOptions> {
  static identifier = "invoice"

  static validateOptions(): void {
    // No required options.
  }

  protected options_: InvoicePaymentOptions

  constructor(container: Record<string, unknown>, options: InvoicePaymentOptions) {
    super(container, options)
    this.options_ = options
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentOutput> {
    const sessionId = input.data?.session_id as string | undefined
    return {
      id: sessionId ?? `invoice_${crypto.randomUUID().replace(/-/g, "")}`,
      status: PaymentSessionStatus.PENDING,
      data: {
        ...(input.data ?? {}),
        provider: "invoice",
      },
    }
  }

  async authorizePayment(input: AuthorizePaymentInput): Promise<AuthorizePaymentOutput> {
    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: {
        ...(input.data ?? {}),
        authorized_at: new Date().toISOString(),
      },
    }
  }

  async capturePayment(input: CapturePaymentInput): Promise<CapturePaymentOutput> {
    // Capture is a no-op: invoice payments are collected offline.
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async getPaymentStatus(input: GetPaymentStatusInput): Promise<GetPaymentStatusOutput> {
    // Consider invoice sessions authorized once created; collection happens later.
    return {
      status: PaymentSessionStatus.AUTHORIZED,
      data: (input.data ?? {}) as Record<string, unknown>,
    }
  }

  async refundPayment(_input: RefundPaymentInput): Promise<RefundPaymentOutput> {
    // Offline refunds are handled by staff, not via provider.
    return { data: {} }
  }

  async retrievePayment(input: RetrievePaymentInput): Promise<RetrievePaymentOutput> {
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    return { data: (input.data ?? {}) as Record<string, unknown> }
  }
}

