import React, { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, DropdownMenu, Text } from "@medusajs/ui"
import { ChevronDown } from "@medusajs/icons"

/**
 * Database / tenant selector that lives in the admin top bar, immediately
 * before the notification bell. Currently a single-tenant scaffold — the only
 * entry is the active store ("Julia Paris"). Wired up so a future multi-tenant
 * setup can swap the active database from this dropdown.
 *
 * Implementation note: Medusa's admin SDK doesn't expose a global header
 * injection zone, so we mount this widget at every "list" zone and use a
 * MutationObserver to find the notification button in the rendered admin
 * chrome, then portal the dropdown into a sibling `<div>` placed right
 * before it. The same DOM container is reused across navigations so the
 * dropdown doesn't flicker between pages.
 */

const STORAGE_KEY = "admin-active-database-v1"
const PORTAL_ID = "tenant-database-selector-portal"

type DatabaseEntry = { id: string; label: string }

const DATABASES: ReadonlyArray<DatabaseEntry> = [
  { id: "julia-paris", label: "Julia Paris" },
]

function loadActiveId(): string {
  if (typeof window === "undefined") return DATABASES[0].id
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && DATABASES.some((d) => d.id === stored)) return stored
  } catch { /* ignore */ }
  return DATABASES[0].id
}

function saveActiveId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch { /* ignore */ }
}

/**
 * The Medusa 2.x admin Topbar is a div with the distinctive class combo
 * `grid grid-cols-2 border-b p-3` (rendered by `Topbar` inside MainLayout).
 * It's a 2-column grid: the first cell holds the sidebar toggles + page title,
 * the second cell holds the notification bell on the right. We anchor our
 * portal as the FIRST child of that right cell so the dropdown appears
 * immediately before the bell.
 */
function findTopbarRightCell(): HTMLElement | null {
  const topbars = document.querySelectorAll<HTMLElement>("div.grid.grid-cols-2.border-b")
  for (const tb of topbars) {
    // Sanity check: must have exactly two direct child cells.
    const cells = Array.from(tb.children).filter(
      (c) => c instanceof HTMLElement
    ) as HTMLElement[]
    if (cells.length !== 2) continue
    return cells[1]
  }
  return null
}

const DatabaseSelectorWidget = () => {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const [activeId, setActiveId] = useState<string>(() => loadActiveId())
  const observerRef = useRef<MutationObserver | null>(null)

  useEffect(() => {
    const tryMount = (): boolean => {
      // Reuse the singleton container if a previous mount on another page
      // already injected it. Avoids flicker on SPA navigation.
      const existing = document.getElementById(PORTAL_ID)
      if (existing && document.body.contains(existing)) {
        setContainer(existing)
        return true
      }
      const rightCell = findTopbarRightCell()
      if (!rightCell) return false
      const el = document.createElement("div")
      el.id = PORTAL_ID
      // The right cell is right-aligned (justify-self / contains the bell on
      // the far right). We want the dropdown to sit immediately to the left
      // of the bell, so we make the cell flex with end-justified children
      // and insert our portal as the first child.
      el.style.display = "inline-flex"
      el.style.alignItems = "center"
      el.style.marginRight = "8px"
      // Force the right cell into a flex layout so our element + the bell
      // align horizontally even if the original cell was just a div.
      const cs = window.getComputedStyle(rightCell)
      if (cs.display !== "flex" && cs.display !== "inline-flex") {
        rightCell.style.display = "flex"
        rightCell.style.alignItems = "center"
        rightCell.style.justifyContent = "flex-end"
      }
      rightCell.insertBefore(el, rightCell.firstChild)
      setContainer(el)
      return true
    }

    if (tryMount()) return

    const obs = new MutationObserver(() => {
      if (tryMount()) obs.disconnect()
    })
    obs.observe(document.body, { childList: true, subtree: true })
    observerRef.current = obs

    return () => {
      observerRef.current?.disconnect()
      observerRef.current = null
      // Note: we deliberately leave the portal container in the DOM so that
      // navigating to a page without this widget zone doesn't make the
      // selector flash out and back in.
    }
  }, [])

  const handleSelect = (id: string) => {
    if (id === activeId) return
    setActiveId(id)
    saveActiveId(id)
  }

  if (!container) return null

  const active = DATABASES.find((d) => d.id === activeId) ?? DATABASES[0]

  return createPortal(
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="transparent"
          size="small"
          className="!h-8 gap-1.5 px-2"
          title="Active database (multi-tenant placeholder)"
        >
          <Text size="small" weight="plus">
            {active.label}
          </Text>
          <ChevronDown />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="min-w-[200px]">
        <DropdownMenu.Label>Active database</DropdownMenu.Label>
        <DropdownMenu.Separator />
        {DATABASES.map((db) => (
          <DropdownMenu.Item
            key={db.id}
            onClick={() => handleSelect(db.id)}
            className={db.id === activeId ? "bg-ui-bg-base-pressed" : ""}
          >
            <span className="flex-1">{db.label}</span>
            {db.id === activeId && (
              <Text size="xsmall" className="text-ui-fg-muted">
                active
              </Text>
            )}
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator />
        <DropdownMenu.Item disabled>
          <Text size="xsmall" className="text-ui-fg-muted">
            Switching not yet enabled
          </Text>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>,
    container
  )
}

// Mount on every common list zone so the dropdown is visible on the pages
// users hit most often. SPA navigations between these pages reuse the same
// DOM portal container (see useEffect above), so the dropdown doesn't
// disappear between page transitions inside this set.
export const config = defineWidgetConfig({
  zone: [
    "product.list.before",
    "product_collection.list.before",
    "product_category.list.before",
    "product_type.list.before",
    "product_tag.list.before",
    "order.list.before",
    "customer.list.before",
    "customer_group.list.before",
    "promotion.list.before",
    "campaign.list.before",
    "sales_channel.list.before",
    "inventory_item.list.before",
    "reservation.list.before",
    "user.list.before",
    "store.details.before",
    "region.list.before",
    "shipping_profile.list.before",
    "location.list.before",
    "tax.list.before",
    "api_key.list.before",
    "price_list.list.before",
    "return_reason.list.before",
    "refund_reason.list.before",
  ],
})

export default DatabaseSelectorWidget
