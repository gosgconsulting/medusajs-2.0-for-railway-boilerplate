import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ADMIN_PRODUCT_TABLE_PREF_MODULE } from "../../../../modules/admin-product-table-pref/constants"

const MAX_PAYLOAD_CHARS = 120_000
const MAX_CUSTOM_COLUMNS = 80

const MIGRATE_HINT =
  "Run database migrations: npx medusa db:migrate (table admin_product_table_pref is missing)."

function isMissingPrefTableError(err: unknown): boolean {
  const e = err as { code?: string; message?: string }
  if (e?.code === "42P01") return true
  const msg = typeof e?.message === "string" ? e.message : ""
  return (
    msg.includes("admin_product_table_pref") &&
    (msg.includes("does not exist") || msg.includes("relation"))
  )
}

type CustomColumnSource =
  | { kind: "variant_metadata"; key: string }
  | { kind: "product_metadata"; key: string }

type CustomColumnDef = {
  id: string
  label: string
  source: CustomColumnSource
}

type PrefsPayload = {
  mode: "default" | "custom"
  visible: string[]
  customColumns: CustomColumnDef[]
}

type PrefRow = {
  id: string
  user_id: string
  payload: string
}

function parseCustomColumns(raw: unknown): CustomColumnDef[] {
  if (!Array.isArray(raw)) return []
  const out: CustomColumnDef[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === "string" && o.id.startsWith("cc_") ? o.id : ""
    const label = typeof o.label === "string" ? o.label.trim() : ""
    const src = o.source as CustomColumnSource | undefined
    if (!id || !label || !src || typeof src !== "object") continue
    if (
      src.kind === "variant_metadata" &&
      typeof src.key === "string" &&
      src.key.trim()
    ) {
      out.push({
        id,
        label,
        source: { kind: "variant_metadata", key: src.key.trim() },
      })
      continue
    }
    if (
      src.kind === "product_metadata" &&
      typeof src.key === "string" &&
      src.key.trim()
    ) {
      out.push({
        id,
        label,
        source: { kind: "product_metadata", key: src.key.trim() },
      })
    }
  }
  return out
}

function parsePrefsBody(body: unknown): PrefsPayload {
  if (!body || typeof body !== "object") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid body")
  }
  const b = body as Record<string, unknown>
  const mode = b.mode === "custom" ? "custom" : "default"
  const visible = Array.isArray(b.visible)
    ? b.visible.filter((x): x is string => typeof x === "string")
    : []
  const customColumns = parseCustomColumns(b.customColumns)
  if (customColumns.length > MAX_CUSTOM_COLUMNS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `At most ${MAX_CUSTOM_COLUMNS} custom columns allowed`
    )
  }
  return { mode, visible, customColumns }
}

function actorId(req: MedusaRequest): string | undefined {
  const ctx = (
    req as MedusaRequest & { auth_context?: { actor_id?: string } }
  ).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id.trim()
    ? ctx.actor_id.trim()
    : undefined
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const userId = actorId(req)
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const mod = req.scope.resolve(ADMIN_PRODUCT_TABLE_PREF_MODULE) as {
    listAdminProductTablePrefs: (
      filters?: { user_id?: string },
      config?: { take?: number }
    ) => Promise<PrefRow[]>
  }

  let rows: PrefRow[]
  try {
    rows = await mod.listAdminProductTablePrefs({ user_id: userId }, { take: 1 })
  } catch (err) {
    if (isMissingPrefTableError(err)) {
      res.status(200).json({
        prefs: null as PrefsPayload | null,
        migration_pending: true,
        message: MIGRATE_HINT,
      })
      return
    }
    throw err
  }

  const row = rows[0]
  if (!row?.payload) {
    res.status(200).json({ prefs: null as PrefsPayload | null })
    return
  }

  try {
    const parsed = JSON.parse(row.payload) as Partial<PrefsPayload>
    const prefs: PrefsPayload = {
      mode: parsed.mode === "custom" ? "custom" : "default",
      visible: Array.isArray(parsed.visible)
        ? parsed.visible.filter((x): x is string => typeof x === "string")
        : [],
      customColumns: parseCustomColumns(parsed.customColumns),
    }
    res.status(200).json({ prefs })
  } catch {
    res.status(200).json({ prefs: null })
  }
}

export async function PUT(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const userId = actorId(req)
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  let prefs: PrefsPayload
  try {
    prefs = parsePrefsBody(req.body)
  } catch (e) {
    const msg = e instanceof MedusaError ? e.message : "Invalid body"
    res.status(400).json({ message: msg })
    return
  }

  const payload = JSON.stringify(prefs)
  if (payload.length > MAX_PAYLOAD_CHARS) {
    res.status(400).json({ message: "Preferences payload is too large" })
    return
  }

  const mod = req.scope.resolve(ADMIN_PRODUCT_TABLE_PREF_MODULE) as {
    listAdminProductTablePrefs: (
      filters?: { user_id?: string },
      config?: { take?: number }
    ) => Promise<PrefRow[]>
    createAdminProductTablePrefs: (data: {
      user_id: string
      payload: string
    }) => Promise<PrefRow>
    updateAdminProductTablePrefs: (data: {
      id: string
      payload: string
    }) => Promise<PrefRow>
  }

  let existing: PrefRow[]
  try {
    existing = await mod.listAdminProductTablePrefs({ user_id: userId }, { take: 1 })
  } catch (err) {
    if (isMissingPrefTableError(err)) {
      res.status(503).json({ message: MIGRATE_HINT, migration_pending: true })
      return
    }
    throw err
  }

  const row = existing[0]

  let saved: PrefRow
  try {
    saved = row
      ? await mod.updateAdminProductTablePrefs({ id: row.id, payload })
      : await mod.createAdminProductTablePrefs({ user_id: userId, payload })
  } catch (err) {
    if (isMissingPrefTableError(err)) {
      res.status(503).json({ message: MIGRATE_HINT, migration_pending: true })
      return
    }
    throw err
  }

  res.status(200).json({
    prefs: JSON.parse(saved.payload) as PrefsPayload,
  })
}
