import * as React from "react"

/**
 * Spreadsheet mechanics for the bulk-edit table.
 *
 * Features:
 *   • Click / Shift+click / mouse-drag selection.
 *   • Ctrl+click (Cmd+click) adds a cell or range to a non-contiguous selection.
 *   • Arrow / Shift+Arrow / Tab / Shift+Tab / Enter / Escape / Home / End / Ctrl+Home / Ctrl+End.
 *   • Ctrl+A — select all cells.
 *   • Ctrl+C — serialize bounding rect of the primary range to TSV and write
 *     to the clipboard.
 *   • Ctrl+V — read clipboard TSV, write into cells via the React-compatible
 *     native-value setter so the existing onChange handlers fire.
 *   • Drag-fill handle at the bottom-right of the primary range; releasing
 *     the drag copies the source value into the new rect.
 *   • Enter on a picker cell (no input) clicks the first inner button to open
 *     the existing dropdown/picker.
 *
 * Uses document-level event delegation against cells matched by
 * `td[data-cell]` inside `tableSelector`, so React re-rendering the table
 * does not orphan the handlers.
 */

const ACTIVE_CLASS = "sheet-cell-active"
const SELECTED_CLASS = "sheet-cell-selected"
const FILL_HANDLE_ID = "sheet-fill-handle"

type CellCoord = { row: number; col: number }
type Range = { anchor: CellCoord; focus: CellCoord }

function rectFromRange(r: Range): {
  r0: number
  r1: number
  c0: number
  c1: number
} {
  return {
    r0: Math.min(r.anchor.row, r.focus.row),
    r1: Math.max(r.anchor.row, r.focus.row),
    c0: Math.min(r.anchor.col, r.focus.col),
    c1: Math.max(r.anchor.col, r.focus.col),
  }
}

function unionRect(ranges: Range[]): {
  r0: number
  r1: number
  c0: number
  c1: number
} | null {
  if (ranges.length === 0) return null
  let r0 = Infinity,
    r1 = -Infinity,
    c0 = Infinity,
    c1 = -Infinity
  for (const rg of ranges) {
    const r = rectFromRange(rg)
    r0 = Math.min(r0, r.r0)
    r1 = Math.max(r1, r.r1)
    c0 = Math.min(c0, r.c0)
    c1 = Math.max(c1, r.c1)
  }
  return { r0, r1, c0, c1 }
}

function getTable(selector: string): HTMLTableElement | null {
  return document.querySelector<HTMLTableElement>(selector)
}

function buildGrid(table: HTMLTableElement): HTMLTableCellElement[][] {
  const rows = Array.from(table.tBodies).flatMap((b) => Array.from(b.rows))
  return rows.map((tr) =>
    Array.from(tr.querySelectorAll<HTMLTableCellElement>("td[data-cell]"))
  )
}

function findCellCoord(
  grid: HTMLTableCellElement[][],
  target: HTMLElement | null
): CellCoord | null {
  if (!target) return null
  const td = target.closest("td[data-cell]") as HTMLTableCellElement | null
  if (!td) return null
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    for (let c = 0; c < row.length; c++) {
      if (row[c] === td) return { row: r, col: c }
    }
  }
  return null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const type = (target as HTMLInputElement).type
    if (type === "checkbox" || type === "radio" || type === "button") return false
    return true
  }
  if (target.isContentEditable) return true
  return false
}

function isInsideTable(
  table: HTMLTableElement,
  target: EventTarget | null
): boolean {
  if (!(target instanceof Node)) return false
  return table.contains(target)
}

function cellControl(
  td: HTMLTableCellElement
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null {
  return td.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select")
}

function readCellValue(td: HTMLTableCellElement): string {
  const ctrl = cellControl(td)
  if (ctrl) {
    if (ctrl.tagName === "SELECT") {
      const sel = ctrl as HTMLSelectElement
      return sel.options[sel.selectedIndex]?.text?.trim() ?? sel.value
    }
    const t = (ctrl as HTMLInputElement).type
    if (t === "checkbox") {
      return (ctrl as HTMLInputElement).checked ? "TRUE" : "FALSE"
    }
    return ctrl.value ?? ""
  }
  return (td.textContent ?? "").trim()
}

function writeCellValue(td: HTMLTableCellElement, value: string): boolean {
  const ctrl = cellControl(td)
  if (!ctrl) return false
  if ((ctrl as HTMLInputElement).disabled) return false
  const tag = ctrl.tagName
  if (tag === "SELECT") {
    const sel = ctrl as HTMLSelectElement
    const match = Array.from(sel.options).find(
      (o) =>
        o.value === value ||
        o.text.trim().toLowerCase() === value.trim().toLowerCase()
    )
    if (!match) return false
    const proto = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value"
    )?.set
    proto?.call(sel, match.value)
    sel.dispatchEvent(new Event("input", { bubbles: true }))
    sel.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }
  if (tag === "INPUT" || tag === "TEXTAREA") {
    const input = ctrl as HTMLInputElement | HTMLTextAreaElement
    const type = (input as HTMLInputElement).type
    if (type === "checkbox" || type === "radio") {
      const next =
        value.trim().toLowerCase() === "true" || value.trim() === "1"
      if ((input as HTMLInputElement).checked !== next) {
        ;(input as HTMLInputElement).click()
      }
      return true
    }
    const proto = Object.getOwnPropertyDescriptor(
      (tag === "INPUT" ? window.HTMLInputElement : window.HTMLTextAreaElement)
        .prototype,
      "value"
    )?.set
    proto?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }
  return false
}

type DragFillState = { from: CellCoord; startedAt: CellCoord } | null

export function useSpreadsheet(tableSelector: string): void {
  const stateRef = React.useRef<{
    active: CellCoord | null
    ranges: Range[] // primary range is the last element
    dragging: boolean
    filling: DragFillState
  }>({ active: null, ranges: [], dragging: false, filling: null })

  const ensureFillHandle = React.useCallback(() => {
    let handle = document.getElementById(FILL_HANDLE_ID)
    if (!handle) {
      handle = document.createElement("div")
      handle.id = FILL_HANDLE_ID
      handle.style.cssText = [
        "position: absolute",
        "width: 8px",
        "height: 8px",
        "background: rgb(59,130,246)",
        "border: 1px solid white",
        "cursor: crosshair",
        "z-index: 30",
        "display: none",
        "pointer-events: auto",
      ].join(";")
      document.body.appendChild(handle)
    }
    return handle as HTMLDivElement
  }, [])

  const positionFillHandle = React.useCallback(() => {
    const handle = ensureFillHandle()
    const table = getTable(tableSelector)
    if (!table) {
      handle.style.display = "none"
      return
    }
    const grid = buildGrid(table)
    const ranges = stateRef.current.ranges
    const primary = ranges[ranges.length - 1]
    if (!primary) {
      handle.style.display = "none"
      return
    }
    const { r1, c1 } = rectFromRange(primary)
    const cell = grid[r1]?.[c1]
    if (!cell) {
      handle.style.display = "none"
      return
    }
    const rect = cell.getBoundingClientRect()
    handle.style.left = rect.right - 5 + window.scrollX + "px"
    handle.style.top = rect.bottom - 5 + window.scrollY + "px"
    handle.style.display = "block"
  }, [ensureFillHandle, tableSelector])

  const repaint = React.useCallback(() => {
    const table = getTable(tableSelector)
    if (!table) return
    const grid = buildGrid(table)
    table
      .querySelectorAll<HTMLTableCellElement>(
        `td.${ACTIVE_CLASS}, td.${SELECTED_CLASS}`
      )
      .forEach((td) => td.classList.remove(ACTIVE_CLASS, SELECTED_CLASS))

    const { active, ranges } = stateRef.current
    for (const rg of ranges) {
      const { r0, r1, c0, c1 } = rectFromRange(rg)
      for (let r = r0; r <= r1; r++) {
        const row = grid[r]
        if (!row) continue
        for (let c = c0; c <= c1; c++) {
          row[c]?.classList.add(SELECTED_CLASS)
        }
      }
    }
    if (active) {
      grid[active.row]?.[active.col]?.classList.add(ACTIVE_CLASS)
    }
    positionFillHandle()
  }, [positionFillHandle, tableSelector])

  // Repaint whenever the table is mutated (React re-renders rows/cells).
  React.useEffect(() => {
    const table = getTable(tableSelector)
    if (!table) return
    const obs = new MutationObserver(() => repaint())
    obs.observe(table, { childList: true, subtree: true })
    const onScrollOrResize = () => positionFillHandle()
    window.addEventListener("scroll", onScrollOrResize, true)
    window.addEventListener("resize", onScrollOrResize)
    repaint()
    return () => {
      obs.disconnect()
      window.removeEventListener("scroll", onScrollOrResize, true)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [positionFillHandle, repaint, tableSelector])

  React.useEffect(() => {
    return () => {
      document.getElementById(FILL_HANDLE_ID)?.remove()
    }
  }, [])

  React.useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const handle = document.getElementById(FILL_HANDLE_ID)
      if (handle && e.target === handle) {
        const table = getTable(tableSelector)
        if (!table) return
        const ranges = stateRef.current.ranges
        const primary = ranges[ranges.length - 1]
        if (!primary) return
        const { r1, c1 } = rectFromRange(primary)
        stateRef.current.filling = {
          from: { row: r1, col: c1 },
          startedAt: { row: r1, col: c1 },
        }
        e.preventDefault()
        return
      }

      const table = getTable(tableSelector)
      if (!table || !isInsideTable(table, e.target)) return
      if (e.button !== 0) return
      const grid = buildGrid(table)
      const coord = findCellCoord(grid, e.target as HTMLElement)
      if (!coord) return
      const editing = isEditingTarget(e.target)
      const meta = e.ctrlKey || e.metaKey
      const prev = stateRef.current.active
      if (e.shiftKey && prev && !editing) {
        // Extend the primary range
        const ranges = stateRef.current.ranges.slice()
        if (ranges.length === 0) {
          ranges.push({ anchor: prev, focus: coord })
        } else {
          ranges[ranges.length - 1] = {
            anchor: ranges[ranges.length - 1].anchor,
            focus: coord,
          }
        }
        stateRef.current.ranges = ranges
      } else if (meta && !editing) {
        // Non-contiguous: add a new single-cell range
        stateRef.current.active = coord
        stateRef.current.ranges = [
          ...stateRef.current.ranges,
          { anchor: coord, focus: coord },
        ]
      } else {
        stateRef.current.active = coord
        stateRef.current.ranges = [{ anchor: coord, focus: coord }]
        if (!editing) stateRef.current.dragging = true
      }
      repaint()
    }

    const onMouseMove = (e: MouseEvent) => {
      const table = getTable(tableSelector)
      if (!table) return

      if (stateRef.current.filling) {
        const el = document.elementFromPoint(e.clientX, e.clientY) as
          | HTMLElement
          | null
        if (!el) return
        const grid = buildGrid(table)
        const coord = findCellCoord(grid, el)
        if (!coord) return
        const anchor = stateRef.current.filling.startedAt
        const ranges = stateRef.current.ranges.slice()
        ranges[ranges.length - 1] = { anchor, focus: coord }
        stateRef.current.ranges = ranges
        repaint()
        return
      }

      if (!stateRef.current.dragging) return
      const grid = buildGrid(table)
      const coord = findCellCoord(grid, e.target as HTMLElement)
      const anchor = stateRef.current.active
      if (!coord || !anchor) return
      const ranges = stateRef.current.ranges.slice()
      ranges[ranges.length - 1] = { anchor, focus: coord }
      stateRef.current.ranges = ranges
      repaint()
    }

    const onMouseUp = () => {
      if (stateRef.current.filling) {
        const table = getTable(tableSelector)
        if (table) {
          const grid = buildGrid(table)
          const src = stateRef.current.filling.from
          const ranges = stateRef.current.ranges
          const primary = ranges[ranges.length - 1]
          const srcCell = grid[src.row]?.[src.col]
          if (primary && srcCell) {
            const srcValue = readCellValue(srcCell)
            const { r0, r1, c0, c1 } = rectFromRange(primary)
            for (let r = r0; r <= r1; r++) {
              for (let c = c0; c <= c1; c++) {
                if (r === src.row && c === src.col) continue
                const td = grid[r]?.[c]
                if (td) writeCellValue(td, srcValue)
              }
            }
          }
        }
        stateRef.current.filling = null
      }
      stateRef.current.dragging = false
    }

    const onKeyDown = async (e: KeyboardEvent) => {
      const table = getTable(tableSelector)
      if (!table) return
      const active = stateRef.current.active
      if (!active) return
      if (!isInsideTable(table, e.target)) return
      const grid = buildGrid(table)
      const rows = grid.length
      if (!rows) return
      const cols = grid[active.row]?.length ?? 0
      if (!cols) return
      const editing = isEditingTarget(e.target)
      const meta = e.ctrlKey || e.metaKey

      if (meta && e.key.toLowerCase() === "a" && !editing) {
        e.preventDefault()
        const lastRow = rows - 1
        const lastCol = (grid[lastRow]?.length ?? 1) - 1
        stateRef.current.ranges = [
          {
            anchor: { row: 0, col: 0 },
            focus: { row: lastRow, col: lastCol },
          },
        ]
        repaint()
        return
      }

      if (meta && e.key.toLowerCase() === "c" && !editing) {
        const ranges = stateRef.current.ranges
        if (!ranges.length) return
        e.preventDefault()
        const rect = unionRect(ranges)
        if (!rect) return
        const { r0, r1, c0, c1 } = rect
        const lines: string[] = []
        for (let r = r0; r <= r1; r++) {
          const colsOut: string[] = []
          for (let c = c0; c <= c1; c++) {
            const td = grid[r]?.[c]
            colsOut.push(td ? readCellValue(td).replace(/\t|\r|\n/g, " ") : "")
          }
          lines.push(colsOut.join("\t"))
        }
        const tsv = lines.join("\n")
        try {
          await navigator.clipboard.writeText(tsv)
        } catch {
          const ta = document.createElement("textarea")
          ta.value = tsv
          document.body.appendChild(ta)
          ta.select()
          document.execCommand("copy")
          ta.remove()
        }
        return
      }

      if (meta && e.key.toLowerCase() === "v" && !editing) {
        e.preventDefault()
        let text = ""
        try {
          text = await navigator.clipboard.readText()
        } catch {
          return
        }
        if (!text) return
        const matrix = text
          .replace(/\r\n?/g, "\n")
          .replace(/\n$/, "")
          .split("\n")
          .map((ln) => ln.split("\t"))
        const startRow = active.row
        const startCol = active.col
        for (let dr = 0; dr < matrix.length; dr++) {
          for (let dc = 0; dc < matrix[dr].length; dc++) {
            const td = grid[startRow + dr]?.[startCol + dc]
            if (td) writeCellValue(td, matrix[dr][dc])
          }
        }
        const endRow = clamp(startRow + matrix.length - 1, 0, rows - 1)
        const lastMatrixCols = matrix.reduce((m, r) => Math.max(m, r.length), 0)
        const endCol = clamp(
          startCol + lastMatrixCols - 1,
          0,
          (grid[endRow]?.length ?? 1) - 1
        )
        stateRef.current.ranges = [
          { anchor: active, focus: { row: endRow, col: endCol } },
        ]
        repaint()
        return
      }

      if (e.key === "Escape") {
        if (editing && e.target instanceof HTMLElement) e.target.blur()
        stateRef.current.ranges = [{ anchor: active, focus: active }]
        repaint()
        return
      }

      if (e.key === "Delete" && !editing) {
        e.preventDefault()
        const ranges = stateRef.current.ranges
        for (const rg of ranges) {
          const { r0, r1, c0, c1 } = rectFromRange(rg)
          for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
              const td = grid[r]?.[c]
              if (td) writeCellValue(td, "")
            }
          }
        }
        return
      }

      if (e.key === "Enter" && !e.shiftKey && !editing) {
        const cell = grid[active.row]?.[active.col]
        if (!cell) return
        const ctrl = cellControl(cell)
        if (ctrl) {
          e.preventDefault()
          ;(ctrl as HTMLElement).focus()
          const v = ctrl as HTMLInputElement
          if (typeof v.select === "function") v.select()
          return
        }
        const btn = cell.querySelector<HTMLButtonElement>("button")
        if (btn) {
          e.preventDefault()
          btn.click()
        }
        return
      }

      if (e.key === "Home") {
        e.preventDefault()
        const target: CellCoord = meta
          ? { row: 0, col: 0 }
          : { row: active.row, col: 0 }
        if (e.shiftKey) {
          const ranges = stateRef.current.ranges.slice()
          const anchor = ranges[ranges.length - 1]?.anchor ?? active
          ranges[ranges.length - 1] = { anchor, focus: target }
          stateRef.current.ranges = ranges
        } else {
          stateRef.current.active = target
          stateRef.current.ranges = [{ anchor: target, focus: target }]
        }
        repaint()
        return
      }
      if (e.key === "End") {
        e.preventDefault()
        const rowIdx = meta ? rows - 1 : active.row
        const colIdx = (grid[rowIdx]?.length ?? 1) - 1
        const target: CellCoord = { row: rowIdx, col: colIdx }
        if (e.shiftKey) {
          const ranges = stateRef.current.ranges.slice()
          const anchor = ranges[ranges.length - 1]?.anchor ?? active
          ranges[ranges.length - 1] = { anchor, focus: target }
          stateRef.current.ranges = ranges
        } else {
          stateRef.current.active = target
          stateRef.current.ranges = [{ anchor: target, focus: target }]
        }
        repaint()
        return
      }

      if (e.key === "Tab") {
        e.preventDefault()
        const next = { ...active }
        if (e.shiftKey) {
          next.col -= 1
          if (next.col < 0) {
            next.row = Math.max(0, next.row - 1)
            next.col = (grid[next.row]?.length ?? 1) - 1
          }
        } else {
          next.col += 1
          if (next.col >= cols) {
            next.row = Math.min(rows - 1, next.row + 1)
            next.col = 0
          }
        }
        stateRef.current.active = next
        stateRef.current.ranges = [{ anchor: next, focus: next }]
        repaint()
        return
      }

      if (editing && !e.shiftKey) return

      const delta: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      }
      const d = delta[e.key]
      if (!d) return
      e.preventDefault()
      const ranges = stateRef.current.ranges
      const primary = ranges[ranges.length - 1]
      const anchor = primary?.anchor ?? active
      const focus = primary?.focus ?? active
      if (e.shiftKey) {
        const nextRow = clamp(focus.row + d[0], 0, rows - 1)
        const next = {
          row: nextRow,
          col: clamp(focus.col + d[1], 0, (grid[nextRow]?.length ?? 1) - 1),
        }
        const newRanges = ranges.slice()
        newRanges[newRanges.length - 1] = { anchor, focus: next }
        stateRef.current.ranges = newRanges
      } else {
        const nextRow = clamp(active.row + d[0], 0, rows - 1)
        const next = {
          row: nextRow,
          col: clamp(active.col + d[1], 0, (grid[nextRow]?.length ?? 1) - 1),
        }
        stateRef.current.active = next
        stateRef.current.ranges = [{ anchor: next, focus: next }]
      }
      repaint()
    }

    document.addEventListener("mousedown", onMouseDown, true)
    document.addEventListener("mousemove", onMouseMove, true)
    document.addEventListener("mouseup", onMouseUp, true)
    document.addEventListener("keydown", onKeyDown, true)
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true)
      document.removeEventListener("mousemove", onMouseMove, true)
      document.removeEventListener("mouseup", onMouseUp, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [repaint, tableSelector])
}
