import React, { useEffect, useMemo, useRef, useState } from "react"
import "../lib/sync-active-store-cookie"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, DropdownMenu, Text } from "@medusajs/ui"
import { ChevronDown } from "@medusajs/icons"
import { useQuery } from "@tanstack/react-query"

import {
  ADMIN_ACTIVE_STORE_STORAGE_KEY,
  ADMIN_LIST_ALL_STORES_HEADER,
  setActiveAdminStoreId,
} from "../lib/active-store-context"
import { sdk } from "../lib/sdk"

/**
 * Active Medusa Store selector for multi-store setups.
 *
 * Persists selection via cookie + SDK headers (`active-store-context`); the backend merges all
 * sales channels for that store (default channel + `metadata.store_id`) into Admin product/order
 * list queries — see `inject-admin-active-store-query.ts`.
 */

const PORTAL_ID = "tenant-database-selector-portal"

/** Avoid syncing SDK headers repeatedly when multiple widget zones mount. */
let syncedAdminStoreSelectionGlobally = false

function loadStoredStoreId(stores: { id: string }[]): string | null {
  if (typeof window === "undefined") return null
  try {
    const stored = window.localStorage.getItem(ADMIN_ACTIVE_STORE_STORAGE_KEY)
    if (stored && stores.some((s) => s.id === stored)) return stored
  } catch {
    /* ignore */
  }
  return null
}

function findTopbarRightCell(): HTMLElement | null {
  const topbars = document.querySelectorAll<HTMLElement>("div.grid.grid-cols-2.border-b")
  for (const tb of topbars) {
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
  const observerRef = useRef<MutationObserver | null>(null)

  const { data: storesRes, isLoading } = useQuery({
    queryKey: ["admin-store-list-for-selector"],
    queryFn: async () =>
      sdk.admin.store.list(
        { limit: 200, fields: "id,name" },
        { [ADMIN_LIST_ALL_STORES_HEADER]: "true" }
      ),
    staleTime: 60_000,
  })

  const normalized = useMemo(() => {
    const stores = storesRes?.stores ?? []
    return stores.map((s) => ({
      id: s.id,
      label: (s as { name?: string | null }).name?.trim() || s.id,
    }))
  }, [storesRes?.stores])

  useEffect(() => {
    if (!normalized.length || syncedAdminStoreSelectionGlobally) return
    syncedAdminStoreSelectionGlobally = true
    const stored = loadStoredStoreId(normalized)
    setActiveAdminStoreId(stored ?? normalized[0].id)
  }, [normalized])

  useEffect(() => {
    const tryMount = (): boolean => {
      const existing = document.getElementById(PORTAL_ID)
      if (existing && document.body.contains(existing)) {
        setContainer(existing)
        return true
      }
      const rightCell = findTopbarRightCell()
      if (!rightCell) return false
      const el = document.createElement("div")
      el.id = PORTAL_ID
      el.style.display = "inline-flex"
      el.style.alignItems = "center"
      el.style.marginRight = "8px"
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
    }
  }, [])

  /** Sidebar route labels come from static route config; hide “Stores” when only one store exists. */
  useEffect(() => {
    if (isLoading) return
    const showMultiStoreNav = normalized.length > 1
    const anchors = document.querySelectorAll<HTMLElement>(
      'aside a[href*="multi-store/list"]'
    )
    anchors.forEach((a) => {
      a.style.display = showMultiStoreNav ? "" : "none"
    })
  }, [isLoading, normalized.length])

  const handleSelect = (id: string) => {
    if (!normalized.some((s) => s.id === id)) return
    setActiveAdminStoreId(id)
    window.location.reload()
  }

  if (!container) return null

  let activeId: string | null = null
  if (typeof window !== "undefined") {
    try {
      activeId = window.localStorage.getItem(ADMIN_ACTIVE_STORE_STORAGE_KEY)
    } catch {
      activeId = null
    }
  }
  const active =
    normalized.find((s) => s.id === activeId) ?? normalized[0]

  return createPortal(
    <DropdownMenu>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="transparent"
          size="small"
          className="!h-8 gap-1.5 px-2"
          title="Active Medusa Store"
          disabled={isLoading || !normalized.length}
        >
          <Text size="small" weight="plus">
            {isLoading
              ? "Stores…"
              : active?.label ?? "No stores"}
          </Text>
          <ChevronDown />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" className="min-w-[220px]">
        <DropdownMenu.Label>Active store</DropdownMenu.Label>
        <DropdownMenu.Separator />
        {normalized.map((db) => (
          <DropdownMenu.Item
            key={db.id}
            onClick={() => handleSelect(db.id)}
            className={db.id === active?.id ? "bg-ui-bg-base-pressed" : ""}
          >
            <span className="flex-1">{db.label}</span>
            {db.id === active?.id && (
              <Text size="xsmall" className="text-ui-fg-muted">
                active
              </Text>
            )}
          </DropdownMenu.Item>
        ))}
        <DropdownMenu.Separator />
        {normalized.length > 1 ? (
          <>
            <DropdownMenu.Item asChild>
              <Link to="/multi-store/list" className="cursor-pointer">
                View all stores…
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
          </>
        ) : null}
        <DropdownMenu.Item asChild>
          <Link to="/multi-store/create" className="cursor-pointer">
            Create new store…
          </Link>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>,
    container
  )
}

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
