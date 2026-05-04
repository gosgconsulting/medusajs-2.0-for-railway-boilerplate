import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Migrate the legacy "B2B / B2C / Retail" customer-segment sales channels into
 * product tags so the active-store dropdown can keep using sales channels for
 * tenant scoping (one SC per brand) without overloading them as customer-type
 * categorisation.
 *
 * After this script runs, every product currently linked to a sales channel
 * named (or containing) "B2B", "B2C" or "Retail" will also carry the matching
 * product_tag. The SC links themselves are left in place — removing them is a
 * destructive follow-up best done manually after verifying the tags look right.
 *
 * The migration is idempotent and safe to re-run: it relies on `ON CONFLICT DO
 * NOTHING` against the `product_tags` (product_id, product_tag_id) primary key
 * so already-tagged products are skipped.
 *
 * Run:        npx medusa exec ./src/scripts/migrate-customer-segment-sc-to-tags.ts
 * Dry-run:    npx medusa exec ./src/scripts/migrate-customer-segment-sc-to-tags.ts -- --dry-run
 */

const SEGMENT_TAG_VALUES = ["B2B", "B2C", "Retail"] as const
type SegmentTag = (typeof SEGMENT_TAG_VALUES)[number]

/**
 * Match SC names that "carry" the segment label. We anchor on word boundaries
 * (`\bB2B\b`, etc.) so a brand-prefixed SC like "Julia Paris B2C Storefront"
 * still matches but a stray "B2BX" wouldn't.
 */
function buildSegmentRegex(segment: SegmentTag): RegExp {
  return new RegExp(`\\b${segment}\\b`, "i")
}

export default async function migrateCustomerSegmentScToTags({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const pgConn = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as any

  const dryRun = process.argv.includes("--dry-run")
  logger.info(`Migrating segment SCs → tags${dryRun ? " (dry-run)" : ""}…`)

  // 1. Resolve / ensure tag ids for each segment value.
  const tagIdByValue: Record<SegmentTag, string> = {} as any
  for (const value of SEGMENT_TAG_VALUES) {
    const existing = await pgConn("product_tag")
      .select("id")
      .where("value", "ilike", value)
      .whereNull("deleted_at")
      .first()
    if (existing) {
      tagIdByValue[value] = existing.id
      continue
    }
    if (dryRun) {
      logger.info(`  would CREATE tag "${value}"`)
      tagIdByValue[value] = `__pending_${value}__`
      continue
    }
    const id = `ptag_${ulidLike()}`
    await pgConn("product_tag").insert({
      id,
      value,
      created_at: pgConn.fn.now(),
      updated_at: pgConn.fn.now(),
    })
    tagIdByValue[value] = id
    logger.info(`  CREATED tag "${value}" (${id})`)
  }

  // 2. For each segment, find matching SCs and tag every product linked to them.
  for (const segment of SEGMENT_TAG_VALUES) {
    const tagId = tagIdByValue[segment]
    const re = buildSegmentRegex(segment)

    const allScs: { id: string; name: string }[] = await pgConn("sales_channel")
      .select("id", "name")
      .whereNull("deleted_at")

    const matchedScs = allScs.filter((sc) => sc.name && re.test(sc.name))
    if (!matchedScs.length) {
      logger.info(`  ${segment}: no sales channels match — skipping`)
      continue
    }

    logger.info(
      `  ${segment}: matched ${matchedScs.length} SC(s): ${matchedScs
        .map((s) => s.name)
        .join(", ")}`
    )

    const scIds = matchedScs.map((s) => s.id)

    // Count products currently in the SCs that still lack the tag — purely informative.
    const pendingRows = await pgConn("product_sales_channel as psc")
      .join("product as p", function (this: any) {
        this.on("p.id", "psc.product_id").andOnNull("p.deleted_at")
      })
      .leftJoin("product_tags as pt", function (this: any) {
        this.on("pt.product_id", "psc.product_id").andOn(
          "pt.product_tag_id",
          pgConn.raw("?", [tagId])
        )
      })
      .whereIn("psc.sales_channel_id", scIds)
      .whereNull("psc.deleted_at")
      .whereNull("pt.product_id")
      .countDistinct({ c: "psc.product_id" })

    const pending = Number(pendingRows[0]?.c ?? 0)
    logger.info(`    products needing the ${segment} tag: ${pending}`)

    if (pending === 0 || dryRun) continue

    // Idempotent insert via ON CONFLICT DO NOTHING.
    const inserted = await pgConn.raw(
      `INSERT INTO product_tags (product_id, product_tag_id)
       SELECT DISTINCT psc.product_id, ?
       FROM product_sales_channel psc
       JOIN product p ON p.id = psc.product_id AND p.deleted_at IS NULL
       WHERE psc.sales_channel_id = ANY(?)
         AND psc.deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [tagId, scIds]
    )
    logger.info(`    tagged ${inserted.rowCount ?? 0} new product(s)`)
  }

  logger.info("Done.")
}

/**
 * Generates a 26-char Crockford-base32 ULID-shaped id without bringing in
 * the `ulid` package. Good enough for product_tag rows since Medusa accepts
 * arbitrary string ids in this table.
 */
function ulidLike(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let out = ""
  for (let i = 0; i < 26; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}
