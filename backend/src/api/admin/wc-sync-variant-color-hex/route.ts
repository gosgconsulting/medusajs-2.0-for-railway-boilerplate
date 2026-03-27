import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  WC_API_URL,
  WC_CONSUMER_KEY,
  WC_CONSUMER_SECRET,
} from "../../../lib/constants"

type SyncBody = {
  wcProductId?: number
  baseUrl?: string
  consumerKey?: string
  consumerSecret?: string
}

type WcAttribute = {
  name?: string
  slug?: string
  variation?: boolean
  options?: string[]
  option_colors?: string[]
  options_with_colors?: { name?: string; hex?: string }[]
}

type WcVariation = {
  id?: number
  parent_id?: number
  attributes?: { id?: number; name?: string; option?: string }[]
}

type WcProduct = {
  id?: number
  type?: string
  attributes?: WcAttribute[]
  variations?: (number | WcVariation)[]
}

function wcCredentialsFromEnv(): boolean {
  return Boolean(WC_API_URL && WC_CONSUMER_KEY && WC_CONSUMER_SECRET)
}

function normalizeBaseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "")
  if (!u.startsWith("http://") && !u.startsWith("https://")) {
    return `https://${u}`
  }
  return u
}

function wcAuthHeader(consumerKey: string, consumerSecret: string): string {
  const raw = `${consumerKey}:${consumerSecret}`
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`
}

async function wcFetchJson<T>(
  apiRoot: string,
  path: string,
  authHeader: string
): Promise<T> {
  const url = `${apiRoot}${path.startsWith("/") ? path : `/${path}`}`
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `WooCommerce request failed (${res.status}): ${text.slice(0, 800)}`
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error("WooCommerce returned non-JSON response")
  }
}

async function fetchWcProductOrVariationById(
  apiRoot: string,
  authHeader: string,
  wcNumericId: number
): Promise<WcVariation | null> {
  try {
    const path = `/wp-json/wc/v3/products/${wcNumericId}`
    const row = await wcFetchJson<WcVariation>(apiRoot, path, authHeader)
    return row?.id != null ? row : null
  } catch {
    return null
  }
}

async function fetchWcVariations(
  apiRoot: string,
  authHeader: string,
  productId: number
): Promise<WcVariation[]> {
  const path = `/wp-json/wc/v3/products/${productId}/variations?per_page=100`
  const batch = await wcFetchJson<WcVariation[]>(apiRoot, path, authHeader)
  return Array.isArray(batch) ? batch : []
}

async function resolveWcVariableVariations(
  wc: WcProduct,
  apiRoot: string,
  authHeader: string
): Promise<WcVariation[]> {
  const wcId = wc.id
  if (wcId == null) return []
  const raw = wc.variations ?? []
  const numericIds = raw.filter((x): x is number => typeof x === "number")
  if (numericIds.length > 0) {
    const out: WcVariation[] = []
    for (const vid of numericIds) {
      const v = await fetchWcProductOrVariationById(apiRoot, authHeader, vid)
      if (v) out.push(v)
    }
    if (out.length > 0) return out
  }
  const embedded = raw.filter(
    (x): x is WcVariation => typeof x === "object" && x != null && "id" in x
  )
  if (embedded.length > 0) return embedded
  return fetchWcVariations(apiRoot, authHeader, wcId)
}

/**
 * Map variation option labels (e.g. "Beige") to hex from parent variable product
 * attributes (`options_with_colors` or parallel `options` / `option_colors`).
 */
function buildColorHexLookup(
  attributes: WcAttribute[] | undefined
): Map<string, string> {
  const m = new Map<string, string>()
  if (!attributes?.length) return m
  for (const a of attributes) {
    for (const row of a.options_with_colors ?? []) {
      const n = row.name?.trim()
      const h = row.hex?.trim()
      if (n && h) m.set(n.toLowerCase(), h)
    }
    const opts = a.options ?? []
    const colors = a.option_colors ?? []
    if (opts.length > 0 && opts.length === colors.length) {
      for (let i = 0; i < opts.length; i++) {
        const n = String(opts[i] ?? "").trim()
        const h = String(colors[i] ?? "").trim()
        if (n && h) m.set(n.toLowerCase(), h)
      }
    }
  }
  return m
}

function colorHexForVariation(
  v: WcVariation,
  lookup: Map<string, string>
): string | null {
  for (const attr of v.attributes ?? []) {
    const opt = attr.option?.trim()
    if (!opt) continue
    const hex = lookup.get(opt.toLowerCase())
    if (hex) return hex
  }
  return null
}

async function findMedusaProductByWcId(
  container: MedusaRequest["scope"],
  wcId: number
): Promise<{ id: string } | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: {
        metadata: {
          wc_product_id: String(wcId),
        },
      },
    })
    const row = data?.[0] as { id?: string } | undefined
    if (row?.id) return { id: row.id }
  } catch {
    /* no match */
  }
  return null
}

export async function GET(
  _req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  res.status(200).json({
    wcEnvConfigured: wcCredentialsFromEnv(),
    usage:
      'POST JSON { "wcProductId": 14377 } (optional; defaults to 14377 for testing). Uses WC_* env or body baseUrl/consumerKey/consumerSecret.',
  })
}

export async function POST(
  req: MedusaRequest<SyncBody>,
  res: MedusaResponse
): Promise<void> {
  const body = req.body ?? {}

  const useEnv = wcCredentialsFromEnv()
  const baseUrlRaw = useEnv
    ? WC_API_URL!
    : (body.baseUrl?.trim() || "")
  const consumerKeyRaw = useEnv
    ? WC_CONSUMER_KEY!
    : (body.consumerKey?.trim() || "")
  const consumerSecretRaw = useEnv
    ? WC_CONSUMER_SECRET!
    : (body.consumerSecret?.trim() || "")

  if (!baseUrlRaw || !consumerKeyRaw || !consumerSecretRaw) {
    res.status(400).json({
      message: useEnv
        ? "WC_API_URL, WC_CONSUMER_KEY, and WC_CONSUMER_SECRET must be set."
        : "Missing baseUrl, consumerKey, or consumerSecret.",
    })
    return
  }

  const wcProductId = body.wcProductId ?? 14377
  const apiRoot = normalizeBaseUrl(baseUrlRaw)
  const authHeader = wcAuthHeader(consumerKeyRaw, consumerSecretRaw)

  let parent: WcProduct
  try {
    parent = await wcFetchJson<WcProduct>(
      apiRoot,
      `/wp-json/wc/v3/products/${wcProductId}`,
      authHeader
    )
  } catch (e: any) {
    res.status(502).json({
      message: e?.message ?? "Failed to fetch WooCommerce product",
    })
    return
  }

  if (parent.type !== "variable") {
    res.status(400).json({
      message: `WooCommerce product ${wcProductId} is not variable (type=${parent.type ?? "unknown"}).`,
    })
    return
  }

  const lookup = buildColorHexLookup(parent.attributes)
  if (lookup.size === 0) {
    res.status(400).json({
      message:
        "No color data on parent product attributes (expected options_with_colors or option_colors aligned with options).",
    })
    return
  }

  let variations: WcVariation[]
  try {
    variations = await resolveWcVariableVariations(parent, apiRoot, authHeader)
  } catch (e: any) {
    res.status(502).json({
      message: e?.message ?? "Failed to fetch WooCommerce variations",
    })
    return
  }

  const hexByWcVariationId = new Map<string, string>()
  const wcSkipped: { wcVariationId: number; reason: string }[] = []
  for (const v of variations) {
    const vid = v.id
    if (vid == null) continue
    const hex = colorHexForVariation(v, lookup)
    if (!hex) {
      wcSkipped.push({
        wcVariationId: vid,
        reason: "No variation attribute option matched parent color map",
      })
      continue
    }
    hexByWcVariationId.set(String(vid), hex)
  }

  const container = req.scope
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const existing = await findMedusaProductByWcId(container, wcProductId)
  if (!existing) {
    res.status(404).json({
      message: `No Medusa product with metadata.wc_product_id = "${wcProductId}". Import the product first (wc-import).`,
    })
    return
  }

  let productRow: {
    variants?: { id?: string; metadata?: Record<string, unknown> }[]
  }
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["variants.id", "variants.metadata"],
      filters: { id: existing.id },
    })
    productRow = (data?.[0] as typeof productRow) ?? {}
  } catch (e: any) {
    res.status(500).json({
      message: e?.message ?? "Failed to load Medusa variants",
    })
    return
  }

  const variantsForUpdate: Record<string, unknown>[] = []
  const medusaSkipped: { medusaVariantId: string; reason: string }[] = []
  const applied: {
    medusaVariantId: string
    wcVariationId: string
    color_hex: string
  }[] = []

  for (const v of productRow.variants ?? []) {
    const mid = v.id
    if (!mid) continue
    const meta = { ...(v.metadata ?? {}) }
    const wvid = meta.wc_variation_id
    if (wvid == null || String(wvid) === "") {
      medusaSkipped.push({
        medusaVariantId: mid,
        reason: "Missing metadata.wc_variation_id",
      })
      continue
    }
    const hex = hexByWcVariationId.get(String(wvid))
    if (!hex) {
      medusaSkipped.push({
        medusaVariantId: mid,
        reason: `No WC variation ${wvid} in resolved list or no color match`,
      })
      continue
    }
    meta.color_hex = hex
    variantsForUpdate.push({ id: mid, metadata: meta })
    applied.push({
      medusaVariantId: mid,
      wcVariationId: String(wvid),
      color_hex: hex,
    })
  }

  if (variantsForUpdate.length > 0) {
    try {
      await updateProductsWorkflow(container).run({
        input: {
          products: [
            {
              id: existing.id,
              variants: variantsForUpdate,
            } as any,
          ],
        },
      })
    } catch (e: any) {
      res.status(500).json({
        message: e?.message ?? "updateProductsWorkflow failed",
        appliedPreview: applied,
      })
      return
    }
  }

  res.status(200).json({
    wcProductId,
    medusaProductId: existing.id,
    colorLookupSize: lookup.size,
    wcVariationsResolved: variations.length,
    updatedVariants: applied,
    wcVariationsSkipped: wcSkipped,
    medusaVariantsSkipped: medusaSkipped,
  })
}
