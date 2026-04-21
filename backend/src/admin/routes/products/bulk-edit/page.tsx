import React, { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Checkbox,
  Container,
  DropdownMenu,
  FocusModal,
  Heading,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { ChevronDown, ChevronLeft, ChevronRight, PencilSquare, XMarkMini } from "@medusajs/icons"
import { hydrateProductVariantsInventoryQuantity } from "../../../lib/hydrate-product-variant-inventory"
import { sdk } from "../../../lib/sdk"
import {
  applyProductColumnPrefsPayload,
  fetchRemoteProductColumnPrefs,
  loadColumnPrefs,
  newCustomColumnId,
  saveColumnPrefs,
  saveRemoteProductColumnPrefs,
  type CustomColumnDef,
} from "../../../lib/product-column-prefs"
import { stripHtmlTags } from "../../../lib/strip-html"
import {
  DEFAULT_VISIBLE_COLUMNS,
  SUGGESTED_PRODUCT_METADATA_KEYS,
  TOGGLEABLE_COLUMNS,
  amountToDisplay,
  getMeta,
  getVariantPriceRange,
  tagsToString,
  variantMetadataColumnSummary,
} from "../../../lib/product-table-columns"
import { SimpleMarkdownEditor } from "../../../components/SimpleMarkdownEditor"

const PAGE_SIZE = 20
const ACCEPT_IMAGES = "image/jpeg,image/png,image/gif,image/webp"

/** Variant metadata keys editable in bulk */
/** Product `metadata` key for B2B discount (product-level, not variant). */
const B2B_DISCOUNT_META_KEY = "b2b_discount"

const VARIANT_METADATA_KEYS = [
  "sale_price",
  "color_hex",
  "wcwp_client-a",
  "wcwp_client-b",
  "wcwp_client-c",
  "wcwp_client-d",
] as const

type ProductStatus = "draft" | "proposed" | "published" | "rejected"

type DateOperator = {
  $gte?: string
  $lte?: string
}

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
  sale_price_id?: string
  sale_price_amount: string // display amount for configured price list
  thumbnail: string | null
  manage_inventory: boolean
  inventory_quantity: number | null
  /** First linked inventory item (Medusa v2 stock is on levels, not variant fields). */
  inventory_item_id: string | null
  inventory_required_quantity: number
  metadata: Record<string, unknown>
}

type ProductRow = {
  id: string
  title: string
  subtitle: string
  description: string
  handle: string
  status: ProductStatus
  category_ids: string[]
  material: string
  tags: string      // comma-separated
  weight: string    // as string for input control
  width: string     // as string for input control
  height: string    // as string for input control
  thumbnail: string | null
  metadata: Record<string, unknown>
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
  inventory_items?: {
    inventory_item_id?: string | null
    required_quantity?: number | null
  }[] | null
  metadata?: Record<string, unknown> | null
}

type ApiProduct = {
  id: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  handle?: string | null
  status?: string | null
  categories?: { id?: string; name?: string }[] | null
  material?: string | null
  weight?: number | null
  width?: number | null
  height?: number | null
  thumbnail?: string | null
  tags?: { id?: string; value?: string }[] | null
  metadata?: Record<string, unknown> | null
  variants?: ApiVariant[] | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert human-readable amount back to API amount (main units). */
function displayToAmount(value: string): number {
  return Number(value)
}

function toVariantRow(v: ApiVariant): VariantRow {
  const meta = (v.metadata ?? {}) as Record<string, unknown>
  // Variant thumbnail: top-level field first, then first image URL, then metadata fallback
  const thumbnail =
    (typeof v.thumbnail === "string" && v.thumbnail.trim() ? v.thumbnail : null) ??
    (v.images?.[0]?.url ?? null) ??
    (typeof meta?.thumbnail === "string" ? meta.thumbnail : null)
  const invLink = v.inventory_items?.[0] as
    | {
        inventory_item_id?: string | null
        required_quantity?: number | null
        inventory?: { id?: string | null }
      }
    | undefined
  const reqQty = invLink?.required_quantity
  const inventoryItemId =
    typeof invLink?.inventory_item_id === "string"
      ? invLink.inventory_item_id
      : typeof invLink?.inventory?.id === "string"
        ? invLink.inventory.id
        : null
  return {
    id: v.id,
    title: v.title ?? "Default",
    sku: v.sku ?? "",
    prices: (v.prices ?? []).map((p) => ({
      id: p.id,
      currency_code: p.currency_code ?? "usd",
      amount: amountToDisplay(p.amount),
    })),
    sale_price_id: undefined,
    sale_price_amount:
      typeof meta?.sale_price === "number"
        ? amountToDisplay(meta.sale_price as number)
        : "",
    thumbnail,
    manage_inventory: v.manage_inventory ?? false,
    inventory_quantity: v.inventory_quantity ?? null,
    inventory_item_id: inventoryItemId,
    inventory_required_quantity:
      typeof reqQty === "number" && reqQty > 0 ? reqQty : 1,
    metadata: meta,
  }
}

function toRow(p: ApiProduct): ProductRow {
  return {
    id: p.id,
    title: stripHtmlTags(p.title ?? ""),
    subtitle: stripHtmlTags(p.subtitle ?? ""),
    description: stripHtmlTags(p.description ?? ""),
    handle: p.handle ?? "",
    status: (p.status as ProductStatus) ?? "draft",
    category_ids: (p.categories ?? [])
      .map((c) => c.id ?? "")
      .filter(Boolean),
    material: p.material ?? "",
    tags: tagsToString(p.tags),
    weight: p.weight != null ? String(p.weight) : "",
    width: p.width != null ? String(p.width) : "",
    height: p.height != null ? String(p.height) : "",
    thumbnail: p.thumbnail ?? null,
    metadata: { ...(p.metadata ?? {}) } as Record<string, unknown>,
    variants: (p.variants ?? []).map(toVariantRow),
  }
}

/** Flat API categories → depth-first order with trail for search / labels. */
function buildHierarchicalCategoryRows(
  categories: Array<{
    id?: string
    name?: string
    parent_category_id?: string | null
    parent_category?: { id?: string } | null
    rank?: number | null
  }>
): { id: string; name: string; depth: number; breadcrumb: string }[] {
  type Node = {
    id: string
    name: string
    parentId: string | null
    rank: number
  }
  const nodes: Node[] = (categories ?? [])
    .filter((c) => c?.id)
    .map((c) => ({
      id: c.id as string,
      name: c.name ?? "",
      parentId:
        (c.parent_category_id ?? c.parent_category?.id ?? null) || null,
      rank: typeof c.rank === "number" ? c.rank : 0,
    }))

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children = new Map<string | null, Node[]>()
  for (const n of nodes) {
    const pid =
      n.parentId && byId.has(n.parentId) ? n.parentId : null
    if (!children.has(pid)) children.set(pid, [])
    children.get(pid)!.push(n)
  }
  for (const [, arr] of children) {
    arr.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
  }

  const out: { id: string; name: string; depth: number; breadcrumb: string }[] =
    []
  const walk = (pid: string | null, depth: number, prefix: string[]) => {
    for (const n of children.get(pid) ?? []) {
      const trail = [...prefix, n.name]
      out.push({
        id: n.id,
        name: n.name,
        depth,
        breadcrumb: trail.join(" › "),
      })
      walk(n.id, depth + 1, trail)
    }
  }
  walk(null, 0, [])
  return out
}

type RowErrors = Record<string, string>

type RichTextEditState =
  | null
  | {
      productId: string
      draftTitle: string
      draftSubtitle: string
      draftDescription: string
    }

function stripForPreview(raw: string, maxLen: number): string {
  const s = raw.replace(/\s+/g, " ").trim()
  if (!s) return ""
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
}

const cellInput =
  "flex h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 txt-small focus:border-ui-border-interactive focus:outline-none"

/**
 * Category picker row: flex layout, fixed-size icon slot (check only when selected).
 * Used with DropdownMenu.Item asChild so Radix can merge focus / keyboard behavior.
 */
const CategoryMenuCheckboxRow = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    checked: boolean
    depth: number
    breadcrumb: string
    name: string
  }
>(function CategoryMenuCheckboxRow(
  { checked, depth, breadcrumb, name, className, style, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      role="menuitemcheckbox"
      aria-checked={checked}
      title={breadcrumb}
      className={[
        "flex w-full min-w-0 cursor-pointer select-none items-center gap-[5px] py-1.5 pl-2 pr-2 text-left txt-small text-ui-fg-base outline-none data-[highlighted]:bg-ui-bg-base-hover",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      {...rest}
    >
      <div
        className="flex shrink-0 items-center"
        style={{ paddingLeft: depth * 16 }}
      >
        <span className="inline-flex size-4 items-center justify-center text-ui-fg-interactive">
          {checked ? (
            <svg
              className="size-4"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                d="M12.75 4.75L6.5 11 3.25 7.75"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </div>
  )
})
CategoryMenuCheckboxRow.displayName = "CategoryMenuCheckboxRow"

// ─── Component ───────────────────────────────────────────────────────────────

const BulkEditPage = () => {
  const queryClient = useQueryClient()
  const mergedServerColumnPrefsRef = React.useRef(false)
  const productThumbnailInputRef = React.useRef<HTMLInputElement>(null)
  const variantThumbnailInputRef = React.useRef<HTMLInputElement>(null)
  const [uploadingThumbnailFor, setUploadingThumbnailFor] = useState<string | null>(null)
  const [uploadingVariantThumbnailFor, setUploadingVariantThumbnailFor] = useState<{
    productId: string
    variantId: string
  } | null>(null)
  const SALE_PRICE_LIST_ID =
    typeof import.meta !== "undefined"
      ? ((import.meta as any).env?.VITE_SALE_PRICE_LIST_ID as
          | string
          | undefined)
      : undefined
  const SALE_PRICE_CURRENCY =
    typeof import.meta !== "undefined"
      ? (((import.meta as any).env?.VITE_SALE_PRICE_CURRENCY as
          | string
          | undefined) ??
          "usd")
      : "usd"

  const [offset, setOffset] = useState(0)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<ProductStatus[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [typeIds, setTypeIds] = useState<string[]>([])
  const [salesChannelIds, setSalesChannelIds] = useState<string[]>([])
  const [createdAt, setCreatedAt] = useState<DateOperator>({})
  const [updatedAt, setUpdatedAt] = useState<DateOperator>({})
  const [filterSearch, setFilterSearch] = useState("")
  const [source, setSource] = useState<ProductRow[]>([])
  const [working, setWorking] = useState<ProductRow[]>([])
  const [errors, setErrors] = useState<RowErrors>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [richTextEdit, setRichTextEdit] = useState<RichTextEditState>(null)
  const [columnMode, setColumnMode] = useState<"default" | "custom">(
    () => loadColumnPrefs().mode
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    () => loadColumnPrefs().visible
  )
  const [customColumns, setCustomColumns] = useState<CustomColumnDef[]>(
    () => loadColumnPrefs().customColumns
  )
  const [newCustomLabel, setNewCustomLabel] = useState("")
  const [newCustomSourceKind, setNewCustomSourceKind] = useState<
    "variant_metadata" | "product_metadata"
  >("variant_metadata")
  const [newCustomKey, setNewCustomKey] = useState("")

  const extraVariantMetadataKeys = useMemo(() => {
    const s = new Set<string>()
    for (const c of customColumns) {
      if (c.source.kind === "variant_metadata") s.add(c.source.key)
    }
    return s
  }, [customColumns])

  useEffect(() => {
    saveColumnPrefs(columnMode, visibleColumns, customColumns)
  }, [columnMode, visibleColumns, customColumns])

  const {
    data: remoteColumnPrefs,
    status: remoteColumnPrefsStatus,
  } = useQuery({
    queryKey: ["admin-product-column-prefs-remote"],
    queryFn: () => fetchRemoteProductColumnPrefs(sdk),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  const remoteColumnPrefsFetchDone = remoteColumnPrefsStatus !== "pending"

  useEffect(() => {
    if (!remoteColumnPrefsFetchDone) return
    if (!remoteColumnPrefs) return
    if (mergedServerColumnPrefsRef.current) return
    mergedServerColumnPrefsRef.current = true
    const visibleArr =
      remoteColumnPrefs.visible?.length
        ? remoteColumnPrefs.visible
        : [...DEFAULT_VISIBLE_COLUMNS]
    setColumnMode(remoteColumnPrefs.mode)
    setVisibleColumns(new Set(visibleArr))
    setCustomColumns(remoteColumnPrefs.customColumns ?? [])
    applyProductColumnPrefsPayload({
      mode: remoteColumnPrefs.mode,
      visible: visibleArr,
      customColumns: remoteColumnPrefs.customColumns ?? [],
    })
  }, [remoteColumnPrefsFetchDone, remoteColumnPrefs])

  useEffect(() => {
    if (!remoteColumnPrefsFetchDone) return
    const t = window.setTimeout(() => {
      void saveRemoteProductColumnPrefs(sdk, {
        mode: columnMode,
        visible: [...visibleColumns],
        customColumns,
      }).catch(() => {
        /* offline */
      })
    }, 900)
    return () => window.clearTimeout(t)
  }, [
    remoteColumnPrefsFetchDone,
    columnMode,
    visibleColumns,
    customColumns,
  ])

  const isColumnVisible = useCallback(
    (id: string) => {
      if (id === "expand" || id === "image" || id === "title" || id === "status")
        return true
      if (columnMode === "default") return true
      return visibleColumns.has(id)
    },
    [columnMode, visibleColumns]
  )

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setOffset(0)
    }, 250)

    return () => window.clearTimeout(t)
  }, [search])

  // ── Fetch ───────────────────────────────────────────────────────────────
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [
      "admin-products-bulk",
      offset,
      debouncedSearch,
      statusFilter,
      tagIds,
      typeIds,
      salesChannelIds,
      createdAt,
      updatedAt,
    ],
    queryFn: async () => {
      const res = await sdk.admin.product.list({
        limit: PAGE_SIZE,
        offset,
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        ...(statusFilter.length ? { status: statusFilter } : {}),
        ...(tagIds.length ? { tag_id: tagIds } : {}),
        ...(typeIds.length ? { type_id: typeIds } : {}),
        ...(salesChannelIds.length ? { sales_channel_id: salesChannelIds } : {}),
        ...(createdAt.$gte || createdAt.$lte ? { created_at: createdAt } : {}),
        ...(updatedAt.$gte || updatedAt.$lte ? { updated_at: updatedAt } : {}),
        fields:
          "+thumbnail,+tags,*categories,+description,+material,+weight,+width,+height,+metadata,+variants,+variants.prices,+variants.thumbnail,+variants.images,+variants.manage_inventory,*variants.inventory_items,+variants.metadata",
      } as Parameters<typeof sdk.admin.product.list>[0])
      await hydrateProductVariantsInventoryQuantity(res.products ?? [])
      return res
    },
    refetchOnWindowFocus: false,
  })

  const { data: tagsData } = useQuery({
    queryKey: ["admin-product-tags-bulk"],
    queryFn: () => sdk.admin.productTag.list({ limit: 200 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: typesData } = useQuery({
    queryKey: ["admin-product-types-bulk"],
    queryFn: () => sdk.admin.productType.list({ limit: 200 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: channelsData } = useQuery({
    queryKey: ["admin-sales-channels-bulk"],
    queryFn: () => sdk.admin.salesChannel.list({ limit: 200 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: categoriesData } = useQuery({
    queryKey: ["admin-product-categories-bulk"],
    queryFn: () => sdk.admin.productCategory.list({ limit: 200 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: stockLocationsData } = useQuery({
    queryKey: ["admin-stock-locations-bulk"],
    queryFn: () => sdk.admin.stockLocation.list({ limit: 100 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const primaryStockLocationId = useMemo(() => {
    const locs = (stockLocationsData as { stock_locations?: { id?: string; name?: string | null }[] })
      ?.stock_locations
    if (!locs?.length) return null
    const sorted = [...locs].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" })
    )
    return sorted[0]?.id ?? null
  }, [stockLocationsData])

  const hierarchicalCategories = useMemo(() => {
    const raw = (categoriesData as any)?.product_categories ?? []
    return buildHierarchicalCategoryRows(raw)
  }, [categoriesData])

  const categoryBreadcrumbById = useMemo(() => {
    const m = new Map<string, string>()
    for (const row of hierarchicalCategories) {
      m.set(row.id, row.breadcrumb)
    }
    return m
  }, [hierarchicalCategories])

  const variantIdsOnPage = useMemo(() => {
    return (data?.products ?? [])
      .flatMap((p: any) => (p.variants ?? []).map((v: any) => v.id))
      .filter(Boolean)
  }, [data])

  const { data: priceListData } = useQuery({
    queryKey: ["admin-sale-price-list", SALE_PRICE_LIST_ID, variantIdsOnPage],
    queryFn: () =>
      sdk.admin.priceList.retrieve(SALE_PRICE_LIST_ID!, {
        fields: "id,prices.id,prices.variant_id,prices.currency_code,prices.amount",
      } as any),
    enabled: !!SALE_PRICE_LIST_ID && variantIdsOnPage.length > 0,
    staleTime: 30_000,
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

  useEffect(() => {
    if (!SALE_PRICE_LIST_ID) return
    const prices = (priceListData as any)?.price_list?.prices ?? []
    if (!Array.isArray(prices)) return

    const map = new Map<string, { id?: string; amount?: number }>()
    for (const p of prices) {
      if (!p?.variant_id) continue
      if ((p.currency_code ?? "").toLowerCase() !== SALE_PRICE_CURRENCY.toLowerCase())
        continue
      map.set(p.variant_id, { id: p.id, amount: p.amount })
    }

    const apply = (rows: ProductRow[]) =>
      rows.map((r) => ({
        ...r,
        variants: r.variants.map((v) => {
          const sale = map.get(v.id)
          return {
            ...v,
            sale_price_id: sale?.id ?? v.sale_price_id,
            // Prefer price list amount when available; otherwise keep existing
            // (which may come from metadata fallback or user edits).
            sale_price_amount:
              sale?.amount != null ? amountToDisplay(sale.amount) : v.sale_price_amount,
          }
        }),
      }))

    setSource((prev) => apply(prev))
    setWorking((prev) => apply(prev))
  }, [SALE_PRICE_LIST_ID, SALE_PRICE_CURRENCY, priceListData])

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
        row.description !== orig.description ||
        row.handle !== orig.handle ||
        row.status !== orig.status ||
        JSON.stringify(row.category_ids) !== JSON.stringify(orig.category_ids) ||
        row.material !== orig.material ||
        row.tags !== orig.tags ||
        row.weight !== orig.weight ||
        row.width !== orig.width ||
        row.height !== orig.height ||
        row.thumbnail !== orig.thumbnail ||
        JSON.stringify(row.metadata ?? {}) !==
          JSON.stringify(orig.metadata ?? {})
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
        const metadataDirty =
          VARIANT_METADATA_KEYS.some(
            (k) => getMeta(variant.metadata, k) !== getMeta(origV.metadata, k)
          ) ||
          [...extraVariantMetadataKeys].some(
            (k) => getMeta(variant.metadata, k) !== getMeta(origV.metadata, k)
          )
        if (
          variant.sku !== origV.sku ||
          JSON.stringify(variant.prices) !== JSON.stringify(origV.prices) ||
          variant.sale_price_amount !== origV.sale_price_amount ||
          variant.thumbnail !== origV.thumbnail ||
          variant.manage_inventory !== origV.manage_inventory ||
          variant.inventory_quantity !== origV.inventory_quantity ||
          metadataDirty
        ) {
          if (!map.has(row.id)) map.set(row.id, new Set())
          map.get(row.id)!.add(variant.id)
        }
      }
    }
    return map
  }, [working, source, extraVariantMetadataKeys])

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
      field: keyof Omit<ProductRow, "id" | "variants">,
      value: string | boolean | string[] | null
    ) => {
      let nextValue: string | boolean | string[] | null = value
      if (
        (field === "title" ||
          field === "subtitle" ||
          field === "description") &&
        typeof value === "string"
      ) {
        nextValue = stripHtmlTags(value)
      }
      setWorking((prev) =>
        prev.map((row) =>
          row.id === id ? { ...row, [field]: nextValue } : row
        )
      )
      if (field === "title") {
        if (!(nextValue as string).trim()) {
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

  const closeRichTextEdit = useCallback(() => {
    setRichTextEdit(null)
  }, [])

  const openRichTextEdit = useCallback(
    (
      productId: string,
      fields: Pick<ProductRow, "title" | "subtitle" | "description">
    ) => {
      setRichTextEdit({
        productId,
        draftTitle: stripHtmlTags(fields.title),
        draftSubtitle: stripHtmlTags(fields.subtitle),
        draftDescription: stripHtmlTags(fields.description),
      })
    },
    []
  )

  const setRichTextDraftField = useCallback(
    (
      key: "draftTitle" | "draftSubtitle" | "draftDescription",
      value: string
    ) => {
      setRichTextEdit((prev) => (prev ? { ...prev, [key]: value } : null))
    },
    []
  )

  const saveRichTextEdit = useCallback(() => {
    if (!richTextEdit) return
    const title = stripHtmlTags(richTextEdit.draftTitle)
    const subtitle = stripHtmlTags(richTextEdit.draftSubtitle)
    const description = stripHtmlTags(richTextEdit.draftDescription)
    if (!title.trim()) {
      toast.error("Title is required")
      return
    }
    const id = richTextEdit.productId
    setWorking((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, title, subtitle, description } : row
      )
    )
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setRichTextEdit(null)
  }, [richTextEdit])

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

  const updateVariantSalePrice = useCallback(
    (productId: string, variantId: string, amount: string) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) =>
              v.id === variantId
                ? {
                    ...v,
                    sale_price_amount: amount,
                    metadata: {
                      ...(v.metadata ?? {}),
                      sale_price:
                        amount.trim() === "" ? null : displayToAmount(amount),
                    },
                  }
                : v
            ),
          }
        })
      )
    },
    []
  )

  const updateVariantThumbnail = useCallback(
    (productId: string, variantId: string, thumbnail: string | null) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) =>
              v.id === variantId ? { ...v, thumbnail } : v
            ),
          }
        })
      )
    },
    []
  )

  const updateVariantMetadata = useCallback(
    (
      productId: string,
      variantId: string,
      key: string,
      value: string | number | null
    ) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) => {
              if (v.id !== variantId) return v
              const nextMeta = { ...(v.metadata ?? {}) }
              if (value !== null && value !== "") {
                nextMeta[key] =
                  typeof value === "number" ? value : String(value).trim()
              } else {
                delete nextMeta[key]
              }
              return { ...v, metadata: nextMeta }
            }),
          }
        })
      )
    },
    []
  )

  const updateProductMetadata = useCallback(
    (productId: string, key: string, value: string | null) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          const nextMeta = { ...(row.metadata ?? {}) }
          if (value !== null && value.trim() !== "") {
            nextMeta[key] = value.trim()
          } else {
            delete nextMeta[key]
          }
          return { ...row, metadata: nextMeta }
        })
      )
    },
    []
  )

  const addCustomColumn = useCallback(() => {
    const label = newCustomLabel.trim()
    const key = newCustomKey.trim()
    if (!label || !key) {
      toast.error("Enter a column label and metadata key.")
      return
    }
    const id = newCustomColumnId()
    const def: CustomColumnDef =
      newCustomSourceKind === "variant_metadata"
        ? { id, label, source: { kind: "variant_metadata", key } }
        : { id, label, source: { kind: "product_metadata", key } }
    setCustomColumns((prev) => [...prev, def])
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setNewCustomLabel("")
    setNewCustomKey("")
    toast.success("Custom column added")
  }, [newCustomLabel, newCustomKey, newCustomSourceKind])

  const removeCustomColumn = useCallback((columnId: string) => {
    setCustomColumns((prev) => prev.filter((c) => c.id !== columnId))
    setVisibleColumns((prev) => {
      const next = new Set(prev)
      next.delete(columnId)
      return next
    })
  }, [])

  const toggleSuggestedProductMetadataColumn = useCallback(
    (metaKey: string, metaLabel: string, enabled: boolean) => {
      if (enabled) {
        setCustomColumns((prev) => {
          if (
            prev.some(
              (c) =>
                c.source.kind === "product_metadata" &&
                c.source.key === metaKey
            )
          ) {
            return prev
          }
          const id = newCustomColumnId()
          setVisibleColumns((v) => {
            const next = new Set(v)
            next.add(id)
            return next
          })
          return [
            ...prev,
            {
              id,
              label: metaLabel,
              source: { kind: "product_metadata" as const, key: metaKey },
            },
          ]
        })
        return
      }
      setCustomColumns((prev) => {
        const ids = prev
          .filter(
            (c) =>
              c.source.kind === "product_metadata" && c.source.key === metaKey
          )
          .map((c) => c.id)
        if (ids.length) {
          setVisibleColumns((v) => {
            const next = new Set(v)
            for (const id of ids) next.delete(id)
            return next
          })
        }
        return prev.filter(
          (c) =>
            !(
              c.source.kind === "product_metadata" && c.source.key === metaKey
            )
        )
      })
    },
    []
  )

  const updateVariantManageInventory = useCallback(
    (productId: string, variantId: string, manage_inventory: boolean) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) =>
              v.id === variantId
                ? {
                    ...v,
                    manage_inventory,
                    inventory_quantity: manage_inventory
                      ? v.inventory_quantity ?? 0
                      : null,
                  }
                : v
            ),
          }
        })
      )
    },
    []
  )

  const updateVariantInventoryQuantity = useCallback(
    (
      productId: string,
      variantId: string,
      inventory_quantity: number | null
    ) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) =>
              v.id === variantId ? { ...v, inventory_quantity } : v
            ),
          }
        })
      )
    },
    []
  )

  const handleProductThumbnailUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const productId = uploadingThumbnailFor
      const files = e.target.files
      if (!productId || !files?.length) return
      setUploadingThumbnailFor(null)
      try {
        const { files: uploaded } = await sdk.admin.upload.create({
          files: Array.from(files),
        })
        if (uploaded?.length && (uploaded[0] as { url?: string }).url) {
          updateRow(productId, "thumbnail", (uploaded[0] as { url: string }).url)
          toast.success("Thumbnail updated")
        } else {
          toast.error("Upload failed")
        }
      } catch {
        toast.error("Upload failed")
      }
      e.target.value = ""
    },
    [uploadingThumbnailFor, updateRow]
  )

  const handleVariantThumbnailUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const target = uploadingVariantThumbnailFor
      const files = e.target.files
      if (!target || !files?.length) return
      setUploadingVariantThumbnailFor(null)
      try {
        const { files: uploaded } = await sdk.admin.upload.create({
          files: Array.from(files),
        })
        if (uploaded?.length && (uploaded[0] as { url?: string }).url) {
          updateVariantThumbnail(
            target.productId,
            target.variantId,
            (uploaded[0] as { url: string }).url
          )
          toast.success("Variant thumbnail updated")
        } else {
          toast.error("Upload failed")
        }
      } catch {
        toast.error("Upload failed")
      }
      e.target.value = ""
    },
    [uploadingVariantThumbnailFor, updateVariantThumbnail]
  )

  const discard = useCallback(() => {
    setWorking(source)
    setErrors({})
  }, [source])

  const handleSearchChange = useCallback(
    (value: string) => {
      if (hasDirty) {
        if (
          !window.confirm(
            "You have unsaved changes. Discard them and change search?"
          )
        ) {
          return
        }
        discard()
      }
      setSearch(value)
    },
    [discard, hasDirty]
  )

  const handleFiltersChange = useCallback(
    (next: {
      status?: ProductStatus[]
      tagIds?: string[]
      typeIds?: string[]
      salesChannelIds?: string[]
      createdAt?: DateOperator
      updatedAt?: DateOperator
    }) => {
      if (hasDirty) {
        if (
          !window.confirm(
            "You have unsaved changes. Discard them and change filters?"
          )
        ) {
          return
        }
        discard()
      }

      if (next.status !== undefined) setStatusFilter(next.status)
      if (next.tagIds !== undefined) setTagIds(next.tagIds)
      if (next.typeIds !== undefined) setTypeIds(next.typeIds)
      if (next.salesChannelIds !== undefined)
        setSalesChannelIds(next.salesChannelIds)
      if (next.createdAt !== undefined) setCreatedAt(next.createdAt)
      if (next.updatedAt !== undefined) setUpdatedAt(next.updatedAt)
      setOffset(0)
    },
    [discard, hasDirty]
  )

  const clearFilters = useCallback(() => {
    handleFiltersChange({
      status: [],
      tagIds: [],
      typeIds: [],
      salesChannelIds: [],
      createdAt: {},
      updatedAt: {},
    })
  }, [handleFiltersChange])

  const ensureSafeToChangeFilters = useCallback(() => {
    if (!hasDirty) return true
    if (
      !window.confirm("You have unsaved changes. Discard them and continue?")
    ) {
      return false
    }
    discard()
    return true
  }, [discard, hasDirty])

  const hasAnyFilters =
    statusFilter.length > 0 ||
    tagIds.length > 0 ||
    typeIds.length > 0 ||
    salesChannelIds.length > 0 ||
    createdAt.$gte != null ||
    createdAt.$lte != null ||
    updatedAt.$gte != null ||
    updatedAt.$lte != null

  // ── Batch save ──────────────────────────────────────────────────────────
  const { mutate: saveBatch, isPending: isSaving } = useMutation({
    mutationFn: async () => {
      const categoryOps = new Map<string, { add: string[]; remove: string[] }>()
      const priceListOps = {
        create: [] as any[],
        update: [] as any[],
        delete: [] as string[],
      }
      const tagValueToId = new Map<string, string>(
        (tagsData?.product_tags ?? []).flatMap((t: any) => {
          const v = (t?.value ?? "").trim()
          if (!v) return []
          return [[v.toLowerCase(), t.id as string]]
        })
      )

      const ensureTagIds = async (values: string[]) => {
        const ids: string[] = []
        for (const raw of values) {
          const key = raw.trim().toLowerCase()
          if (!key) continue

          const existing = tagValueToId.get(key)
          if (existing) {
            ids.push(existing)
            continue
          }

          const created = await sdk.admin.productTag.create({ value: raw.trim() })
          const createdId = (created as any)?.product_tag?.id
          if (createdId) {
            tagValueToId.set(key, createdId)
            ids.push(createdId)
          }
        }
        return ids
      }

      const variantMetaKeysForSave = new Set<string>([
        ...VARIANT_METADATA_KEYS,
        ...extraVariantMetadataKeys,
      ])

      const update = await Promise.all(
        Array.from(dirtyIds).map(async (id) => {
        const row = working.find((r) => r.id === id)!
        const orig = source.find((s) => s.id === id)!
        const patch: Record<string, unknown> & { id: string } = { id }

        if (row.title !== orig.title) patch.title = row.title
        if (row.subtitle !== orig.subtitle) patch.subtitle = row.subtitle
          if (row.description !== orig.description)
            patch.description = row.description || null
        if (row.handle !== orig.handle) patch.handle = row.handle
        if (row.status !== orig.status) patch.status = row.status
        if (
          JSON.stringify(row.category_ids) !== JSON.stringify(orig.category_ids)
        ) {
          const toAdd = row.category_ids.filter((c) => !orig.category_ids.includes(c))
          const toRemove = orig.category_ids.filter((c) => !row.category_ids.includes(c))

          for (const categoryId of toAdd) {
            if (!categoryOps.has(categoryId)) {
              categoryOps.set(categoryId, { add: [], remove: [] })
            }
            categoryOps.get(categoryId)!.add.push(id)
          }

          for (const categoryId of toRemove) {
            if (!categoryOps.has(categoryId)) {
              categoryOps.set(categoryId, { add: [], remove: [] })
            }
            categoryOps.get(categoryId)!.remove.push(id)
          }
        }
        if (row.material !== orig.material) patch.material = row.material || null
        if (row.tags !== orig.tags) {
          const arr = row.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
          const tagIds = await ensureTagIds(arr)
          patch.tags = tagIds.map((tagId) => ({ id: tagId }))
        }
        if (row.weight !== orig.weight) {
          patch.weight = row.weight === "" ? null : Number(row.weight)
        }
        if (row.width !== orig.width) {
          patch.width = row.width === "" ? null : Number(row.width)
        }
        if (row.height !== orig.height) {
          patch.height = row.height === "" ? null : Number(row.height)
        }
        if (row.thumbnail !== orig.thumbnail) {
          patch.thumbnail = row.thumbnail || null
        }
        if (
          JSON.stringify(row.metadata ?? {}) !==
          JSON.stringify(orig.metadata ?? {})
        ) {
          patch.metadata = {
            ...(orig.metadata ?? {}),
            ...(row.metadata ?? {}),
          }
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
            // Variant thumbnail is a top-level field in Medusa API
            if (v.thumbnail !== origV.thumbnail) {
              vPatch.thumbnail = v.thumbnail?.trim() || null
            }
            if (v.manage_inventory !== origV.manage_inventory) {
              vPatch.manage_inventory = v.manage_inventory
            }

            // Build merged metadata for sale_price, color_hex, wcwp_client-*, etc.
            const metaUpdates: Record<string, unknown> = {
              ...(origV.metadata ?? {}),
            }
            let metaChanged = false

            // Sale price metadata via price list when configured
            if (
              SALE_PRICE_LIST_ID &&
              v.sale_price_amount !== origV.sale_price_amount
            ) {
              const next = v.sale_price_amount.trim()
              const prev = origV.sale_price_amount.trim()

              if (prev === "" && next !== "") {
                priceListOps.create.push({
                  variant_id: variantId,
                  currency_code: SALE_PRICE_CURRENCY,
                  amount: displayToAmount(next),
                })
              } else if (prev !== "" && next === "" && origV.sale_price_id) {
                priceListOps.delete.push(origV.sale_price_id)
              } else if (prev !== "" && next !== "" && origV.sale_price_id) {
                priceListOps.update.push({
                  id: origV.sale_price_id,
                  variant_id: variantId,
                  amount: displayToAmount(next),
                })
              } else if (prev !== "" && next !== "" && !origV.sale_price_id) {
                priceListOps.create.push({
                  variant_id: variantId,
                  currency_code: SALE_PRICE_CURRENCY,
                  amount: displayToAmount(next),
                })
              }
              metaUpdates.sale_price =
                next === "" ? null : displayToAmount(next)
              metaChanged = true
            }

            // Other metadata fields (sale_price when no price list, color_hex, wcwp_client-*, custom keys)
            for (const key of variantMetaKeysForSave) {
              if (key === "sale_price" && SALE_PRICE_LIST_ID) continue // already handled above
              const prev = getMeta(origV.metadata, key)
              const next = getMeta(v.metadata, key)
              if (prev !== next) {
                if (next && next.trim()) {
                  metaUpdates[key] =
                    key === "sale_price" ? displayToAmount(next) : next.trim()
                } else {
                  delete metaUpdates[key]
                }
                metaChanged = true
              }
            }

            if (metaChanged) {
              vPatch.metadata = metaUpdates
            }
            return vPatch
          })
        }

        return patch
      })
      )

      let inventorySaveNeedsLocation = false
      for (const id of dirtyIds) {
        const row = working.find((r) => r.id === id)
        const orig = source.find((s) => s.id === id)
        if (!row || !orig) continue
        const dirtyVs = dirtyVariantMap.get(id)
        if (!dirtyVs) continue
        for (const variantId of dirtyVs) {
          const v = row.variants.find((x) => x.id === variantId)
          const origV = orig.variants.find((x) => x.id === variantId)
          if (!v || !origV) continue
          if (!v.manage_inventory) continue
          if (v.inventory_quantity === origV.inventory_quantity) continue
          if (!origV.inventory_item_id) continue
          inventorySaveNeedsLocation = true
          break
        }
        if (inventorySaveNeedsLocation) break
      }
      if (inventorySaveNeedsLocation && !primaryStockLocationId) {
        throw new Error(
          "Stock quantity was changed but no stock location exists. Create a stock location in Settings (Inventory → Locations), then save again."
        )
      }

      const batchRes = await sdk.admin.product.batch(
        { update } as Parameters<typeof sdk.admin.product.batch>[0]
      )

      const inventoryLevelUpdates: {
        inventory_item_id: string
        location_id: string
        stocked_quantity: number
      }[] = []

      if (primaryStockLocationId) {
        for (const id of dirtyIds) {
          const row = working.find((r) => r.id === id)
          const orig = source.find((s) => s.id === id)
          if (!row || !orig) continue
          const dirtyVs = dirtyVariantMap.get(id)
          if (!dirtyVs) continue
          for (const variantId of dirtyVs) {
            const v = row.variants.find((x) => x.id === variantId)
            const origV = orig.variants.find((x) => x.id === variantId)
            if (!v || !origV) continue
            if (!v.manage_inventory) continue
            if (v.inventory_quantity === origV.inventory_quantity) continue
            const itemId = origV.inventory_item_id
            if (!itemId) continue
            const req = Math.max(1, origV.inventory_required_quantity)
            const qty =
              v.inventory_quantity != null
                ? Math.max(0, Math.round(v.inventory_quantity))
                : 0
            inventoryLevelUpdates.push({
              inventory_item_id: itemId,
              location_id: primaryStockLocationId,
              stocked_quantity: qty * req,
            })
          }
        }
      }

      if (inventoryLevelUpdates.length) {
        await sdk.admin.inventoryItem.batchInventoryItemsLocationLevels({
          update: inventoryLevelUpdates,
        } as Parameters<
          typeof sdk.admin.inventoryItem.batchInventoryItemsLocationLevels
        >[0])
      }

      // Product categories are managed through category endpoints, not product batch update.
      // Apply diffs per category.
      if (categoryOps.size > 0) {
        await Promise.all(
          Array.from(categoryOps.entries()).map(([categoryId, ops]) => {
            const body: { add?: string[]; remove?: string[] } = {}
            if (ops.add.length) body.add = ops.add
            if (ops.remove.length) body.remove = ops.remove
            return sdk.admin.productCategory.updateProducts(categoryId, body as any)
          })
        )
      }

      if (
        SALE_PRICE_LIST_ID &&
        (priceListOps.create.length ||
          priceListOps.update.length ||
          priceListOps.delete.length)
      ) {
        await sdk.admin.priceList.batchPrices(
          SALE_PRICE_LIST_ID,
          priceListOps as any
        )
      }

      return batchRes
    },
    onSuccess: () => {
      const count = dirtyIds.size
      toast.success(`${count} product${count !== 1 ? "s" : ""} updated`)
      queryClient.invalidateQueries({ queryKey: ["admin-products-bulk"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
    onError: (e: Error) => {
      toast.error(
        e?.message && e.message.length < 200
          ? e.message
          : "Failed to save products. Please try again."
      )
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
    <div className="flex flex-col pb-4">
      <input
        ref={productThumbnailInputRef}
        type="file"
        accept={ACCEPT_IMAGES}
        className="hidden"
        onChange={handleProductThumbnailUpload}
      />
      <input
        ref={variantThumbnailInputRef}
        type="file"
        accept={ACCEPT_IMAGES}
        className="hidden"
        onChange={handleVariantThumbnailUpload}
      />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4" >
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
          <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <Button variant="secondary" size="small" disabled={isSaving}>
                  Manage columns <ChevronDown className="ml-1" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="w-[min(100vw-2rem,360px)]">
                <div className="flex flex-col gap-3 p-3">
                  <Text size="xsmall" className="text-ui-fg-muted">
                    Expand, image, title, and status always stay visible. Same
                    as the main products list.
                  </Text>
                  <div className="flex flex-col gap-1">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-column-mode"
                        checked={columnMode === "default"}
                        onChange={() => setColumnMode("default")}
                        disabled={isSaving}
                        className="rounded-full text-ui-fg-interactive"
                      />
                      <Text size="small">Default (all columns)</Text>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="bulk-column-mode"
                        checked={columnMode === "custom"}
                        onChange={() => setColumnMode("custom")}
                        disabled={isSaving}
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
                      <div className="max-h-[min(320px,50vh)] flex flex-col gap-0.5 overflow-y-auto">
                        {TOGGLEABLE_COLUMNS.map((col) => (
                          <label
                            key={col.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-1 pr-1 hover:bg-ui-bg-base-hover"
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
                  <div className="border-t border-ui-border-base pt-2">
                    <Text size="xsmall" className="mb-2 block text-ui-fg-muted">
                      Custom columns (read from metadata keys)
                    </Text>
                    {SUGGESTED_PRODUCT_METADATA_KEYS.length > 0 && (
                      <div className="mb-3">
                        <Text
                          size="xsmall"
                          className="mb-1.5 block text-ui-fg-subtle"
                        >
                          Product metadata presets — off by default; check to
                          add a column (same as Product + key below).
                        </Text>
                        <div className="max-h-[min(220px,40vh)] flex flex-col gap-0.5 overflow-y-auto rounded-md border border-ui-border-base p-1.5">
                          {SUGGESTED_PRODUCT_METADATA_KEYS.map(({ key, label }) => {
                            const checked = customColumns.some(
                              (c) =>
                                c.source.kind === "product_metadata" &&
                                c.source.key === key
                            )
                            return (
                              <label
                                key={key}
                                className="flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-1 pr-1 hover:bg-ui-bg-base-hover"
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={isSaving}
                                  onCheckedChange={(v) =>
                                    toggleSuggestedProductMetadataColumn(
                                      key,
                                      label,
                                      v === true
                                    )
                                  }
                                />
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <Text size="small" className="truncate">
                                    {label}
                                  </Text>
                                  <Text
                                    size="xsmall"
                                    className="truncate font-mono text-ui-fg-muted"
                                  >
                                    {key}
                                  </Text>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <Input
                        size="small"
                        placeholder="Column label"
                        value={newCustomLabel}
                        onChange={(e) => setNewCustomLabel(e.target.value)}
                        disabled={isSaving}
                      />
                      <select
                        className="txt-compact-small rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5"
                        value={newCustomSourceKind}
                        onChange={(e) =>
                          setNewCustomSourceKind(
                            e.target.value === "product_metadata"
                              ? "product_metadata"
                              : "variant_metadata"
                          )
                        }
                        disabled={isSaving}
                      >
                        <option value="variant_metadata">
                          Variant metadata
                        </option>
                        <option value="product_metadata">
                          Product metadata
                        </option>
                      </select>
                      <Input
                        size="small"
                        placeholder="Metadata key (e.g. my_field)"
                        value={newCustomKey}
                        onChange={(e) => setNewCustomKey(e.target.value)}
                        disabled={isSaving}
                      />
                      <Button
                        size="small"
                        variant="secondary"
                        type="button"
                        onClick={addCustomColumn}
                        disabled={isSaving}
                      >
                        Add column
                      </Button>
                    </div>
                    {customColumns.length > 0 && (
                      <div className="mt-2 max-h-[min(200px,40vh)] flex flex-col gap-1 overflow-y-auto">
                        {customColumns.map((cc) => (
                          <div
                            key={cc.id}
                            className="flex items-center gap-2 rounded-md py-1 pl-1 pr-1 hover:bg-ui-bg-base-hover"
                          >
                            {columnMode === "custom" ? (
                              <Checkbox
                                checked={visibleColumns.has(cc.id)}
                                onCheckedChange={(checked) => {
                                  setVisibleColumns((prev) => {
                                    const next = new Set(prev)
                                    if (checked === true) next.add(cc.id)
                                    else next.delete(cc.id)
                                    return next
                                  })
                                }}
                              />
                            ) : (
                              <span className="w-5 shrink-0" aria-hidden />
                            )}
                            <div className="flex min-w-0 flex-1 flex-col">
                              <Text size="small" className="truncate">
                                {cc.label}
                              </Text>
                              <Text
                                size="xsmall"
                                className="truncate text-ui-fg-muted"
                              >
                                {cc.source.kind === "variant_metadata"
                                  ? "Variant"
                                  : "Product"}{" "}
                                · {cc.source.key}
                              </Text>
                            </div>
                            <Button
                              size="small"
                              variant="transparent"
                              type="button"
                              className="shrink-0 text-ui-fg-error"
                              disabled={isSaving}
                              onClick={() => removeCustomColumn(cc.id)}
                            >
                              <XMarkMini />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu>
        </div>
      </div>

      {/* Page title */}
      {/* <div>
        <Heading>Bulk Edit Products</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Edit product fields and variant prices in bulk. Press Ctrl+S (or ⌘S)
          to save. Click <ChevronRight className="inline" /> to expand variants.
          Tags are comma-separated. Prices are in main currency units (e.g.
          dollars, not cents).
        </Text>
      </div> */}

      {/* Table */}
      <Container className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b border-ui-border-base bg-ui-bg-base">
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            {tagIds.length > 0 && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  ensureSafeToChangeFilters() &&
                  handleFiltersChange({ tagIds: [] })
                }
                disabled={isSaving}
              >
                Tag <XMarkMini className="ml-1" />
              </Button>
            )}
            {typeIds.length > 0 && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  ensureSafeToChangeFilters() &&
                  handleFiltersChange({ typeIds: [] })
                }
                disabled={isSaving}
              >
                Type <XMarkMini className="ml-1" />
              </Button>
            )}
            {salesChannelIds.length > 0 && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  ensureSafeToChangeFilters() &&
                  handleFiltersChange({ salesChannelIds: [] })
                }
                disabled={isSaving}
              >
                Sales Channel <XMarkMini className="ml-1" />
              </Button>
            )}
            {statusFilter.length > 0 && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  ensureSafeToChangeFilters() &&
                  handleFiltersChange({ status: [] })
                }
                disabled={isSaving}
              >
                Status <XMarkMini className="ml-1" />
              </Button>
            )}
            {(createdAt.$gte || createdAt.$lte) && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  ensureSafeToChangeFilters() &&
                  handleFiltersChange({ createdAt: {} })
                }
                disabled={isSaving}
              >
                Created <XMarkMini className="ml-1" />
              </Button>
            )}
            {(updatedAt.$gte || updatedAt.$lte) && (
              <Button
                variant="secondary"
                size="small"
                onClick={() =>
                  ensureSafeToChangeFilters() &&
                  handleFiltersChange({ updatedAt: {} })
                }
                disabled={isSaving}
              >
                Updated <XMarkMini className="ml-1" />
              </Button>
            )}

            <DropdownMenu onOpenChange={(open) => open && setFilterSearch("")}>
              <DropdownMenu.Trigger asChild>
                <Button variant="secondary" size="small" disabled={isSaving}>
                  Add filter <ChevronDown className="ml-1" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="w-[260px]">
                <DropdownMenu.SubMenu>
                  <DropdownMenu.SubMenuTrigger>Type</DropdownMenu.SubMenuTrigger>
                  <DropdownMenu.SubMenuContent className="w-[320px]">
                    <div className="p-3 flex flex-col gap-2">
                      <Input
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        placeholder="Search"
                      />
                      <div className="max-h-[260px] overflow-auto">
                        {(typesData?.product_types ?? [])
                          .filter((t: any) =>
                            (t.value ?? t.name ?? "")
                              .toLowerCase()
                              .includes(filterSearch.toLowerCase())
                          )
                          .map((t: any) => (
                            <DropdownMenu.CheckboxItem
                              key={t.id}
                              checked={typeIds.includes(t.id)}
                              onCheckedChange={(checked) => {
                                if (!ensureSafeToChangeFilters()) return
                                const next = checked
                                  ? Array.from(new Set([...typeIds, t.id]))
                                  : typeIds.filter((id) => id !== t.id)
                                handleFiltersChange({ typeIds: next })
                              }}
                            >
                              {t.value ?? t.name ?? t.id}
                            </DropdownMenu.CheckboxItem>
                          ))}
                      </div>
                    </div>
                  </DropdownMenu.SubMenuContent>
                </DropdownMenu.SubMenu>

                <DropdownMenu.SubMenu>
                  <DropdownMenu.SubMenuTrigger>Tag</DropdownMenu.SubMenuTrigger>
                  <DropdownMenu.SubMenuContent className="w-[320px]">
                    <div className="p-3 flex flex-col gap-2">
                      <Input
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        placeholder="Search"
                      />
                      <div className="max-h-[260px] overflow-auto">
                        {(tagsData?.product_tags ?? [])
                          .filter((t: any) =>
                            (t.value ?? "")
                              .toLowerCase()
                              .includes(filterSearch.toLowerCase())
                          )
                          .map((t: any) => (
                            <DropdownMenu.CheckboxItem
                              key={t.id}
                              checked={tagIds.includes(t.id)}
                              onCheckedChange={(checked) => {
                                if (!ensureSafeToChangeFilters()) return
                                const next = checked
                                  ? Array.from(new Set([...tagIds, t.id]))
                                  : tagIds.filter((id) => id !== t.id)
                                handleFiltersChange({ tagIds: next })
                              }}
                            >
                              {t.value}
                            </DropdownMenu.CheckboxItem>
                          ))}
                      </div>
                    </div>
                  </DropdownMenu.SubMenuContent>
                </DropdownMenu.SubMenu>

                <DropdownMenu.SubMenu>
                  <DropdownMenu.SubMenuTrigger>
                    Sales Channel
                  </DropdownMenu.SubMenuTrigger>
                  <DropdownMenu.SubMenuContent className="w-[320px]">
                    <div className="p-3 flex flex-col gap-2">
                      <Input
                        value={filterSearch}
                        onChange={(e) => setFilterSearch(e.target.value)}
                        placeholder="Search"
                      />
                      <div className="max-h-[260px] overflow-auto">
                        {(channelsData?.sales_channels ?? [])
                          .filter((c: any) =>
                            (c.name ?? "")
                              .toLowerCase()
                              .includes(filterSearch.toLowerCase())
                          )
                          .map((c: any) => (
                            <DropdownMenu.CheckboxItem
                              key={c.id}
                              checked={salesChannelIds.includes(c.id)}
                              onCheckedChange={(checked) => {
                                if (!ensureSafeToChangeFilters()) return
                                const next = checked
                                  ? Array.from(
                                      new Set([...salesChannelIds, c.id])
                                    )
                                  : salesChannelIds.filter((id) => id !== c.id)
                                handleFiltersChange({ salesChannelIds: next })
                              }}
                            >
                              {c.name}
                            </DropdownMenu.CheckboxItem>
                          ))}
                      </div>
                    </div>
                  </DropdownMenu.SubMenuContent>
                </DropdownMenu.SubMenu>

                <DropdownMenu.SubMenu>
                  <DropdownMenu.SubMenuTrigger>Status</DropdownMenu.SubMenuTrigger>
                  <DropdownMenu.SubMenuContent className="w-[280px]">
                    <div className="p-3 flex flex-col gap-2">
                      {(["draft", "proposed", "published", "rejected"] as const).map(
                        (s) => (
                          <DropdownMenu.CheckboxItem
                            key={s}
                            checked={statusFilter.includes(s)}
                            onCheckedChange={(checked) => {
                              if (!ensureSafeToChangeFilters()) return
                              const next = checked
                                ? Array.from(new Set([...statusFilter, s]))
                                : statusFilter.filter((x) => x !== s)
                              handleFiltersChange({ status: next })
                            }}
                          >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                          </DropdownMenu.CheckboxItem>
                        )
                      )}
                    </div>
                  </DropdownMenu.SubMenuContent>
                </DropdownMenu.SubMenu>

                <DropdownMenu.SubMenu>
                  <DropdownMenu.SubMenuTrigger>Created</DropdownMenu.SubMenuTrigger>
                  <DropdownMenu.SubMenuContent className="w-[320px]">
                    <div className="p-3 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Text size="small" className="text-ui-fg-subtle">
                            From
                          </Text>
                          <input
                            type="date"
                            value={createdAt.$gte ?? ""}
                            onChange={(e) => {
                              if (!ensureSafeToChangeFilters()) return
                              handleFiltersChange({
                                createdAt: {
                                  ...createdAt,
                                  $gte: e.target.value || undefined,
                                },
                              })
                            }}
                            className={cellInput}
                          />
                        </div>
                        <div className="flex-1">
                          <Text size="small" className="text-ui-fg-subtle">
                            To
                          </Text>
                          <input
                            type="date"
                            value={createdAt.$lte ?? ""}
                            onChange={(e) => {
                              if (!ensureSafeToChangeFilters()) return
                              handleFiltersChange({
                                createdAt: {
                                  ...createdAt,
                                  $lte: e.target.value || undefined,
                                },
                              })
                            }}
                            className={cellInput}
                          />
                        </div>
                      </div>
                    </div>
                  </DropdownMenu.SubMenuContent>
                </DropdownMenu.SubMenu>

                <DropdownMenu.SubMenu>
                  <DropdownMenu.SubMenuTrigger>Updated</DropdownMenu.SubMenuTrigger>
                  <DropdownMenu.SubMenuContent className="w-[320px]">
                    <div className="p-3 flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Text size="small" className="text-ui-fg-subtle">
                            From
                          </Text>
                          <input
                            type="date"
                            value={updatedAt.$gte ?? ""}
                            onChange={(e) => {
                              if (!ensureSafeToChangeFilters()) return
                              handleFiltersChange({
                                updatedAt: {
                                  ...updatedAt,
                                  $gte: e.target.value || undefined,
                                },
                              })
                            }}
                            className={cellInput}
                          />
                        </div>
                        <div className="flex-1">
                          <Text size="small" className="text-ui-fg-subtle">
                            To
                          </Text>
                          <input
                            type="date"
                            value={updatedAt.$lte ?? ""}
                            onChange={(e) => {
                              if (!ensureSafeToChangeFilters()) return
                              handleFiltersChange({
                                updatedAt: {
                                  ...updatedAt,
                                  $lte: e.target.value || undefined,
                                },
                              })
                            }}
                            className={cellInput}
                          />
                        </div>
                      </div>
                    </div>
                  </DropdownMenu.SubMenuContent>
                </DropdownMenu.SubMenu>

                {hasAnyFilters && (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      onSelect={(e) => {
                        e.preventDefault()
                        clearFilters()
                      }}
                    >
                      Clear all
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu>


            {hasAnyFilters && (
              <Button
                variant="transparent"
                size="small"
                onClick={clearFilters}
                disabled={isSaving}
              >
                Clear all
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="w-full sm:w-[360px]">
              <Input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search products by title, handle, or SKU…"
              />
            </div>
            {search.trim() !== "" && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => handleSearchChange("")}
                disabled={isSaving}
              >
                Clear
              </Button>
            )}

            {/* <Text size="small" className="text-ui-fg-subtle whitespace-nowrap">
              {total} result{total !== 1 ? "s" : ""}
            </Text> */}
          </div>
        </div>
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
            <Text className="text-ui-fg-muted">
              {debouncedSearch
                ? `No products found for "${debouncedSearch}".`
                : "No products found."}
            </Text>
            {debouncedSearch ? (
              <Button
                size="small"
                variant="secondary"
                onClick={() => handleSearchChange("")}
              >
                Clear search
              </Button>
            ) : (
              <Link to="/products/create">
                <Button size="small" variant="secondary">
                  Create product
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
            <table className="w-full" style={{ minWidth: 1400 }}>
              <thead>
                <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                  {isColumnVisible("expand") && (
                  <th className="px-3 py-3" style={{ minWidth: 40 }}>
                    <button
                      onClick={toggleExpandAll}
                      className="text-ui-fg-muted hover:text-ui-fg-base transition-colors"
                      title={allExpanded ? "Collapse all" : "Expand all variants"}
                    >
                      {allExpanded ? <ChevronDown /> : <ChevronRight />}
                    </button>
                  </th>
                  )}
                  {isColumnVisible("image") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 56 }}
                  >
                    Image
                  </th>
                  )}
                  {isColumnVisible("title") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 180 }}
                  >
                    Title
                  </th>
                  )}
                  {isColumnVisible("subtitle") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 150 }}
                  >
                    Subtitle
                  </th>
                  )}
                  {isColumnVisible("description") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 260 }}
                  >
                    Description
                  </th>
                  )}
                  {isColumnVisible("handle") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 150 }}
                  >
                    Handle
                  </th>
                  )}
                  {isColumnVisible("status") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 130 }}
                  >
                    Status
                  </th>
                  )}
                  {isColumnVisible("category") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 200 }}
                  >
                    Category
                  </th>
                  )}
                  {isColumnVisible("sku") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 150 }}
                  >
                    SKU
                  </th>
                  )}
                  {isColumnVisible("basePrice") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 100 }}
                  >
                    Base price
                  </th>
                  )}
                  {isColumnVisible("salePrice") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 100 }}
                  >
                    Sale price
                  </th>
                  )}
                  {isColumnVisible("b2bDiscount") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 100 }}
                  >
                    B2B discount
                  </th>
                  )}
                  {isColumnVisible("clientA") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 90 }}
                  >
                    Client A
                  </th>
                  )}
                  {isColumnVisible("clientB") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 90 }}
                  >
                    Client B
                  </th>
                  )}
                  {isColumnVisible("clientC") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 90 }}
                  >
                    Client C
                  </th>
                  )}
                  {isColumnVisible("clientD") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 90 }}
                  >
                    Client D
                  </th>
                  )}
                  {isColumnVisible("manageStock") && (
                  <th
                    className="px-3 py-3 text-center txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 100 }}
                  >
                    Manage Stock
                  </th>
                  )}
                  {isColumnVisible("stockQty") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 90 }}
                  >
                    Stock qty
                  </th>
                  )}
                  {isColumnVisible("tags") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 170 }}
                  >
                    Tags
                  </th>
                  )}
                  {isColumnVisible("material") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 120 }}
                  >
                    Material
                  </th>
                  )}
                  {isColumnVisible("weight") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 100 }}
                  >
                    Weight (g)
                  </th>
                  )}
                  {isColumnVisible("width") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 80 }}
                  >
                    Width
                  </th>
                  )}
                  {isColumnVisible("height") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 80 }}
                  >
                    Height
                  </th>
                  )}
                  {isColumnVisible("color") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ minWidth: 90 }}
                  >
                    Color
                  </th>
                  )}
                  {customColumns.map((cc) =>
                    isColumnVisible(cc.id) ? (
                      <th
                        key={cc.id}
                        className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                        style={{ minWidth: 120 }}
                      >
                        {cc.label}
                      </th>
                    ) : null
                  )}
                  {isColumnVisible("changed") && (
                  <th
                    className="px-3 py-3"
                    style={{ minWidth: 90 }}
                    aria-label="Changed"
                  />
                  )}
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

                  return (
                    <React.Fragment key={row.id}>
                      {/* ── Product row ── */}
                      <tr
                        className={
                          isDirty ? "bg-ui-bg-highlight" : "bg-ui-bg-base"
                        }
                      >
                        {isColumnVisible("expand") && (
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
                        )}
                        {isColumnVisible("image") && (
                        <td className="px-3 py-2">
                          <DropdownMenu>
                            <DropdownMenu.Trigger asChild>
                              <button
                                type="button"
                                className="flex items-center gap-1.5 rounded border border-ui-border-base hover:border-ui-border-interactive transition-colors overflow-hidden focus:outline-none focus:ring-2 focus:ring-ui-border-interactive"
                              >
                                {row.thumbnail ? (
                                  <img
                                    src={row.thumbnail}
                                    alt=""
                                    className="w-9 h-9 object-contain"
                                  />
                                ) : (
                                  <div className="w-9 h-9 bg-ui-bg-subtle" />
                                )}
                                <PencilSquare className="w-4 h-4 text-ui-fg-muted shrink-0 mr-1" />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content align="start" className="w-64">
                              <div className="p-2 flex flex-col gap-2">
                                <Button
                                  size="small"
                                  variant="secondary"
                                  className="w-full"
                                  disabled={uploadingThumbnailFor === row.id}
                                  onClick={() => {
                                    setUploadingThumbnailFor(row.id)
                                    productThumbnailInputRef.current?.click()
                                  }}
                                >
                                  {uploadingThumbnailFor === row.id
                                    ? "Uploading…"
                                    : "Upload image"}
                                </Button>
                                <div className="flex flex-col gap-1">
                                  <Text size="xsmall" className="text-ui-fg-muted">
                                    Or paste URL
                                  </Text>
                                  <Input
                                    size="small"
                                    placeholder="https://..."
                                    value={row.thumbnail ?? ""}
                                    onChange={(e) =>
                                      updateRow(
                                        row.id,
                                        "thumbnail",
                                        e.target.value || null
                                      )
                                    }
                                  />
                                </div>
                                {row.thumbnail && (
                                  <Button
                                    size="small"
                                    variant="transparent"
                                    className="w-full text-ui-fg-error"
                                    onClick={() =>
                                      updateRow(row.id, "thumbnail", null)
                                    }
                                  >
                                    Clear
                                  </Button>
                                )}
                              </div>
                            </DropdownMenu.Content>
                          </DropdownMenu>
                        </td>
                        )}
                        {isColumnVisible("title") && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              openRichTextEdit(row.id, {
                                title: row.title,
                                subtitle: row.subtitle,
                                description: row.description,
                              })
                            }
                            className={`${cellInput} flex min-w-[140px] cursor-pointer items-center justify-between gap-2 text-left hover:bg-ui-bg-base-hover`}
                          >
                            <span className="min-w-0 truncate">
                              {stripForPreview(row.title, 120) || "Edit title…"}
                            </span>
                            <PencilSquare className="size-4 shrink-0 text-ui-fg-muted" />
                          </button>
                          {rowError && (
                            <p className="mt-1 txt-small text-ui-fg-error">
                              {rowError}
                            </p>
                          )}
                        </td>
                        )}
                        {isColumnVisible("subtitle") && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              openRichTextEdit(row.id, {
                                title: row.title,
                                subtitle: row.subtitle,
                                description: row.description,
                              })
                            }
                            className={`${cellInput} flex min-h-8 min-w-[140px] cursor-pointer items-center justify-between gap-2 py-2 text-left hover:bg-ui-bg-base-hover`}
                          >
                            <span className="line-clamp-2 min-w-0 flex-1 text-left">
                              {stripForPreview(row.subtitle, 160) ||
                                "Edit subtitle…"}
                            </span>
                            <PencilSquare className="size-4 shrink-0 self-start text-ui-fg-muted" />
                          </button>
                        </td>
                        )}
                        {isColumnVisible("description") && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() =>
                              openRichTextEdit(row.id, {
                                title: row.title,
                                subtitle: row.subtitle,
                                description: row.description,
                              })
                            }
                            className={`${cellInput} flex min-h-8 min-w-[160px] cursor-pointer items-center justify-between gap-2 py-2 text-left hover:bg-ui-bg-base-hover`}
                          >
                            <span className="line-clamp-2 min-w-0 flex-1 text-left">
                              {stripForPreview(row.description, 180) ||
                                "Edit description…"}
                            </span>
                            <PencilSquare className="size-4 shrink-0 self-start text-ui-fg-muted" />
                          </button>
                        </td>
                        )}
                        {isColumnVisible("handle") && (
                        <td className="px-3 py-2">
                          <Input
                            value={row.handle}
                            onChange={(e) =>
                              updateRow(row.id, "handle", e.target.value)
                            }
                            placeholder="product-handle"
                          />
                        </td>
                        )}
                        {isColumnVisible("status") && (
                        <td className="px-3 py-2">
                          <select
                            value={row.status}
                            onChange={(e) =>
                              updateRow(row.id, "status", e.target.value)
                            }
                            className={cellInput}
                          >
                            <option value="draft">Draft</option>
                            <option value="proposed">Proposed</option>
                            <option value="published">Published</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </td>
                        )}
                        {isColumnVisible("category") && (
                        <td className="px-3 py-2">
                          <DropdownMenu onOpenChange={(open) => open && setFilterSearch("")}>
                            <DropdownMenu.Trigger asChild>
                              <button
                                type="button"
                                className={`${cellInput} text-left flex items-center justify-between gap-2`}
                              >
                                <span className="truncate">
                                  {row.category_ids.length > 0
                                    ? row.category_ids
                                        .map((id) => {
                                          return (
                                            categoryBreadcrumbById.get(id) ??
                                            (categoriesData as any)?.product_categories?.find(
                                              (x: any) => x.id === id
                                            )?.name ??
                                            id
                                          )
                                        })
                                        .join(", ")
                                    : "—"}
                                </span>
                                <ChevronDown className="shrink-0" />
                              </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Content className="w-[320px]">
                              <div className="p-3 flex flex-col gap-2">
                                <Input
                                  value={filterSearch}
                                  onChange={(e) => setFilterSearch(e.target.value)}
                                  placeholder="Search categories"
                                />
                                <div className="max-h-[260px] overflow-auto">
                                  {hierarchicalCategories
                                    .filter((c) =>
                                      c.breadcrumb
                                        .toLowerCase()
                                        .includes(filterSearch.toLowerCase().trim())
                                    )
                                    .map((c) => {
                                      const checked = row.category_ids.includes(c.id)
                                      return (
                                        <DropdownMenu.Item
                                          key={c.id}
                                          asChild
                                          onSelect={(e) => {
                                            e.preventDefault()
                                            const next = checked
                                              ? row.category_ids.filter(
                                                  (id) => id !== c.id
                                                )
                                              : Array.from(
                                                  new Set([
                                                    ...row.category_ids,
                                                    c.id,
                                                  ])
                                                )
                                            updateRow(
                                              row.id,
                                              "category_ids",
                                              next
                                            )
                                          }}
                                        >
                                          <CategoryMenuCheckboxRow
                                            checked={checked}
                                            depth={c.depth}
                                            breadcrumb={c.breadcrumb}
                                            name={c.name}
                                          />
                                        </DropdownMenu.Item>
                                      )
                                    })}
                                </div>
                              </div>
                            </DropdownMenu.Content>
                          </DropdownMenu>
                        </td>
                        )}
                        {isColumnVisible("sku") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value="—"
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("basePrice") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={
                              row.variants[0]?.prices[0]?.amount ?? "—"
                            }
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("salePrice") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={
                              row.variants[0]?.sale_price_amount ?? "—"
                            }
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("b2bDiscount") && (
                        <td className="px-3 py-2">
                          <Input
                            value={getMeta(row.metadata, B2B_DISCOUNT_META_KEY)}
                            onChange={(e) =>
                              updateProductMetadata(
                                row.id,
                                B2B_DISCOUNT_META_KEY,
                                e.target.value || null
                              )
                            }
                            placeholder="e.g. 10 or 10%"
                          />
                        </td>
                        )}
                        {isColumnVisible("clientA") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={getVariantPriceRange(row.variants, "wcwp_client-a")}
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("clientB") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={getVariantPriceRange(row.variants, "wcwp_client-b")}
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("clientC") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={getVariantPriceRange(row.variants, "wcwp_client-c")}
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("clientD") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={getVariantPriceRange(row.variants, "wcwp_client-d")}
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("manageStock") && (
                        <td className="px-3 py-2 text-center">
                          <input
                            type="text"
                            value={
                              row.variants.some((v) => v.manage_inventory)
                                ? "Yes"
                                : "No"
                            }
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("stockQty") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={String(
                              row.variants.reduce(
                                (sum, v) =>
                                  sum + (v.inventory_quantity ?? 0),
                                0
                              )
                            )}
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {isColumnVisible("tags") && (
                        <td className="px-3 py-2">
                          <Input
                            value={row.tags}
                            onChange={(e) =>
                              updateRow(row.id, "tags", e.target.value)
                            }
                            placeholder="tag1, tag2"
                          />
                        </td>
                        )}
                        {isColumnVisible("material") && (
                        <td className="px-3 py-2">
                          <Input
                            value={row.material}
                            onChange={(e) =>
                              updateRow(row.id, "material", e.target.value)
                            }
                            placeholder="e.g. Cotton"
                          />
                        </td>
                        )}
                        {isColumnVisible("weight") && (
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
                        )}
                        {isColumnVisible("width") && (
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            value={row.width}
                            onChange={(e) =>
                              updateRow(row.id, "width", e.target.value)
                            }
                            placeholder="0"
                            className={cellInput}
                          />
                        </td>
                        )}
                        {isColumnVisible("height") && (
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            value={row.height}
                            onChange={(e) =>
                              updateRow(row.id, "height", e.target.value)
                            }
                            placeholder="0"
                            className={cellInput}
                          />
                        </td>
                        )}
                        {isColumnVisible("color") && (
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value=""
                            disabled
                            className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                          />
                        </td>
                        )}
                        {customColumns.map((cc) =>
                          isColumnVisible(cc.id) ? (
                            <td key={cc.id} className="px-3 py-2">
                              {cc.source.kind === "variant_metadata" ? (
                                <input
                                  type="text"
                                  value={variantMetadataColumnSummary(
                                    row.variants,
                                    cc.source.key
                                  )}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              ) : (
                                <Input
                                  value={getMeta(
                                    row.metadata,
                                    cc.source.key
                                  )}
                                  onChange={(e) =>
                                    updateProductMetadata(
                                      row.id,
                                      cc.source.key,
                                      e.target.value || null
                                    )
                                  }
                                  placeholder="—"
                                />
                              )}
                            </td>
                          ) : null
                        )}
                        {isColumnVisible("changed") && (
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
                        )}
                      </tr>

                      {/* ── Variant rows (same column level as product) ── */}
                      {isExpanded &&
                        row.variants.map((variant) => {
                          const vDirty = dirtyVariantMap
                            .get(row.id)
                            ?.has(variant.id)
                          const categoryLabel =
                            row.category_ids.length > 0
                              ? row.category_ids
                                  .map((id) => {
                                    return (
                                      categoryBreadcrumbById.get(id) ??
                                      (categoriesData as any)?.product_categories?.find(
                                        (x: any) => x.id === id
                                      )?.name ??
                                      id
                                    )
                                  })
                                  .join(", ")
                              : "—"
                          return (
                            <tr
                              key={variant.id}
                              className={
                                vDirty
                                  ? "bg-ui-bg-highlight"
                                  : "bg-ui-bg-subtle"
                              }
                            >
                              {isColumnVisible("expand") && (
                              <td className="px-3 py-2" />
                              )}
                              {isColumnVisible("image") && (
                              <td className="px-3 py-2">
                                <DropdownMenu>
                                  <DropdownMenu.Trigger asChild>
                                    <button
                                      type="button"
                                      className="flex items-center gap-1.5 rounded border border-ui-border-base hover:border-ui-border-interactive transition-colors overflow-hidden focus:outline-none focus:ring-2 focus:ring-ui-border-interactive"
                                    >
                                      {variant.thumbnail ? (
                                        <img
                                          src={variant.thumbnail}
                                          alt=""
                                          className="w-8 h-8 object-contain"
                                        />
                                      ) : (
                                        <div className="w-8 h-8 bg-ui-bg-base" />
                                      )}
                                      <PencilSquare className="w-4 h-4 text-ui-fg-muted shrink-0 mr-1" />
                                    </button>
                                  </DropdownMenu.Trigger>
                                  <DropdownMenu.Content align="start" className="w-64">
                                    <div className="p-2 flex flex-col gap-2">
                                      <Button
                                        size="small"
                                        variant="secondary"
                                        className="w-full"
                                        disabled={
                                          uploadingVariantThumbnailFor?.productId === row.id &&
                                          uploadingVariantThumbnailFor?.variantId === variant.id
                                        }
                                        onClick={() => {
                                          setUploadingVariantThumbnailFor({
                                            productId: row.id,
                                            variantId: variant.id,
                                          })
                                          variantThumbnailInputRef.current?.click()
                                        }}
                                      >
                                        {uploadingVariantThumbnailFor?.productId === row.id &&
                                        uploadingVariantThumbnailFor?.variantId === variant.id
                                          ? "Uploading…"
                                          : "Upload image"}
                                      </Button>
                                      <div className="flex flex-col gap-1">
                                        <Text size="xsmall" className="text-ui-fg-muted">
                                          Or paste URL
                                        </Text>
                                        <Input
                                          size="small"
                                          placeholder="https://..."
                                          value={variant.thumbnail ?? ""}
                                          onChange={(e) =>
                                            updateVariantThumbnail(
                                              row.id,
                                              variant.id,
                                              e.target.value || null
                                            )
                                          }
                                        />
                                      </div>
                                      {variant.thumbnail && (
                                        <Button
                                          size="small"
                                          variant="transparent"
                                          className="w-full text-ui-fg-error"
                                          onClick={() =>
                                            updateVariantThumbnail(
                                              row.id,
                                              variant.id,
                                              null
                                            )
                                          }
                                        >
                                          Clear
                                        </Button>
                                      )}
                                    </div>
                                  </DropdownMenu.Content>
                                </DropdownMenu>
                              </td>
                              )}
                              {isColumnVisible("title") && (
                              <td className="px-3 py-2">
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
                              )}
                              {isColumnVisible("subtitle") && (
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openRichTextEdit(row.id, {
                                      title: row.title,
                                      subtitle: row.subtitle,
                                      description: row.description,
                                    })
                                  }
                                  className={`${cellInput} flex min-w-[120px] cursor-pointer items-center justify-between gap-2 text-left hover:bg-ui-bg-base-hover`}
                                >
                                  <span className="min-w-0 truncate">
                                    {stripForPreview(row.subtitle, 80) ||
                                      "Edit subtitle…"}
                                  </span>
                                  <PencilSquare className="size-4 shrink-0 text-ui-fg-muted" />
                                </button>
                              </td>
                              )}
                              {isColumnVisible("description") && (
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openRichTextEdit(row.id, {
                                      title: row.title,
                                      subtitle: row.subtitle,
                                      description: row.description,
                                    })
                                  }
                                  className={`${cellInput} flex min-w-[120px] cursor-pointer items-center justify-between gap-2 text-left hover:bg-ui-bg-base-hover`}
                                >
                                  <span className="min-w-0 truncate">
                                    {stripForPreview(row.description, 80) ||
                                      "Edit description…"}
                                  </span>
                                  <PencilSquare className="size-4 shrink-0 text-ui-fg-muted" />
                                </button>
                              </td>
                              )}
                              {isColumnVisible("handle") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.handle}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("status") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.status}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("category") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={categoryLabel}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("sku") && (
                              <td className="px-3 py-2">
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
                              )}
                              {isColumnVisible("basePrice") && (
                              <td className="px-3 py-2">
                                {variant.prices[0] ? (
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={variant.prices[0].amount}
                                    onChange={(e) =>
                                      updateVariantPrice(
                                        row.id,
                                        variant.id,
                                        variant.prices[0].currency_code,
                                        e.target.value
                                      )
                                    }
                                    placeholder="0.00"
                                    className={cellInput}
                                  />
                                ) : (
                                  <Text size="small" className="text-ui-fg-muted px-3">
                                    —
                                  </Text>
                                )}
                              </td>
                              )}
                              {isColumnVisible("salePrice") && SALE_PRICE_LIST_ID ? (
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={variant.sale_price_amount}
                                    onChange={(e) =>
                                      updateVariantSalePrice(
                                        row.id,
                                        variant.id,
                                        e.target.value
                                      )
                                    }
                                    placeholder="0.00"
                                    className={cellInput}
                                  />
                                </td>
                              ) : isColumnVisible("salePrice") ? (
                                <td className="px-3 py-2">
                                  <input
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={getMeta(variant.metadata, "sale_price")}
                                    onChange={(e) => {
                                      const val = e.target.value.trim()
                                      updateVariantMetadata(
                                        row.id,
                                        variant.id,
                                        "sale_price",
                                        val ? (Number.isFinite(Number(val)) ? Number(val) : val) : null
                                      )
                                    }
                                    }
                                    placeholder="0.00"
                                    className={cellInput}
                                  />
                                </td>
                              ) : null}
                              {isColumnVisible("b2bDiscount") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={getMeta(row.metadata, B2B_DISCOUNT_META_KEY)}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("clientA") && (
                              <td className="px-3 py-2">
                                <Input
                                  size="small"
                                  value={getMeta(variant.metadata, "wcwp_client-a")}
                                  onChange={(e) =>
                                    updateVariantMetadata(
                                      row.id,
                                      variant.id,
                                      "wcwp_client-a",
                                      e.target.value || null
                                    )
                                  }
                                  placeholder="—"
                                />
                              </td>
                              )}
                              {isColumnVisible("clientB") && (
                              <td className="px-3 py-2">
                                <Input
                                  size="small"
                                  value={getMeta(variant.metadata, "wcwp_client-b")}
                                  onChange={(e) =>
                                    updateVariantMetadata(
                                      row.id,
                                      variant.id,
                                      "wcwp_client-b",
                                      e.target.value || null
                                    )
                                  }
                                  placeholder="—"
                                />
                              </td>
                              )}
                              {isColumnVisible("clientC") && (
                              <td className="px-3 py-2">
                                <Input
                                  size="small"
                                  value={getMeta(variant.metadata, "wcwp_client-c")}
                                  onChange={(e) =>
                                    updateVariantMetadata(
                                      row.id,
                                      variant.id,
                                      "wcwp_client-c",
                                      e.target.value || null
                                    )
                                  }
                                  placeholder="—"
                                />
                              </td>
                              )}
                              {isColumnVisible("clientD") && (
                              <td className="px-3 py-2">
                                <Input
                                  size="small"
                                  value={getMeta(variant.metadata, "wcwp_client-d")}
                                  onChange={(e) =>
                                    updateVariantMetadata(
                                      row.id,
                                      variant.id,
                                      "wcwp_client-d",
                                      e.target.value || null
                                    )
                                  }
                                  placeholder="—"
                                />
                              </td>
                              )}
                              {isColumnVisible("manageStock") && (
                              <td className="px-3 py-2 text-center">
                                <Checkbox
                                  checked={variant.manage_inventory}
                                  onCheckedChange={(checked) =>
                                    updateVariantManageInventory(
                                      row.id,
                                      variant.id,
                                      checked === true
                                    )
                                  }
                                />
                              </td>
                              )}
                              {isColumnVisible("stockQty") && (
                              <td className="px-3 py-2">
                                {variant.manage_inventory ? (
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={
                                      variant.inventory_quantity ?? ""
                                    }
                                    onChange={(e) => {
                                      const val = e.target.value.trim()
                                      const num = val
                                        ? Math.max(0, Math.floor(Number(val)))
                                        : NaN
                                      updateVariantInventoryQuantity(
                                        row.id,
                                        variant.id,
                                        val
                                          ? Number.isFinite(num)
                                            ? num
                                            : variant.inventory_quantity ?? null
                                          : null
                                      )
                                    }
                                    }
                                    placeholder="0"
                                    className={cellInput}
                                  />
                                ) : (
                                  <Text size="small" className="text-ui-fg-muted px-3">
                                    —
                                  </Text>
                                )}
                              </td>
                              )}
                              {isColumnVisible("tags") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.tags}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("material") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.material}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("weight") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.weight}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("width") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.width}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("height") && (
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={row.height}
                                  disabled
                                  className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                />
                              </td>
                              )}
                              {isColumnVisible("color") && (
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1">
                                  <input
                                    type="color"
                                    value={
                                      getMeta(variant.metadata, "color_hex") ||
                                      "#000000"
                                    }
                                    onChange={(e) =>
                                      updateVariantMetadata(
                                        row.id,
                                        variant.id,
                                        "color_hex",
                                        e.target.value
                                      )
                                    }
                                    className="w-8 h-8 rounded border border-ui-border-base cursor-pointer p-0"
                                    title="Color"
                                  />
                                  <Input
                                    size="small"
                                    value={getMeta(variant.metadata, "color_hex")}
                                    onChange={(e) =>
                                      updateVariantMetadata(
                                        row.id,
                                        variant.id,
                                        "color_hex",
                                        e.target.value || null
                                      )
                                    }
                                    placeholder="#hex"
                                    className="w-20"
                                  />
                                </div>
                              </td>
                              )}
                              {customColumns.map((cc) =>
                                isColumnVisible(cc.id) ? (
                                  <td key={cc.id} className="px-3 py-2">
                                    {cc.source.kind === "variant_metadata" ? (
                                      <Input
                                        size="small"
                                        value={getMeta(
                                          variant.metadata,
                                          cc.source.key
                                        )}
                                        onChange={(e) =>
                                          updateVariantMetadata(
                                            row.id,
                                            variant.id,
                                            cc.source.key,
                                            e.target.value || null
                                          )
                                        }
                                        placeholder="—"
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        value={getMeta(
                                          row.metadata,
                                          cc.source.key
                                        )}
                                        disabled
                                        className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`}
                                      />
                                    )}
                                  </td>
                                ) : null
                              )}
                              {isColumnVisible("changed") && (
                              <td className="px-3 py-2 text-right">
                                {vDirty && (
                                  <Badge color="orange" className="whitespace-nowrap">
                                    Changed
                                  </Badge>
                                )}
                              </td>
                              )}
                            </tr>
                          )
                        })}
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

      <FocusModal
        open={!!richTextEdit}
        onOpenChange={(open) => {
          if (!open) closeRichTextEdit()
        }}
      >
        <FocusModal.Content
          className="z-50 flex w-[calc(100vw-2rem)] max-w-4xl flex-col overflow-hidden !inset-auto !left-1/2 !top-1/2 max-h-[min(92vh,960px)] -translate-x-1/2 -translate-y-1/2"
        >
          {richTextEdit ? (
            <>
              <FocusModal.Header>
                <FocusModal.Title className="txt-compact-large font-sans font-medium">
                  Edit title, subtitle & description
                </FocusModal.Title>
              </FocusModal.Header>
              <FocusModal.Body className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex flex-col gap-6">
                  <div>
                    <Text size="small" weight="plus" className="mb-2 block">
                      Title
                    </Text>
                    <Input
                      value={richTextEdit.draftTitle}
                      onChange={(e) =>
                        setRichTextDraftField("draftTitle", e.target.value)
                      }
                      placeholder="Product title…"
                    />
                  </div>
                  <div>
                    <Text size="small" weight="plus" className="mb-2 block">
                      Subtitle
                    </Text>
                    <Input
                      value={richTextEdit.draftSubtitle}
                      onChange={(e) =>
                        setRichTextDraftField("draftSubtitle", e.target.value)
                      }
                      placeholder="Product subtitle…"
                    />
                  </div>
                  <div>
                    <Text size="small" weight="plus" className="mb-2 block">
                      Description
                    </Text>
                    <SimpleMarkdownEditor
                      key={`${richTextEdit.productId}-description`}
                      id={`rte-${richTextEdit.productId}-description`}
                      value={richTextEdit.draftDescription}
                      onChange={(v) =>
                        setRichTextDraftField("draftDescription", v)
                      }
                      placeholder="Product description…"
                      minHeight={280}
                    />
                  </div>
                </div>
              </FocusModal.Body>
              <FocusModal.Footer>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={closeRichTextEdit}
                >
                  Cancel
                </Button>
                <Button type="button" onClick={saveRichTextEdit}>
                  Save
                </Button>
              </FocusModal.Footer>
            </>
          ) : null}
        </FocusModal.Content>
      </FocusModal>
    </div>
  )
}

export default BulkEditPage
