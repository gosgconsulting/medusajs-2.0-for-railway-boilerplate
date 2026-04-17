import type Medusa from "@medusajs/js-sdk"
import { DEFAULT_VISIBLE_COLUMNS } from "./product-table-columns"

export const COL_PREFS_KEY = "medusa-admin-product-index-columns-v1"

export type CustomColumnSource =
  | { kind: "variant_metadata"; key: string }
  | { kind: "product_metadata"; key: string }

export type CustomColumnDef = {
  id: string
  label: string
  source: CustomColumnSource
}

/** Payload stored in DB and mirrored in localStorage */
export type ProductColumnPrefsPayload = {
  mode: "default" | "custom"
  visible: string[]
  customColumns: CustomColumnDef[]
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
    if (src.kind === "variant_metadata" && typeof src.key === "string" && src.key.trim()) {
      out.push({ id, label, source: { kind: "variant_metadata", key: src.key.trim() } })
      continue
    }
    if (src.kind === "product_metadata" && typeof src.key === "string" && src.key.trim()) {
      out.push({ id, label, source: { kind: "product_metadata", key: src.key.trim() } })
    }
  }
  return out
}

export function newCustomColumnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `cc_${crypto.randomUUID()}`
  }
  return `cc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function loadColumnPrefs(): {
  mode: "default" | "custom"
  visible: Set<string>
  customColumns: CustomColumnDef[]
} {
  if (typeof window === "undefined") {
    return {
      mode: "default",
      visible: new Set(DEFAULT_VISIBLE_COLUMNS),
      customColumns: [],
    }
  }
  try {
    const raw = window.localStorage.getItem(COL_PREFS_KEY)
    if (!raw) {
      return {
        mode: "default",
        visible: new Set(DEFAULT_VISIBLE_COLUMNS),
        customColumns: [],
      }
    }
    const p = JSON.parse(raw) as {
      mode?: string
      visible?: string[]
      customColumns?: unknown
    }
    const mode = p.mode === "custom" ? "custom" : "default"
    const visible = new Set(
      Array.isArray(p.visible) && p.visible.length
        ? p.visible
        : DEFAULT_VISIBLE_COLUMNS
    )
    return { mode, visible, customColumns: parseCustomColumns(p.customColumns) }
  } catch {
    return {
      mode: "default",
      visible: new Set(DEFAULT_VISIBLE_COLUMNS),
      customColumns: [],
    }
  }
}

export function saveColumnPrefs(
  mode: "default" | "custom",
  visible: Set<string>,
  customColumns?: CustomColumnDef[]
) {
  try {
    let mergedCustom: CustomColumnDef[] = []
    const raw = window.localStorage.getItem(COL_PREFS_KEY)
    if (raw) {
      try {
        const p = JSON.parse(raw) as { customColumns?: unknown }
        mergedCustom = parseCustomColumns(p.customColumns)
      } catch {
        mergedCustom = []
      }
    }
    if (customColumns !== undefined) {
      mergedCustom = customColumns
    }
    window.localStorage.setItem(
      COL_PREFS_KEY,
      JSON.stringify({
        mode,
        visible: [...visible],
        customColumns: mergedCustom,
      })
    )
  } catch {
    /* ignore */
  }
}

/** Apply server prefs to localStorage (and callers should mirror into React state). */
export function applyProductColumnPrefsPayload(
  prefs: ProductColumnPrefsPayload
): void {
  const visible = new Set(
    Array.isArray(prefs.visible) && prefs.visible.length
      ? prefs.visible
      : [...DEFAULT_VISIBLE_COLUMNS]
  )
  saveColumnPrefs(prefs.mode, visible, prefs.customColumns ?? [])
}

export async function fetchRemoteProductColumnPrefs(
  sdk: Medusa
): Promise<ProductColumnPrefsPayload | null> {
  try {
    const res = (await sdk.client.fetch("/admin/me/product-column-prefs")) as {
      prefs: ProductColumnPrefsPayload | null
    }
    return res.prefs ?? null
  } catch {
    return null
  }
}

export async function saveRemoteProductColumnPrefs(
  sdk: Medusa,
  prefs: ProductColumnPrefsPayload
): Promise<void> {
  await sdk.client.fetch("/admin/me/product-column-prefs", {
    method: "PUT",
    body: prefs,
  })
}
