import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSpreadsheet } from "./use-spreadsheet"
import { useColumnResize } from "./use-column-resize"
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
import { ArrowDownTray, ArrowUpTray, ArrowUturnLeft, Check, ChevronDown, ChevronLeft, ChevronRight, PencilSquare, XMarkMini } from "@medusajs/icons"
import { hydrateProductVariantsInventoryQuantity } from "../../../lib/hydrate-product-variant-inventory"
import { sdk } from "../../../lib/sdk"
import {
  fetchRemoteProductColumnPrefs,
  loadSavedViews,
  newCustomColumnId,
  newSavedViewId,
  saveSavedViews,
  type CustomColumnDef,
  type SavedView,
} from "../../../lib/product-column-prefs"
import { stripHtmlTags } from "../../../lib/strip-html"
import {
  DEFAULT_COLUMN_ORDER,
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

/** Must match `PRODUCT_I18N_AUTO_ON_UPDATE_METADATA_KEY` in `src/lib/product-i18n-metadata.ts`. */
const PRODUCT_I18N_AUTO_ON_UPDATE_METADATA_KEY = "i18n_auto_on_update"

function normalizeLocaleKeyClient(lang: string): string {
  return lang.trim().toLowerCase().replace(/_/g, "-")
}

function parseAutoTranslateLocalesFromMetadata(
  metadata: Record<string, unknown> | undefined
): Set<string> {
  const out = new Set<string>()
  if (!metadata) return out
  const raw = metadata[PRODUCT_I18N_AUTO_ON_UPDATE_METADATA_KEY]
  if (raw == null || raw === "") return out
  let parsed: unknown
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return out
    }
  } else if (Array.isArray(raw)) {
    parsed = raw
  } else {
    return out
  }
  if (!Array.isArray(parsed)) return out
  for (const item of parsed) {
    if (typeof item === "string" && item.trim()) {
      out.add(normalizeLocaleKeyClient(item))
    }
  }
  return out
}

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
  images: { id?: string; url: string }[]
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
  collection_id: string | null
  sales_channel_ids: string[]
  material: string
  tags: string      // comma-separated
  weight: string    // as string for input control
  width: string     // as string for input control
  height: string    // as string for input control
  thumbnail: string | null
  images: { id?: string; url: string }[]
  options: { id: string; title: string; values: { id: string; value: string }[] }[]
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
  collection?: { id?: string; title?: string | null } | null
  collection_id?: string | null
  sales_channels?: { id?: string; name?: string | null }[] | null
  material?: string | null
  weight?: number | null
  width?: number | null
  height?: number | null
  thumbnail?: string | null
  images?: { id?: string; url?: string }[] | null
  tags?: { id?: string; value?: string }[] | null
  options?: {
    id?: string
    title?: string | null
    values?: { id?: string; value?: string | null }[] | null
  }[] | null
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
  // Medusa's `*variants.inventory_items` expansion has returned the join record
  // (`{ inventory_item_id, required_quantity }`) in some versions and the inventory
  // item itself (`{ id, sku, ... }`) in others. Try every shape so we never miss
  // an existing link — missing it would cause our save to create a duplicate.
  const invLink = v.inventory_items?.[0] as
    | {
        id?: string | null
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
        : typeof invLink?.id === "string" && invLink.id.startsWith("iitem_")
          ? invLink.id
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
    // Medusa v2's variant update endpoint does NOT accept an `images` array,
    // so we persist the variant gallery in metadata.variant_images (array of URLs)
    // and fall back to the relation images if metadata is absent.
    images: (() => {
      const metaImgs = meta?.variant_images
      if (Array.isArray(metaImgs)) {
        const out: { id?: string; url: string }[] = []
        for (const m of metaImgs) {
          if (typeof m === "string" && m) {
            out.push({ url: m })
          } else if (m && typeof m === "object") {
            const url = (m as { url?: unknown }).url
            const id = (m as { id?: unknown }).id
            if (typeof url === "string" && url) {
              out.push({
                url,
                ...(typeof id === "string" ? { id } : {}),
              })
            }
          }
        }
        return out
      }
      return (v.images ?? [])
        .map((i) => ({ id: i.id, url: i.url ?? "" }))
        .filter((i) => !!i.url)
    })(),
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
    collection_id: p.collection?.id ?? p.collection_id ?? null,
    sales_channel_ids: (p.sales_channels ?? [])
      .map((c) => c.id ?? "")
      .filter(Boolean),
    material: p.material ?? "",
    tags: tagsToString(p.tags),
    weight: p.weight != null ? String(p.weight) : "",
    width: p.width != null ? String(p.width) : "",
    height: p.height != null ? String(p.height) : "",
    thumbnail: p.thumbnail ?? null,
    images: (p.images ?? [])
      .map((i) => ({ id: i.id, url: i.url ?? "" }))
      .filter((i) => i.url),
    options: (p.options ?? [])
      .filter((o) => o.id && o.title)
      .map((o) => ({
        id: o.id as string,
        title: o.title as string,
        values: (o.values ?? [])
          .filter((v) => v.id && v.value)
          .map((v) => ({ id: v.id as string, value: v.value as string })),
      })),
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
  useSpreadsheet("table.sheet-table")
  useColumnResize("table.sheet-table")
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
  // selectedIds holds both variant IDs (for variant rows) and product IDs (for 0-variant products)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [richTextEdit, setRichTextEdit] = useState<RichTextEditState>(null)
  const [addingVariantFor, setAddingVariantFor] = useState<string | null>(null)
  const [newVariantStep, setNewVariantStep] = useState<1 | 2 | 3>(1)
  const [newVariantDraft, setNewVariantDraft] = useState<{
    title: string
    optionValues: Record<string, string>
    prices: { currency_code: string; amount: string }[]
    sku: string
    manage_inventory: boolean
    inventory_quantity: string
  }>({
    title: "",
    optionValues: {},
    prices: [{ currency_code: "usd", amount: "" }],
    sku: "",
    manage_inventory: true,
    inventory_quantity: "",
  })
  const [isCreatingVariant, setIsCreatingVariant] = useState(false)
  // Saved views — Default (null) shows all columns; saved views store a specific selection
  const [savedViews, setSavedViews] = useState<SavedView[]>(
    () => loadSavedViews().savedViews
  )
  const [currentViewId, setCurrentViewIdState] = useState<string | null>(
    () => loadSavedViews().currentViewId
  )
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    const { savedViews: sv, currentViewId: id } = loadSavedViews()
    const view = id ? sv.find((v) => v.id === id) : null
    return view
      ? new Set(view.visible)
      : new Set(DEFAULT_VISIBLE_COLUMNS)
  })
  const [customColumns, setCustomColumns] = useState<CustomColumnDef[]>(() => {
    const { savedViews: sv, currentViewId: id } = loadSavedViews()
    const view = id ? sv.find((v) => v.id === id) : null
    return view ? view.customColumns : []
  })
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const { savedViews: sv, currentViewId: id } = loadSavedViews()
    const view = id ? sv.find((v) => v.id === id) : null
    // Merge saved order with DEFAULT_COLUMN_ORDER so newly-added columns still show up
    const saved = view?.order ?? []
    const merged = [...saved]
    for (const col of DEFAULT_COLUMN_ORDER) {
      if (!merged.includes(col)) merged.push(col)
    }
    return merged
  })
  const colDragSrcRef = useRef<string | null>(null)
  const [newCustomLabel, setNewCustomLabel] = useState("")
  const [newCustomSourceKind, setNewCustomSourceKind] = useState<
    "variant_metadata" | "product_metadata"
  >("variant_metadata")
  const [newCustomKey, setNewCustomKey] = useState("")
  const [newViewNameInput, setNewViewNameInput] = useState("")
  const [isNamingNewView, setIsNamingNewView] = useState(false)
  const [i18nLocaleToggleBusy, setI18nLocaleToggleBusy] = useState<
    Record<string, boolean>
  >({})

  // Image modal state
  const [imageModalFor, setImageModalFor] = useState<
    | { mode: "product"; productId: string }
    | { mode: "variant"; productId: string; variantId: string }
    | null
  >(null)
  const [modalProductImages, setModalProductImages] = useState<{ id?: string; url: string }[]>([])
  const [modalVariantImages, setModalVariantImages] = useState<{ id?: string; url: string }[]>([])
  const [isSavingImages, setIsSavingImages] = useState(false)
  const [isUploadingProductImages, setIsUploadingProductImages] = useState(false)
  const [isUploadingVariantImages, setIsUploadingVariantImages] = useState(false)
  const modalProductImagesInputRef = useRef<HTMLInputElement>(null)
  const modalVariantImagesInputRef = useRef<HTMLInputElement>(null)
  const imgDragSrcRef = useRef<{ section: "product" | "variant"; idx: number } | null>(null)

  const extraVariantMetadataKeys = useMemo(() => {
    const s = new Set<string>()
    for (const c of customColumns) {
      if (c.source.kind === "variant_metadata") s.add(c.source.key)
    }
    return s
  }, [customColumns])

  // Persist saved views + current view selection
  useEffect(() => {
    saveSavedViews(savedViews, currentViewId)
  }, [savedViews, currentViewId])

  // Is the current in-memory state different from the selected saved view?
  const isViewDirty = useMemo(() => {
    const currentView = currentViewId
      ? savedViews.find((v) => v.id === currentViewId)
      : null
    // Default view (null): dirty if state differs from defaults
    if (!currentView) {
      if (customColumns.length > 0) return true
      if (visibleColumns.size !== DEFAULT_VISIBLE_COLUMNS.size) return true
      for (const id of DEFAULT_VISIBLE_COLUMNS) {
        if (!visibleColumns.has(id)) return true
      }
      // Dirty if column order differs from default
      if (columnOrder.length !== DEFAULT_COLUMN_ORDER.length) return true
      for (let i = 0; i < DEFAULT_COLUMN_ORDER.length; i++) {
        if (columnOrder[i] !== DEFAULT_COLUMN_ORDER[i]) return true
      }
      return false
    }
    const savedVisible = new Set(currentView.visible)
    if (savedVisible.size !== visibleColumns.size) return true
    for (const id of visibleColumns) if (!savedVisible.has(id)) return true
    if (currentView.customColumns.length !== customColumns.length) return true
    for (let i = 0; i < customColumns.length; i++) {
      const a = customColumns[i]
      const b = currentView.customColumns[i]
      if (!b || a.id !== b.id || a.label !== b.label) return true
      if (a.source.kind !== b.source.kind || a.source.key !== b.source.key) {
        return true
      }
    }
    // Compare column order
    const savedOrder = currentView.order ?? DEFAULT_COLUMN_ORDER
    if (savedOrder.length !== columnOrder.length) return true
    for (let i = 0; i < savedOrder.length; i++) {
      if (savedOrder[i] !== columnOrder[i]) return true
    }
    return false
  }, [currentViewId, savedViews, visibleColumns, customColumns, columnOrder])

  const selectView = useCallback(
    (viewId: string | null) => {
      setCurrentViewIdState(viewId)
      const view = viewId ? savedViews.find((v) => v.id === viewId) : null
      if (view) {
        setVisibleColumns(new Set(view.visible))
        setCustomColumns(view.customColumns)
        const saved = view.order ?? []
        const merged = [...saved]
        for (const col of DEFAULT_COLUMN_ORDER) {
          if (!merged.includes(col)) merged.push(col)
        }
        setColumnOrder(merged)
      } else {
        setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))
        setCustomColumns([])
        setColumnOrder([...DEFAULT_COLUMN_ORDER])
      }
    },
    [savedViews]
  )

  const saveCurrentAsNewView = useCallback(() => {
    const name = newViewNameInput.trim()
    if (!name) {
      toast.error("Enter a view name")
      return
    }
    const id = newSavedViewId()
    const newView: SavedView = {
      id,
      name,
      visible: [...visibleColumns],
      customColumns,
      order: [...columnOrder],
    }
    setSavedViews((prev) => [...prev, newView])
    setCurrentViewIdState(id)
    setNewViewNameInput("")
    setIsNamingNewView(false)
    toast.success(`View "${name}" saved`)
  }, [newViewNameInput, visibleColumns, customColumns, columnOrder])

  const updateCurrentView = useCallback(() => {
    if (!currentViewId) return
    setSavedViews((prev) =>
      prev.map((v) =>
        v.id === currentViewId
          ? {
              ...v,
              visible: [...visibleColumns],
              customColumns,
              order: [...columnOrder],
            }
          : v
      )
    )
    const view = savedViews.find((v) => v.id === currentViewId)
    toast.success(`View "${view?.name ?? ""}" updated`)
  }, [currentViewId, savedViews, visibleColumns, customColumns, columnOrder])

  const deleteCurrentView = useCallback(() => {
    if (!currentViewId) return
    const view = savedViews.find((v) => v.id === currentViewId)
    if (!view) return
    if (!window.confirm(`Delete view "${view.name}"? This cannot be undone.`)) {
      return
    }
    setSavedViews((prev) => prev.filter((v) => v.id !== currentViewId))
    setCurrentViewIdState(null)
    setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))
    setCustomColumns([])
    setColumnOrder([...DEFAULT_COLUMN_ORDER])
    toast.success(`View "${view.name}" deleted`)
  }, [currentViewId, savedViews])

  const moveColumn = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setColumnOrder((prev) => {
      const next = [...prev]
      const fromIdx = next.indexOf(fromId)
      const toIdx = next.indexOf(toId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
  }, [])

  const currentViewName = useMemo(() => {
    if (!currentViewId) return "Default"
    return savedViews.find((v) => v.id === currentViewId)?.name ?? "Default"
  }, [currentViewId, savedViews])

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
    // Legacy remote prefs (mode/visible/customColumns) are ignored here;
    // saved views are local-only for now (can be synced later with a dedicated endpoint).
  }, [remoteColumnPrefsFetchDone, remoteColumnPrefs])

  const isColumnVisible = useCallback(
    (id: string) => {
      if (id === "expand" || id === "image" || id === "title" || id === "status")
        return true
      // Default view (no saved view selected) and no modifications: show all columns
      if (!currentViewId && !isViewDirty) return true
      return visibleColumns.has(id)
    },
    [currentViewId, isViewDirty, visibleColumns]
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
          "+thumbnail,+images,+tags,*categories,*collection,*sales_channels,*options,*options.values,+description,+material,+weight,+width,+height,+metadata,+variants,+variants.prices,+variants.thumbnail,+variants.images,+variants.manage_inventory,*variants.inventory_items,+variants.metadata",
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

  const { data: collectionsData } = useQuery({
    queryKey: ["admin-product-collections-bulk"],
    queryFn: () => sdk.admin.productCollection.list({ limit: 200 }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const { data: deeplConfig } = useQuery({
    queryKey: ["admin-deepl-config"],
    queryFn: () =>
      sdk.client.fetch<{ enabled: boolean; targetLangs: string[] }>(
        "/admin/deepl/config"
      ),
    staleTime: 120_000,
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

  // ── Selection (checkbox column + bulk actions) ──────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // All selectable IDs: variant IDs for products with variants, product IDs for 0-variant products
  const allSelectableIds = useMemo(() => [
    ...working.flatMap((r) => r.variants.map((v) => v.id)),
    ...working.filter((r) => r.variants.length === 0).map((r) => r.id),
  ], [working])

  const allSelected =
    allSelectableIds.length > 0 && allSelectableIds.every((id) => selectedIds.has(id))
  const someSelected =
    !allSelected && allSelectableIds.some((id) => selectedIds.has(id))
  const toggleSelectAll = useCallback(() => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(allSelectableIds))
  }, [allSelected, allSelectableIds])

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
        (row.collection_id ?? null) !== (orig.collection_id ?? null) ||
        JSON.stringify(row.sales_channel_ids) !==
          JSON.stringify(orig.sales_channel_ids) ||
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
          variant.title !== origV.title ||
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

  // Maps variant ID → parent product ID; used for variant-level delete
  const variantToProductIdMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of working) {
      for (const v of row.variants) map.set(v.id, row.id)
    }
    return map
  }, [working])

  const selectedVariantCount = useMemo(() =>
    Array.from(selectedIds).filter((id) => variantToProductIdMap.has(id)).length,
    [selectedIds, variantToProductIdMap]
  )
  const selectedProductCount = useMemo(() =>
    Array.from(selectedIds).filter((id) => !variantToProductIdMap.has(id)).length,
    [selectedIds, variantToProductIdMap]
  )
  const deleteSelectionLabel = useMemo(() => {
    const parts: string[] = []
    if (selectedVariantCount > 0) parts.push(`${selectedVariantCount} variant${selectedVariantCount !== 1 ? "s" : ""}`)
    if (selectedProductCount > 0) parts.push(`${selectedProductCount} product${selectedProductCount !== 1 ? "s" : ""}`)
    return parts.length > 0 ? `Delete ${parts.join(" & ")}` : `Delete ${selectedIds.size}`
  }, [selectedVariantCount, selectedProductCount, selectedIds.size])

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

  const updateVariantTitle = useCallback(
    (productId: string, variantId: string, title: string) => {
      setWorking((prev) =>
        prev.map((row) => {
          if (row.id !== productId) return row
          return {
            ...row,
            variants: row.variants.map((v) =>
              v.id === variantId ? { ...v, title } : v
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
        const urls = (uploaded ?? [])
          .map((f: { url?: string }) => f.url)
          .filter((u): u is string => !!u)
        if (!urls.length) {
          toast.error("Upload failed")
          e.target.value = ""
          return
        }
        // First uploaded image → thumbnail (flows through the save button).
        updateRow(productId, "thumbnail", urls[0])
        // Additional images → attach to the product gallery immediately.
        if (urls.length > 1) {
          try {
            const existing = await sdk.admin.product.retrieve(productId, {
              fields: "images",
            } as Parameters<typeof sdk.admin.product.retrieve>[1])
            const existingUrls = (
              ((existing as { product: { images?: { url?: string }[] } }).product
                ?.images ?? []) as { url?: string }[]
            )
              .map((i) => i.url)
              .filter((u): u is string => !!u)
            const nextImages = [
              ...existingUrls,
              ...urls,
            ].map((url) => ({ url }))
            await sdk.admin.product.update(
              productId,
              { images: nextImages } as Parameters<
                typeof sdk.admin.product.update
              >[1]
            )
            await queryClient.invalidateQueries({
              queryKey: ["admin-products-bulk"],
            })
            toast.success(
              `${urls.length} images uploaded (thumbnail + ${urls.length - 1} to gallery)`
            )
          } catch {
            toast.error("Gallery update failed; thumbnail saved on next click.")
          }
        } else {
          toast.success("Thumbnail updated")
        }
      } catch {
        toast.error("Upload failed")
      }
      e.target.value = ""
    },
    [queryClient, uploadingThumbnailFor, updateRow]
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

  // ── Image modal handlers ────────────────────────────────────────────────────

  const openImageModalForProduct = useCallback(
    (productId: string) => {
      const row = working.find((r) => r.id === productId)
      if (!row) return
      // Seed from images[] if present, else fallback to the lone thumbnail so
      // the modal isn't visually empty when the product only has a thumbnail.
      const seed =
        row.images && row.images.length > 0
          ? row.images
          : row.thumbnail
          ? [{ url: row.thumbnail }]
          : []
      setModalProductImages([...seed])
      setModalVariantImages([])
      setImageModalFor({ mode: "product", productId })
    },
    [working]
  )

  const openImageModalForVariant = useCallback(
    (productId: string, variantId: string) => {
      const row = working.find((r) => r.id === productId)
      if (!row) return
      const v = row.variants.find((v) => v.id === variantId)
      const seed =
        v?.images && v.images.length > 0
          ? v.images
          : v?.thumbnail
          ? [{ url: v.thumbnail }]
          : []
      setModalVariantImages([...seed])
      setModalProductImages([])
      setImageModalFor({ mode: "variant", productId, variantId })
    },
    [working]
  )

  const saveImageModal = useCallback(async () => {
    if (!imageModalFor) return
    setIsSavingImages(true)
    try {
      if (imageModalFor.mode === "product") {
        const { productId } = imageModalFor
        await sdk.admin.product.update(productId, {
          images: modalProductImages.map((i) => ({ id: i.id, url: i.url })),
          thumbnail: modalProductImages[0]?.url || null,
        } as Parameters<typeof sdk.admin.product.update>[1])
        setWorking((prev) =>
          prev.map((r) =>
            r.id !== productId
              ? r
              : {
                  ...r,
                  images: modalProductImages,
                  thumbnail: modalProductImages[0]?.url ?? r.thumbnail,
                }
          )
        )
        setSource((prev) =>
          prev.map((r) =>
            r.id !== productId
              ? r
              : {
                  ...r,
                  images: modalProductImages,
                  thumbnail: modalProductImages[0]?.url ?? r.thumbnail,
                }
          )
        )
      } else {
        const { productId, variantId } = imageModalFor
        // Medusa v2's variant update payload does NOT accept an `images` array,
        // so we persist the gallery in metadata.variant_images instead. The
        // first image still drives the variant thumbnail (which IS accepted).
        const row = working.find((r) => r.id === productId)
        const currentVariant = row?.variants.find((v) => v.id === variantId)
        const nextMetadata: Record<string, unknown> = {
          ...(currentVariant?.metadata ?? {}),
          variant_images: modalVariantImages.map((i) => ({
            ...(i.id ? { id: i.id } : {}),
            url: i.url,
          })),
        }
        await sdk.client.fetch(
          `/admin/products/${productId}/variants/${variantId}`,
          {
            method: "POST",
            body: {
              thumbnail: modalVariantImages[0]?.url || null,
              metadata: nextMetadata,
            },
          }
        )
        const applyVariantUpdate = (r: ProductRow) =>
          r.id !== productId
            ? r
            : {
                ...r,
                variants: r.variants.map((v) =>
                  v.id !== variantId
                    ? v
                    : {
                        ...v,
                        images: modalVariantImages,
                        thumbnail: modalVariantImages[0]?.url ?? v.thumbnail,
                        metadata: nextMetadata,
                      }
                ),
              }
        setWorking((prev) => prev.map(applyVariantUpdate))
        setSource((prev) => prev.map(applyVariantUpdate))
      }
      setImageModalFor(null)
      toast.success("Images saved")
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save images")
    } finally {
      setIsSavingImages(false)
    }
  }, [imageModalFor, modalProductImages, modalVariantImages, working])

  const handleModalProductImagesUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      setIsUploadingProductImages(true)
      try {
        const { files: uploaded } = await sdk.admin.upload.create({
          files: Array.from(files),
        })
        const urls = (uploaded ?? [])
          .map((f: { url?: string }) => f.url)
          .filter((u): u is string => !!u)
        if (urls.length) {
          setModalProductImages((prev) => [
            ...prev,
            ...urls.map((url) => ({ url })),
          ])
        }
      } catch {
        toast.error("Upload failed")
      } finally {
        setIsUploadingProductImages(false)
        e.target.value = ""
      }
    },
    []
  )

  const handleModalVariantImagesUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      setIsUploadingVariantImages(true)
      try {
        const { files: uploaded } = await sdk.admin.upload.create({
          files: Array.from(files),
        })
        const urls = (uploaded ?? [])
          .map((f: { url?: string }) => f.url)
          .filter((u): u is string => !!u)
        if (urls.length) {
          setModalVariantImages((prev) => [
            ...prev,
            ...urls.map((url) => ({ url })),
          ])
        }
      } catch {
        toast.error("Upload failed")
      } finally {
        setIsUploadingVariantImages(false)
        e.target.value = ""
      }
    },
    []
  )

  const discard = useCallback(() => {
    setWorking(source)
    setErrors({})
  }, [source])

  // Track whether the user has been prompted about dirty changes during this
  // search session — prompting on every keystroke blocks typing entirely.
  const searchDirtyPromptedRef = useRef(false)
  const handleSearchChange = useCallback(
    (value: string) => {
      // Always accept keystrokes into local state; the debounced effect below
      // drives the actual re-query, so typing never gets swallowed by a prompt.
      if (hasDirty && !searchDirtyPromptedRef.current) {
        searchDirtyPromptedRef.current = true
        if (
          !window.confirm(
            "You have unsaved changes. Keep typing will discard them on the next search. Continue?"
          )
        ) {
          // User cancelled — leave value unchanged
          return
        }
        discard()
      }
      setSearch(value)
      if (!value.trim()) searchDirtyPromptedRef.current = false
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
        if ((row.collection_id ?? null) !== (orig.collection_id ?? null)) {
          patch.collection_id = row.collection_id
        }
        if (
          JSON.stringify(row.sales_channel_ids) !==
          JSON.stringify(orig.sales_channel_ids)
        ) {
          patch.sales_channels = row.sales_channel_ids.map((id) => ({ id }))
        }
        if (
          JSON.stringify(row.metadata ?? {}) !==
          JSON.stringify(orig.metadata ?? {})
        ) {
          // Medusa v2 metadata updates merge — sending {a:1} keeps prior keys.
          // To DELETE a key (e.g. clearing B2B discount), we must explicitly
          // send it as null so the server strips it.
          const nextMeta: Record<string, unknown> = { ...(row.metadata ?? {}) }
          for (const k of Object.keys(orig.metadata ?? {})) {
            if (!(k in nextMeta)) nextMeta[k] = null
          }
          patch.metadata = nextMeta
        }

        // Include all existing variants when any variant is edited.
        // Medusa product batch updates may treat `variants` as replace semantics,
        // so omitting untouched variants can remove them.
        const dirtyVariants = dirtyVariantMap.get(id)
        if (dirtyVariants && dirtyVariants.size > 0) {
          patch.variants = row.variants.map((currentVariant) => {
            const variantId = currentVariant.id
            const origV = orig.variants.find((v) => v.id === variantId)!
            if (!dirtyVariants.has(variantId)) {
              return { id: variantId }
            }
            const vPatch: Record<string, unknown> & { id: string } = {
              id: variantId,
            }
            if (currentVariant.title !== origV.title) {
              vPatch.title = currentVariant.title || null
            }
            if (currentVariant.sku !== origV.sku) {
              vPatch.sku = currentVariant.sku || null
            }
            if (
              JSON.stringify(currentVariant.prices) !== JSON.stringify(origV.prices)
            ) {
              vPatch.prices = currentVariant.prices
                .filter((p) => p.amount !== "")
                .map((p) => ({
                  ...(p.id ? { id: p.id } : {}),
                  currency_code: p.currency_code,
                  amount: displayToAmount(p.amount),
                }))
            }
            // Variant thumbnail is a top-level field in Medusa API
            if (currentVariant.thumbnail !== origV.thumbnail) {
              vPatch.thumbnail = currentVariant.thumbnail?.trim() || null
            }
            if (currentVariant.manage_inventory !== origV.manage_inventory) {
              vPatch.manage_inventory = currentVariant.manage_inventory
            }

            // Build merged metadata for sale_price, color_hex, wcwp_client-*, etc.
            const metaUpdates: Record<string, unknown> = {
              ...(origV.metadata ?? {}),
            }
            let metaChanged = false

            // Sale price metadata via price list when configured
            if (
              SALE_PRICE_LIST_ID &&
              currentVariant.sale_price_amount !== origV.sale_price_amount
            ) {
              const next = currentVariant.sale_price_amount.trim()
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
              const next = getMeta(currentVariant.metadata, key)
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

      // Collect all variants that need an inventory-level change (qty or manage_inventory→true).
      // Variants where manage_inventory was just enabled have inventoryItemId=null; those need
      // a full item+link+level setup (Medusa does NOT auto-create inventory items on variant update).
      type InvQtyChange = {
        productId: string
        variantId: string
        variantSku: string
        inventoryItemId: string | null
        /** true when manage_inventory just became true (item must be created & linked) */
        isNew: boolean
        stocked_quantity: number
      }
      const invQtyChanges: InvQtyChange[] = []

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
          const qtyChanged = v.inventory_quantity !== origV.inventory_quantity
          const manageOn = !origV.manage_inventory && v.manage_inventory
          if (!qtyChanged && !manageOn) continue
          const req = Math.max(1, origV.inventory_required_quantity)
          const qty =
            v.inventory_quantity != null
              ? Math.max(0, Math.round(v.inventory_quantity))
              : 0
          invQtyChanges.push({
            productId: id,
            variantId,
            variantSku: v.sku ?? "",
            inventoryItemId: origV.inventory_item_id,
            isNew: manageOn && !origV.inventory_item_id,
            stocked_quantity: qty * req,
          })
        }
      }

      if (invQtyChanges.length && !primaryStockLocationId) {
        throw new Error(
          "Stock quantity was changed but no stock location exists. Create a stock location in Settings (Inventory → Locations), then save again."
        )
      }

      const batchRes = await sdk.admin.product.batch(
        { update } as Parameters<typeof sdk.admin.product.batch>[0]
      )

      if (invQtyChanges.length && primaryStockLocationId) {
        // ── Newly managed variants ──────────────────────────────────────────────
        // Medusa's product update workflow does NOT auto-create inventory items when
        // manage_inventory flips from false to true on an existing variant. We must:
        //   1. Check whether the variant ALREADY has an inventory item linked
        //      (the GET /admin/products may not have populated `inventory_item_id`,
        //      and creating another would produce duplicate rows in "Edit stock levels").
        //   2. If not, create one and link it to the variant.
        //   3. Create/update the inventory level at the primary location.
        // The variant batch already set manage_inventory=true.
        const newlyManagedFailures: string[] = []
        for (const chg of invQtyChanges.filter((c) => c.isNew)) {
          // Step 0: safety check — re-fetch the variant's existing inventory items
          // before creating a new one. Prevents duplicates when the initial product
          // list query didn't surface inventory_item_id in a parseable shape.
          try {
            const lookup = await sdk.admin.productVariant.list({
              id: chg.variantId,
              fields: "*inventory_items",
              limit: 1,
            } as Parameters<typeof sdk.admin.productVariant.list>[0])
            const existingItems = (lookup.variants?.[0] as any)?.inventory_items as
              | Array<{
                  id?: string | null
                  inventory_item_id?: string | null
                  inventory?: { id?: string | null }
                }>
              | undefined
            const existingId = existingItems?.length
              ? existingItems
                  .map((item) =>
                    typeof item?.inventory_item_id === "string"
                      ? item.inventory_item_id
                      : typeof item?.inventory?.id === "string"
                        ? item.inventory.id
                        : typeof item?.id === "string" && item.id.startsWith("iitem_")
                          ? item.id
                          : null
                  )
                  .find((id): id is string => !!id)
              : null
            if (existingId) {
              chg.inventoryItemId = existingId
              chg.isNew = false
              continue
            }
          } catch { /* fall through and create — non-fatal */ }

          let newItemId: string | undefined
          // Step 1: create inventory item
          try {
            const body: Record<string, unknown> = {}
            if (chg.variantSku) body.sku = chg.variantSku
            const newItemRes = await sdk.admin.inventoryItem.create(
              body as Parameters<typeof sdk.admin.inventoryItem.create>[0]
            )
            newItemId = (newItemRes as { inventory_item?: { id?: string } }).inventory_item?.id
          } catch (e) {
            newlyManagedFailures.push(
              `Create inventory item failed for ${chg.variantSku || chg.variantId}: ${(e as Error)?.message ?? "unknown"}`
            )
            continue
          }
          if (!newItemId) {
            newlyManagedFailures.push(
              `Create inventory item returned no id for ${chg.variantSku || chg.variantId}`
            )
            continue
          }

          // Step 2: link inventory item to variant
          try {
            await sdk.client.fetch(
              `/admin/products/${chg.productId}/variants/${chg.variantId}/inventory-items`,
              { method: "POST", body: { inventory_item_id: newItemId, required_quantity: 1 } }
            )
          } catch (e) {
            newlyManagedFailures.push(
              `Link inventory item to ${chg.variantSku || chg.variantId} failed: ${(e as Error)?.message ?? "unknown"}`
            )
            continue
          }

          // Step 3: create inventory level
          try {
            await sdk.admin.inventoryItem.batchInventoryItemLocationLevels(
              newItemId,
              {
                create: [{ location_id: primaryStockLocationId, stocked_quantity: chg.stocked_quantity }],
              } as Parameters<typeof sdk.admin.inventoryItem.batchInventoryItemLocationLevels>[1]
            )
          } catch (e) {
            newlyManagedFailures.push(
              `Create inventory level for ${chg.variantSku || chg.variantId} failed: ${(e as Error)?.message ?? "unknown"}`
            )
            continue
          }

          chg.inventoryItemId = newItemId
          chg.isNew = false
        }

        if (newlyManagedFailures.length) {
          throw new Error(
            `Inventory setup failed: ${newlyManagedFailures.join("; ")}`
          )
        }

        // ── Existing inventory items: update or create level at primary location ──
        const createLevels: {
          inventory_item_id: string
          location_id: string
          stocked_quantity: number
        }[] = []
        const updateLevels: {
          inventory_item_id: string
          location_id: string
          stocked_quantity: number
        }[] = []

        await Promise.all(
          invQtyChanges
            .filter((c) => !!c.inventoryItemId && !c.isNew)
            .map(async (chg) => {
              const itemId = chg.inventoryItemId!
              let levelExists = false
              try {
                const lvlRes = await sdk.admin.inventoryItem.listLevels(itemId, {
                  location_id: primaryStockLocationId,
                } as Parameters<typeof sdk.admin.inventoryItem.listLevels>[1])
                levelExists = (lvlRes.inventory_levels ?? []).length > 0
              } catch { /* assume not found — will create */ }
              const entry = {
                inventory_item_id: itemId,
                location_id: primaryStockLocationId,
                stocked_quantity: chg.stocked_quantity,
              }
              if (levelExists) updateLevels.push(entry)
              else createLevels.push(entry)
            })
        )

        if (createLevels.length || updateLevels.length) {
          await sdk.admin.inventoryItem.batchInventoryItemsLocationLevels(
            { create: createLevels, update: updateLevels, delete: [] } as unknown as Parameters<
              typeof sdk.admin.inventoryItem.batchInventoryItemsLocationLevels
            >[0]
          )
        }
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

  // ── Export / Import (CSV) ──────────────────────────────────────────────────
  // Export honors the same filters that produce the visible product list, so
  // applying a status/tag/search filter narrows the export to those products.
  // Both go through our custom endpoints (bulk-edit-export-products and
  // bulk-edit-import-products) so metadata round-trips correctly.
  const importFileInputRef = useRef<HTMLInputElement | null>(null)

  const { mutate: startExport, isPending: isExporting } = useMutation({
    mutationFn: async () => {
      // Use our custom endpoint (not sdk.admin.product.export) because Medusa's
      // built-in export drops product/variant metadata — which we rely on for
      // b2b_discount, sale_price, color_hex, wcwp_client-* etc. Direct download
      // also avoids the notification round-trip and the "Failed to export
      // products" toasts caused by stale region references in the legacy export.
      const filters: Record<string, unknown> = {
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        ...(statusFilter.length ? { status: statusFilter } : {}),
        ...(tagIds.length ? { tag_id: tagIds } : {}),
        ...(typeIds.length ? { type_id: typeIds } : {}),
        ...(salesChannelIds.length ? { sales_channel_id: salesChannelIds } : {}),
        ...(createdAt.$gte || createdAt.$lte ? { created_at: createdAt } : {}),
        ...(updatedAt.$gte || updatedAt.$lte ? { updated_at: updatedAt } : {}),
      }
      const blob = (await sdk.client.fetch("/admin/bulk-edit-export-products", {
        method: "POST",
        body: filters,
        headers: { accept: "text/csv" },
      } as Parameters<typeof sdk.client.fetch>[1])) as Blob
      // Trigger browser download
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `bulk-edit-products-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    },
    onSuccess: () => {
      toast.success("Export downloaded.")
    },
    onError: (e: Error) => {
      toast.error(e?.message || "Export failed.")
    },
  })

  // Import uses our custom endpoint (not sdk.admin.product.import) so the
  // CSV column shape matches the export — round-trip preserves metadata.
  const { mutateAsync: uploadImport, isPending: isImporting } = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text()
      const res = (await sdk.client.fetch("/admin/bulk-edit-import-products", {
        method: "POST",
        body: { csv: text },
      } as Parameters<typeof sdk.client.fetch>[1])) as {
        products_updated: number
        variants_updated: number
        inventory_levels_applied?: number
        skipped_rows?: number
        skipped_no_product_id?: number
        errors?: string[]
        message?: string
      }
      return res
    },
    onError: (e: Error) => {
      toast.error(e?.message || "Import failed.")
    },
  })

  const handleImportFileSelect = useCallback(
    async (file: File) => {
      try {
        const res = await uploadImport(file)
        if (res?.errors?.length) {
          toast.error(
            `Import partially applied. ${res.errors.length} error(s): ${res.errors[0]}${
              res.errors.length > 1 ? ` (+${res.errors.length - 1} more)` : ""
            }`
          )
        } else if (res?.message) {
          toast.warning(res.message)
        } else {
          toast.success(
            `Imported ${res.products_updated} product(s), ${res.variants_updated} variant patch(es).`
          )
        }
        await queryClient.invalidateQueries({ queryKey: ["admin-products-bulk"] })
      } catch {
        /* error already toasted by mutation onError */
      }
    },
    [uploadImport, queryClient]
  )

  const { mutate: deleteBulk, isPending: isDeleting } = useMutation({
    mutationFn: async (args: {
      productIds: string[]
      variants: { variantId: string; productId: string }[]
    }) => {
      for (const { variantId, productId } of args.variants) {
        await sdk.client.fetch(`/admin/products/${productId}/variants/${variantId}`, {
          method: "DELETE",
        })
      }
      if (args.productIds.length > 0) {
        await sdk.admin.product.batch(
          { delete: args.productIds } as Parameters<typeof sdk.admin.product.batch>[0]
        )
      }
      return args
    },
    onSuccess: (args) => {
      if (!args) return
      setSelectedIds(new Set())
      if (args.variants.length > 0) {
        const deletedVIds = new Set(args.variants.map((v) => v.variantId))
        const removeVariants = (rows: ProductRow[]) =>
          rows.map((r) => ({ ...r, variants: r.variants.filter((v) => !deletedVIds.has(v.id)) }))
        setSource(removeVariants)
        setWorking(removeVariants)
      }
      if (args.productIds.length > 0) {
        const deletedPIds = new Set(args.productIds)
        setSource((prev) => prev.filter((p) => !deletedPIds.has(p.id)))
        setWorking((prev) => prev.filter((p) => !deletedPIds.has(p.id)))
      }
      queryClient.invalidateQueries({ queryKey: ["admin-products-bulk"] })
      queryClient.invalidateQueries({ queryKey: ["products"] })
    },
  })
  const handleBulkDelete = useCallback(() => {
    if (isDeleting || selectedIds.size === 0) return
    const selectedArr = Array.from(selectedIds)
    const variantArgs = selectedArr
      .filter((id) => variantToProductIdMap.has(id))
      .map((id) => ({ variantId: id, productId: variantToProductIdMap.get(id)! }))
    const productIds = selectedArr.filter((id) => !variantToProductIdMap.has(id))
    if (variantArgs.length === 0 && productIds.length === 0) return
    const parts: string[] = []
    if (variantArgs.length > 0) parts.push(`${variantArgs.length} variant${variantArgs.length !== 1 ? "s" : ""}`)
    if (productIds.length > 0) parts.push(`${productIds.length} product${productIds.length !== 1 ? "s" : ""}`)
    if (!window.confirm(`Delete ${parts.join(" and ")}? This cannot be undone.`)) return
    deleteBulk({ productIds, variants: variantArgs })
  }, [deleteBulk, isDeleting, selectedIds, variantToProductIdMap])

  const handleBulkI18nLocaleAuto = useCallback(
    async (productId: string, localeCode: string, checked: boolean) => {
      const busyKey = `${productId}:${normalizeLocaleKeyClient(localeCode)}`
      setI18nLocaleToggleBusy((p) => ({ ...p, [busyKey]: true }))
      try {
        if (checked) {
          const res = await sdk.client.fetch<{
            skipped?: boolean
            targetsWritten?: string[]
          }>(`/admin/products/${productId}/translate`, {
            method: "POST",
            body: {
              enableAutoOnUpdateForLocales: [localeCode.trim()],
            },
          })
          const code = localeCode.trim().toUpperCase()
          if (res.targetsWritten?.length) {
            toast.success(
              `${code}: translated now; auto-translate on product save enabled`
            )
          } else {
            toast.success(
              `${code}: already translated; auto-translate on product save enabled`
            )
          }
        } else {
          await sdk.client.fetch(`/admin/products/${productId}/translate`, {
            method: "POST",
            body: {
              disableAutoOnUpdateForLocales: [localeCode.trim()],
            },
          })
          toast.success(
            `${localeCode.trim().toUpperCase()}: auto-translate on save off`
          )
        }
        await queryClient.invalidateQueries({ queryKey: ["admin-products-bulk"] })
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "Translation / settings request failed"
        toast.error(msg)
      } finally {
        setI18nLocaleToggleBusy((p) => {
          const next = { ...p }
          delete next[busyKey]
          return next
        })
      }
    },
    [queryClient]
  )

  const openCreateVariant = useCallback(
    (productId: string) => {
      const row = working.find((r) => r.id === productId)
      // Seed currency from an existing variant's first price, fallback to "usd"
      const seedCurrency =
        row?.variants[0]?.prices[0]?.currency_code?.toLowerCase() || "usd"
      setAddingVariantFor(productId)
      setNewVariantStep(1)
      setNewVariantDraft({
        title: "",
        optionValues: {},
        prices: [{ currency_code: seedCurrency, amount: "" }],
        sku: "",
        manage_inventory: true,
        inventory_quantity: "",
      })
    },
    [working]
  )

  const closeCreateVariant = useCallback(() => {
    setAddingVariantFor(null)
    setNewVariantStep(1)
  }, [])

  const handleCreateVariant = useCallback(async () => {
    const productId = addingVariantFor
    if (!productId) return
    const title = newVariantDraft.title.trim()
    if (!title) {
      toast.error("Variant name is required")
      return
    }
    const validPrices = newVariantDraft.prices
      .map((p) => ({
        currency_code: p.currency_code.trim().toLowerCase(),
        amount: Number(p.amount),
      }))
      .filter((p) => p.currency_code && Number.isFinite(p.amount) && p.amount >= 0)
    if (validPrices.length === 0) {
      toast.error("At least one price is required")
      return
    }
    setIsCreatingVariant(true)
    try {
      const body: Record<string, unknown> = {
        title,
        prices: validPrices,
        manage_inventory: newVariantDraft.manage_inventory,
      }
      const optionValues = Object.fromEntries(
        Object.entries(newVariantDraft.optionValues).filter(
          ([, v]) => v && v.trim()
        )
      )
      if (Object.keys(optionValues).length > 0) body.options = optionValues
      if (newVariantDraft.sku.trim()) body.sku = newVariantDraft.sku.trim()
      await sdk.client.fetch(`/admin/products/${productId}/variants`, {
        method: "POST",
        body,
      })
      closeCreateVariant()
      toast.success("Variant added")
      await queryClient.invalidateQueries({ queryKey: ["admin-products-bulk"] })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to add variant")
    } finally {
      setIsCreatingVariant(false)
    }
  }, [addingVariantFor, newVariantDraft, queryClient, closeCreateVariant])

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
        multiple
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
      <input
        ref={modalProductImagesInputRef}
        type="file"
        multiple
        accept={ACCEPT_IMAGES}
        className="hidden"
        onChange={handleModalProductImagesUpload}
      />
      <input
        ref={modalVariantImagesInputRef}
        type="file"
        multiple
        accept={ACCEPT_IMAGES}
        className="hidden"
        onChange={handleModalVariantImagesUpload}
      />

      {/* Image editing modal */}
      {imageModalFor && (
        <FocusModal
          open
          onOpenChange={(open) => { if (!open && !isSavingImages) setImageModalFor(null) }}
        >
          <FocusModal.Content className="max-w-2xl">
            <FocusModal.Header>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={() => setImageModalFor(null)}
                  disabled={isSavingImages}
                >
                  Cancel
                </Button>
                <Button
                  size="small"
                  onClick={() => void saveImageModal()}
                  disabled={isSavingImages}
                >
                  {isSavingImages ? "Saving…" : "Save"}
                </Button>
              </div>
            </FocusModal.Header>
            <FocusModal.Body className="flex flex-col gap-4 overflow-y-auto p-6">
              {(() => {
                const isProduct = imageModalFor.mode === "product"
                const images = isProduct ? modalProductImages : modalVariantImages
                const setImages = isProduct ? setModalProductImages : setModalVariantImages
                const isUploading = isProduct ? isUploadingProductImages : isUploadingVariantImages
                const openUpload = () =>
                  (isProduct ? modalProductImagesInputRef : modalVariantImagesInputRef).current?.click()
                const section: "product" | "variant" = isProduct ? "product" : "variant"
                return (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <Heading level="h3">Media</Heading>
                        <Text size="small" className="text-ui-fg-subtle">
                          Drag to reorder. First image becomes the thumbnail.
                        </Text>
                      </div>
                      <Button
                        variant="secondary"
                        size="small"
                        disabled={isUploading}
                        onClick={openUpload}
                      >
                        {isUploading ? "Uploading…" : "Upload images"}
                      </Button>
                    </div>
                    {images.length === 0 ? (
                      <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-ui-border-base text-ui-fg-muted">
                        <Text size="small">No images yet</Text>
                      </div>
                    ) : (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
                        {images.map((img, idx) => (
                          <div
                            key={img.url + idx}
                            draggable
                            onDragStart={() => { imgDragSrcRef.current = { section, idx } }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault()
                              const src = imgDragSrcRef.current
                              if (!src || src.section !== section || src.idx === idx) return
                              setImages((prev) => {
                                const next = [...prev]
                                const [item] = next.splice(src.idx, 1)
                                next.splice(idx, 0, item)
                                return next
                              })
                              imgDragSrcRef.current = null
                            }}
                            className="group relative aspect-square cursor-grab overflow-hidden rounded-md border border-ui-border-base bg-ui-bg-subtle"
                          >
                            <img
                              src={img.url}
                              alt=""
                              className="h-full w-full object-cover"
                              draggable={false}
                            />
                            {idx === 0 && (
                              <span className="absolute left-1 top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] text-white">
                                Thumbnail
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setImages((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="absolute right-1 top-1 hidden rounded bg-black/60 px-1 py-0.5 text-white group-hover:flex items-center justify-center"
                              title="Remove"
                            >
                              <XMarkMini className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </FocusModal.Body>
          </FocusModal.Content>
        </FocusModal>
      )}

      {/* Create variant modal */}
      {addingVariantFor && (() => {
        const productRow = working.find((r) => r.id === addingVariantFor)
        if (!productRow) return null
        const productOptions = productRow.options
        const hasOptions = productOptions.length > 0
        const stepLabels: Record<number, string> = {
          1: "1 / Name & options",
          2: "2 / Pricing",
          3: "3 / Inventory (optional)",
        }
        const canGoNextFromStep1 = newVariantDraft.title.trim().length > 0
        const canGoNextFromStep2 = newVariantDraft.prices.some(
          (p) => p.currency_code.trim() && Number(p.amount) >= 0 && p.amount !== ""
        )
        return (
          <FocusModal
            open
            onOpenChange={(o) => { if (!o && !isCreatingVariant) closeCreateVariant() }}
          >
            <FocusModal.Content className="max-w-xl">
              <FocusModal.Header>
                <div className="flex items-center gap-3 w-full">
                  <Text size="small" className="text-ui-fg-subtle">
                    New variant · {productRow.title || "Untitled"}
                  </Text>
                  <span className="text-ui-fg-muted txt-compact-small ml-auto">
                    {stepLabels[newVariantStep]}
                  </span>
                </div>
              </FocusModal.Header>
              <FocusModal.Body className="flex flex-col gap-5 overflow-y-auto p-6">
                {newVariantStep === 1 && (
                  <>
                    <div>
                      <Text size="small" weight="plus" className="mb-2 block">
                        Variant name <span className="text-ui-fg-error">*</span>
                      </Text>
                      <Input
                        autoFocus
                        value={newVariantDraft.title}
                        onChange={(e) =>
                          setNewVariantDraft((d) => ({ ...d, title: e.target.value }))
                        }
                        placeholder="e.g. Red / Medium"
                      />
                    </div>
                    {hasOptions ? (
                      <div className="flex flex-col gap-3">
                        <Text size="small" weight="plus" className="block">
                          Options
                        </Text>
                        <Text size="xsmall" className="text-ui-fg-muted -mt-2">
                          Pick an existing value or type a new one. Empty = not set.
                        </Text>
                        {productOptions.map((opt) => {
                          const current = newVariantDraft.optionValues[opt.title] ?? ""
                          return (
                            <div key={opt.id} className="flex flex-col gap-1">
                              <Text size="xsmall" className="text-ui-fg-subtle">
                                {opt.title}
                              </Text>
                              <div className="flex gap-2">
                                <select
                                  value={
                                    opt.values.some((v) => v.value === current) ? current : ""
                                  }
                                  onChange={(e) =>
                                    setNewVariantDraft((d) => ({
                                      ...d,
                                      optionValues: { ...d.optionValues, [opt.title]: e.target.value },
                                    }))
                                  }
                                  className="txt-compact-small rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5 flex-1"
                                >
                                  <option value="">— select existing —</option>
                                  {opt.values.map((v) => (
                                    <option key={v.id} value={v.value}>
                                      {v.value}
                                    </option>
                                  ))}
                                </select>
                                <Input
                                  placeholder="or new value"
                                  value={
                                    opt.values.some((v) => v.value === current) ? "" : current
                                  }
                                  onChange={(e) =>
                                    setNewVariantDraft((d) => ({
                                      ...d,
                                      optionValues: { ...d.optionValues, [opt.title]: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-ui-border-base bg-ui-bg-subtle p-3">
                        <Text size="xsmall" className="text-ui-fg-muted">
                          This product has no options defined. You can still add a variant,
                          but without options it won't be distinguishable from other variants.
                          Add options (Color, Size, etc.) on the product detail page first.
                        </Text>
                      </div>
                    )}
                  </>
                )}
                {newVariantStep === 2 && (
                  <div className="flex flex-col gap-3">
                    <Text size="small" weight="plus" className="block">
                      Pricing <span className="text-ui-fg-error">*</span>
                    </Text>
                    <Text size="xsmall" className="text-ui-fg-muted -mt-2">
                      At least one price is required. Amount is in the currency's main units.
                    </Text>
                    {newVariantDraft.prices.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          className="w-24"
                          value={p.currency_code}
                          onChange={(e) =>
                            setNewVariantDraft((d) => ({
                              ...d,
                              prices: d.prices.map((pp, i) =>
                                i === idx ? { ...pp, currency_code: e.target.value } : pp
                              ),
                            }))
                          }
                          placeholder="usd"
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="flex-1"
                          value={p.amount}
                          onChange={(e) =>
                            setNewVariantDraft((d) => ({
                              ...d,
                              prices: d.prices.map((pp, i) =>
                                i === idx ? { ...pp, amount: e.target.value } : pp
                              ),
                            }))
                          }
                          placeholder="0.00"
                        />
                        <Button
                          variant="transparent"
                          size="small"
                          disabled={newVariantDraft.prices.length === 1}
                          onClick={() =>
                            setNewVariantDraft((d) => ({
                              ...d,
                              prices: d.prices.filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-ui-fg-error"
                        >
                          <XMarkMini />
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() =>
                        setNewVariantDraft((d) => ({
                          ...d,
                          prices: [...d.prices, { currency_code: "", amount: "" }],
                        }))
                      }
                    >
                      Add price
                    </Button>
                  </div>
                )}
                {newVariantStep === 3 && (
                  <div className="flex flex-col gap-4">
                    <div>
                      <Text size="small" weight="plus" className="mb-2 block">
                        SKU (optional)
                      </Text>
                      <Input
                        value={newVariantDraft.sku}
                        onChange={(e) =>
                          setNewVariantDraft((d) => ({ ...d, sku: e.target.value }))
                        }
                        placeholder="SKU-001"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={newVariantDraft.manage_inventory}
                        onCheckedChange={(v) =>
                          setNewVariantDraft((d) => ({
                            ...d,
                            manage_inventory: v === true,
                          }))
                        }
                      />
                      <Text size="small">Manage stock for this variant</Text>
                    </label>
                    <Text size="xsmall" className="text-ui-fg-muted -mt-2">
                      Stock quantity can be set in the spreadsheet after creation.
                    </Text>
                  </div>
                )}
              </FocusModal.Body>
              <FocusModal.Footer>
                <div className="flex items-center gap-2 w-full">
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={closeCreateVariant}
                    disabled={isCreatingVariant}
                  >
                    Cancel
                  </Button>
                  <div className="ml-auto flex items-center gap-2">
                    {newVariantStep > 1 && (
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => setNewVariantStep((s) => (s - 1) as 1 | 2 | 3)}
                        disabled={isCreatingVariant}
                      >
                        Back
                      </Button>
                    )}
                    {newVariantStep < 3 ? (
                      <Button
                        size="small"
                        onClick={() => setNewVariantStep((s) => (s + 1) as 1 | 2 | 3)}
                        disabled={
                          isCreatingVariant ||
                          (newVariantStep === 1 && !canGoNextFromStep1) ||
                          (newVariantStep === 2 && !canGoNextFromStep2)
                        }
                      >
                        Next
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        onClick={() => void handleCreateVariant()}
                        disabled={isCreatingVariant}
                      >
                        {isCreatingVariant ? "Creating…" : "Create variant"}
                      </Button>
                    )}
                  </div>
                </div>
              </FocusModal.Footer>
            </FocusModal.Content>
          </FocusModal>
        )
      })()}

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
          <span className="txt-small text-ui-fg-subtle">Edit with spreadsheet</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="small"
            onClick={() => startExport()}
            disabled={isExporting || isLoading}
            title={hasAnyFilters ? "Export the filtered products to CSV" : "Export all products to CSV"}
          >
            <ArrowDownTray />
            {isExporting ? "Exporting…" : hasAnyFilters ? "Export filtered" : "Export"}
          </Button>
          <Button
            variant="secondary"
            size="small"
            onClick={() => importFileInputRef.current?.click()}
            disabled={isImporting}
            title="Import products from a CSV exported from this page"
          >
            <ArrowUpTray />
            {isImporting ? "Importing…" : "Import"}
          </Button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImportFileSelect(f)
              // Reset so picking the same file again still triggers onChange
              e.target.value = ""
            }}
          />
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


            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <Button variant="secondary" size="small" disabled={isSaving}>
                  View: {currentViewName}{isViewDirty ? " •" : ""} <ChevronDown className="ml-1" />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content className="w-[min(100vw-2rem,360px)]">
                <div className="flex flex-col gap-3 p-3">
                  <div className="flex flex-col gap-1">
                    <Text size="xsmall" className="text-ui-fg-muted">
                      Active view
                    </Text>
                    <select
                      className="txt-compact-small rounded-md border border-ui-border-base bg-ui-bg-field px-2 py-1.5"
                      value={currentViewId ?? ""}
                      onChange={(e) => selectView(e.target.value || null)}
                      disabled={isSaving}
                    >
                      <option value="">Default (all columns)</option>
                      {savedViews.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    {isViewDirty && (
                      <Text size="xsmall" className="text-ui-fg-muted">
                        Unsaved changes to this view
                      </Text>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isNamingNewView ? (
                      <div className="flex w-full flex-col gap-2">
                        <Input
                          size="small"
                          placeholder="View name"
                          value={newViewNameInput}
                          onChange={(e) => setNewViewNameInput(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveCurrentAsNewView()
                            if (e.key === "Escape") {
                              setIsNamingNewView(false)
                              setNewViewNameInput("")
                            }
                          }}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="small"
                            onClick={saveCurrentAsNewView}
                            disabled={!newViewNameInput.trim()}
                          >
                            Save
                          </Button>
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => {
                              setIsNamingNewView(false)
                              setNewViewNameInput("")
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() => setIsNamingNewView(true)}
                          disabled={isSaving}
                        >
                          Save view
                        </Button>
                        {currentViewId && isViewDirty && (
                          <Button
                            size="small"
                            onClick={updateCurrentView}
                            disabled={isSaving}
                          >
                            Update view
                          </Button>
                        )}
                        {currentViewId && (
                          <Button
                            size="small"
                            variant="transparent"
                            onClick={deleteCurrentView}
                            disabled={isSaving}
                            className="text-ui-fg-error"
                          >
                            Delete view
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                  <div className="border-t border-ui-border-base pt-2">
                    <Text size="xsmall" className="mb-2 block text-ui-fg-muted">
                      Select columns to display. Drag rows to reorder them.
                      Expand, image, title, and status always stay visible.
                    </Text>
                    <div className="max-h-[min(320px,50vh)] flex flex-col gap-0.5 overflow-y-auto">
                      {columnOrder.map((id) => {
                        const col = TOGGLEABLE_COLUMNS.find((c) => c.id === id)
                        if (!col) return null
                        return (
                          <label
                            key={col.id}
                            draggable
                            onDragStart={(e) => {
                              colDragSrcRef.current = col.id
                              e.dataTransfer.effectAllowed = "move"
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault()
                              const src = colDragSrcRef.current
                              if (src && src !== col.id) moveColumn(src, col.id)
                              colDragSrcRef.current = null
                            }}
                            className="flex cursor-grab items-center gap-2 rounded-md py-1.5 pl-1 pr-1 hover:bg-ui-bg-base-hover"
                          >
                            <span className="text-ui-fg-muted text-xs select-none" aria-hidden>⋮⋮</span>
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
                        )
                      })}
                    </div>
                  </div>
                  <div className="border-t border-ui-border-base pt-2">
                    <Text size="xsmall" className="mb-2 block text-ui-fg-muted">
                      Custom columns (read from metadata keys)
                    </Text>
                    {SUGGESTED_PRODUCT_METADATA_KEYS.length > 0 && (
                      <div className="mb-3">
                        <Text size="xsmall" className="mb-1.5 block text-ui-fg-subtle">
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
                        <option value="variant_metadata">Variant metadata</option>
                        <option value="product_metadata">Product metadata</option>
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
                            <div className="flex min-w-0 flex-1 flex-col">
                              <Text size="small" className="truncate">
                                {cc.label}
                              </Text>
                              <Text size="xsmall" className="truncate text-ui-fg-muted">
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
            {hasDirty && (
              <span className="txt-compact-small text-ui-fg-subtle whitespace-nowrap">
                {dirtyIds.size} unsaved
              </span>
            )}
            <Button
              variant="secondary"
              size="small"
              onClick={discard}
              disabled={!hasDirty || isSaving}
              title="Discard changes"
              className="!px-2"
            >
              <ArrowUturnLeft />
            </Button>
            <Button
              size="small"
              onClick={handleSave}
              disabled={!hasDirty || hasErrors || isSaving}
              title={isSaving ? "Saving…" : "Save changes"}
              className="!px-2"
            >
              <Check />
            </Button>
            <div className="w-full sm:w-[240px]">
              <Input
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search products…"
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
          <>
          {selectedIds.size > 0 && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-ui-border-base bg-ui-bg-highlight px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="txt-compact-small-plus">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="txt-compact-small text-ui-fg-subtle hover:text-ui-fg-base"
                >
                  Clear selection
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={isDeleting}
                  className="rounded-md border border-ui-border-error bg-ui-bg-base px-3 py-1 txt-compact-small-plus text-ui-fg-error hover:bg-ui-bg-error-hover disabled:opacity-50"
                >
                  {isDeleting ? "Deleting…" : deleteSelectionLabel}
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
            <style>{`
              .sheet-table {
                border-collapse: separate;
                border-spacing: 0;
                /* Fixed layout so column widths are authoritative and
                   long content can't expand a cell past its declared width. */
                table-layout: fixed;
              }
              .sheet-table thead th {
                border-right: 1px solid var(--border-base, rgba(17,24,39,0.1));
                border-bottom: 1px solid var(--border-base, rgba(17,24,39,0.15));
                padding: 6px 8px !important;
                position: sticky;
                top: 0;
                background: var(--bg-subtle, #f9fafb);
                z-index: 2;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              }
              .sheet-table td[data-cell] {
                overflow: hidden;
              }
              /* Dropdown / popover portals must stack above the sticky thead (z:2) */
              [data-radix-popper-content-wrapper] { z-index: 60 !important; }
              /* FocusModal (Radix Dialog) overlay + content must also be above the sticky thead */
              .bg-ui-bg-overlay.fixed.inset-0 { z-index: 70 !important; }
              [role="dialog"].fixed.inset-2,
              [role="dialog"].shadow-elevation-modal { z-index: 71 !important; }
              .sheet-table td[data-cell] {
                outline: none;
                position: relative;
                padding: 2px 4px !important;
                border-right: 1px solid rgba(17,24,39,0.08);
                border-bottom: 1px solid rgba(17,24,39,0.08);
                vertical-align: middle;
                user-select: none;
              }
              /* Flatten inputs / buttons / selects so cells feel spreadsheet-y */
              .sheet-table td[data-cell] input:not([type=checkbox]):not([type=radio]),
              .sheet-table td[data-cell] textarea,
              .sheet-table td[data-cell] select,
              .sheet-table td[data-cell] > button {
                border: none !important;
                border-radius: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                height: 26px !important;
                min-height: 26px !important;
                padding: 0 4px !important;
                margin: 0 !important;
                width: 100%;
                font-size: 13px;
              }
              .sheet-table td[data-cell] input:not([type=checkbox]):not([type=radio]):focus,
              .sheet-table td[data-cell] textarea:focus,
              .sheet-table td[data-cell] select:focus {
                outline: none !important;
                box-shadow: inset 0 0 0 2px rgb(59,130,246) !important;
              }
              /* Medusa Input wraps in a relative div — collapse that wrapper. */
              .sheet-table td[data-cell] > div.relative,
              .sheet-table td[data-cell] > div > input,
              .sheet-table td[data-cell] > div > textarea,
              .sheet-table td[data-cell] > div > select {
                margin: 0 !important;
              }
              .sheet-table td[data-cell] > div.relative > * {
                height: 26px !important;
              }
              .sheet-table td[data-cell].sheet-cell-selected {
                background-color: rgba(59,130,246,0.12);
              }
              .sheet-table td[data-cell].sheet-cell-active {
                box-shadow: inset 0 0 0 2px rgb(59,130,246);
                background-color: rgba(59,130,246,0.05);
                z-index: 5;
              }
              .sheet-table tbody tr:hover td[data-cell]:not(.sheet-cell-selected):not(.sheet-cell-active) {
                background-color: rgba(17,24,39,0.02);
              }
              /* "Not applicable" placeholder cell (e.g. per-product columns on a variant row). */
              .sheet-table td[data-cell].sheet-cell-na {
                background-image: repeating-linear-gradient(
                  45deg,
                  rgba(17,24,39,0.04) 0 4px,
                  transparent 4px 8px
                );
                cursor: not-allowed;
              }
              #sheet-fill-handle:hover { transform: scale(1.25); }
            `}</style>
            <table className="w-full sheet-table" style={{ minWidth: 1400 }}>
              <thead>
                <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                  {isColumnVisible("expand") && (
                  <th className="px-3 py-3 text-center align-middle" style={{ width: 40, minWidth: 40 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected
                      }}
                      onChange={toggleSelectAll}
                      title={allSelected ? "Deselect all" : "Select all"}
                      className="cursor-pointer"
                    />
                  </th>
                  )}
                  {isColumnVisible("image") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 72, minWidth: 72 }}
                  >
                    Featured image
                  </th>
                  )}
                  {isColumnVisible("image") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 56, minWidth: 56 }}
                  >
                    Image
                  </th>
                  )}
                  {isColumnVisible("title") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 200, minWidth: 180 }}
                  >
                    Title
                  </th>
                  )}
                  {isColumnVisible("title") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 160, minWidth: 150 }}
                  >
                    Variant
                  </th>
                  )}
                  {isColumnVisible("status") && (
                  <th
                    className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                    style={{ width: 130, minWidth: 130 }}
                  >
                    Status
                  </th>
                  )}
                  {deeplConfig?.enabled &&
                    (deeplConfig.targetLangs?.length ?? 0) > 0 && (
                    <th
                      className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                      style={{ width: 128, minWidth: 128 }}
                    >
                      <span className="block">Auto-translate</span>
                      <Text
                        size="xsmall"
                        className="block font-normal text-ui-fg-muted"
                      >
                        (per language, on save)
                      </Text>
                    </th>
                  )}
                  {(() => {
                    const thMap: Record<string, React.ReactNode> = {}
                    const th = (id: string, label: string, style: React.CSSProperties) => {
                      // Derive explicit width so `table-layout: fixed` respects it
                      const width =
                        typeof style.width === "number" ? style.width :
                        typeof style.minWidth === "number" ? style.minWidth : 140
                      return (thMap[id] = (
                        <th
                          key={id}
                          draggable
                          onDragStart={(e) => {
                            colDragSrcRef.current = id
                            e.dataTransfer.effectAllowed = "move"
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault()
                            const src = colDragSrcRef.current
                            if (src && src !== id) moveColumn(src, id)
                            colDragSrcRef.current = null
                          }}
                          className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted cursor-grab"
                          style={{ ...style, width }}
                          title={`Drag to reorder — ${label}`}
                        >
                          {label}
                        </th>
                      ))
                    }
                    if (isColumnVisible("subtitle")) th("subtitle", "Subtitle", { minWidth: 150 })
                    if (isColumnVisible("description")) th("description", "Description", { minWidth: 180, maxWidth: 260, width: 200 })
                    if (isColumnVisible("handle")) th("handle", "Handle", { minWidth: 150 })
                    if (isColumnVisible("category")) th("category", "Category", { minWidth: 200 })
                    if (isColumnVisible("collection")) th("collection", "Collection", { minWidth: 180 })
                    if (isColumnVisible("salesChannels")) th("salesChannels", "Sales channels", { minWidth: 180 })
                    if (isColumnVisible("sku")) th("sku", "SKU", { minWidth: 150 })
                    if (isColumnVisible("basePrice")) th("basePrice", "Base price", { minWidth: 100 })
                    if (isColumnVisible("salePrice")) th("salePrice", "Sale price", { minWidth: 100 })
                    if (isColumnVisible("b2bDiscount")) th("b2bDiscount", "B2B discount", { minWidth: 100 })
                    if (isColumnVisible("clientA")) th("clientA", "Client A", { minWidth: 90 })
                    if (isColumnVisible("clientB")) th("clientB", "Client B", { minWidth: 90 })
                    if (isColumnVisible("clientC")) th("clientC", "Client C", { minWidth: 90 })
                    if (isColumnVisible("clientD")) th("clientD", "Client D", { minWidth: 90 })
                    if (isColumnVisible("stockQty")) th("stockQty", "Stock qty", { minWidth: 90 })
                    if (isColumnVisible("tags")) th("tags", "Tags", { minWidth: 170 })
                    if (isColumnVisible("material")) th("material", "Material", { minWidth: 120 })
                    if (isColumnVisible("weight")) th("weight", "Weight (g)", { minWidth: 100 })
                    if (isColumnVisible("width")) th("width", "Width", { minWidth: 80 })
                    if (isColumnVisible("height")) th("height", "Height", { minWidth: 80 })
                    if (isColumnVisible("color")) th("color", "Color", { minWidth: 90 })
                    return columnOrder
                      .filter((id) => thMap[id])
                      .map((id) => thMap[id])
                  })()}
                  {customColumns.map((cc) =>
                    isColumnVisible(cc.id) ? (
                      <th
                        key={cc.id}
                        className="px-3 py-3 text-left txt-compact-small-plus text-ui-fg-muted"
                        style={{ width: 140, minWidth: 120 }}
                      >
                        {cc.label}
                      </th>
                    ) : null
                  )}
                  {isColumnVisible("changed") && (
                  <th
                    className="px-3 py-3"
                    style={{ width: 100, minWidth: 90 }}
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
                      {/* ── Product-only row (shown only for products with NO variants) ── */}
                      {row.variants.length === 0 && (
                      <tr
                        className={isDirty ? "bg-ui-bg-highlight" : ""}
                      >
                        {isColumnVisible("expand") && (
                        <td tabIndex={-1} data-cell="" className="px-3 py-2 text-center align-middle">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            onChange={() => toggleSelect(row.id)}
                            title="Select product"
                            className="cursor-pointer"
                          />
                        </td>
                        )}
                        {isColumnVisible("image") && (
                        <td tabIndex={-1} data-cell="" className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {row.thumbnail ? (
                              <img
                                src={row.thumbnail}
                                alt=""
                                className="w-9 h-9 rounded border border-ui-border-base object-cover"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded border border-ui-border-base bg-ui-bg-subtle" />
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                openImageModalForProduct(row.id)
                              }}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base"
                              title="Edit featured image"
                            >
                              <PencilSquare className="size-3.5" />
                            </button>
                          </div>
                        </td>
                        )}
                        {isColumnVisible("image") && (
                        <td tabIndex={-1} data-cell="" className="px-3 py-2 sheet-cell-na" />
                        )}
                        {isColumnVisible("title") && (
                        <td tabIndex={-1} data-cell="" className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={row.title}
                              onChange={(e) =>
                                updateRow(row.id, "title", e.target.value)
                              }
                              placeholder="Title"
                              className={cellInput}
                              style={{ flex: 1 }}
                            />
                            <button
                              type="button"
                              title="Add variant"
                              onClick={() => openCreateVariant(row.id)}
                              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ui-border-base text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base font-bold"
                            >
                              +
                            </button>
                          </div>
                          {rowError && (
                            <p className="mt-1 txt-small text-ui-fg-error">
                              {rowError}
                            </p>
                          )}
                        </td>
                        )}
                        {isColumnVisible("title") && (
                        <td tabIndex={-1} data-cell="" className="px-3 py-2 sheet-cell-na" />
                        )}
                        {isColumnVisible("status") && (
                        <td tabIndex={-1} data-cell="" className="px-3 py-2">
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
                        {deeplConfig?.enabled &&
                          (deeplConfig.targetLangs?.length ?? 0) > 0 && (
                          <td tabIndex={-1} data-cell="" className="px-3 py-2 align-top">
                            <div className="flex flex-col gap-1.5">
                              {(deeplConfig.targetLangs ?? []).map((loc) => {
                                const norm = normalizeLocaleKeyClient(loc)
                                const autos =
                                  parseAutoTranslateLocalesFromMetadata(
                                    row.metadata
                                  )
                                const busyKey = `${row.id}:${norm}`
                                return (
                                  <label
                                    key={`${row.id}:${loc}`}
                                    className="flex cursor-pointer items-center gap-2"
                                  >
                                    <Checkbox
                                      checked={autos.has(norm)}
                                      disabled={!!i18nLocaleToggleBusy[busyKey]}
                                      onCheckedChange={(v) => {
                                        if (v === "indeterminate") return
                                        void handleBulkI18nLocaleAuto(
                                          row.id,
                                          loc,
                                          v === true
                                        )
                                      }}
                                    />
                                    <Text
                                      size="xsmall"
                                      className="w-8 shrink-0 text-ui-fg-subtle"
                                    >
                                      {loc.trim().toUpperCase()}
                                    </Text>
                                  </label>
                                )
                              })}
                            </div>
                          </td>
                        )}
                        {(() => {
                          const cellMap: Record<string, React.ReactNode> = {}
                          if (isColumnVisible("subtitle")) cellMap.subtitle = (
                            <td key="subtitle" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input
                                type="text"
                                value={row.subtitle}
                                onChange={(e) => updateRow(row.id, "subtitle", e.target.value)}
                                placeholder="Subtitle"
                                className={cellInput}
                              />
                            </td>
                          )
                          if (isColumnVisible("description")) cellMap.description = (
                            <td key="description" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <div className="flex h-8 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate txt-small text-ui-fg-base">
                                  {stripForPreview(row.description, 180) || (
                                    <span className="text-ui-fg-muted">—</span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  title="Edit rich-text description"
                                  onClick={() =>
                                    openRichTextEdit(row.id, {
                                      title: row.title,
                                      subtitle: row.subtitle,
                                      description: row.description,
                                    })
                                  }
                                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ui-border-base text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base"
                                >
                                  <PencilSquare className="size-3.5" />
                                </button>
                              </div>
                            </td>
                          )
                          if (isColumnVisible("handle")) cellMap.handle = (
                            <td key="handle" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <Input value={row.handle} onChange={(e) => updateRow(row.id, "handle", e.target.value)} placeholder="product-handle" />
                            </td>
                          )
                          if (isColumnVisible("category")) cellMap.category = (
                            <td key="category" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <DropdownMenu onOpenChange={(open) => open && setFilterSearch("")}>
                                <DropdownMenu.Trigger asChild>
                                  <button type="button" className={`${cellInput} text-left flex items-center justify-between gap-2`}>
                                    <span className="truncate">
                                      {row.category_ids.length > 0
                                        ? row.category_ids
                                            .map((id) => categoryBreadcrumbById.get(id) ?? (categoriesData as any)?.product_categories?.find((x: any) => x.id === id)?.name ?? id)
                                            .join(", ")
                                        : "—"}
                                    </span>
                                    <ChevronDown className="shrink-0" />
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content className="w-[320px]">
                                  <div className="p-3 flex flex-col gap-2">
                                    <Input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search categories" />
                                    <div className="max-h-[260px] overflow-auto">
                                      {hierarchicalCategories
                                        .filter((c) => c.breadcrumb.toLowerCase().includes(filterSearch.toLowerCase().trim()))
                                        .map((c) => {
                                          const checked = row.category_ids.includes(c.id)
                                          return (
                                            <DropdownMenu.Item key={c.id} asChild onSelect={(e) => {
                                              e.preventDefault()
                                              const next = checked
                                                ? row.category_ids.filter((id) => id !== c.id)
                                                : Array.from(new Set([...row.category_ids, c.id]))
                                              updateRow(row.id, "category_ids", next)
                                            }}>
                                              <CategoryMenuCheckboxRow checked={checked} depth={c.depth} breadcrumb={c.breadcrumb} name={c.name} />
                                            </DropdownMenu.Item>
                                          )
                                        })}
                                    </div>
                                  </div>
                                </DropdownMenu.Content>
                              </DropdownMenu>
                            </td>
                          )
                          if (isColumnVisible("collection")) cellMap.collection = (
                            <td key="collection" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <select value={row.collection_id ?? ""} onChange={(e) => updateRow(row.id, "collection_id", e.target.value || null)} className={cellInput}>
                                <option value="">—</option>
                                {((collectionsData as any)?.collections ?? []).map((c: { id: string; title?: string }) => (
                                  <option key={c.id} value={c.id}>{c.title ?? c.id}</option>
                                ))}
                              </select>
                            </td>
                          )
                          if (isColumnVisible("salesChannels")) cellMap.salesChannels = (
                            <td key="salesChannels" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <DropdownMenu onOpenChange={(open) => open && setFilterSearch("")}>
                                <DropdownMenu.Trigger asChild>
                                  <button type="button" className={`${cellInput} text-left flex items-center justify-between gap-2`}>
                                    <span className="truncate">
                                      {row.sales_channel_ids.length > 0
                                        ? row.sales_channel_ids.map((id) => ((channelsData as any)?.sales_channels ?? []).find((c: { id: string }) => c.id === id)?.name ?? id).join(", ")
                                        : "—"}
                                    </span>
                                    <ChevronDown className="shrink-0" />
                                  </button>
                                </DropdownMenu.Trigger>
                                <DropdownMenu.Content className="w-[280px]">
                                  <div className="max-h-[260px] overflow-auto p-2">
                                    {((channelsData as any)?.sales_channels ?? []).map((c: { id: string; name?: string }) => {
                                      const checked = row.sales_channel_ids.includes(c.id)
                                      return (
                                        <DropdownMenu.CheckboxItem key={c.id} checked={checked} onCheckedChange={(v) => {
                                          const next = v === true
                                            ? Array.from(new Set([...row.sales_channel_ids, c.id]))
                                            : row.sales_channel_ids.filter((id) => id !== c.id)
                                          updateRow(row.id, "sales_channel_ids", next)
                                        }}>{c.name ?? c.id}</DropdownMenu.CheckboxItem>
                                      )
                                    })}
                                  </div>
                                </DropdownMenu.Content>
                              </DropdownMenu>
                            </td>
                          )
                          if (isColumnVisible("sku")) cellMap.sku = (
                            <td key="sku" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value="—" disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("basePrice")) cellMap.basePrice = (
                            <td key="basePrice" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={row.variants[0]?.prices[0]?.amount ?? "—"} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("salePrice")) cellMap.salePrice = (
                            <td key="salePrice" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={row.variants[0]?.sale_price_amount ?? "—"} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("b2bDiscount")) cellMap.b2bDiscount = (
                            <td key="b2bDiscount" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <Input value={getMeta(row.metadata, B2B_DISCOUNT_META_KEY)} onChange={(e) => updateProductMetadata(row.id, B2B_DISCOUNT_META_KEY, e.target.value || null)} placeholder="e.g. 10 or 10%" />
                            </td>
                          )
                          if (isColumnVisible("clientA")) cellMap.clientA = (
                            <td key="clientA" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={getVariantPriceRange(row.variants, "wcwp_client-a")} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("clientB")) cellMap.clientB = (
                            <td key="clientB" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={getVariantPriceRange(row.variants, "wcwp_client-b")} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("clientC")) cellMap.clientC = (
                            <td key="clientC" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={getVariantPriceRange(row.variants, "wcwp_client-c")} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("clientD")) cellMap.clientD = (
                            <td key="clientD" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={getVariantPriceRange(row.variants, "wcwp_client-d")} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("stockQty")) cellMap.stockQty = (
                            <td key="stockQty" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value={String(row.variants.reduce((sum, v) => sum + (v.inventory_quantity ?? 0), 0))} disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          if (isColumnVisible("tags")) cellMap.tags = (
                            <td key="tags" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <Input value={row.tags} onChange={(e) => updateRow(row.id, "tags", e.target.value)} placeholder="tag1, tag2" />
                            </td>
                          )
                          if (isColumnVisible("material")) cellMap.material = (
                            <td key="material" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <Input value={row.material} onChange={(e) => updateRow(row.id, "material", e.target.value)} placeholder="e.g. Cotton" />
                            </td>
                          )
                          if (isColumnVisible("weight")) cellMap.weight = (
                            <td key="weight" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="number" min={0} value={row.weight} onChange={(e) => updateRow(row.id, "weight", e.target.value)} placeholder="0" className={cellInput} />
                            </td>
                          )
                          if (isColumnVisible("width")) cellMap.width = (
                            <td key="width" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="number" min={0} value={row.width} onChange={(e) => updateRow(row.id, "width", e.target.value)} placeholder="0" className={cellInput} />
                            </td>
                          )
                          if (isColumnVisible("height")) cellMap.height = (
                            <td key="height" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="number" min={0} value={row.height} onChange={(e) => updateRow(row.id, "height", e.target.value)} placeholder="0" className={cellInput} />
                            </td>
                          )
                          if (isColumnVisible("color")) cellMap.color = (
                            <td key="color" tabIndex={-1} data-cell="" className="px-3 py-2">
                              <input type="text" value="" disabled className={`${cellInput} bg-ui-bg-subtle cursor-not-allowed opacity-70`} />
                            </td>
                          )
                          return columnOrder.filter((id) => cellMap[id]).map((id) => cellMap[id])
                        })()}
                        {customColumns.map((cc) =>
                          isColumnVisible(cc.id) ? (
                            <td tabIndex={-1} data-cell="" key={cc.id} className="px-3 py-2">
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
                        <td tabIndex={-1} data-cell="" className="px-3 py-2 text-right">
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
                      )}

                      {/* ── Variant rows (merged: first row carries product-level settings) ── */}
                      {row.variants.map((variant, vIdx) => {
                          const isFirst = vIdx === 0
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
                              className={vDirty ? "bg-ui-bg-highlight" : ""}
                            >
                              {isColumnVisible("expand") && (
                              <td tabIndex={-1} data-cell="" className="px-3 py-2 text-center align-middle">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(variant.id)}
                                  onChange={() => toggleSelect(variant.id)}
                                  title="Select variant"
                                  className="cursor-pointer"
                                />
                              </td>
                              )}
                              {isColumnVisible("image") && (
                              <td
                                tabIndex={-1}
                                data-cell=""
                                className={`px-3 py-2 ${isFirst ? "" : "sheet-cell-na"}`}
                              >
                                {isFirst && (
                                  <div className="flex items-center gap-1.5">
                                    {row.thumbnail ? (
                                      <img
                                        src={row.thumbnail}
                                        alt=""
                                        className="w-8 h-8 rounded border border-ui-border-base object-cover"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 rounded border border-ui-border-base bg-ui-bg-base" />
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        openImageModalForProduct(row.id)
                                      }}
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base"
                                      title="Edit featured image"
                                    >
                                      <PencilSquare className="size-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                              )}
                              {isColumnVisible("image") && (
                              <td tabIndex={-1} data-cell="" className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  {variant.thumbnail ? (
                                    <img
                                      src={variant.thumbnail}
                                      alt=""
                                      className="w-8 h-8 rounded border border-ui-border-base object-cover"
                                    />
                                  ) : (
                                    <div className="w-8 h-8 rounded border border-ui-border-base bg-ui-bg-base" />
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openImageModalForVariant(row.id, variant.id)
                                    }}
                                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base"
                                    title="Edit variant media"
                                  >
                                    <PencilSquare className="size-3.5" />
                                  </button>
                                </div>
                              </td>
                              )}
                              {isColumnVisible("title") && (
                              <td
                                tabIndex={-1}
                                data-cell=""
                                className={`px-3 py-2 ${isFirst ? "" : "sheet-cell-na"}`}
                              >
                                {isFirst && (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={row.title}
                                      onChange={(e) =>
                                        updateRow(row.id, "title", e.target.value)
                                      }
                                      placeholder="Title"
                                      className={cellInput}
                                      style={{ flex: 1 }}
                                    />
                                    <button
                                      type="button"
                                      title="Add variant"
                                      onClick={() => openCreateVariant(row.id)}
                                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ui-border-base text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base font-bold"
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                                {isFirst && rowError && (
                                  <p className="mt-1 txt-small text-ui-fg-error">
                                    {rowError}
                                  </p>
                                )}
                              </td>
                              )}
                              {isColumnVisible("title") && (
                              <td tabIndex={-1} data-cell="" className="px-3 py-2">
                                <input
                                  type="text"
                                  value={variant.title}
                                  onChange={(e) =>
                                    updateVariantTitle(row.id, variant.id, e.target.value)
                                  }
                                  placeholder="Variant name"
                                  className={cellInput}
                                />
                              </td>
                              )}
                              {isColumnVisible("status") && (
                              <td
                                tabIndex={-1}
                                data-cell=""
                                className={`px-3 py-2 ${isFirst ? "" : "sheet-cell-na"}`}
                              >
                                {isFirst && (
                                  <select
                                    value={row.status}
                                    onChange={(e) =>
                                      updateRow(
                                        row.id,
                                        "status",
                                        e.target.value
                                      )
                                    }
                                    className={cellInput}
                                  >
                                    <option value="draft">Draft</option>
                                    <option value="proposed">Proposed</option>
                                    <option value="published">Published</option>
                                    <option value="rejected">Rejected</option>
                                  </select>
                                )}
                              </td>
                              )}
                              {deeplConfig?.enabled &&
                                (deeplConfig.targetLangs?.length ?? 0) > 0 && (
                                <td
                                  tabIndex={-1}
                                  data-cell=""
                                  aria-disabled={!isFirst}
                                  className={`px-3 py-2 align-top ${isFirst ? "" : "sheet-cell-na"}`}
                                >
                                  {isFirst && (
                                    <div className="flex flex-col gap-1.5">
                                      {(deeplConfig.targetLangs ?? []).map(
                                        (loc) => {
                                          const norm =
                                            normalizeLocaleKeyClient(loc)
                                          const autos =
                                            parseAutoTranslateLocalesFromMetadata(
                                              row.metadata
                                            )
                                          const busyKey = `${row.id}:${norm}`
                                          return (
                                            <label
                                              key={`${row.id}:${loc}`}
                                              className="flex cursor-pointer items-center gap-2"
                                            >
                                              <Checkbox
                                                checked={autos.has(norm)}
                                                disabled={
                                                  !!i18nLocaleToggleBusy[
                                                    busyKey
                                                  ]
                                                }
                                                onCheckedChange={(v) => {
                                                  if (v === "indeterminate")
                                                    return
                                                  void handleBulkI18nLocaleAuto(
                                                    row.id,
                                                    loc,
                                                    v === true
                                                  )
                                                }}
                                              />
                                              <Text
                                                size="xsmall"
                                                className="w-8 shrink-0 text-ui-fg-subtle"
                                              >
                                                {loc.trim().toUpperCase()}
                                              </Text>
                                            </label>
                                          )
                                        }
                                      )}
                                    </div>
                                  )}
                                </td>
                              )}
                              {(() => {
                                const naClass = `px-3 py-2 ${isFirst ? "" : "sheet-cell-na"}`
                                const plainClass = "px-3 py-2"
                                const cm: Record<string, React.ReactNode> = {}
                                if (isColumnVisible("subtitle")) cm.subtitle = (
                                  <td key="subtitle" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <input type="text" value={row.subtitle} onChange={(e) => updateRow(row.id, "subtitle", e.target.value)} placeholder="Subtitle" className={cellInput} />
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("description")) cm.description = (
                                  <td key="description" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <div className="flex h-8 items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate txt-small text-ui-fg-base">
                                          {stripForPreview(row.description, 180) || (<span className="text-ui-fg-muted">—</span>)}
                                        </span>
                                        <button type="button" title="Edit rich-text description" onClick={() => openRichTextEdit(row.id, { title: row.title, subtitle: row.subtitle, description: row.description })} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-ui-border-base text-ui-fg-muted hover:bg-ui-bg-base-hover hover:text-ui-fg-base">
                                          <PencilSquare className="size-3.5" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("handle")) cm.handle = (
                                  <td key="handle" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <input type="text" value={row.handle} onChange={(e) => updateRow(row.id, "handle", e.target.value)} placeholder="product-handle" className={cellInput} />
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("category")) cm.category = (
                                  <td key="category" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <DropdownMenu onOpenChange={(open) => open && setFilterSearch("")}>
                                        <DropdownMenu.Trigger asChild>
                                          <button type="button" className={`${cellInput} text-left flex items-center justify-between gap-2`}>
                                            <span className="truncate">{row.category_ids.length > 0 ? categoryLabel : "—"}</span>
                                            <ChevronDown className="shrink-0" />
                                          </button>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content className="w-[320px]">
                                          <div className="p-3 flex flex-col gap-2">
                                            <Input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search categories" />
                                            <div className="max-h-[260px] overflow-auto">
                                              {hierarchicalCategories.filter((c) => c.breadcrumb.toLowerCase().includes(filterSearch.toLowerCase().trim())).map((c) => {
                                                const checked = row.category_ids.includes(c.id)
                                                return (
                                                  <DropdownMenu.Item key={c.id} asChild onSelect={(e) => {
                                                    e.preventDefault()
                                                    const next = checked ? row.category_ids.filter((id) => id !== c.id) : Array.from(new Set([...row.category_ids, c.id]))
                                                    updateRow(row.id, "category_ids", next)
                                                  }}>
                                                    <CategoryMenuCheckboxRow checked={checked} depth={c.depth} breadcrumb={c.breadcrumb} name={c.name} />
                                                  </DropdownMenu.Item>
                                                )
                                              })}
                                            </div>
                                          </div>
                                        </DropdownMenu.Content>
                                      </DropdownMenu>
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("collection")) cm.collection = (
                                  <td key="collection" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <select value={row.collection_id ?? ""} onChange={(e) => updateRow(row.id, "collection_id", e.target.value || null)} className={cellInput}>
                                        <option value="">—</option>
                                        {((collectionsData as any)?.collections ?? []).map((c: { id: string; title?: string }) => (
                                          <option key={c.id} value={c.id}>{c.title ?? c.id}</option>
                                        ))}
                                      </select>
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("salesChannels")) cm.salesChannels = (
                                  <td key="salesChannels" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <DropdownMenu onOpenChange={(open) => open && setFilterSearch("")}>
                                        <DropdownMenu.Trigger asChild>
                                          <button type="button" className={`${cellInput} text-left flex items-center justify-between gap-2`}>
                                            <span className="truncate">
                                              {row.sales_channel_ids.length > 0
                                                ? row.sales_channel_ids.map((id) => ((channelsData as any)?.sales_channels ?? []).find((c: { id: string }) => c.id === id)?.name ?? id).join(", ")
                                                : "—"}
                                            </span>
                                            <ChevronDown className="shrink-0" />
                                          </button>
                                        </DropdownMenu.Trigger>
                                        <DropdownMenu.Content className="w-[280px]">
                                          <div className="max-h-[260px] overflow-auto p-2">
                                            {((channelsData as any)?.sales_channels ?? []).map((c: { id: string; name?: string }) => {
                                              const checked = row.sales_channel_ids.includes(c.id)
                                              return (
                                                <DropdownMenu.CheckboxItem key={c.id} checked={checked} onCheckedChange={(v) => {
                                                  const next = v === true
                                                    ? Array.from(new Set([...row.sales_channel_ids, c.id]))
                                                    : row.sales_channel_ids.filter((id) => id !== c.id)
                                                  updateRow(row.id, "sales_channel_ids", next)
                                                }}>{c.name ?? c.id}</DropdownMenu.CheckboxItem>
                                              )
                                            })}
                                          </div>
                                        </DropdownMenu.Content>
                                      </DropdownMenu>
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("sku")) cm.sku = (
                                  <td key="sku" tabIndex={-1} data-cell="" className={plainClass}>
                                    <Input value={variant.sku} onChange={(e) => updateVariantSku(row.id, variant.id, e.target.value)} placeholder="SKU-001" />
                                  </td>
                                )
                                if (isColumnVisible("basePrice")) cm.basePrice = (
                                  <td key="basePrice" tabIndex={-1} data-cell="" className={plainClass}>
                                    {variant.prices[0] ? (
                                      <input type="number" min={0} step="0.01" value={variant.prices[0].amount} onChange={(e) => updateVariantPrice(row.id, variant.id, variant.prices[0].currency_code, e.target.value)} placeholder="0.00" className={cellInput} />
                                    ) : (
                                      <Text size="small" className="text-ui-fg-muted px-3">—</Text>
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("salePrice")) {
                                  cm.salePrice = SALE_PRICE_LIST_ID ? (
                                    <td key="salePrice" tabIndex={-1} data-cell="" className={plainClass}>
                                      <input type="number" min={0} step="0.01" value={variant.sale_price_amount} onChange={(e) => updateVariantSalePrice(row.id, variant.id, e.target.value)} placeholder="0.00" className={cellInput} />
                                    </td>
                                  ) : (
                                    <td key="salePrice" tabIndex={-1} data-cell="" className={plainClass}>
                                      <input type="number" min={0} step="0.01" value={getMeta(variant.metadata, "sale_price")} onChange={(e) => {
                                        const val = e.target.value.trim()
                                        updateVariantMetadata(row.id, variant.id, "sale_price", val ? (Number.isFinite(Number(val)) ? Number(val) : val) : null)
                                      }} placeholder="0.00" className={cellInput} />
                                    </td>
                                  )
                                }
                                if (isColumnVisible("b2bDiscount")) cm.b2bDiscount = (
                                  <td key="b2bDiscount" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (
                                      <Input size="small" value={getMeta(row.metadata, B2B_DISCOUNT_META_KEY)} onChange={(e) => updateProductMetadata(row.id, B2B_DISCOUNT_META_KEY, e.target.value || null)} placeholder="e.g. 10 or 10%" />
                                    )}
                                  </td>
                                )
                                if (isColumnVisible("clientA")) cm.clientA = (
                                  <td key="clientA" tabIndex={-1} data-cell="" className={plainClass}>
                                    <Input size="small" value={getMeta(variant.metadata, "wcwp_client-a")} onChange={(e) => updateVariantMetadata(row.id, variant.id, "wcwp_client-a", e.target.value || null)} placeholder="—" />
                                  </td>
                                )
                                if (isColumnVisible("clientB")) cm.clientB = (
                                  <td key="clientB" tabIndex={-1} data-cell="" className={plainClass}>
                                    <Input size="small" value={getMeta(variant.metadata, "wcwp_client-b")} onChange={(e) => updateVariantMetadata(row.id, variant.id, "wcwp_client-b", e.target.value || null)} placeholder="—" />
                                  </td>
                                )
                                if (isColumnVisible("clientC")) cm.clientC = (
                                  <td key="clientC" tabIndex={-1} data-cell="" className={plainClass}>
                                    <Input size="small" value={getMeta(variant.metadata, "wcwp_client-c")} onChange={(e) => updateVariantMetadata(row.id, variant.id, "wcwp_client-c", e.target.value || null)} placeholder="—" />
                                  </td>
                                )
                                if (isColumnVisible("clientD")) cm.clientD = (
                                  <td key="clientD" tabIndex={-1} data-cell="" className={plainClass}>
                                    <Input size="small" value={getMeta(variant.metadata, "wcwp_client-d")} onChange={(e) => updateVariantMetadata(row.id, variant.id, "wcwp_client-d", e.target.value || null)} placeholder="—" />
                                  </td>
                                )
                                if (isColumnVisible("stockQty")) cm.stockQty = (
                                  <td key="stockQty" tabIndex={-1} data-cell="" className={plainClass}>
                                    <input type="text" value={variant.manage_inventory && variant.inventory_quantity !== null ? String(variant.inventory_quantity) : "-"} onChange={(e) => {
                                      const val = e.target.value.trim()
                                      if (val === "-" || val === "") {
                                        updateVariantManageInventory(row.id, variant.id, false)
                                        updateVariantInventoryQuantity(row.id, variant.id, null)
                                      } else {
                                        const num = Math.max(0, Math.floor(Number(val)))
                                        if (!variant.manage_inventory) updateVariantManageInventory(row.id, variant.id, true)
                                        updateVariantInventoryQuantity(row.id, variant.id, Number.isFinite(num) ? num : variant.inventory_quantity ?? null)
                                      }
                                    }} placeholder="-" className={cellInput} />
                                  </td>
                                )
                                if (isColumnVisible("tags")) cm.tags = (
                                  <td key="tags" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (<input type="text" value={row.tags} onChange={(e) => updateRow(row.id, "tags", e.target.value)} placeholder="tag1, tag2" className={cellInput} />)}
                                  </td>
                                )
                                if (isColumnVisible("material")) cm.material = (
                                  <td key="material" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (<input type="text" value={row.material} onChange={(e) => updateRow(row.id, "material", e.target.value)} placeholder="e.g. Cotton" className={cellInput} />)}
                                  </td>
                                )
                                if (isColumnVisible("weight")) cm.weight = (
                                  <td key="weight" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (<input type="text" value={row.weight} onChange={(e) => updateRow(row.id, "weight", e.target.value)} placeholder="0" className={cellInput} />)}
                                  </td>
                                )
                                if (isColumnVisible("width")) cm.width = (
                                  <td key="width" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (<input type="text" value={row.width} onChange={(e) => updateRow(row.id, "width", e.target.value)} placeholder="0" className={cellInput} />)}
                                  </td>
                                )
                                if (isColumnVisible("height")) cm.height = (
                                  <td key="height" tabIndex={-1} data-cell="" className={naClass}>
                                    {isFirst && (<input type="text" value={row.height} onChange={(e) => updateRow(row.id, "height", e.target.value)} placeholder="0" className={cellInput} />)}
                                  </td>
                                )
                                if (isColumnVisible("color")) cm.color = (
                                  <td key="color" tabIndex={-1} data-cell="" className={plainClass}>
                                    <div className="flex items-center gap-1">
                                      <input type="color" value={getMeta(variant.metadata, "color_hex") || "#000000"} onChange={(e) => updateVariantMetadata(row.id, variant.id, "color_hex", e.target.value)} className="w-8 h-8 rounded border border-ui-border-base cursor-pointer p-0" title="Color" />
                                      <Input size="small" value={getMeta(variant.metadata, "color_hex")} onChange={(e) => updateVariantMetadata(row.id, variant.id, "color_hex", e.target.value || null)} placeholder="#hex" className="w-20" />
                                    </div>
                                  </td>
                                )
                                return columnOrder.filter((id) => cm[id]).map((id) => cm[id])
                              })()}
                              {customColumns.map((cc) =>
                                isColumnVisible(cc.id) ? (
                                  <td tabIndex={-1} data-cell="" key={cc.id} className="px-3 py-2">
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
                              <td tabIndex={-1} data-cell="" className="px-3 py-2 text-right">
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
          </>
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
                  Edit description
                </FocusModal.Title>
              </FocusModal.Header>
              <FocusModal.Body className="min-h-0 flex-1 overflow-y-auto p-4">
                <SimpleMarkdownEditor
                  key={`${richTextEdit.productId}-description`}
                  id={`rte-${richTextEdit.productId}-description`}
                  value={richTextEdit.draftDescription}
                  onChange={(v) =>
                    setRichTextDraftField("draftDescription", v)
                  }
                  placeholder="Product description…"
                  minHeight={360}
                />
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
