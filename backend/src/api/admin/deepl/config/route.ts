import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEEPL_AUTH_KEY, DEEPL_TARGET_LANGS } from "../../../../lib/constants"

function parseCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * GET /admin/deepl/config
 * Non-secret flags for admin UI (bulk translate checkboxes).
 */
export async function GET(_req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const targetLangs = parseCommaList(DEEPL_TARGET_LANGS)
  const enabled = Boolean(DEEPL_AUTH_KEY?.trim() && targetLangs.length > 0)
  res.status(200).json({ enabled, targetLangs })
}
