import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createProductVariantsWorkflow,
  createProductsWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  WC_API_URL,
  WC_CONSUMER_KEY,
  WC_CONSUMER_SECRET,
} from "../../../lib/constants"

type ImportLimit = "1" | "10" | "all"

type ImportBody = {
  baseUrl?: string
  consumerKey?: string
  consumerSecret?: string
  limit: ImportLimit
  /** Default region currency for variant prices (e.g. eur) */
  currencyCode?: string
}

function wcCredentialsFromEnv(): boolean {
  return Boolean(
    WC_API_URL && WC_CONSUMER_KEY && WC_CONSUMER_SECRET
  )
}

type WcCategory = { id?: number; name?: string; slug?: string }
type WcTag = { id?: number; name?: string; slug?: string }
type WcImage = { src?: string }
type WcAttribute = {
  id?: number
  name?: string
  slug?: string
  variation?: boolean
  options?: string[]
  option_colors?: string[]
  options_with_colors?: { name?: string; hex?: string }[]
}
type WcMetaEntry = { id?: number; key?: string; value?: unknown }
type WcVariation = {
  id?: number
  parent_id?: number
  sku?: string
  price?: string | number
  regular_price?: string | number
  sale_price?: string | number
  manage_stock?: boolean
  stock_quantity?: number | null
  weight?: string
  attributes?: { id?: number; name?: string; option?: string }[]
  image?: WcImage | null
  images?: WcImage[]
}
type WcProduct = {
  id?: number
  name?: string
  slug?: string
  permalink?: string
  type?: string
  status?: string
  description?: string
  short_description?: string
  sku?: string
  price?: string
  regular_price?: string
  sale_price?: string
  manage_stock?: boolean
  stock_quantity?: number | null
  weight?: string
  dimensions?: { length?: string; width?: string; height?: string }
  categories?: WcCategory[]
  tags?: WcTag[]
  brands?: unknown[]
  images?: WcImage[]
  attributes?: WcAttribute[]
  variations?: (number | WcVariation)[]
  meta_data?: WcMetaEntry[]
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

function sanitizeHandle(slug: string): string {
  const s = slug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s || "product"
}

function parseAmount(value?: string | number | null): number {
  if (value == null || value === "") return 0
  if (typeof value === "number")
    return Number.isFinite(value) ? value : 0
  const n = Number.parseFloat(String(value).replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

function numDim(v?: string): number | undefined {
  if (v == null || v === "") return undefined
  const n = Number.parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
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

async function fetchAllWcProducts(
  apiRoot: string,
  authHeader: string,
  maxProducts: number | "unbounded"
): Promise<WcProduct[]> {
  const out: WcProduct[] = []
  let page = 1
  const perPage = 100

  while (true) {
    const path = `/wp-json/wc/v3/products?per_page=${perPage}&page=${page}`
    const batch = await wcFetchJson<WcProduct[]>(apiRoot, path, authHeader)
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const p of batch) {
      out.push(p)
      if (maxProducts !== "unbounded" && out.length >= maxProducts) {
        return out.slice(0, maxProducts)
      }
    }
    if (batch.length < perPage) break
    page += 1
    if (maxProducts !== "unbounded" && out.length >= maxProducts) break
  }

  return out
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

/** Single WC product or variation by numeric id (GET /wc/v3/products/:id). */
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

/**
 * Prefer fetching each variation by id when parent lists numeric ids; fallback to
 * /products/:parentId/variations.
 */
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

async function findMedusaProductByWcId(
  container: MedusaRequest["scope"],
  wcId: number
): Promise<{ id: string; handle: string } | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "handle"],
      filters: {
        metadata: {
          wc_product_id: String(wcId),
        },
      },
    })
    const row = data?.[0] as { id?: string; handle?: string } | undefined
    if (row?.id) return { id: row.id, handle: row.handle ?? "" }
  } catch {
    /* no match or filter unsupported */
  }
  return null
}

async function getFirstVariantIdForProduct(
  query: { graph: (args: unknown) => Promise<{ data?: unknown[] }> },
  productId: string
): Promise<string | null> {
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["variants.id"],
      filters: { id: productId },
    })
    const v = (data?.[0] as { variants?: { id?: string }[] } | undefined)
      ?.variants?.[0]
    return v?.id ?? null
  } catch {
    return null
  }
}

async function loadMedusaVariantWcIdMap(
  query: { graph: (args: unknown) => Promise<{ data?: unknown[] }> },
  productId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const { data } = await query.graph({
      entity: "product",
      fields: ["variants.id", "variants.metadata"],
      filters: { id: productId },
    })
    const product = data?.[0] as
      | { variants?: { id?: string; metadata?: Record<string, unknown> }[] }
      | undefined
    for (const v of product?.variants ?? []) {
      const wvid = v.metadata?.wc_variation_id
      if (v.id && wvid != null && String(wvid).length > 0) {
        map.set(String(wvid), v.id)
      }
    }
  } catch {
    /* empty map */
  }
  return map
}

function buildVariantPayload(
  v: WcVariation,
  optionTitlesOrdered: { title: string }[],
  currency: string
): Record<string, unknown> {
  const optMap: Record<string, string> = {}
  for (const attr of v.attributes ?? []) {
    const n = attr.name?.trim()
    const o = attr.option?.trim()
    if (n && o) optMap[n] = o
  }
  const titleParts = optionTitlesOrdered.map((o) => optMap[o.title] ?? "?")
  const title = titleParts.join(" / ") || `Variant ${v.id ?? ""}`
  const amount = parseAmount(v.regular_price ?? v.sale_price ?? v.price)
  const vid = v.id
  const out: Record<string, unknown> = {
    title,
    sku: v.sku || undefined,
    options: optMap,
    prices:
      amount > 0
        ? [{ amount, currency_code: currency }]
        : [{ amount: 0, currency_code: currency }],
    manage_inventory: Boolean(v.manage_stock),
    metadata: {
      wc_variation_id: String(vid ?? ""),
      ...(v.parent_id != null
        ? { wc_parent_product_id: String(v.parent_id) }
        : {}),
    },
  }
  if (v.stock_quantity != null) out.inventory_quantity = v.stock_quantity
  const vw = numDim(v.weight)
  if (vw != null) out.weight = vw
  const thumb =
    v.images?.[0]?.src ?? (typeof v.image === "object" && v.image?.src ? v.image.src : undefined)
  if (thumb) out.thumbnail = thumb
  return out
}

async function ensureCategoryId(
  container: MedusaRequest["scope"],
  query: any,
  slug: string,
  name: string
): Promise<string> {
  const handle = sanitizeHandle(slug)
  const { data: existing } = await query.graph({
    entity: "product_category",
    fields: ["id"],
    filters: { handle },
  })
  if (existing?.length) {
    return existing[0].id as string
  }
  const { result } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: name || handle,
          handle,
          is_active: true,
        },
      ],
    },
  })
  const created = result?.[0]
  if (!created?.id) {
    throw new Error(`Failed to create category: ${handle}`)
  }
  return created.id as string
}

async function resolveUniqueProductHandle(
  query: any,
  baseHandle: string,
  wcProductId: number
): Promise<string> {
  let handle = sanitizeHandle(baseHandle)
  for (let i = 0; i < 50; i++) {
    const { data: existing } = await query.graph({
      entity: "product",
      fields: ["id"],
      filters: { handle },
    })
    if (!existing?.length) return handle
    handle = sanitizeHandle(`${baseHandle}-wc-${wcProductId}${i > 0 ? `-${i}` : ""}`)
  }
  return sanitizeHandle(`${baseHandle}-${wcProductId}-${Date.now()}`)
}

function wcStatusToMedusa(status?: string): ProductStatus {
  if (status === "publish") return ProductStatus.PUBLISHED
  if (status === "draft") return ProductStatus.DRAFT
  if (status === "pending") return ProductStatus.PROPOSED
  if (status === "private") return ProductStatus.DRAFT
  return ProductStatus.DRAFT
}

function buildProductMetadata(wc: WcProduct): Record<string, string> {
  const meta: Record<string, string> = {
    wc_product_id: String(wc.id ?? ""),
    wc_type: String(wc.type ?? ""),
    wc_permalink: String(wc.permalink ?? ""),
    wc_slug: String(wc.slug ?? ""),
  }
  if (wc.tags?.length) {
    meta.wc_tags = JSON.stringify(
      wc.tags.map((t) => ({ id: t.id, name: t.name, slug: t.slug }))
    )
  }
  if (wc.brands?.length) {
    meta.wc_brands = JSON.stringify(wc.brands)
  }
  if (wc.attributes?.length) {
    meta.wc_attributes = JSON.stringify(
      wc.attributes.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        variation: a.variation,
        options: a.options,
        option_colors: a.option_colors,
        options_with_colors: a.options_with_colors,
      }))
    )
  }
  if (wc.meta_data?.length) {
    const simplified = wc.meta_data.map((m) => ({
      key: m.key,
      value: m.value,
    }))
    meta.wc_meta_data = JSON.stringify(simplified)
  }
  return meta
}

function buildImages(wc: WcProduct): { url: string }[] {
  const urls = (wc.images ?? [])
    .map((i) => i.src)
    .filter((u): u is string => typeof u === "string" && u.length > 0)
  return urls.map((url) => ({ url }))
}

async function mapWcProductToMedusaInput(
  wc: WcProduct,
  ctx: {
    container: MedusaRequest["scope"]
    query: any
    shippingProfileId: string
    salesChannelId: string
    currencyCode: string
    apiRoot: string
    authHeader: string
  },
  opts?: { existingHandle?: string }
): Promise<Record<string, unknown>> {
  const wcId = wc.id
  if (wcId == null) throw new Error("WooCommerce product missing id")

  const categoryIds: string[] = []
  for (const c of wc.categories ?? []) {
    if (!c.slug) continue
    const id = await ensureCategoryId(
      ctx.container,
      ctx.query,
      c.slug,
      c.name ?? c.slug
    )
    categoryIds.push(id)
  }

  const handle =
    opts?.existingHandle ??
    (await resolveUniqueProductHandle(
      ctx.query,
      wc.slug ?? `product-${wcId}`,
      wcId
    ))

  const metadata = buildProductMetadata(wc)
  const images = buildImages(wc)

  const weight = numDim(wc.weight)
  const length = numDim(wc.dimensions?.length)
  const width = numDim(wc.dimensions?.width)
  const height = numDim(wc.dimensions?.height)

  const base: Record<string, unknown> = {
    title: wc.name ?? handle,
    handle,
    description: wc.description ?? "",
    subtitle: wc.short_description ?? "",
    status: wcStatusToMedusa(wc.status),
    discountable: true,
    category_ids: categoryIds,
    shipping_profile_id: ctx.shippingProfileId,
    images,
    metadata,
    sales_channels: [{ id: ctx.salesChannelId }],
  }

  if (weight != null) base.weight = weight
  if (length != null) base.length = length
  if (width != null) base.width = width
  if (height != null) base.height = height

  const currency = ctx.currencyCode.toLowerCase()

  let variations: WcVariation[] = []
  if (wc.type === "variable") {
    variations = await resolveWcVariableVariations(
      wc,
      ctx.apiRoot,
      ctx.authHeader
    )
  }

  if (wc.type === "variable" && variations.length > 0) {
    const varAttrs = (wc.attributes ?? []).filter((a) => a.variation)
    const options = varAttrs
      .filter((a) => a.name && (a.options?.length ?? 0) > 0)
      .map((a) => ({
        title: a.name as string,
        values: [...new Set(a.options ?? [])],
      }))

    if (options.length === 0) {
      throw new Error("Variable product has no variation attributes")
    }

    const variants = variations.map((v) =>
      buildVariantPayload(v, options, currency)
    )

    return { ...base, options, variants }
  }

  const amount = parseAmount(
    wc.regular_price ?? wc.sale_price ?? wc.price
  )
  const variant: Record<string, unknown> = {
    title: wc.name ?? "Default",
    sku: wc.sku || undefined,
    prices:
      amount > 0
        ? [{ amount, currency_code: currency }]
        : [{ amount: 0, currency_code: currency }],
    manage_inventory: Boolean(wc.manage_stock),
  }
  if (wc.stock_quantity != null) {
    variant.inventory_quantity = wc.stock_quantity
  }

  return {
    ...base,
    variants: [variant],
  }
}

export async function GET(
  _req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const configured = wcCredentialsFromEnv()
  let wcApiHost: string | null = null
  if (WC_API_URL) {
    try {
      wcApiHost = new URL(normalizeBaseUrl(WC_API_URL)).host
    } catch {
      wcApiHost = null
    }
  }
  res.status(200).json({
    wcEnvConfigured: configured,
    wcApiHost,
  })
}

export async function POST(
  req: MedusaRequest<ImportBody>,
  res: MedusaResponse
): Promise<void> {
  const body = req.body ?? ({} as ImportBody)

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
        ? "WC_API_URL, WC_CONSUMER_KEY, and WC_CONSUMER_SECRET must be set in the server environment."
        : "Missing baseUrl, consumerKey, or consumerSecret (set them in the request body or configure WC_* env vars).",
    })
    return
  }

  const limit = body.limit ?? "10"
  if (limit !== "1" && limit !== "10" && limit !== "all") {
    res.status(400).json({ message: 'limit must be "1", "10", or "all".' })
    return
  }

  const apiRoot = normalizeBaseUrl(baseUrlRaw)
  const authHeader = wcAuthHeader(consumerKeyRaw, consumerSecretRaw)
  const currencyCode = (body.currencyCode ?? "eur").toLowerCase()

  const maxProducts: number | "unbounded" =
    limit === "1" ? 1 : limit === "10" ? 10 : "unbounded"

  let wcProducts: WcProduct[]
  try {
    wcProducts = await fetchAllWcProducts(apiRoot, authHeader, maxProducts)
  } catch (e: any) {
    res.status(502).json({
      message: e?.message ?? "Failed to fetch WooCommerce products",
    })
    return
  }

  const container = req.scope
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)

  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles(
    {}
  )
  const shippingProfileId = shippingProfiles[0]?.id
  if (!shippingProfileId) {
    res.status(500).json({
      message:
        "No shipping profile found. Create a shipping profile in Medusa first.",
    })
    return
  }

  const salesChannels = await salesChannelModuleService.listSalesChannels({})
  const salesChannelId = salesChannels[0]?.id
  if (!salesChannelId) {
    res.status(500).json({
      message: "No sales channel found.",
    })
    return
  }

  const imported: {
    medusaProductId: string
    title: string
    handle: string
    wcProductId: number
    action: "created" | "updated"
  }[] = []
  const errors: { wcProductId?: number; message: string }[] = []

  const importCtx = {
    container,
    query,
    shippingProfileId,
    salesChannelId,
    currencyCode,
    apiRoot,
    authHeader,
  }

  for (const wc of wcProducts) {
    const wcId = wc.id
    try {
      if (wc.type === "variation") {
        continue
      }
      if (wc.type === "grouped" || wc.type === "external") {
        throw new Error(
          `Unsupported WooCommerce product type: ${wc.type ?? "unknown"}`
        )
      }

      const existing =
        wcId != null
          ? await findMedusaProductByWcId(container, wcId)
          : null

      const productPayload = await mapWcProductToMedusaInput(
        wc,
        importCtx,
        existing ? { existingHandle: existing.handle } : undefined
      )

      let medusaProductId: string
      let action: "created" | "updated"

      if (existing) {
        const {
          variants: plannedVariants,
          options: plannedOptions,
          ...productRest
        } = productPayload as {
          variants?: Record<string, unknown>[]
          options?: unknown
          [key: string]: unknown
        }

        const wcVarMap = await loadMedusaVariantWcIdMap(query, existing.id)
        const variantsForUpdate: Record<string, unknown>[] = []
        const variantsForCreate: Record<string, unknown>[] = []

        if (wc.type === "variable" && Array.isArray(plannedVariants)) {
          for (const pv of plannedVariants) {
            const wvid = (pv.metadata as Record<string, string> | undefined)
              ?.wc_variation_id
            if (wvid == null || wvid === "") continue
            const exVid = wcVarMap.get(String(wvid))
            if (exVid) {
              variantsForUpdate.push({ id: exVid, ...pv })
            } else {
              variantsForCreate.push({
                product_id: existing.id,
                ...pv,
              })
            }
          }
        } else if (Array.isArray(plannedVariants) && plannedVariants.length === 1) {
          const firstVid = await getFirstVariantIdForProduct(query, existing.id)
          if (firstVid) {
            variantsForUpdate.push({ id: firstVid, ...plannedVariants[0] })
          } else {
            variantsForCreate.push({
              product_id: existing.id,
              ...plannedVariants[0],
            })
          }
        }

        const updateProduct: Record<string, unknown> = {
          id: existing.id,
          title: productRest.title,
          subtitle: productRest.subtitle,
          description: productRest.description,
          status: productRest.status,
          handle: productRest.handle,
          discountable: productRest.discountable,
          category_ids: productRest.category_ids,
          images: productRest.images,
          metadata: productRest.metadata,
          shipping_profile_id: productRest.shipping_profile_id,
          sales_channels: productRest.sales_channels,
        }
        if (productRest.weight != null) updateProduct.weight = productRest.weight
        if (productRest.length != null) updateProduct.length = productRest.length
        if (productRest.width != null) updateProduct.width = productRest.width
        if (productRest.height != null) updateProduct.height = productRest.height
        if (wc.type === "variable" && plannedOptions != null) {
          updateProduct.options = plannedOptions
        }
        if (variantsForUpdate.length > 0) {
          updateProduct.variants = variantsForUpdate
        }

        await updateProductsWorkflow(container).run({
          input: {
            products: [updateProduct as any],
          },
        })

        if (variantsForCreate.length > 0) {
          await createProductVariantsWorkflow(container).run({
            input: {
              product_variants: variantsForCreate as any,
            },
          })
        }

        medusaProductId = existing.id
        action = "updated"
      } else {
        const { result } = await createProductsWorkflow(container).run({
          input: {
            products: [productPayload as any],
          },
        })

        const raw = result as any
        const created = Array.isArray(raw)
          ? raw[0]
          : raw?.products?.[0] ?? raw?.product ?? raw
        const newId = created?.id as string | undefined
        if (!newId) {
          throw new Error("Medusa did not return a product id")
        }
        medusaProductId = newId
        action = "created"
      }

      imported.push({
        medusaProductId,
        title: (productPayload.title as string) ?? "",
        handle: (productPayload.handle as string) ?? "",
        wcProductId: wcId as number,
        action,
      })
    } catch (err: any) {
      errors.push({
        wcProductId: wcId,
        message: err?.message ?? String(err),
      })
    }
  }

  res.status(200).json({ imported, errors })
}
