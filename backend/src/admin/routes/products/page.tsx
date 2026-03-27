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
import { ChevronDown, ChevronRight, PencilSquare } from "@medusajs/icons"
import { sdk } from "../../lib/sdk"
import {
  loadColumnPrefs,
  saveColumnPrefs,
} from "../../lib/product-column-prefs"
import {
  TOGGLEABLE_COLUMNS,
  amountToDisplay,
  categoriesDisplay,
  colorDisplay,
  getMeta,
  getVariantPriceRange,
  manageStockSummary,
  skusDisplay,
  stockQtySummary,
  tagsToString,
} from "../../lib/product-table-columns"

const PAGE_SIZE = 20

type ProductStatus = "draft" | "proposed" | "published" | "rejected"

type PriceRow = {
  id?: string
  currency_code: string
  amount: string
}

type VariantRow = {
  id: string
  title: string
  sku: string
  prices: PriceRow[]
  sale_price_amount: string
  thumbnail: string | null
  manage_inventory: boolean
  inventory_quantity: number | null
  metadata: Record<string, unknown>
}

type ProductRow = {
  id: string
  title: string
  subtitle: string
  description: string
  handle: string
  status: ProductStatus
  material: string
  tags: string
  weight: string
  width: string
  height: string
  discountable: boolean
  thumbnail: string | null
  categories?: { name?: string | null }[] | null
  variants: VariantRow[]
}

type ApiPrice = {
  id?: string
  currency_code?: string
  amount?: number
}

type ApiVariant = {
  id: string
  title?: string | null
  sku?: string | null
  prices?: ApiPrice[] | null
  thumbnail?: string | null
  images?: { id?: string; url?: string }[] | null
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
  categories?: { name?: string | null }[] | null
  material?: string | null
  weight?: number | null
  width?: number | null
  height?: number | null
  discountable?: boolean | null
  thumbnail?: string | null
  tags?: { id?: string; value?: string }[] | null
  variants?: ApiVariant[] | null
}

function toVariantRow(v: ApiVariant): VariantRow {
  const meta = (v.metadata ?? {}) as Record<string, unknown>
  const thumbnail =
    (typeof v.thumbnail === "string" && v.thumbnail.trim() ? v.thumbnail : null) ??
    (v.images?.[0]?.url ?? null) ??
    (typeof meta?.thumbnail === "string" ? meta.thumbnail : null)
  return {
    id: v.id,
    title: v.title ?? "Default",
    sku: v.sku ?? "",
    prices: (v.prices ?? []).map((p) => ({
      id: p.id,
      currency_code: p.currency_code ?? "usd",
      amount: amountToDisplay(p.amount),
    })),
    sale_price_amount:
      typeof meta?.b2b_price === "number"
        ? amountToDisplay(meta.b2b_price as number)
        : "",
    thumbnail,
    manage_inventory: v.manage_inventory ?? false,
    inventory_quantity: v.inventory_quantity ?? null,
    metadata: meta,
  }
}

function toRow(p: ApiProduct): ProductRow {
  return {
    id: p.id,
    title: p.title ?? "",
    subtitle: p.subtitle ?? "",
    description: p.description ?? "",
    handle: p.handle ?? "",
    status: (p.status as ProductStatus) ?? "draft",
    material: p.material ?? "",
    tags: tagsToString(p.tags),
    weight: p.weight != null ? String(p.weight) : "",
    width: p.width != null ? String(p.width) : "",
    height: p.height != null ? String(p.height) : "",
    discountable: p.discountable ?? true,
    thumbnail: p.thumbnail ?? null,
    categories: p.categories,
    variants: (p.variants ?? []).map(toVariantRow),
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

const tdText =
  "txt-compact-small px-3 py-2 align-middle text-ui-fg-base max-w-xs truncate"

const ProductsIndexPage = () => {
  const location = useLocation()
  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
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

  useEffect(() => {
    const p = loadColumnPrefs()
    setColumnMode(p.mode)
    setVisibleColumns(p.visible)
  }, [location.pathname])

  const isColumnVisible = useCallback(
    (id: string) => {
      if (
        id === "expand" ||
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
          "+thumbnail,+tags,*categories,+description,+material,+weight,+width,+height,+discountable,+variants,+variants.prices,+variants.thumbnail,+variants.images,+variants.manage_inventory,+variants.inventory_quantity,+variants.metadata",
      } as Parameters<typeof sdk.admin.product.list>[0]),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })

  const rows = useMemo(
    () => (data?.products ?? []).map((p) => toRow(p as ApiProduct)),
    [data?.products]
  )
  const total = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allExpanded =
    rows.length > 0 && rows.every((r) => expandedIds.has(r.id))

  const toggleExpandAll = useCallback(() => {
    if (allExpanded) {
      setExpandedIds(new Set())
    } else {
      setExpandedIds(new Set(rows.map((r) => r.id)))
    }
  }, [allExpanded, rows])

  const metaVariantsForProduct = (p: ProductRow) =>
    p.variants.map((v) => ({ metadata: v.metadata }))

  return (
    <div className="flex flex-col gap-6 pb-8">
      <Container className="divide-y p-0">
        <div className="flex flex-col gap-4 px-6 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <Heading level="h1">Products</Heading>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
            <div className="w-full max-w-md">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title, handle, or SKU…"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="small" variant="secondary" asChild>
                <Link to={`import${location.search}`}>Import</Link>
              </Button>
              <Button size="small" variant="secondary" asChild>
                <Link to={`export${location.search}`}>Export</Link>
              </Button>
              <Button size="small" variant="secondary" asChild>
                <Link to="create">Create</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenu.Trigger asChild>
                  <Button variant="secondary" size="small" type="button">
                    Manage columns <ChevronDown className="ml-1" />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content className="w-[280px]">
                  <div className="flex flex-col gap-3 p-3">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Expand, image, title, and status always stay visible.
                      Same options as bulk edit.
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
            {total === 0
              ? "0 results"
              : `${offset + 1}–${Math.min(offset + rows.length, total)} of ${total} product${total !== 1 ? "s" : ""}`}
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
          ) : rows.length === 0 ? (
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
              <table className="w-full" style={{ minWidth: 1400 }}>
                <thead>
                  <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                    {isColumnVisible("expand") && (
                      <th className="px-3 py-3" style={{ minWidth: 40 }}>
                        <button
                          type="button"
                          onClick={toggleExpandAll}
                          className="text-ui-fg-muted transition-colors hover:text-ui-fg-base"
                          title={
                            allExpanded ? "Collapse all" : "Expand all variants"
                          }
                        >
                          {allExpanded ? <ChevronDown /> : <ChevronRight />}
                        </button>
                      </th>
                    )}
                    {isColumnVisible("image") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 56 }}
                      >
                        Image
                      </th>
                    )}
                    {isColumnVisible("title") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 180 }}
                      >
                        Title
                      </th>
                    )}
                    {isColumnVisible("status") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 130 }}
                      >
                        Status
                      </th>
                    )}
                    {isColumnVisible("category") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 200 }}
                      >
                        Category
                      </th>
                    )}
                    {isColumnVisible("sku") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 150 }}
                      >
                        SKU
                      </th>
                    )}
                    {isColumnVisible("basePrice") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 100 }}
                      >
                        Base price
                      </th>
                    )}
                    {isColumnVisible("salePrice") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 100 }}
                      >
                        Sale price
                      </th>
                    )}
                    {isColumnVisible("clientA") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 90 }}
                      >
                        Client A
                      </th>
                    )}
                    {isColumnVisible("clientB") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 90 }}
                      >
                        Client B
                      </th>
                    )}
                    {isColumnVisible("clientC") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 90 }}
                      >
                        Client C
                      </th>
                    )}
                    {isColumnVisible("manageStock") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-center text-ui-fg-muted"
                        style={{ minWidth: 100 }}
                      >
                        Manage Stock
                      </th>
                    )}
                    {isColumnVisible("stockQty") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 90 }}
                      >
                        Stock qty
                      </th>
                    )}
                    {isColumnVisible("subtitle") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 150 }}
                      >
                        Subtitle
                      </th>
                    )}
                    {isColumnVisible("description") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 260 }}
                      >
                        Description
                      </th>
                    )}
                    {isColumnVisible("handle") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 150 }}
                      >
                        Handle
                      </th>
                    )}
                    {isColumnVisible("tags") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 170 }}
                      >
                        Tags
                      </th>
                    )}
                    {isColumnVisible("material") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 120 }}
                      >
                        Material
                      </th>
                    )}
                    {isColumnVisible("weight") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 100 }}
                      >
                        Weight (g)
                      </th>
                    )}
                    {isColumnVisible("width") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 80 }}
                      >
                        Width
                      </th>
                    )}
                    {isColumnVisible("height") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 80 }}
                      >
                        Height
                      </th>
                    )}
                    {isColumnVisible("discountable") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-center text-ui-fg-muted"
                        style={{ minWidth: 110 }}
                      >
                        Discountable
                      </th>
                    )}
                    {isColumnVisible("color") && (
                      <th
                        className="txt-compact-small-plus px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 90 }}
                      >
                        Color
                      </th>
                    )}
                    {isColumnVisible("changed") && (
                      <th
                        className="px-3 py-3 text-left text-ui-fg-muted"
                        style={{ minWidth: 90 }}
                        aria-label="Changed"
                      />
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ui-border-base">
                  {rows.map((row) => {
                    const isExpanded = expandedIds.has(row.id)
                    const categoryLabel =
                      categoriesDisplay(row.categories) || "—"
                    return (
                      <React.Fragment key={row.id}>
                        <tr className="bg-ui-bg-base transition-colors hover:bg-ui-bg-base-hover">
                          {isColumnVisible("expand") && (
                            <td className="px-3 py-2 align-middle">
                              {row.variants.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(row.id)}
                                  className="text-ui-fg-muted transition-colors hover:text-ui-fg-base"
                                  title={
                                    isExpanded
                                      ? "Collapse variants"
                                      : `Expand ${row.variants.length} variant${row.variants.length !== 1 ? "s" : ""}`
                                  }
                                >
                                  {isExpanded ? (
                                    <ChevronDown />
                                  ) : (
                                    <ChevronRight />
                                  )}
                                </button>
                              ) : null}
                            </td>
                          )}
                          {isColumnVisible("image") && (
                            <td className="px-3 py-2 align-middle">
                              {row.thumbnail ? (
                                <img
                                  src={row.thumbnail}
                                  alt=""
                                  className="size-9 rounded object-contain"
                                />
                              ) : (
                                <div className="size-9 rounded bg-ui-bg-subtle" />
                              )}
                            </td>
                          )}
                          {isColumnVisible("title") && (
                            <td className={`${tdText} font-medium`}>
                              <Link
                                to={`/products/${row.id}/edit`}
                                className="text-ui-fg-interactive hover:underline"
                              >
                                {row.title || "—"}
                              </Link>
                            </td>
                          )}
                          {isColumnVisible("status") && (
                            <td className="px-3 py-2 align-middle">
                              <Badge
                                color={statusColors[row.status] ?? "grey"}
                              >
                                {row.status}
                              </Badge>
                            </td>
                          )}
                          {isColumnVisible("category") && (
                            <td
                              className={`${tdText} text-ui-fg-subtle`}
                              title={categoryLabel}
                            >
                              {categoryLabel}
                            </td>
                          )}
                          {isColumnVisible("sku") && (
                            <td className={`${tdText} font-mono`}>
                              {skusDisplay(row.variants) || "—"}
                            </td>
                          )}
                          {isColumnVisible("basePrice") && (
                            <td className={tdText}>
                              {row.variants[0]?.prices[0]?.amount || "—"}
                            </td>
                          )}
                          {isColumnVisible("salePrice") && (
                            <td className={tdText}>
                              {row.variants[0]?.sale_price_amount || "—"}
                            </td>
                          )}
                          {isColumnVisible("clientA") && (
                            <td className={tdText}>
                              {getVariantPriceRange(
                                metaVariantsForProduct(row),
                                "wcwp_client-a"
                              ) || "—"}
                            </td>
                          )}
                          {isColumnVisible("clientB") && (
                            <td className={tdText}>
                              {getVariantPriceRange(
                                metaVariantsForProduct(row),
                                "wcwp_client-b"
                              ) || "—"}
                            </td>
                          )}
                          {isColumnVisible("clientC") && (
                            <td className={tdText}>
                              {getVariantPriceRange(
                                metaVariantsForProduct(row),
                                "wcwp_client-c"
                              ) || "—"}
                            </td>
                          )}
                          {isColumnVisible("manageStock") && (
                            <td className={`${tdText} text-center`}>
                              {manageStockSummary(row.variants)}
                            </td>
                          )}
                          {isColumnVisible("stockQty") && (
                            <td className={tdText}>
                              {stockQtySummary(row.variants) || "—"}
                            </td>
                          )}
                          {isColumnVisible("subtitle") && (
                            <td className={`${tdText} text-ui-fg-subtle`}>
                              {row.subtitle.trim() || "—"}
                            </td>
                          )}
                          {isColumnVisible("description") && (
                            <td
                              className={`${tdText} text-ui-fg-subtle max-w-[260px]`}
                              title={row.description}
                            >
                              {trunc(
                                row.description.replace(/<[^>]+>/g, ""),
                                120
                              ) || "—"}
                            </td>
                          )}
                          {isColumnVisible("handle") && (
                            <td className={`${tdText} font-mono`}>
                              {row.handle || "—"}
                            </td>
                          )}
                          {isColumnVisible("tags") && (
                            <td className={`${tdText} text-ui-fg-subtle`}>
                              {row.tags || "—"}
                            </td>
                          )}
                          {isColumnVisible("material") && (
                            <td className={tdText}>
                              {row.material.trim() || "—"}
                            </td>
                          )}
                          {isColumnVisible("weight") && (
                            <td className={tdText}>
                              {row.weight || "—"}
                            </td>
                          )}
                          {isColumnVisible("width") && (
                            <td className={tdText}>
                              {row.width || "—"}
                            </td>
                          )}
                          {isColumnVisible("height") && (
                            <td className={tdText}>
                              {row.height || "—"}
                            </td>
                          )}
                          {isColumnVisible("discountable") && (
                            <td className={`${tdText} text-center`}>
                              {row.discountable ? "Yes" : "No"}
                            </td>
                          )}
                          {isColumnVisible("color") && (
                            <td className={tdText}>
                              {colorDisplay(row.variants) || "—"}
                            </td>
                          )}
                          {isColumnVisible("changed") && (
                            <td className="px-3 py-2 align-middle" aria-hidden />
                          )}
                        </tr>

                        {isExpanded &&
                          row.variants.map((variant) => (
                            <tr key={variant.id} className="bg-ui-bg-subtle">
                              {isColumnVisible("expand") && (
                                <td className="px-3 py-2" />
                              )}
                              {isColumnVisible("image") && (
                                <td className="px-3 py-2 align-middle">
                                  {variant.thumbnail ? (
                                    <img
                                      src={variant.thumbnail}
                                      alt=""
                                      className="size-8 rounded object-contain"
                                    />
                                  ) : (
                                    <div className="size-8 rounded bg-ui-bg-base" />
                                  )}
                                </td>
                              )}
                              {isColumnVisible("title") && (
                                <td className={`${tdText} font-medium`}>
                                  {variant.title}
                                </td>
                              )}
                              {isColumnVisible("status") && (
                                <td className={tdText}>
                                  <Badge
                                    color={statusColors[row.status] ?? "grey"}
                                  >
                                    {row.status}
                                  </Badge>
                                </td>
                              )}
                              {isColumnVisible("category") && (
                                <td
                                  className={`${tdText} text-ui-fg-subtle`}
                                  title={categoryLabel}
                                >
                                  {categoryLabel}
                                </td>
                              )}
                              {isColumnVisible("sku") && (
                                <td className={`${tdText} font-mono`}>
                                  {variant.sku || "—"}
                                </td>
                              )}
                              {isColumnVisible("basePrice") && (
                                <td className={tdText}>
                                  {variant.prices[0]?.amount || "—"}
                                </td>
                              )}
                              {isColumnVisible("salePrice") && (
                                <td className={tdText}>
                                  {variant.sale_price_amount || "—"}
                                </td>
                              )}
                              {isColumnVisible("clientA") && (
                                <td className={tdText}>
                                  {getMeta(
                                    variant.metadata,
                                    "wcwp_client-a"
                                  ) || "—"}
                                </td>
                              )}
                              {isColumnVisible("clientB") && (
                                <td className={tdText}>
                                  {getMeta(
                                    variant.metadata,
                                    "wcwp_client-b"
                                  ) || "—"}
                                </td>
                              )}
                              {isColumnVisible("clientC") && (
                                <td className={tdText}>
                                  {getMeta(
                                    variant.metadata,
                                    "wcwp_client-c"
                                  ) || "—"}
                                </td>
                              )}
                              {isColumnVisible("manageStock") && (
                                <td className={`${tdText} text-center`}>
                                  {variant.manage_inventory ? "Yes" : "No"}
                                </td>
                              )}
                              {isColumnVisible("stockQty") && (
                                <td className={tdText}>
                                  {variant.manage_inventory
                                    ? String(
                                        variant.inventory_quantity ?? "—"
                                      )
                                    : "—"}
                                </td>
                              )}
                              {isColumnVisible("subtitle") && (
                                <td className={`${tdText} text-ui-fg-subtle`}>
                                  {row.subtitle.trim() || "—"}
                                </td>
                              )}
                              {isColumnVisible("description") && (
                                <td
                                  className={`${tdText} text-ui-fg-subtle max-w-[260px]`}
                                  title={row.description}
                                >
                                  {trunc(
                                    row.description.replace(/<[^>]+>/g, ""),
                                    80
                                  ) || "—"}
                                </td>
                              )}
                              {isColumnVisible("handle") && (
                                <td className={`${tdText} font-mono`}>
                                  {row.handle || "—"}
                                </td>
                              )}
                              {isColumnVisible("tags") && (
                                <td className={`${tdText} text-ui-fg-subtle`}>
                                  {row.tags || "—"}
                                </td>
                              )}
                              {isColumnVisible("material") && (
                                <td className={tdText}>
                                  {row.material.trim() || "—"}
                                </td>
                              )}
                              {isColumnVisible("weight") && (
                                <td className={tdText}>{row.weight || "—"}</td>
                              )}
                              {isColumnVisible("width") && (
                                <td className={tdText}>{row.width || "—"}</td>
                              )}
                              {isColumnVisible("height") && (
                                <td className={tdText}>{row.height || "—"}</td>
                              )}
                              {isColumnVisible("discountable") && (
                                <td className={`${tdText} text-center`}>
                                  {row.discountable ? "Yes" : "No"}
                                </td>
                              )}
                              {isColumnVisible("color") && (
                                <td className={tdText}>
                                  <span className="inline-flex items-center gap-2">
                                    {getMeta(variant.metadata, "color_hex") ? (
                                      <span
                                        className="inline-block size-4 shrink-0 rounded border border-ui-border-base"
                                        style={{
                                          backgroundColor: getMeta(
                                            variant.metadata,
                                            "color_hex"
                                          ),
                                        }}
                                        title={getMeta(
                                          variant.metadata,
                                          "color_hex"
                                        )}
                                      />
                                    ) : null}
                                    {getMeta(variant.metadata, "color_hex") ||
                                      "—"}
                                  </span>
                                </td>
                              )}
                              {isColumnVisible("changed") && (
                                <td className="px-3 py-2" aria-hidden />
                              )}
                            </tr>
                          ))}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {total > PAGE_SIZE && rows.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <Text size="small" className="text-ui-fg-subtle">
                Page {currentPage} of {totalPages}
              </Text>
              <div className="flex items-center gap-2">
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
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </Container>

      <Outlet />
    </div>
  )
}

export default ProductsIndexPage
