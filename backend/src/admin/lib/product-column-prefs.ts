import { DEFAULT_VISIBLE_COLUMNS } from "./product-table-columns"

export const COL_PREFS_KEY = "medusa-admin-product-index-columns-v1"

export function loadColumnPrefs(): {
  mode: "default" | "custom"
  visible: Set<string>
} {
  if (typeof window === "undefined") {
    return { mode: "default", visible: new Set(DEFAULT_VISIBLE_COLUMNS) }
  }
  try {
    const raw = window.localStorage.getItem(COL_PREFS_KEY)
    if (!raw) {
      return { mode: "default", visible: new Set(DEFAULT_VISIBLE_COLUMNS) }
    }
    const p = JSON.parse(raw) as {
      mode?: string
      visible?: string[]
    }
    const mode = p.mode === "custom" ? "custom" : "default"
    const visible = new Set(
      Array.isArray(p.visible) && p.visible.length
        ? p.visible
        : DEFAULT_VISIBLE_COLUMNS
    )
    return { mode, visible }
  } catch {
    return { mode: "default", visible: new Set(DEFAULT_VISIBLE_COLUMNS) }
  }
}

export function saveColumnPrefs(
  mode: "default" | "custom",
  visible: Set<string>
) {
  try {
    window.localStorage.setItem(
      COL_PREFS_KEY,
      JSON.stringify({ mode, visible: [...visible] })
    )
  } catch {
    /* ignore */
  }
}
