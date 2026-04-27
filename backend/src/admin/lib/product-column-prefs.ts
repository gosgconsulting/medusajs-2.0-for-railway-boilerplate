import type Medusa from "@medusajs/js-sdk"
import {
  B2B_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
} from "./product-table-columns"

/** Stable id for the built-in "B2B" preset view. Stable so the preset is
 *  recognized across reloads and not duplicated. */
export const B2B_PRESET_VIEW_ID = "view_preset_b2b"

export const COL_PREFS_KEY = "medusa-admin-product-index-columns-v1"
export const SAVED_VIEWS_KEY = "medusa-admin-bulk-edit-views-v1"

export type CustomColumnSource =
  | { kind: "variant_metadata"; key: string }
  | { kind: "product_metadata"; key: string }

export type CustomColumnDef = {
  id: string
  label: string
  source: CustomColumnSource
}

export type SavedView = {
  id: string
  name: string
  visible: string[]
  customColumns: CustomColumnDef[]
  /** User-defined column display order (by column id). If absent, falls back to TOGGLEABLE_COLUMNS order. */
  order?: string[]
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

// ─── Saved views (bulk-edit) ────────────────────────────────────────────────

export function newSavedViewId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `view_${crypto.randomUUID()}`
  }
  return `view_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function parseSavedViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return []
  const out: SavedView[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === "string" && o.id.startsWith("view_") ? o.id : ""
    const name = typeof o.name === "string" ? o.name.trim() : ""
    if (!id || !name) continue
    const visible = Array.isArray(o.visible)
      ? (o.visible as unknown[]).filter(
          (s): s is string => typeof s === "string"
        )
      : []
    const customColumns = parseCustomColumns(o.customColumns)
    const order = Array.isArray(o.order)
      ? (o.order as unknown[]).filter(
          (s): s is string => typeof s === "string"
        )
      : undefined
    out.push({ id, name, visible, customColumns, order })
  }
  return out
}

/** Built-in "B2B" preset view — every toggleable column including the
 *  custom B2B-pricing ones (B2B discount, Client A/B/C/D). Always present in
 *  the dropdown; cannot be deleted (the page filters delete by preset id). */
export function buildB2bPresetView(): SavedView {
  return {
    id: B2B_PRESET_VIEW_ID,
    name: "B2B",
    visible: [...B2B_VISIBLE_COLUMNS],
    customColumns: [],
    order: [...DEFAULT_COLUMN_ORDER],
  }
}

/** Returns true if the given view id is a built-in preset (cannot be deleted). */
export function isPresetViewId(id: string): boolean {
  return id === B2B_PRESET_VIEW_ID
}

export function loadSavedViews(): {
  savedViews: SavedView[]
  currentViewId: string | null
} {
  const ensureB2bPreset = (views: SavedView[]): SavedView[] => {
    if (views.some((v) => v.id === B2B_PRESET_VIEW_ID)) return views
    // Inject the preset so it's always selectable from the dropdown. User
    // customizations of the preset are persisted normally (parseSavedViews
    // accepts any view_* id including the preset id).
    return [buildB2bPresetView(), ...views]
  }

  if (typeof window === "undefined") {
    return { savedViews: ensureB2bPreset([]), currentViewId: null }
  }
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY)
    if (!raw) return { savedViews: ensureB2bPreset([]), currentViewId: null }
    const p = JSON.parse(raw) as {
      savedViews?: unknown
      currentViewId?: unknown
    }
    const savedViews = ensureB2bPreset(parseSavedViews(p.savedViews))
    const rawId = typeof p.currentViewId === "string" ? p.currentViewId : null
    const currentViewId =
      rawId && savedViews.some((v) => v.id === rawId) ? rawId : null
    return { savedViews, currentViewId }
  } catch {
    return { savedViews: ensureB2bPreset([]), currentViewId: null }
  }
}

export function saveSavedViews(
  savedViews: SavedView[],
  currentViewId: string | null
): void {
  try {
    window.localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify({ savedViews, currentViewId })
    )
  } catch {
    /* ignore */
  }
}
