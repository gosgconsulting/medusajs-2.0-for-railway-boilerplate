import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Link, Outlet, useLocation } from "react-router-dom"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  DropdownMenu,
  Heading,
  Input,
  Text,
} from "@medusajs/ui"
import { ChevronDown, PencilSquare } from "@medusajs/icons"
import { sdk } from "../../lib/sdk"
import {
  DEFAULT_VISIBLE_COLUMNS,
  TOGGLEABLE_COLUMNS,
  basePriceRangeFromVariants,
  categoriesDisplay,
  colorDisplay,
  getVariantPriceRange,
  manageStockSummary,
  skusDisplay,
  stockQtySummary,
  tagsToString,
} from "../../lib/product-table-columns"

const PAGE_SIZE = 20
const COL_PREFS_KEY = "medusa-admin-product-index-columns-v1"

type ProductStatus = "draft" | "proposed" | "published" | "rejected"

type ApiVariant = {
  id?: string
  sku?: string | null
  prices?: { amount?: number | null; currency_code?: string | null }[] | null
  manage_inventory?: boolean | null
  inventory_quantity?: number | null
  metadata?: Record<string, unknown> | null
}

type ApiProduct = {
  id: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  handle?: string | null
  status?: string | null
  thumbnail?: string | null
  discountable?: boolean | null
  material?: string | null
  weight?: number | null
  width?: number | null
  height?: number | null
  categories?: { name?: string | null }[] | null
  tags?: { value?: string }[] | null
  variants?: ApiVariant[] | null
}

function loadColumnPrefs(): {
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

function saveColumnPrefs(mode: "default" | "custom", visible: Set<string>) {
  try {
    window.localStorage.setItem(
      COL_PREFS_KEY,
      JSON.stringify({ mode, visible: [...visible] })
    )
  } catch {
    /* ignore */
  }
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

const statusColors: Record<
  ProductStatus,
  "green" | "orange" | "grey" | "red"
> = {
  published: "green",
  draft: "grey",
  proposed: "orange",
  rejected: "red",
}

const ProductsIndexPage = () => {
  const location = useLocation()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [columnMode, setColumnMode] = useState<"default" | "custom">(
    () => loadColumnPrefs().mode
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => loadColumnPrefs().visible
  )

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setOffset(0)
    }, 250)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    saveColumnPrefs(columnMode, visibleColumns)
  }, [columnMode, visibleColumns])

  const isColumnVisible = useCallback(
    (id: string) => {
      if (
        id === "image" ||
        id === "title" ||
        id === "status"
      ) {
        return true
      }
      if (columnMode === "default") return true
      return visibleColumns.has(id)
    },
    [columnMode, visibleColumns]
  )

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-products-index", offset, debouncedSearch],
    queryFn: () =>
      sdk.admin.product.list({
        limit: PAGE_SIZE,
        offset,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        fields:
          "+thumbnail,+tags,*categories,+description,+material,+weight,+width,+height,+discountable,+variants,+variants.prices,+variants.manage_inventory,+variants.inventory_quantity,+variants.metadata",
      } as Parameters<typeof sdk.admin.product.list>[0]),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })

  const products = (data?.products ?? []) as ApiProduct[]
  const count = data?.count ?? 0

  const end = Math.min(offset + products.length, count)

  const renderProductCells = (p: ApiProduct) => {
    const variants = p.variants ?? []
    const metaVariants = variants.map((v) => ({
      metadata: v.metadata ?? undefined,
    }))

    return (
      <>
        {isColumnVisible("image") && (
          <td className="px-3 py-2 align-middle">
            {p.thumbnail ? (
              <img
                src={p.thumbnail}
                alt=""
                className="size-10 rounded object-cover"
              />
            ) : (
              <div className="size-10 rounded bg-ui-bg-subtle" />
            )}
          </td>
        )}
        {isColumnVisible("title") && (
          <td className="px-3 py-2 align-middle">
            <Link
              to={`/products/${p.id}/edit`}
              className="font-medium text-ui-fg-interactive hover:underline"
            >
              {p.title ?? "—"}
            </Link>
          </td>
        )}
        {isColumnVisible("status") && (
          <td className="px-3 py-2 align-middle">
            <Badge color={statusColors[(p.status as ProductStatus) ?? "draft"]}>
              {p.status ?? "draft"}
            </Badge>
          </td>
        )}
        {isColumnVisible("category") && (
          <td className="txt-compact-small px-3 py-2 align-middle text-ui-fg-subtle">
            {categoriesDisplay(p.categories) || "—"}
          </td>
        )}
        {isColumnVisible("sku") && (
          <td className="font-mono txt-compact-small px-3 py-2 align-middle">
            {skusDisplay(variants) || "—"}
          </td>
        )}
        {isColumnVisible("basePrice") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {basePriceRangeFromVariants(variants) || "—"}
          </td>
        )}
        {isColumnVisible("salePrice") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {getVariantPriceRange(metaVariants, "b2b_price") || "—"}
          </td>
        )}
        {isColumnVisible("clientA") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {getVariantPriceRange(metaVariants, "wcwp_client-a") || "—"}
          </td>
        )}
        {isColumnVisible("clientB") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {getVariantPriceRange(metaVariants, "wcwp_client-b") || "—"}
          </td>
        )}
        {isColumnVisible("clientC") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {getVariantPriceRange(metaVariants, "wcwp_client-c") || "—"}
          </td>
        )}
        {isColumnVisible("manageStock") && (
          <td className="txt-compact-small px-3 py-2 text-center align-middle">
            {manageStockSummary(variants)}
          </td>
        )}
        {isColumnVisible("stockQty") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {stockQtySummary(variants) || "—"}
          </td>
        )}
        {isColumnVisible("subtitle") && (
          <td className="txt-compact-small px-3 py-2 align-middle text-ui-fg-subtle">
            {p.subtitle?.trim() || "—"}
          </td>
        )}
        {isColumnVisible("description") && (
          <td
            className="txt-compact-small max-w-xs px-3 py-2 align-middle text-ui-fg-subtle"
            title={p.description ?? ""}
          >
            {trunc((p.description ?? "").replace(/<[^>]+>/g, ""), 120) || "—"}
          </td>
        )}
        {isColumnVisible("handle") && (
          <td className="font-mono txt-compact-small px-3 py-2 align-middle">
            {p.handle || "—"}
          </td>
        )}
        {isColumnVisible("tags") && (
          <td className="txt-compact-small px-3 py-2 align-middle text-ui-fg-subtle">
            {tagsToString(p.tags) || "—"}
          </td>
        )}
        {isColumnVisible("material") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {p.material?.trim() || "—"}
          </td>
        )}
        {isColumnVisible("weight") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {p.weight != null ? String(p.weight) : "—"}
          </td>
        )}
        {isColumnVisible("width") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {p.width != null ? String(p.width) : "—"}
          </td>
        )}
        {isColumnVisible("height") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {p.height != null ? String(p.height) : "—"}
          </td>
        )}
        {isColumnVisible("discountable") && (
          <td className="txt-compact-small px-3 py-2 text-center align-middle">
            {p.discountable === false ? "No" : "Yes"}
          </td>
        )}
        {isColumnVisible("color") && (
          <td className="txt-compact-small px-3 py-2 align-middle">
            {colorDisplay(variants) || "—"}
          </td>
        )}
        {isColumnVisible("changed") && (
          <td className="px-3 py-2 align-middle text-ui-fg-muted">—</td>
        )}
      </>
    )
  }

  const headerRow = useMemo(() => {
    const th = (
      id: string,
      label: string,
      opts?: { minW?: number; className?: string }
    ) =>
      isColumnVisible(id) ? (
        <th
          key={id}
          className={`txt-compact-small-plus bg-ui-bg-subtle px-3 py-3 text-left text-ui-fg-muted ${opts?.className ?? ""}`}
          style={{ minWidth: opts?.minW }}
        >
          {label}
        </th>
      ) : null

    return (
      <tr className="border-b border-ui-border-base">
        {th("image", "Image", { minW: 56 })}
        {th("title", "Title", { minW: 200 })}
        {th("status", "Status", { minW: 120 })}
        {th("category", "Category", { minW: 180 })}
        {th("sku", "SKU", { minW: 140 })}
        {th("basePrice", "Base price", { minW: 100 })}
        {th("salePrice", "Sale price", { minW: 100 })}
        {th("clientA", "Client A", { minW: 90 })}
        {th("clientB", "Client B", { minW: 90 })}
        {th("clientC", "Client C", { minW: 90 })}
        {th("manageStock", "Manage Stock", {
          minW: 100,
          className: "text-center",
        })}
        {th("stockQty", "Stock qty", { minW: 90 })}
        {th("subtitle", "Subtitle", { minW: 150 })}
        {th("description", "Description", { minW: 220 })}
        {th("handle", "Handle", { minW: 140 })}
        {th("tags", "Tags", { minW: 160 })}
        {th("material", "Material", { minW: 120 })}
        {th("weight", "Weight (g)", { minW: 100 })}
        {th("width", "Width", { minW: 80 })}
        {th("height", "Height", { minW: 80 })}
        {th("discountable", "Discountable", {
          minW: 100,
          className: "text-center",
        })}
        {th("color", "Color", { minW: 90 })}
        {th("changed", "Changed", { minW: 72 })}
      </tr>
    )
  }, [isColumnVisible])

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-4 px-6 py-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Heading level="h1">Products</Heading>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="small" variant="secondary" asChild>
              <Link to={`export${location.search}`}>Export</Link>
            </Button>
            <Button size="small" variant="secondary" asChild>
              <Link to={`import${location.search}`}>Import</Link>
            </Button>
            <Button size="small" variant="secondary" asChild>
              <Link to="create">Create</Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="w-full max-w-md">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, handle, or SKU…"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <Button variant="secondary" size="small" type="button">
                  Manage columns <ChevronDown className="ml-1" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="w-[280px]">
                <div className="flex flex-col gap-3 p-3">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Image, title, and status always stay visible. Same options as
                    bulk edit.
                  </Text>
                  <div className="flex flex-col gap-1">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="product-index-column-mode"
                        checked={columnMode === "default"}
                        onChange={() => setColumnMode("default")}
                        className="rounded-full text-ui-fg-interactive"
                      />
                      <Text size="small">Default (all columns)</Text>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="product-index-column-mode"
                        checked={columnMode === "custom"}
                        onChange={() => setColumnMode("custom")}
                        className="rounded-full text-ui-fg-interactive"
                      />
                      <Text size="small">Custom</Text>
                    </label>
                  </div>
                  {columnMode === "custom" && (
                    <div className="border-t border-ui-border-base pt-2">
                      <Text
                        size="xsmall"
                        className="mb-2 block text-ui-fg-muted"
                      >
                        Select columns to display:
                      </Text>
                      <div className="flex max-h-[240px] flex-col gap-1 overflow-auto">
                        {TOGGLEABLE_COLUMNS.map((col) => (
                          <label
                            key={col.id}
                            className="flex cursor-pointer items-center gap-2 py-1"
                          >
                            <Checkbox
                              checked={visibleColumns.has(col.id)}
                              onCheckedChange={(checked) => {
                                setVisibleColumns((prev) => {
                                  const next = new Set(prev)
                                  if (checked === true) next.add(col.id)
                                  else next.delete(col.id)
                                  return next
                                })
                              }}
                            />
                            <Text size="small">{col.label}</Text>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu>

            <Button size="small" variant="secondary" asChild>
              <Link
                to="/products/bulk-edit"
                className="flex items-center gap-1.5"
              >
                <PencilSquare />
                Bulk edit
              </Link>
            </Button>
          </div>
        </div>

        <Text size="small" className="text-ui-fg-muted">
          {count === 0
            ? "0 results"
            : `${offset + 1}–${end} of ${count} product${count !== 1 ? "s" : ""}`}
        </Text>
      </div>

      <div className="px-6 pb-6">
        {isError ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Text className="text-ui-fg-muted">Failed to load products.</Text>
            <Button size="small" variant="secondary" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <Text className="py-12 text-center text-ui-fg-muted">
            Loading products…
          </Text>
        ) : products.length === 0 ? (
          <Text className="py-12 text-center text-ui-fg-muted">
            {debouncedSearch
              ? `No products match “${debouncedSearch}”.`
              : "No products yet."}
          </Text>
        ) : (
          <div
            className="overflow-x-auto rounded-lg border border-ui-border-base"
            style={{ maxHeight: "calc(100vh - 280px)" }}
          >
            <table className="w-full" style={{ minWidth: 1200 }}>
              <thead>{headerRow}</thead>
              <tbody className="divide-y divide-ui-border-base">
                {products.map((p) => (
                  <tr
                    key={p.id}
                    className="hover:bg-ui-bg-base-hover transition-colors"
                  >
                    {renderProductCells(p)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {count > PAGE_SIZE && products.length > 0 ? (
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              size="small"
              variant="secondary"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            >
              Previous
            </Button>
            <Button
              size="small"
              variant="secondary"
              disabled={offset + PAGE_SIZE >= count}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      <Outlet />
    </Container>
  )
}

export default ProductsIndexPage
