import {
  AbstractFileProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  Logger,
  ProviderDeleteFileDTO,
  ProviderFileResultDTO,
  ProviderGetFileDTO,
  ProviderGetPresignedUploadUrlDTO,
  ProviderUploadFileDTO,
} from "@medusajs/framework/types"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import path from "path"
import { ulid } from "ulid"
import { Readable } from "stream"

type InjectedDependencies = {
  logger: Logger
}

export interface SupabaseFileProviderOptions {
  /** e.g. https://fkemumodynkaeojrrkbj.supabase.co */
  url: string
  /** Service role key — server-side only. */
  serviceRoleKey: string
  /** Bucket name. Default: "images". Must already exist and be public for product images. */
  bucket?: string
  /**
   * Upload key prefix. Supports the `{brand}` token which is replaced at
   * upload time with the active brand slug derived from the file context
   * (`brands/<slug>/...` matches the convention used by the Sparti storage).
   * Default: `brands/{brand}`. When no brand can be resolved, `unscoped` is
   * used so uploads still succeed in admin contexts that don't carry tenant
   * information (e.g. server-side workflows).
   */
  prefix?: string
  /** Default cache-control header for stored objects. */
  cacheControl?: string
}

const DEFAULT_BUCKET = "images"
const DEFAULT_PREFIX = "brands/{brand}"
const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable"
const UNSCOPED_PLACEHOLDER = "unscoped"

/**
 * Medusa file provider that stores uploads in a Supabase Storage bucket,
 * keyed by the active brand. Mirrors the surface of MinioFileProviderService
 * so it can be swapped in/out via the env-driven provider chain in
 * `medusa-config.js`.
 *
 * Brand resolution: the upload DTO's metadata + filename are inspected for a
 * brand slug (`metadata.brand_slug` or a path-prefixed filename). Server-side
 * workflows that cannot identify a tenant fall back to `unscoped/`. The
 * provider is intentionally tolerant — Medusa's file_provider interface does
 * not pass the active store, so this best-effort pattern keeps uploads
 * working everywhere while still funnelling admin uploads to the right
 * brand folder when context is available.
 */
class SupabaseFileProviderService extends AbstractFileProviderService {
  static identifier = "supabase-file"

  protected readonly logger_: Logger
  protected readonly client: SupabaseClient
  protected readonly bucket: string
  protected readonly prefixTemplate: string
  protected readonly cacheControl: string
  protected readonly publicUrlBase: string

  constructor(
    { logger }: InjectedDependencies,
    options: SupabaseFileProviderOptions
  ) {
    super()
    this.logger_ = logger
    this.bucket = options.bucket || DEFAULT_BUCKET
    this.prefixTemplate = options.prefix || DEFAULT_PREFIX
    this.cacheControl = options.cacheControl || DEFAULT_CACHE_CONTROL

    const url = options.url.replace(/\/+$/, "")
    this.client = createClient(url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    this.publicUrlBase = `${url}/storage/v1/object/public/${this.bucket}`

    this.logger_.info(
      `Supabase file provider initialised — bucket="${this.bucket}" prefix="${this.prefixTemplate}"`
    )
  }

  static validateOptions(options: Record<string, any>) {
    const required = ["url", "serviceRoleKey"]
    for (const f of required) {
      if (!options[f]) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `${f} is required for the supabase-file provider`
        )
      }
    }
  }

  // ── upload ────────────────────────────────────────────────────────────────
  async upload(file: ProviderUploadFileDTO): Promise<ProviderFileResultDTO> {
    if (!file?.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No filename provided"
      )
    }

    const brand = this.resolveBrand(file)
    const parsed = path.parse(file.filename)
    const baseName = sanitizeBaseName(parsed.name) || "file"
    const ext = parsed.ext || ""
    const objectKey = joinKey(
      this.prefixTemplate.replace("{brand}", brand),
      `${baseName}-${ulid()}${ext}`
    )

    const body = toBuffer(file.content)

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(objectKey, body, {
        contentType: file.mimeType,
        cacheControl: this.cacheControl,
        upsert: false,
      })

    if (error) {
      this.logger_.error(
        `Supabase upload failed for ${objectKey}: ${error.message}`
      )
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to upload to Supabase: ${error.message}`
      )
    }

    const url = `${this.publicUrlBase}/${objectKey}`
    return { url, key: objectKey }
  }

  // ── delete ────────────────────────────────────────────────────────────────
  async delete(
    fileData: ProviderDeleteFileDTO | ProviderDeleteFileDTO[]
  ): Promise<void> {
    const files = Array.isArray(fileData) ? fileData : [fileData]
    const keys = files.map((f) => f?.fileKey).filter(Boolean) as string[]
    if (keys.length === 0) return

    const { error } = await this.client.storage
      .from(this.bucket)
      .remove(keys)

    if (error) {
      // Match MinioFileProviderService behaviour: warn but don't throw, since
      // a missing object on delete is harmless and Medusa often retries.
      this.logger_.warn(
        `Supabase delete failed for ${keys.join(", ")}: ${error.message}`
      )
    }
  }

  // ── presigned URLs ────────────────────────────────────────────────────────
  async getPresignedDownloadUrl(
    fileData: ProviderGetFileDTO
  ): Promise<string> {
    if (!fileData?.fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No file key provided"
      )
    }
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(fileData.fileKey, 24 * 60 * 60)
    if (error || !data) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to sign download URL: ${error?.message ?? "unknown"}`
      )
    }
    return data.signedUrl
  }

  async getPresignedUploadUrl(
    fileData: ProviderGetPresignedUploadUrlDTO
  ): Promise<ProviderFileResultDTO> {
    if (!fileData?.filename) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No filename provided"
      )
    }
    const brand = this.resolveBrand(fileData as ProviderUploadFileDTO)
    const parsed = path.parse(fileData.filename)
    const objectKey = joinKey(
      this.prefixTemplate.replace("{brand}", brand),
      `${sanitizeBaseName(parsed.name) || "file"}-${ulid()}${parsed.ext || ""}`
    )
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(objectKey)
    if (error || !data) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to sign upload URL: ${error?.message ?? "unknown"}`
      )
    }
    return { url: data.signedUrl, key: objectKey }
  }

  // ── reads ─────────────────────────────────────────────────────────────────
  async getAsBuffer(fileData: ProviderGetFileDTO): Promise<Buffer> {
    if (!fileData?.fileKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No file key provided"
      )
    }
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(fileData.fileKey)
    if (error || !data) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to download from Supabase: ${error?.message ?? "unknown"}`
      )
    }
    return Buffer.from(await data.arrayBuffer())
  }

  async getDownloadStream(fileData: ProviderGetFileDTO): Promise<Readable> {
    const buffer = await this.getAsBuffer(fileData)
    return Readable.from(buffer)
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Best-effort brand resolver. Looks at, in order:
   *   1. file.metadata.brand_slug (preferred — set by future tenant-aware uploaders)
   *   2. file.metadata.brand_id   (slug derived later by backfill / docs)
   *   3. A leading "<slug>/" segment in the filename
   * Falls back to `UNSCOPED_PLACEHOLDER` to keep server-side uploads working.
   */
  private resolveBrand(file: ProviderUploadFileDTO): string {
    const md = (file as { metadata?: Record<string, unknown> }).metadata
    if (md && typeof md === "object") {
      const slug = md.brand_slug
      if (typeof slug === "string" && slug.trim()) {
        return sanitizeSlug(slug)
      }
    }
    if (typeof file.filename === "string" && file.filename.includes("/")) {
      const head = file.filename.split("/")[0]
      if (head && head.length <= 64) return sanitizeSlug(head)
    }
    return UNSCOPED_PLACEHOLDER
  }
}

// ── module-level helpers ────────────────────────────────────────────────────

function toBuffer(content: ProviderUploadFileDTO["content"]): Buffer {
  if (Buffer.isBuffer(content)) return content
  if (typeof content === "string") {
    if (/^[A-Za-z0-9+/=]+$/.test(content)) {
      return Buffer.from(content, "base64")
    }
    return Buffer.from(content, "binary")
  }
  return Buffer.from(content as ArrayBuffer)
}

function sanitizeBaseName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80)
}

function sanitizeSlug(slug: string): string {
  return (
    slug
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || UNSCOPED_PLACEHOLDER
  )
}

function joinKey(prefix: string, name: string): string {
  const left = prefix.replace(/^\/+|\/+$/g, "")
  return left ? `${left}/${name}` : name
}

export default SupabaseFileProviderService
