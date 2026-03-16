import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  Heading,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { ChevronDown, ChevronLeft, ChevronRight } from "@medusajs/icons"
import { sdk } from "../../../lib/sdk"

const PAGE_SIZE = 20

type ProductStatus = "draft" | "published"

// ─── Data types ──────────────────────────────────────────────────────────────

type PriceRow = {
  id?: string
  currency_code: string
  amount: string  // human-readable dollars, e.g. "10.00"
}

type VariantRow = {
  id: string
  title: string
  sku: string
  prices: PriceRow[]
}

type ProductRow = {
  id: string
  title: string
  subtitle: string
  handle: string
  status: ProductStatus
  material: string
  tags: string      // comma-separated
  weight: string    // as string for input control
  discountable: boolean
  thumbnail: string | null
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
}

type ApiProduct = {
  id: string
  title?: string | null
  subtitle?: string | null
  handle?: string | null
  status?: string | null
  material?: string | null
  weight?: number | null
  discountable?: boolean | null
  thumbnail?: string | null
  tags?: { id?: string; value?: string }[] | null
  variants?: ApiVariant[] | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tagsToString(tags?: { value?: string }[] | null): string {
  if (!tags || tags.length === 0) return ""
  return tags.map((t) => t.value ?? "").filter(Boolean).join(", ")
}

/** Medusa stores prices in lowest denomination (cents). Convert to display. */
function amountToDisplay(amount?: number): string {
  if (amount == null) return ""
  return (amount / 100).toFixed(2)
}

/** Convert human-readable amount back to cents for the API. */
function displayToAmount(value: string): number {
  return Math.round(Number(value) * 100)
}

function toVariantRow(v: ApiVariant): VariantRow {
  return {
    id: v.id,
    title: v.title ?? "Default",
    sku: v.sku ?? "",
    prices: (v.prices ?? []).map((p) => ({
      id: p.id,
      currency_code: p.currency_code ?? "usd",
      amount: amountToDisplay(p.amount),
    })),
  }
}

function toRow(p: ApiProduct): ProductRow {
  return {
    id: p.id,
    title: p.title ?? "",
    subtitle: p.subtitle ?? "",
    handle: p.handle ?? "",
    status: (p.status as ProductStatus) ?? "draft",
    material: p.material ?? "",
    tags: tagsToString(p.tags),
    weight: p.weight != null ? String(p.weight) : "",
    discountable: p.discountable ?? true,
    thumbnail: p.thumbnail ?? null,
    variants: (p.variants ?? []).map(toVariantRow),
  }
}

type RowErrors = Record<string, string>

const cellInput =
  "flex h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 txt-small focus:border-ui-border-interactive focus:outline-none"

// ─── Component ───────────────────────────────────────────────────────────────

const BulkEditPage = () => {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [source, setSource] = useState<ProductRow[]>([])
  const [working, setWorking] = useState<ProductRow[]>([])
  const [errors, setErrors] = useState<RowErrors>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // ── Fetch ───────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-products-bulk", offset],
    queryFn: () =>
      sdk.admin.product.list({
        limit: PAGE_SIZE,
        offset,
        fields: "+tags,+material,+weight,+discountable,+variants,+variants.prices",
      } as Parameters<typeof sdk.admin.product.list>[0]),
    refetchOnWindowFocus: false,
  })

  useEffect(() => {
    if (!data?.products) return
    const rows = (data.products as ApiProduct[]).map(toRow)
    setSource(rows)
    setWorking(rows)
    setErrors({})
    setExpandedIds(new Set())
  }, [data])

  // ── Expand/collapse ─────────────────────────────────────────────────────
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allExpanded =
    working.length > 0 && working.every((r) => expandedIds.has(r.id))

  const toggleExpandAll = useCallback(() => {
    if (allExpanded) {
      setExpandedIds(new Set())
    } else {
      setExpandedIds(new Set(working.map((r) => r.id)))
    }
  }, [allExpanded, working])

  // ── Dirty tracking ──────────────────────────────────────────────────────
  const dirtyProductIds = useMemo(() => {
    const set = new Set<string>()
    for (const row of working) {
      const orig = source.find((s) => s.id === row.id)
      if (!orig) continue
      if (
        row.title !== orig.title ||
        row.subtitle !== orig.subtitle ||
        row.handle !== orig.handle ||
        row.status !== orig.status ||
        row.material !== orig.material ||
        row.tags !== orig.tags ||
        row.weight !== orig.weight ||
        row.discountable !== orig.discountable
      ) {
        set.add(row.id)
      }
    }
    return set
  }, [working, source])

  // productId → Set of dirty variantIds
  const dirtyVariantMap = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of working) {
      const orig = source.find((s) => s.id === row.id)
      if (!orig) continue
      for (const variant of row.variants) {
        const origV = orig.variants.find((v) => v.id === variant.id)
        if (!origV) continue
        if (
          variant.sku !== origV.sku ||
          JSON.stringify(variant.prices) !== JSON.stringify(origV.prices)
        ) {
          if (!map.has(row.id)) map.set(row.id, new Set())
          map.get(row.id)!.add(variant.id)
        }
      }
    }
    return map
  }, [working, source])

  const dirtyIds = useMemo(() => {
    const set = new Set<string>()
    for (const id of dirtyProductIds) set.add(id)
    for (const id of dirtyVariantMap.keys()) set.add(id)
    return set
  }, [dirtyProductIds, dirtyVariantMap])

  const hasDirty = dirtyIds.size > 0
  const hasErrors = Object.keys(errors).length > 0

  // ── Update handlers ─────────────────────────────────────────────────────
  const updateRow = useCallback(
    (
      id: string,
      field: keyof Omit<ProductRow, "id" | "thumbnail" | "variants">,
      value: string | boolean
    ) => {
      setWorking((prev) =>
        prev.map((row) => (row.id === id ? { ...row, [field]: value } : row))
      )
      if (field === "title") {
        if (!(value as string).trim()) {
          setErrors((prev) => ({ ...prev, [id]: "Title is required" }))
        } else {
          setErrors((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        }
      }
    },
    []
  )

  const updateVariantSku = useCallback(
    (productId: string, variantId: string, sku: string) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) =>
              v.id === variantId ? { ...v, sku } : v
            ),
          }
        })
      )
    },
    []
  )

  const updateVariantPrice = useCallback(
    (
      productId: string,
      variantId: string,
      currency_code: string,
      amount: string
    ) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) => {
              if (v.id !== variantId) return v
              return {
                ...v,
                prices: v.prices.map((p) =>
                  p.currency_code === currency_code ? { ...p, amount } : p
                ),
              }
            }),
          }
        })
      )
    },
    []
  )

  const discard = useCallback(() => {
    setWorking(source)
    setErrors({})
  }, [source])

  // ── Batch save ──────────────────────────────────────────────────────────
  const { mutate: saveBatch, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      const update = Array.from(dirtyIds).map((id) => {
        const row = working.find((r) => r.id === id)!
        const orig = source.find((s) => s.id === id)!
        const patch: Record<string, unknown> & { id: string } = { id }

        if (row.title !== orig.title) patch.title = row.title
        if (row.subtitle !== orig.subtitle) patch.subtitle = row.subtitle
        if (row.handle !== orig.handle) patch.handle = row.handle
        if (row.status !== orig.status) patch.status = row.status
        if (row.material !== orig.material) patch.material = row.material || null
        if (row.discountable !== orig.discountable)
          patch.discountable = row.discountable
        if (row.tags !== orig.tags) {
          const arr = row.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
          patch.tags = arr.map((v) => ({ value: v }))
        }
        if (row.weight !== orig.weight) {
          patch.weight = row.weight === "" ? null : Number(row.weight)
        }

        // Include dirty variant updates
        const dirtyVariants = dirtyVariantMap.get(id)
        if (dirtyVariants && dirtyVariants.size > 0) {
          patch.variants = Array.from(dirtyVariants).map((variantId) => {
            const v = row.variants.find((v) => v.id === variantId)!
            const origV = orig.variants.find((v) => v.id === variantId)!
            const vPatch: Record<string, unknown> & { id: string } = {
              id: variantId,
            }
            if (v.sku !== origV.sku) vPatch.sku = v.sku || null
            if (
              JSON.stringify(v.prices) !== JSON.stringify(origV.prices)
            ) {
              vPatch.prices = v.prices
                .filter((p) => p.amount !== "")
                .map((p) => ({
                  ...(p.id ? { id: p.id } : {}),
                  currency_code: p.currency_code,
                  amount: displayToAmount(p.amount),
                }))
            }
            return vPatch
          })
        }

        return patch
      })

      return sdk.admin.product.batch(
        { update } as Parameters<typeof sdk.admin.product.batch>[0]
      )
    },
    onSuccess: () => {
      const count = dirtyIds.size
      toast.success(`${count} product${count !== 1 ? "s" : ""} updated`)
      queryClient.invalidateQueries({ queryKey: ["admin-products-bulk"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
    onError: () => {
      toast.error("Failed to save products. Please try again.")
    },
  })

  const handleSave = useCallback(() => {
    if (hasErrors || !hasDirty || isSaving) return
    saveBatch()
  }, [hasErrors, hasDirty, isSaving, saveBatch])

  // Ctrl+S / ⌘S shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [handleSave])

  // ── Pagination ──────────────────────────────────────────────────────────
  const total = data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  const handlePageChange = useCallback(
    (newOffset: number) => {
      if (hasDirty) {
        if (
          !window.confirm(
            "You have unsaved changes. Discard them and change page?"
          )
        )
          return
      }
      setOffset(newOffset)
    },
    [hasDirty]
  )

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/products">
            <Button variant="transparent" size="small" className="!p-0 gap-1.5">
              <ChevronLeft />
              Back to products
            </Button>
          </Link>
          <span className="text-ui-fg-muted">/</span>
          <span className="txt-small text-ui-fg-subtle">Bulk Edit</span>
        </div>

        <div className="flex items-center gap-3">
          {hasDirty && (
            <Text size="small" className="text-ui-fg-subtle">
              {dirtyIds.size} unsaved change{dirtyIds.size !== 1 ? "s" : ""}
            </Text>
          )}
          <Button
            variant="secondary"
            size="small"
            onClick={discard}
            disabled={!hasDirty || isSaving}
          >
            Discard
          </Button>
          <Button
            size="small"
            onClick={handleSave}
            disabled={!hasDirty || hasErrors || isSaving}
          >
            {isSaving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Page title */}
      <div>
        <Heading>Bulk Edit Products</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Edit product fields and variant prices in bulk. Press Ctrl+S (or ⌘S)
          to save. Click <ChevronRight className="inline" /> to expand variants.
          Tags are comma-separated. Prices are in main currency units (e.g.
          dollars, not cents).
        </Text>
      </div>

      {/* Table */}
      <Container className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <Text className="text-ui-fg-muted">Loading products…</Text>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-4 p-12">
            <Text className="text-ui-fg-muted">Failed to load products.</Text>
            <Button
              variant="secondary"
              size="small"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        ) : working.length === 0 ? (
          <div className="flex flex-col items-center gap-4 p-12">
            <Text className="text-ui-fg-muted">No products found.</Text>
            <Link to="/products/create">
              <Button size="small" variant="secondary">
                Create product
              </Button>
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 1400 }}>
              <thead>
                <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                  {/* Expand-all toggle */}
                  <th className="px-3 py-3" style={{ width: 40 }}>
                    <button
                      onClick={toggleExpandAll}
                      className="text-ui-fg-muted hover:text-ui-fg-base transition-colors"
                      title={allExpanded ? "Collapse all" : "Expand all variants"}
                    >
                      {allExpanded ? <ChevronDown /> : <ChevronRight />}
                    </button>
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 56 }}
                  >
                    Image
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 180 }}
                  >
                    Title
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 150 }}
                  >
                    Subtitle
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 150 }}
                  >
                    Handle
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 130 }}
                  >
                    Status
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 170 }}
                  >
                    Tags
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 120 }}
                  >
                    Material
                  </th>
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 100 }}
                  >
                    Weight (g)
                  </th>
                  <th
                    className="px-3 py-3 text-center txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 110 }}
                  >
                    Discountable
                  </th>
                  <th
                    className="px-3 py-3"
                    style={{ width: 90 }}
                    aria-label="Changed"
                  />
                </tr>
              </thead>
              <tbody className="divide-y divide-ui-border-base">
                {working.map((row) => {
                  const isDirty = dirtyIds.has(row.id)
                  const hasVariantDirty = dirtyVariantMap.has(row.id)
                  const isOnlyVariantDirty =
                    hasVariantDirty && !dirtyProductIds.has(row.id)
                  const rowError = errors[row.id]
                  const isExpanded = expandedIds.has(row.id)

                  // Collect all unique currency codes across this product's variants
                  const currencies = Array.from(
                    new Set(
                      row.variants.flatMap((v) =>
                        v.prices.map((p) => p.currency_code)
                      )
                    )
                  )

                  return (
                    <React.Fragment key={row.id}>
                      {/* ── Product row ── */}
                      <tr
                        className={
                          isDirty ? "bg-ui-bg-highlight" : "bg-ui-bg-base"
                        }
                      >
                        {/* Expand toggle */}
                        <td className="px-3 py-2">
                          {row.variants.length > 0 && (
                            <button
                              onClick={() => toggleExpand(row.id)}
                              className="text-ui-fg-muted hover:text-ui-fg-base transition-colors"
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
                          )}
                        </td>

                        {/* Thumbnail */}
                        <td className="px-3 py-2">
                          {row.thumbnail ? (
                            <img
                              src={row.thumbnail}
                              alt=""
                              className="w-9 h-9 rounded object-cover border border-ui-border-base"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded bg-ui-bg-subtle border border-ui-border-base" />
                          )}
                        </td>

                        {/* Title */}
                        <td className="px-3 py-2">
                          <Input
                            value={row.title}
                            onChange={(e) =>
                              updateRow(row.id, "title", e.target.value)
                            }
                            placeholder="Product title"
                          />
                          {rowError && (
                            <p className="mt-1 txt-small text-ui-fg-error">
                              {rowError}
                            </p>
                          )}
                        </td>

                        {/* Subtitle */}
                        <td className="px-3 py-2">
                          <Input
                            value={row.subtitle}
                            onChange={(e) =>
                              updateRow(row.id, "subtitle", e.target.value)
                            }
                            placeholder="Short subtitle"
                          />
                        </td>

                        {/* Handle */}
                        <td className="px-3 py-2">
                          <Input
                            value={row.handle}
                            onChange={(e) =>
                              updateRow(row.id, "handle", e.target.value)
                            }
                            placeholder="product-handle"
                          />
                        </td>

                        {/* Status */}
                        <td className="px-3 py-2">
                          <select
                            value={row.status}
                            onChange={(e) =>
                              updateRow(row.id, "status", e.target.value)
                            }
                            className={cellInput}
                          >
                            <option value="draft">Draft</option>
                            <option value="published">Published</option>
                          </select>
                        </td>

                        {/* Tags */}
                        <td className="px-3 py-2">
                          <Input
                            value={row.tags}
                            onChange={(e) =>
                              updateRow(row.id, "tags", e.target.value)
                            }
                            placeholder="tag1, tag2"
                          />
                        </td>

                        {/* Material */}
                        <td className="px-3 py-2">
                          <Input
                            value={row.material}
                            onChange={(e) =>
                              updateRow(row.id, "material", e.target.value)
                            }
                            placeholder="e.g. Cotton"
                          />
                        </td>

                        {/* Weight */}
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            value={row.weight}
                            onChange={(e) =>
                              updateRow(row.id, "weight", e.target.value)
                            }
                            placeholder="0"
                            className={cellInput}
                          />
                        </td>

                        {/* Discountable */}
                        <td className="px-3 py-2 text-center">
                          <Checkbox
                            checked={row.discountable}
                            onCheckedChange={(checked) =>
                              updateRow(
                                row.id,
                                "discountable",
                                checked === true
                              )
                            }
                          />
                        </td>

                        {/* Dirty indicators */}
                        <td className="px-3 py-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            {dirtyProductIds.has(row.id) && (
                              <Badge color="orange" className="whitespace-nowrap">
                                Changed
                              </Badge>
                            )}
                            {hasVariantDirty && isOnlyVariantDirty && (
                              <Badge color="blue" className="whitespace-nowrap">
                                Variants
                              </Badge>
                            )}
                            {hasVariantDirty && !isOnlyVariantDirty && (
                              <Badge color="blue" className="whitespace-nowrap">
                                +Variants
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Variant sub-rows ── */}
                      {isExpanded && row.variants.length > 0 && (
                        <tr>
                          <td
                            colSpan={11}
                            className="p-0 border-b border-ui-border-base"
                          >
                            <div className="ml-10 border-l-2 border-ui-border-interactive bg-ui-bg-subtle">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b border-ui-border-base">
                                    <th
                                      className="px-4 py-2 text-left txt-compact-xsmall-plus text-ui-fg-muted"
                                      style={{ width: 160 }}
                                    >
                                      Variant
                                    </th>
                                    <th
                                      className="px-4 py-2 text-left txt-compact-xsmall-plus text-ui-fg-muted"
                                      style={{ minWidth: 160 }}
                                    >
                                      SKU
                                    </th>
                                    {currencies.map((cc) => (
                                      <th
                                        key={cc}
                                        className="px-4 py-2 text-left txt-compact-xsmall-plus text-ui-fg-muted"
                                        style={{ minWidth: 130 }}
                                      >
                                        Price ({cc.toUpperCase()})
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-ui-border-base">
                                  {row.variants.map((variant) => {
                                    const vDirty = dirtyVariantMap
                                      .get(row.id)
                                      ?.has(variant.id)
                                    return (
                                      <tr
                                        key={variant.id}
                                        className={
                                          vDirty
                                            ? "bg-ui-bg-highlight"
                                            : "bg-ui-bg-subtle"
                                        }
                                      >
                                        {/* Variant name */}
                                        <td className="px-4 py-2">
                                          <div className="flex items-center gap-2">
                                            <Text
                                              size="small"
                                              className="text-ui-fg-base font-medium"
                                            >
                                              {variant.title}
                                            </Text>
                                            {vDirty && (
                                              <Badge
                                                color="orange"
                                                className="whitespace-nowrap"
                                              >
                                                Changed
                                              </Badge>
                                            )}
                                          </div>
                                        </td>

                                        {/* SKU */}
                                        <td className="px-4 py-2">
                                          <Input
                                            value={variant.sku}
                                            onChange={(e) =>
                                              updateVariantSku(
                                                row.id,
                                                variant.id,
                                                e.target.value
                                              )
                                            }
                                            placeholder="SKU-001"
                                          />
                                        </td>

                                        {/* Price per currency */}
                                        {currencies.map((cc) => {
                                          const price = variant.prices.find(
                                            (p) => p.currency_code === cc
                                          )
                                          return (
                                            <td key={cc} className="px-4 py-2">
                                              {price ? (
                                                <input
                                                  type="number"
                                                  min={0}
                                                  step="0.01"
                                                  value={price.amount}
                                                  onChange={(e) =>
                                                    updateVariantPrice(
                                                      row.id,
                                                      variant.id,
                                                      cc,
                                                      e.target.value
                                                    )
                                                  }
                                                  placeholder="0.00"
                                                  className={cellInput}
                                                />
                                              ) : (
                                                <Text
                                                  size="small"
                                                  className="text-ui-fg-muted px-3"
                                                >
                                                  —
                                                </Text>
                                              )}
                                            </td>
                                          )
                                        })}
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Container>

      {/* Pagination */}
      {!isLoading && !isError && (
        <div className="flex items-center justify-between">
          <Text size="small" className="text-ui-fg-subtle">
            {total} product{total !== 1 ? "s" : ""} · Page {currentPage} of{" "}
            {totalPages}
          </Text>
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                disabled={offset === 0 || isSaving}
                onClick={() =>
                  handlePageChange(Math.max(0, offset - PAGE_SIZE))
                }
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="small"
                disabled={offset + PAGE_SIZE >= total || isSaving}
                onClick={() => handlePageChange(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default BulkEditPage
