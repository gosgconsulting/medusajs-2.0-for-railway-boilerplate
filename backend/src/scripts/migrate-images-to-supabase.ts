import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createClient } from "@supabase/supabase-js"
import path from "path"
import { ulid } from "ulid"

/**
 * Re-host images from the live storage provider (currently MinIO on
 * `bucket-production-9c73`) into the Supabase `images` bucket under the
 * brand-keyed convention `brands/<slug>/<filename>`, then rewrite
 * `image.url` to the new Supabase public URL.
 *
 * Idempotent: rows whose URL already points at the Supabase public URL base
 * are skipped. Safe to run brand-by-brand via `--brand <slug>` and to dry-run
 * with `--dry-run`.
 *
 * Brand resolution chain (each image row):
 *   1. shop_brands.slug from the product's brand link
 *      (product → product_sales_channel → sales_channel.brand_id → shop_brands.supabase_brand_id)
 *   2. Direct shop_brands match if an entry exists for product.id (rare)
 *   3. Falls back to "unscoped/" so the migration never blocks on missing
 *      brand metadata; you can re-run after fixing the brand link.
 *
 * Required env (read at runtime, never logged):
 *   SUPABASE_URL                — e.g. https://fkemumodynkaeojrrkbj.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY   — server-side key (do NOT use anon)
 *   SUPABASE_BUCKET             — defaults to "images"
 *
 * Run:        npx medusa exec ./src/scripts/migrate-images-to-supabase.ts
 * Dry-run:    npx medusa exec ./src/scripts/migrate-images-to-supabase.ts -- --dry-run
 * One brand:  npx medusa exec ./src/scripts/migrate-images-to-supabase.ts -- --brand sparti
 */

const DEFAULT_BUCKET = "images"
const PREFIX_TEMPLATE = "brands/{brand}"
const UNSCOPED = "unscoped"

type ImageRow = {
  id: string
  url: string
  rank: number
  product_id: string
}

export default async function migrateImagesToSupabase({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as any

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_BUCKET || DEFAULT_BUCKET

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running."
    )
  }

  const dryRun = process.argv.includes("--dry-run")
  const brandFilterIdx = process.argv.indexOf("--brand")
  const brandFilter =
    brandFilterIdx !== -1 ? process.argv[brandFilterIdx + 1] : null

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const publicBase = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}`

  // 1. Resolve brand_id → slug map (only brands present in shop_brands).
  const hasShopBrands: boolean = await knex.schema.hasTable("shop_brands")
  const brandSlugByBrandId = new Map<string, string>()
  if (hasShopBrands) {
    const rows: { supabase_brand_id: string; slug: string; status: string }[] =
      await knex("shop_brands").select(
        "supabase_brand_id",
        "slug",
        "status"
      )
    for (const r of rows) {
      if (r.supabase_brand_id && r.slug) {
        brandSlugByBrandId.set(r.supabase_brand_id, r.slug)
      }
    }
  }
  logger.info(
    `Resolved ${brandSlugByBrandId.size} brand_id → slug mappings ${
      hasShopBrands ? "" : "(shop_brands table missing — all rows -> unscoped)"
    }`
  )

  // 2. Build the candidate set: every image row whose URL doesn't already
  //    point at the Supabase public base. Drop deleted rows and orphaned
  //    products. If --brand is set, pre-filter to that brand's products.
  let q = knex({ i: "image" })
    .select("i.id", "i.url", "i.rank", "i.product_id")
    .whereNull("i.deleted_at")
    .whereExists(function (this: any) {
      this.select(knex.raw("1"))
        .from("product as p")
        .whereRaw("p.id = i.product_id")
        .whereNull("p.deleted_at")
    })
    .whereRaw("i.url NOT LIKE ?", [`${publicBase}/%`])

  if (brandFilter) {
    // Find brand_id for the slug filter
    const brandRow = hasShopBrands
      ? await knex("shop_brands")
          .select("supabase_brand_id")
          .where({ slug: brandFilter })
          .first()
      : null
    if (!brandRow?.supabase_brand_id) {
      throw new Error(
        `--brand "${brandFilter}" not found in shop_brands.slug`
      )
    }
    const brandId = brandRow.supabase_brand_id
    q = q.whereIn(
      "i.product_id",
      knex("product_sales_channel as psc")
        .join("sales_channel as sc", function (this: any) {
          this.on("sc.id", "psc.sales_channel_id")
        })
        .select("psc.product_id")
        .where("sc.brand_id", brandId)
        .whereNull("psc.deleted_at")
    )
  }

  const rows: ImageRow[] = await q.orderBy(["i.product_id", "i.rank"])

  logger.info(
    `Migrating ${rows.length} image row(s) to Supabase bucket "${bucket}" ${
      brandFilter ? `(brand=${brandFilter})` : "(all brands)"
    }${dryRun ? " (dry-run)" : ""}`
  )

  // 3. For each image, look up its brand slug via the product's SC.
  const brandSlugByProductId = new Map<string, string>()
  const productIds = Array.from(new Set(rows.map((r) => r.product_id)))
  if (productIds.length) {
    const links: { product_id: string; brand_id: string | null }[] = await knex(
      "product_sales_channel as psc"
    )
      .join("sales_channel as sc", function (this: any) {
        this.on("sc.id", "psc.sales_channel_id")
      })
      .select("psc.product_id", "sc.brand_id")
      .whereIn("psc.product_id", productIds)
      .whereNull("psc.deleted_at")
    for (const l of links) {
      if (brandSlugByProductId.has(l.product_id)) continue // first wins
      const slug =
        l.brand_id && brandSlugByBrandId.get(l.brand_id)
      if (slug) brandSlugByProductId.set(l.product_id, slug)
    }
  }

  let uploaded = 0
  let updated = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const slug = brandSlugByProductId.get(row.product_id) || UNSCOPED
    const folder = PREFIX_TEMPLATE.replace("{brand}", slug)

    // Download
    let buf: Buffer
    let contentType = "image/jpeg"
    try {
      const res = await fetch(row.url)
      if (!res.ok) {
        failed++
        logger.warn(`  ${row.id}: download HTTP ${res.status} (${truncate(row.url)})`)
        continue
      }
      contentType = res.headers.get("content-type") || contentType
      buf = Buffer.from(await res.arrayBuffer())
    } catch (e: any) {
      failed++
      logger.warn(`  ${row.id}: download error ${e.message}`)
      continue
    }

    const parsed = path.parse(safeFilename(row.url))
    const fileKey = `${folder}/${sanitize(parsed.name)}-${ulid()}${
      parsed.ext || extOf(contentType)
    }`

    if (dryRun) {
      uploaded++
      logger.info(
        `  [dry] would upload ${fileKey} (${buf.length} bytes) and rewrite image ${row.id}`
      )
      continue
    }

    // Upload to Supabase
    const up = await supabase.storage
      .from(bucket)
      .upload(fileKey, buf, {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
        upsert: false,
      })
    if (up.error) {
      failed++
      logger.warn(`  ${row.id}: upload error ${up.error.message}`)
      continue
    }
    uploaded++

    const newUrl = `${publicBase}/${fileKey}`
    await knex("image")
      .where({ id: row.id })
      .update({ url: newUrl, updated_at: knex.fn.now() })
    updated++

    if ((uploaded + skipped) % 25 === 0) {
      logger.info(
        `  progress uploaded=${uploaded} updated=${updated} failed=${failed}`
      )
    }
  }

  logger.info(
    `Done. uploaded=${uploaded} updated=${updated} skipped=${skipped} failed=${failed}`
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function safeFilename(url: string): string {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "image"
  } catch {
    return "image"
  }
}

function sanitize(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) || "file"
}

function extOf(t: string): string {
  if (t.includes("png")) return ".png"
  if (t.includes("webp")) return ".webp"
  if (t.includes("gif")) return ".gif"
  if (t.includes("svg")) return ".svg"
  return ".jpg"
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}
