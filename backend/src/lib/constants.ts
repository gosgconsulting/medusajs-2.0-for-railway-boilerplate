import { loadEnv } from '@medusajs/framework/utils'

import { assertValue } from 'utils/assert-value'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Is development environment
 */
export const IS_DEV = process.env.NODE_ENV === 'development'

/**
 * Public URL for the backend
 */
export const BACKEND_URL = process.env.BACKEND_PUBLIC_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN_VALUE ?? 'http://localhost:9000'

/**
 * Database URL for Postgres instance used by the backend
 */
export const DATABASE_URL = assertValue(
  process.env.DATABASE_URL,
  'Environment variable for DATABASE_URL is not set',
)

/**
 * (optional) Redis URL for Redis instance used by the backend
 */
export const REDIS_URL = process.env.REDIS_URL;

/**
 * Admin CORS origins
 */
export const ADMIN_CORS = process.env.ADMIN_CORS;

/**
 * Auth CORS origins
 */
export const AUTH_CORS = process.env.AUTH_CORS;

/**
 * Store/frontend CORS origins
 */
export const STORE_CORS = process.env.STORE_CORS;

/**
 * JWT Secret used for signing JWT tokens
 */
export const JWT_SECRET = assertValue(
  process.env.JWT_SECRET,
  'Environment variable for JWT_SECRET is not set',
)

/**
 * Cookie secret used for signing cookies
 */
export const COOKIE_SECRET = assertValue(
  process.env.COOKIE_SECRET,
  'Environment variable for COOKIE_SECRET is not set',
)

/**
 * (optional) Minio configuration for file storage
 */
export const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT;
export const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
export const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
export const MINIO_BUCKET = process.env.MINIO_BUCKET; // Optional, if not set bucket will be called: medusa-media

/**
 * (optional) Resend API Key and from Email - do not set if using SendGrid
 */
export const RESEND_API_KEY = process.env.RESEND_API_KEY;
export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || process.env.RESEND_FROM;

/**
 * (optionl) SendGrid API Key and from Email - do not set if using Resend
 */
export const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
export const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || process.env.SENDGRID_FROM;

/**
 * From addresses for notification email providers (same gating as medusa-config).
 * Exposed in admin so staff see the effective sender; not sourced from a Resend HTTP API.
 */
export function getNotificationFromByProvider(): {
  resend: string | null
  sendgrid: string | null
} {
  return {
    resend:
      RESEND_API_KEY && RESEND_FROM_EMAIL ? RESEND_FROM_EMAIL : null,
    sendgrid:
      SENDGRID_API_KEY && SENDGRID_FROM_EMAIL
        ? SENDGRID_FROM_EMAIL
        : null,
  }
}

/**
 * (optional) Stripe API key and webhook secret
 */
export const STRIPE_API_KEY = process.env.STRIPE_API_KEY;
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * (optional) HitPay — API key, webhook salt (HMAC), sandbox flag, storefront redirect after checkout
 */
export const HITPAY_API_KEY = process.env.HITPAY_API_KEY;
export const HITPAY_SALT = process.env.HITPAY_SALT;
export const HITPAY_SANDBOX = process.env.HITPAY_SANDBOX === "true";
export const HITPAY_REDIRECT_URL = process.env.HITPAY_REDIRECT_URL;

/**
 * (optional) Meilisearch configuration
 */
export const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST;
export const MEILISEARCH_ADMIN_KEY = process.env.MEILISEARCH_ADMIN_KEY;

/**
 * Worker mode
 */
export const WORKER_MODE =
  (process.env.MEDUSA_WORKER_MODE as 'worker' | 'server' | 'shared' | undefined) ?? 'shared'

/**
 * Disable Admin
 */
export const SHOULD_DISABLE_ADMIN = process.env.MEDUSA_DISABLE_ADMIN === 'true'

/**
 * When true, `POST /store/carts/:id/complete-deferred` is enabled (order without payment/shipping).
 */
export const STORE_DEFERRED_CHECKOUT =
  process.env.STORE_DEFERRED_CHECKOUT === "true"

/**
 * Storefront origin for deferred invoice payment links (no trailing slash required).
 */
export const STOREFRONT_URL = process.env.STOREFRONT_URL?.trim() || ""

/**
 * Optional Handlebars URL for pay links in deferred invoice emails.
 * Variables: storefront_url, order_id, order_display_id, payment_collection_id
 */
export const DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE =
  process.env.DEFERRED_INVOICE_PAYMENT_URL_TEMPLATE?.trim() || ""

/**
 * WooCommerce REST API (optional). When all three are set, /admin/wc-import and
 * /admin/wc-sync-variant-color-hex use them; the admin UI hides URL / keys for import.
 */
export const WC_API_URL = process.env.WC_API_URL?.trim() || undefined
export const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY?.trim() || undefined
export const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET?.trim() || undefined

/**
 * DeepL — optional. When DEEPL_AUTH_KEY and DEEPL_TARGET_LANGS are set, admin can
 * translate product copy into metadata key `i18n` (JSON).
 */
export const DEEPL_AUTH_KEY = process.env.DEEPL_AUTH_KEY?.trim() || undefined
/** e.g. https://api-free.deepl.com/v2 or https://api.deepl.com/v2 */
export const DEEPL_API_BASE =
  process.env.DEEPL_API_BASE?.trim() || "https://api-free.deepl.com/v2"
export const DEEPL_SOURCE_LANG =
  process.env.DEEPL_SOURCE_LANG?.trim() || "EN"
/** Comma-separated DeepL target language codes, e.g. DE,FR,IT */
export const DEEPL_TARGET_LANGS = process.env.DEEPL_TARGET_LANGS?.trim() || ""
/**
 * Comma-separated product metadata keys to pass through DeepL with title/subtitle/description.
 * Values are read from product.metadata; translations live under `i18n` JSON only (per locale).
 * Never include the reserved key `i18n` here.
 */
export const DEEPL_METADATA_TRANSLATION_KEYS =
  process.env.DEEPL_METADATA_TRANSLATION_KEYS?.trim() || ""
/**
 * When true, subscribers run DeepL after product updates when source text changed.
 * Requires DEEPL_AUTH_KEY and DEEPL_TARGET_LANGS.
 */
export const DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE =
  process.env.DEEPL_AUTO_TRANSLATE_ON_PRODUCT_UPDATE === "true"
