import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client as MinioClient } from "minio"
import { ulid } from "ulid"

/**
 * Re-host every shop_product_images URL whose target product exists in the
 * Medusa `product` table but whose image row hasn't been created yet, then
 * INSERT the matching `image` row pointing at the new MinIO object.
 *
 * Idempotent — re-running skips images that already have a matching row in
 * `image` (matched by url first, then by product_id + rank as a fallback).
 *
 * Required env (read at runtime, never logged):
 *   MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY
 *   MINIO_BUCKET (optional, default "medusa-media")
 *
 * Run:        npx medusa exec ./src/scripts/migrate-shop-images-to-minio.ts
 * Dry-run:    npx medusa exec ./src/scripts/migrate-shop-images-to-minio.ts -- --dry-run
 */

const DEFAULT_BUCKET = "medusa-media"

type ShopImageRow = {
  shop_id: string
  product_id: string
  url: string
  rank: number
}

export default async function migrateShopImagesToMinio({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const knex = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as any

  const dryRun = process.argv.includes("--dry-run")

  const endPoint = process.env.MINIO_ENDPOINT
  const accessKey = process.env.MINIO_ACCESS_KEY
  const secretKey = process.env.MINIO_SECRET_KEY
  const bucket = process.env.MINIO_BUCKET || DEFAULT_BUCKET

  if (!endPoint || !accessKey || !secretKey) {
    throw new Error(
      "Set MINIO_ENDPOINT, MINIO_ACCESS_KEY and MINIO_SECRET_KEY before running."
    )
  }

  const { host, port, useSSL } = parseEndpoint(endPoint)

  const minio = new MinioClient({
    endPoint: host,
    port,
    useSSL,
    accessKey,
    secretKey,
  })

  // Sanity: bucket must already exist.
  const bucketOk = await minio.bucketExists(bucket).catch(() => false)
  if (!bucketOk) {
    throw new Error(
      `Target bucket "${bucket}" does not exist on ${host}. ` +
        `Either create it or set MINIO_BUCKET.`
    )
  }

  // Pull only the orphan rows we can act on (product still alive, no image yet).
  const rows: ShopImageRow[] = await knex({ si: "shop_product_images" })
    .select("si.id as shop_id", "si.product_id", "si.url", "si.rank")
    .whereExists(function (this: any) {
      this.select(knex.raw("1"))
        .from("product as p")
        .whereRaw("p.id = si.product_id")
        .whereNull("p.deleted_at")
    })
    .whereNotExists(function (this: any) {
      this.select(knex.raw("1"))
        .from("image as i")
        .whereRaw("i.url = si.url")
    })
    .orderBy(["si.product_id", "si.rank"])

  logger.info(
    `Migrating ${rows.length} shop_product_images → MinIO bucket "${bucket}" on ${host}${
      dryRun ? " (dry-run)" : ""
    }`
  )

  let uploaded = 0
  let skippedExisting = 0
  let failedDownload = 0
  let failedUpload = 0
  let inserted = 0

  for (const row of rows) {
    // Defence in depth: re-check by (product_id, rank) so a previous partial
    // run that already created the image row at a NEW url is still skipped.
    const dup = await knex("image")
      .where({ product_id: row.product_id, rank: row.rank })
      .whereNull("deleted_at")
      .first()
    if (dup) {
      skippedExisting++
      continue
    }

    // Download.
    let buffer: Buffer
    let contentType = "image/jpeg"
    try {
      const res = await fetch(row.url)
      if (!res.ok) {
        failedDownload++
        logger.warn(
          `  download HTTP ${res.status} for ${truncate(row.url)} — skipping`
        )
        continue
      }
      contentType = res.headers.get("content-type") || contentType
      const ab = await res.arrayBuffer()
      buffer = Buffer.from(ab)
    } catch (e: any) {
      failedDownload++
      logger.warn(
        `  download error for ${truncate(row.url)}: ${e.message} — skipping`
      )
      continue
    }

    // Build a deterministic-enough filename: keep original basename, append a
    // ulid to avoid collisions (matches the live MinioFileProviderService).
    const baseName = sanitizeBasename(row.url)
    const ext = extFromUrlOrType(row.url, contentType)
    const fileKey = `${baseName}-${ulid()}${ext}`

    if (dryRun) {
      uploaded++
      logger.info(`  [dry] would upload ${fileKey} (${buffer.length} bytes)`)
      continue
    }

    // Upload.
    try {
      await minio.putObject(bucket, fileKey, buffer, buffer.length, {
        "Content-Type": contentType,
        "x-amz-acl": "public-read",
      })
      uploaded++
    } catch (e: any) {
      failedUpload++
      logger.warn(`  upload failed for ${fileKey}: ${e.message} — skipping`)
      continue
    }

    const newUrl = `https://${host}/${bucket}/${fileKey}`

    // INSERT the image row. Match the column shape used by Medusa.
    await knex("image").insert({
      id: `img_${ulidUpper()}`,
      url: newUrl,
      rank: row.rank,
      product_id: row.product_id,
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    })
    inserted++

    if ((uploaded + skippedExisting) % 10 === 0) {
      logger.info(
        `  progress: uploaded=${uploaded} inserted=${inserted} skipped=${skippedExisting} failed_dl=${failedDownload} failed_up=${failedUpload}`
      )
    }
  }

  logger.info(
    `Done. uploaded=${uploaded} inserted=${inserted} skipped_existing=${skippedExisting} failed_download=${failedDownload} failed_upload=${failedUpload}`
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers

function parseEndpoint(raw: string): {
  host: string
  port: number
  useSSL: boolean
} {
  let s = raw
  let useSSL = true
  let port = 443
  if (s.startsWith("https://")) s = s.slice("https://".length)
  else if (s.startsWith("http://")) {
    s = s.slice("http://".length)
    useSSL = false
    port = 80
  }
  s = s.replace(/\/$/, "")
  const m = s.match(/:(\d+)$/)
  if (m) {
    port = parseInt(m[1], 10)
    s = s.replace(/:(\d+)$/, "")
  }
  return { host: s, port, useSSL }
}

function sanitizeBasename(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").filter(Boolean).pop() || "image"
    const base = last.replace(/\.[^.]+$/, "")
    return base.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64) || "image"
  } catch {
    return "image"
  }
}

function extFromUrlOrType(url: string, type: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").filter(Boolean).pop() || ""
    const m = last.match(/\.[A-Za-z0-9]{1,5}$/)
    if (m) return m[0].toLowerCase()
  } catch {
    /* ignore */
  }
  if (type.includes("png")) return ".png"
  if (type.includes("webp")) return ".webp"
  if (type.includes("gif")) return ".gif"
  if (type.includes("svg")) return ".svg"
  return ".jpg"
}

/** Crockford base32, 26 chars, uppercase — matches Medusa's id format. */
function ulidUpper(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let out = ""
  for (let i = 0; i < 26; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

function truncate(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}
