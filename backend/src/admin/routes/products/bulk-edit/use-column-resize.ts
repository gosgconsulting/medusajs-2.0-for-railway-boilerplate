import * as React from "react"

/**
 * Mouse-drag column resizing for a table matched by `tableSelector`.
 * Attaches a small handle at the right edge of every `<th>` in thead.
 * Widths are persisted to localStorage, keyed by column index.
 */

const HANDLE_CLASS = "sheet-col-resizer"
const STORAGE_KEY = "bulkEdit.columnWidths.v1"

type Widths = Record<number, number>

function readWidths(): Widths {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Widths
  } catch {
    return {}
  }
}
function writeWidths(w: Widths): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w))
  } catch {
    /* quota or privacy mode — ignore */
  }
}

function getTable(selector: string): HTMLTableElement | null {
  return document.querySelector<HTMLTableElement>(selector)
}

function applyWidth(
  table: HTMLTableElement,
  colIndex: number,
  width: number
): void {
  const ths = table.tHead?.rows[0]?.cells
  if (ths && ths[colIndex]) {
    ths[colIndex].style.width = width + "px"
    ths[colIndex].style.minWidth = width + "px"
    ths[colIndex].style.maxWidth = width + "px"
  }
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      const cell = row.cells[colIndex]
      if (cell) {
        cell.style.width = width + "px"
        cell.style.minWidth = width + "px"
        cell.style.maxWidth = width + "px"
      }
    }
  }
}

function ensureHandles(table: HTMLTableElement): void {
  const headRow = table.tHead?.rows[0]
  if (!headRow) return
  const ths = Array.from(headRow.cells)
  ths.forEach((th, i) => {
    if (i === ths.length - 1) return // no handle on last column
    if (th.querySelector(`.${HANDLE_CLASS}`)) return
    const h = document.createElement("div")
    h.className = HANDLE_CLASS
    h.dataset.col = String(i)
    h.style.cssText = [
      "position: absolute",
      "top: 0",
      "right: -3px",
      "width: 6px",
      "height: 100%",
      "cursor: col-resize",
      "z-index: 20",
      "user-select: none",
    ].join(";")
    h.addEventListener("mouseenter", () => {
      h.style.background = "rgba(59,130,246,0.5)"
    })
    h.addEventListener("mouseleave", () => {
      h.style.background = "transparent"
    })
    th.style.position = "relative"
    th.appendChild(h)
  })
}

export function useColumnResize(tableSelector: string): void {
  React.useEffect(() => {
    // Keep-alive loop: re-apply handles & persisted widths whenever the table
    // (re)appears. Observing document.body covers the "Loading…" → table swap
    // as well as any in-table thead re-render.
    const applyAll = () => {
      const table = getTable(tableSelector)
      if (!table) return
      const widths = readWidths()
      for (const k of Object.keys(widths)) {
        applyWidth(table, Number(k), widths[Number(k)])
      }
      ensureHandles(table)
    }
    applyAll()
    const obs = new MutationObserver(() => applyAll())
    obs.observe(document.body, { childList: true, subtree: true })

    let drag: {
      colIndex: number
      startX: number
      startWidth: number
    } | null = null

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t?.classList.contains(HANDLE_CLASS)) return
      const table = getTable(tableSelector)
      if (!table) return
      const ci = Number(t.dataset.col)
      if (Number.isNaN(ci)) return
      const th = table.tHead?.rows[0]?.cells[ci]
      if (!th) return
      drag = {
        colIndex: ci,
        startX: e.clientX,
        startWidth: th.getBoundingClientRect().width,
      }
      document.body.style.cursor = "col-resize"
      e.preventDefault()
      e.stopPropagation()
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!drag) return
      const table = getTable(tableSelector)
      if (!table) return
      const next = Math.max(40, drag.startWidth + (e.clientX - drag.startX))
      applyWidth(table, drag.colIndex, next)
    }
    const onMouseUp = () => {
      if (!drag) return
      const table = getTable(tableSelector)
      const th = table?.tHead?.rows[0]?.cells[drag.colIndex]
      if (th) {
        const w = readWidths()
        w[drag.colIndex] = Math.round(th.getBoundingClientRect().width)
        writeWidths(w)
      }
      drag = null
      document.body.style.cursor = ""
    }

    document.addEventListener("mousedown", onMouseDown, true)
    document.addEventListener("mousemove", onMouseMove, true)
    document.addEventListener("mouseup", onMouseUp, true)
    return () => {
      obs.disconnect()
      document.removeEventListener("mousedown", onMouseDown, true)
      document.removeEventListener("mousemove", onMouseMove, true)
      document.removeEventListener("mouseup", onMouseUp, true)
    }
  }, [tableSelector])
}
