/**
 * Plain-text notification bodies are stored in `html_body` and converted to HTML at send time.
 * Rows that still contain full HTML (from before this change) are detected and compiled as HTML.
 */

const LEGACY_HTML_START = /^(?:\s*<)(?:\s*!DOCTYPE|\s*html|\s*head|\s*body|\s*table|\s*div|\s*p[\s>\/]|\s*h[1-6])/i

export function isLegacyHtmlBody(body: string): boolean {
  const t = body.trimStart()
  if (!t.startsWith("<")) return false
  return LEGACY_HTML_START.test(t)
}

/**
 * After Handlebars runs on a plain-text template, `{{var}}` output is already HTML-escaped.
 * Split paragraphs on blank lines; single newlines become `<br>`.
 */
export function plainTextAfterHandlebarsToEmailHtml(body: string): string {
  const paragraphs = body.split(/\n\n+/)
  const blocks = paragraphs.map((p) => {
    const withBreaks = p.split("\n").join("<br />\n")
    return `<p style="margin: 0 0 1em 0;">${withBreaks}</p>`
  })
  const inner = blocks.join("\n")
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; line-height: 1.55; color: #111;">
${inner}
</body>
</html>`
}

function formatShippingAddress(addr: Record<string, unknown>): string {
  const lines: string[] = []
  const a1 = addr.address_1
  if (typeof a1 === "string" && a1.trim()) lines.push(a1.trim())
  const a2 = addr.address_2
  if (typeof a2 === "string" && a2.trim()) lines.push(a2.trim())
  const city = addr.city
  const province = addr.province
  const postal = addr.postal_code
  const cityLine = [city, province, postal]
    .filter((x) => typeof x === "string" && x.trim())
    .join(", ")
  if (cityLine) lines.push(cityLine)
  const country = addr.country_code
  if (typeof country === "string" && country.trim()) lines.push(country.trim().toUpperCase())
  return lines.join("\n")
}

/**
 * Adds simple `{{customer_name}}`-style aliases alongside existing `order`, `shippingAddress`, etc.
 */
export function augmentNotificationTemplateData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  const order = data.order as Record<string, unknown> | undefined
  const shippingAddress = data.shippingAddress as Record<string, unknown> | undefined
  const emailOptions = (data.emailOptions ?? {}) as Record<string, unknown>

  const storeName =
    process.env.STORE_NAME?.trim() ||
    process.env.MEDUSA_STORE_NAME?.trim() ||
    "Store"

  const reply = emailOptions.replyTo
  const supportEmail =
    process.env.STORE_SUPPORT_EMAIL?.trim() ||
    (typeof reply === "string" && reply.trim()) ||
    "info@example.com"

  out.store_name = storeName
  out.support_email = supportEmail

  if (typeof data.inviteLink === "string") {
    out.invite_link = data.inviteLink
  }

  const payUrl =
    typeof data.pay_url === "string"
      ? data.pay_url.trim()
      : typeof data.payUrl === "string"
        ? data.payUrl.trim()
        : ""
  if (payUrl) {
    out.pay_url = payUrl
  }

  const pcId =
    typeof data.payment_collection_id === "string"
      ? data.payment_collection_id.trim()
      : ""
  if (pcId) {
    out.payment_collection_id = pcId
  }

  if (order) {
    const fn =
      typeof shippingAddress?.first_name === "string"
        ? shippingAddress.first_name.trim()
        : ""
    const ln =
      typeof shippingAddress?.last_name === "string"
        ? shippingAddress.last_name.trim()
        : ""
    const fromName = [fn, ln].filter(Boolean).join(" ")
    const email =
      typeof order.email === "string" ? order.email.trim() : ""
    out.customer_name = fromName || email || "there"
    out.customer_email = email
    out.order_id = String(order.display_id ?? order.id ?? "")
    out.currency = String(order.currency_code ?? "").toUpperCase()

    const summary = order.summary as Record<string, unknown> | undefined
    const rawTotal = summary?.raw_current_order_total as Record<string, unknown> | undefined
    const val = rawTotal?.value
    out.total = val != null && val !== "" ? String(val) : ""

    const items = order.items as unknown[] | undefined
    out.items_count = items?.length ?? 0
    out.tracking_number = ""

    if (shippingAddress && typeof shippingAddress === "object") {
      out.shipping_address = formatShippingAddress(shippingAddress)
    } else {
      out.shipping_address = ""
    }

    const baseUrl =
      process.env.BACKEND_PUBLIC_URL?.trim() ||
      process.env.RAILWAY_PUBLIC_DOMAIN_VALUE?.trim() ||
      ""
    const orderId = typeof order.id === "string" ? order.id : ""
    if (baseUrl && orderId) {
      const origin = baseUrl.replace(/\/$/, "")
      out.admin_order_url = `${origin}/app/orders/${orderId}`
    } else {
      out.admin_order_url = ""
    }
  }

  return out
}
