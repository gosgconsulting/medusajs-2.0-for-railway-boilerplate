import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNavigate, Link } from "react-router-dom"
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
import { ChevronLeft, Minus, Plus, Trash, XMark } from "@medusajs/icons"
import { sdk } from "../../../lib/sdk"

// ─── Types ────────────────────────────────────────────────────────────────────

type AddressForm = {
  first_name: string
  last_name: string
  address_1: string
  address_2: string
  city: string
  province: string
  postal_code: string
  country_code: string
  phone: string
}

type LineItem = {
  /** undefined for custom items */
  variant_id?: string
  title: string
  variant_title?: string
  thumbnail?: string | null
  quantity: number
  /** unit price in display units (e.g. dollars). undefined = use variant price */
  unit_price?: number
}

type WizardState = {
  // Step 1
  region_id: string
  sales_channel_id: string
  use_existing_customer: boolean
  customer_id: string
  email: string
  no_notification_order: boolean
  // Step 2
  items: LineItem[]
  // Step 3
  shipping_address: AddressForm
  same_billing: boolean
  billing_address: AddressForm
  shipping_option_id: string
}

const EMPTY_ADDRESS: AddressForm = {
  first_name: "",
  last_name: "",
  address_1: "",
  address_2: "",
  city: "",
  province: "",
  postal_code: "",
  country_code: "",
  phone: "",
}

const INITIAL_STATE: WizardState = {
  region_id: "",
  sales_channel_id: "",
  use_existing_customer: true,
  customer_id: "",
  email: "",
  no_notification_order: false,
  items: [],
  shipping_address: { ...EMPTY_ADDRESS },
  same_billing: true,
  billing_address: { ...EMPTY_ADDRESS },
  shipping_option_id: "",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fieldInput =
  "flex h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 txt-small focus:border-ui-border-interactive focus:outline-none placeholder:text-ui-fg-muted"

const selectInput =
  "flex h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 txt-small focus:border-ui-border-interactive focus:outline-none text-ui-fg-base"

function formatPrice(amount: number | undefined, currencyCode?: string): string {
  if (amount == null) return "—"
  const display = (amount / 100).toFixed(2)
  return currencyCode
    ? `${currencyCode.toUpperCase()} ${display}`
    : display
}

function getFirstPrice(
  variant: { prices?: { amount?: number; currency_code?: string }[] | null }
) {
  return variant.prices?.[0]
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type StepIndicatorProps = { current: number; total: number; labels: string[] }

function StepIndicator({ current, total, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-0">
      {Array.from({ length: total }).map((_, i) => {
        const active = i + 1 === current
        const done = i + 1 < current
        return (
          <React.Fragment key={i}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center txt-compact-small-plus transition-colors",
                  active
                    ? "bg-ui-button-inverted text-ui-fg-on-inverted"
                    : done
                    ? "bg-ui-tag-green-bg text-ui-tag-green-text border border-ui-tag-green-border"
                    : "bg-ui-bg-subtle text-ui-fg-muted border border-ui-border-base",
                ].join(" ")}
              >
                {done ? "✓" : i + 1}
              </div>
              <Text
                size="xsmall"
                className={
                  active ? "text-ui-fg-base font-medium" : "text-ui-fg-muted"
                }
              >
                {labels[i]}
              </Text>
            </div>
            {i < total - 1 && (
              <div
                className={[
                  "flex-1 h-px mx-2 mb-4 min-w-8",
                  done ? "bg-ui-tag-green-border" : "bg-ui-border-base",
                ].join(" ")}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Address form section ─────────────────────────────────────────────────────

type AddressFormProps = {
  value: AddressForm
  onChange: (field: keyof AddressForm, value: string) => void
  title?: string
}

function AddressFormSection({ value, onChange, title }: AddressFormProps) {
  return (
    <div className="flex flex-col gap-3">
      {title && (
        <Text className="txt-compact-small-plus text-ui-fg-subtle">{title}</Text>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
            First name
          </label>
          <Input
            value={value.first_name}
            onChange={(e) => onChange("first_name", e.target.value)}
            placeholder="Jane"
          />
        </div>
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
            Last name
          </label>
          <Input
            value={value.last_name}
            onChange={(e) => onChange("last_name", e.target.value)}
            placeholder="Doe"
          />
        </div>
      </div>
      <div>
        <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
          Address line 1
        </label>
        <Input
          value={value.address_1}
          onChange={(e) => onChange("address_1", e.target.value)}
          placeholder="123 Main Street"
        />
      </div>
      <div>
        <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
          Address line 2
        </label>
        <Input
          value={value.address_2}
          onChange={(e) => onChange("address_2", e.target.value)}
          placeholder="Apt 4B (optional)"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
            City
          </label>
          <Input
            value={value.city}
            onChange={(e) => onChange("city", e.target.value)}
            placeholder="New York"
          />
        </div>
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
            State / Province
          </label>
          <Input
            value={value.province}
            onChange={(e) => onChange("province", e.target.value)}
            placeholder="NY"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
            Postal code
          </label>
          <Input
            value={value.postal_code}
            onChange={(e) => onChange("postal_code", e.target.value)}
            placeholder="10001"
          />
        </div>
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
            Country code
          </label>
          <Input
            value={value.country_code}
            onChange={(e) =>
              onChange("country_code", e.target.value.toLowerCase())
            }
            placeholder="us"
          />
        </div>
      </div>
      <div>
        <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
          Phone
        </label>
        <Input
          value={value.phone}
          onChange={(e) => onChange("phone", e.target.value)}
          placeholder="+1 555 000 0000"
        />
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type ApiCustomer = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

type ApiVariant = {
  id: string
  title?: string | null
  sku?: string | null
  prices?: { id?: string; amount?: number; currency_code?: string }[] | null
}

type ApiProduct = {
  id: string
  title?: string | null
  thumbnail?: string | null
  variants?: ApiVariant[] | null
}

type ApiShippingOption = {
  id: string
  name?: string | null
  price_type?: string | null
  prices?: { amount?: number }[] | null
}

const STEPS = ["Customer", "Items", "Shipping", "Review"]

const CreateOrderPage = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1)
  const [state, setState] = useState<WizardState>(INITIAL_STATE)

  // customer search
  const [customerQuery, setCustomerQuery] = useState("")
  const debouncedCustomerQuery = useDebounce(customerQuery, 300)
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const customerRef = useRef<HTMLDivElement>(null)

  // product search
  const [productQuery, setProductQuery] = useState("")
  const debouncedProductQuery = useDebounce(productQuery, 300)

  // custom item form
  const [showCustomItem, setShowCustomItem] = useState(false)
  const [customTitle, setCustomTitle] = useState("")
  const [customPrice, setCustomPrice] = useState("")
  const [customQty, setCustomQty] = useState("1")

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: regionsData } = useQuery({
    queryKey: ["regions"],
    queryFn: () => sdk.admin.region.list({ limit: 100 }),
    staleTime: 60_000,
  })

  const { data: channelsData } = useQuery({
    queryKey: ["sales-channels"],
    queryFn: () => sdk.admin.salesChannel.list({ limit: 100 }),
    staleTime: 60_000,
  })

  const { data: customersData } = useQuery({
    queryKey: ["customers-search", debouncedCustomerQuery],
    queryFn: () =>
      sdk.admin.customer.list({
        q: debouncedCustomerQuery || undefined,
        limit: 8,
      } as Parameters<typeof sdk.admin.customer.list>[0]),
    enabled: state.use_existing_customer && customerDropdownOpen,
  })

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["products-search-order", debouncedProductQuery],
    queryFn: () =>
      sdk.admin.product.list({
        q: debouncedProductQuery || undefined,
        limit: 10,
        fields: "+variants,+variants.prices",
      } as Parameters<typeof sdk.admin.product.list>[0]),
    enabled: step === 2,
  })

  const {
    data: shippingOptionsData,
    isLoading: shippingLoading,
    isError: shippingError,
  } = useQuery({
    queryKey: ["shipping-options-order"],
    queryFn: () => sdk.admin.shippingOption.list({ limit: 200 }),
    staleTime: 60_000,
  })

  // close customer dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        customerRef.current &&
        !customerRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ── State updaters ─────────────────────────────────────────────────────────

  const set = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const setAddress = useCallback(
    (which: "shipping_address" | "billing_address") =>
      (field: keyof AddressForm, value: string) => {
        setState((prev) => ({
          ...prev,
          [which]: { ...prev[which], [field]: value },
        }))
      },
    []
  )

  // ── Item management ────────────────────────────────────────────────────────

  const addVariantItem = useCallback(
    (product: ApiProduct, variant: ApiVariant) => {
      setState((prev) => {
        const existing = prev.items.find(
          (i) => i.variant_id === variant.id
        )
        if (existing) {
          return {
            ...prev,
            items: prev.items.map((i) =>
              i.variant_id === variant.id
                ? { ...i, quantity: i.quantity + 1 }
                : i
            ),
          }
        }
        const price = getFirstPrice(variant)
        return {
          ...prev,
          items: [
            ...prev.items,
            {
              variant_id: variant.id,
              title: product.title ?? "Product",
              variant_title: variant.title ?? undefined,
              thumbnail: product.thumbnail,
              quantity: 1,
              unit_price: price?.amount,
            },
          ],
        }
      })
    },
    []
  )

  const addCustomItem = useCallback(() => {
    if (!customTitle.trim()) return
    setState((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          title: customTitle.trim(),
          quantity: Math.max(1, parseInt(customQty) || 1),
          unit_price: customPrice ? Math.round(Number(customPrice) * 100) : undefined,
        },
      ],
    }))
    setCustomTitle("")
    setCustomPrice("")
    setCustomQty("1")
    setShowCustomItem(false)
  }, [customTitle, customPrice, customQty])

  const updateItemQty = useCallback((index: number, delta: number) => {
    setState((prev) => {
      const items = prev.items.map((item, i) => {
        if (i !== index) return item
        return { ...item, quantity: Math.max(1, item.quantity + delta) }
      })
      return { ...prev, items }
    })
  }, [])

  const removeItem = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }))
  }, [])

  // ── Estimated total ────────────────────────────────────────────────────────

  const estimatedTotal = useMemo(() => {
    return state.items.reduce((sum, item) => {
      return sum + (item.unit_price ?? 0) * item.quantity
    }, 0)
  }, [state.items])

  // ── Validation per step ────────────────────────────────────────────────────

  const step1Valid = useMemo(() => {
    if (!state.region_id || !state.sales_channel_id) return false
    if (state.use_existing_customer) return !!state.customer_id
    return !!state.email.trim() && state.email.includes("@")
  }, [state])

  const step2Valid = state.items.length > 0

  const step3Valid = useMemo(() => {
    const a = state.shipping_address
    return (
      !!state.shipping_option_id &&
      !!a.first_name &&
      !!a.last_name &&
      !!a.address_1 &&
      !!a.city &&
      !!a.postal_code &&
      !!a.country_code
    )
  }, [state])

  // ── Mutations ──────────────────────────────────────────────────────────────

  const buildPayload = useCallback(() => {
    const addr = (a: AddressForm) => ({
      first_name: a.first_name,
      last_name: a.last_name,
      address_1: a.address_1,
      ...(a.address_2 ? { address_2: a.address_2 } : {}),
      city: a.city,
      ...(a.province ? { province: a.province } : {}),
      postal_code: a.postal_code,
      country_code: a.country_code,
      ...(a.phone ? { phone: a.phone } : {}),
    })

    return {
      region_id: state.region_id,
      sales_channel_id: state.sales_channel_id,
      ...(state.use_existing_customer
        ? { customer_id: state.customer_id }
        : { email: state.email }),
      no_notification_order: state.no_notification_order,
      shipping_address: addr(state.shipping_address),
      billing_address: state.same_billing
        ? addr(state.shipping_address)
        : addr(state.billing_address),
      items: state.items.map((item) => ({
        ...(item.variant_id ? { variant_id: item.variant_id } : {}),
        ...(item.unit_price != null ? { unit_price: item.unit_price } : {}),
        title: item.title,
        quantity: item.quantity,
      })),
      shipping_methods: state.shipping_option_id
        ? [{ shipping_option_id: state.shipping_option_id, name: "", amount: 0 }]
        : [],
    }
  }, [state])

  /** Enrich payload with shipping method name and amount from cached options (required by API). */
  const enrichPayloadWithShippingDetails = useCallback(
    (payload: ReturnType<typeof buildPayload>) => {
      if (!payload.shipping_methods?.length || !state.shipping_option_id) return payload
      const cached = queryClient.getQueryData<{
        shipping_options?: ApiShippingOption[]
      }>(["shipping-options-order"])
      const opt = cached?.shipping_options?.find(
        (o) => o.id === state.shipping_option_id
      )
      payload.shipping_methods = [
        {
          shipping_option_id: state.shipping_option_id,
          name: opt?.name ?? "Shipping",
          amount: opt?.prices?.[0]?.amount ?? 0,
        },
      ]
      return payload
    },
    [queryClient, state.shipping_option_id]
  )

  const { mutate: saveAsDraft, isPending: savingDraft } = useMutation({
    mutationFn: () => {
      const payload = enrichPayloadWithShippingDetails(buildPayload())
      return sdk.admin.draftOrder.create(
        payload as Parameters<typeof sdk.admin.draftOrder.create>[0]
      )
    },
    onSuccess: () => {
      toast.success("Draft order created successfully")
      navigate("/orders")
    },
    onError: (err: Error) => {
      toast.error(err?.message ?? "Failed to create draft order")
    },
  })

  const { mutate: createAndConfirm, isPending: confirming } = useMutation({
    mutationFn: async () => {
      const payload = enrichPayloadWithShippingDetails(buildPayload())
      const draft = await sdk.admin.draftOrder.create(
        payload as Parameters<typeof sdk.admin.draftOrder.create>[0]
      )
      const draftId = (draft as { draft_order?: { id?: string } })
        ?.draft_order?.id
      if (!draftId) throw new Error("Draft order ID missing in response")
      return sdk.admin.draftOrder.convertToOrder(draftId)
    },
    onSuccess: (data) => {
      const orderId = (data as { order?: { id?: string } })?.order?.id
      toast.success("Order created and confirmed")
      if (orderId) {
        navigate(`/orders/${orderId}`)
      } else {
        navigate("/orders")
      }
    },
    onError: (err: Error) => {
      toast.error(err?.message ?? "Failed to create order")
    },
  })

  const isSubmitting = savingDraft || confirming

  // ── Derived display data ───────────────────────────────────────────────────

  const selectedRegion = regionsData?.regions?.find(
    (r: { id: string; name?: string | null }) => r.id === state.region_id
  )
  const selectedChannel = channelsData?.sales_channels?.find(
    (c: { id: string; name?: string | null }) => c.id === state.sales_channel_id
  )
  const selectedCustomer = customersData?.customers?.find(
    (c: ApiCustomer) => c.id === state.customer_id
  )
  const selectedShippingOption = (
    shippingOptionsData?.shipping_options as ApiShippingOption[] | undefined
  )?.find((o) => o.id === state.shipping_option_id)

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="flex flex-col gap-6">
      {/* Customer type toggle */}
      <div>
        <Text className="txt-compact-small-plus text-ui-fg-base mb-3">
          Customer
        </Text>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => set("use_existing_customer", true)}
            className={[
              "px-4 py-2 rounded-md txt-compact-small border transition-colors",
              state.use_existing_customer
                ? "bg-ui-button-inverted text-ui-fg-on-inverted border-transparent"
                : "bg-ui-bg-base text-ui-fg-base border-ui-border-base hover:bg-ui-bg-subtle",
            ].join(" ")}
          >
            Existing customer
          </button>
          <button
            type="button"
            onClick={() => set("use_existing_customer", false)}
            className={[
              "px-4 py-2 rounded-md txt-compact-small border transition-colors",
              !state.use_existing_customer
                ? "bg-ui-button-inverted text-ui-fg-on-inverted border-transparent"
                : "bg-ui-bg-base text-ui-fg-base border-ui-border-base hover:bg-ui-bg-subtle",
            ].join(" ")}
          >
            Guest / email
          </button>
        </div>

        {state.use_existing_customer ? (
          <div ref={customerRef} className="relative">
            <Input
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value)
                setCustomerDropdownOpen(true)
                if (!e.target.value) set("customer_id", "")
              }}
              onFocus={() => setCustomerDropdownOpen(true)}
              placeholder="Search by name or email…"
            />
            {state.customer_id && selectedCustomer && (
              <div className="flex items-center gap-2 mt-2">
                <Badge color="green">
                  {selectedCustomer.first_name} {selectedCustomer.last_name} —{" "}
                  {selectedCustomer.email}
                </Badge>
                <button
                  type="button"
                  onClick={() => {
                    set("customer_id", "")
                    setCustomerQuery("")
                  }}
                  className="text-ui-fg-muted hover:text-ui-fg-base"
                >
                  <XMark />
                </button>
              </div>
            )}
            {customerDropdownOpen &&
              (customersData?.customers as ApiCustomer[] | undefined)?.length
              ? (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-ui-bg-base border border-ui-border-base rounded-md shadow-elevation-card-rest overflow-hidden">
                  {(customersData!.customers as ApiCustomer[]).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-4 py-2.5 txt-small hover:bg-ui-bg-subtle flex justify-between items-center"
                      onClick={() => {
                        set("customer_id", c.id)
                        setCustomerQuery(
                          `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim()
                        )
                        setCustomerDropdownOpen(false)
                      }}
                    >
                      <span className="font-medium">
                        {c.first_name} {c.last_name}
                      </span>
                      <span className="text-ui-fg-muted">{c.email}</span>
                    </button>
                  ))}
                </div>
              ) : null}
          </div>
        ) : (
          <div>
            <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
              Email address
            </label>
            <Input
              type="email"
              value={state.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="customer@example.com"
            />
          </div>
        )}
      </div>

      {/* Region */}
      <div>
        <label className="txt-compact-small-plus text-ui-fg-base mb-2 block">
          Region
        </label>
        <select
          value={state.region_id}
          onChange={(e) => {
            set("region_id", e.target.value)
            set("shipping_option_id", "")
          }}
          className={selectInput}
        >
          <option value="">Select a region…</option>
          {(
            regionsData?.regions as
              | { id: string; name?: string | null }[]
              | undefined
          )?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Sales channel */}
      <div>
        <label className="txt-compact-small-plus text-ui-fg-base mb-2 block">
          Sales channel
        </label>
        <select
          value={state.sales_channel_id}
          onChange={(e) => set("sales_channel_id", e.target.value)}
          className={selectInput}
        >
          <option value="">Select a sales channel…</option>
          {(
            channelsData?.sales_channels as
              | { id: string; name?: string | null }[]
              | undefined
          )?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Notification toggle */}
      <div className="flex items-start gap-3">
        <Checkbox
          id="no-notification"
          checked={state.no_notification_order}
          onCheckedChange={(v) => set("no_notification_order", v === true)}
        />
        <div>
          <label
            htmlFor="no-notification"
            className="txt-compact-small-plus text-ui-fg-base cursor-pointer"
          >
            Skip order notification email
          </label>
          <Text size="small" className="text-ui-fg-muted">
            The customer will not receive a confirmation email for this order.
          </Text>
        </div>
      </div>
    </div>
  )

  const renderStep2 = () => (
    <div className="flex flex-col gap-6">
      {/* Search */}
      <div>
        <label className="txt-compact-small-plus text-ui-fg-base mb-2 block">
          Search products
        </label>
        <Input
          value={productQuery}
          onChange={(e) => setProductQuery(e.target.value)}
          placeholder="Type to search products and variants…"
        />
      </div>

      {/* Search results */}
      {(productsData?.products as ApiProduct[] | undefined)?.length ? (
        <div className="border border-ui-border-base rounded-md overflow-hidden">
          {(productsData!.products as ApiProduct[]).map((product) => (
            <div key={product.id}>
              {(product.variants ?? []).map((variant) => {
                const price = getFirstPrice(variant)
                const alreadyAdded = state.items.some(
                  (i) => i.variant_id === variant.id
                )
                return (
                  <div
                    key={variant.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-ui-border-base last:border-b-0 hover:bg-ui-bg-subtle"
                  >
                    {product.thumbnail ? (
                      <img
                        src={product.thumbnail}
                        alt=""
                        className="w-8 h-8 rounded object-cover border border-ui-border-base flex-shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded bg-ui-bg-subtle border border-ui-border-base flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <Text size="small" className="font-medium truncate">
                        {product.title}
                      </Text>
                      <Text size="xsmall" className="text-ui-fg-muted">
                        {variant.title}
                        {variant.sku ? ` · ${variant.sku}` : ""}
                      </Text>
                    </div>
                    <Text size="small" className="text-ui-fg-subtle">
                      {formatPrice(price?.amount, price?.currency_code)}
                    </Text>
                    <Button
                      size="small"
                      variant={alreadyAdded ? "secondary" : "primary"}
                      onClick={() => addVariantItem(product, variant)}
                    >
                      {alreadyAdded ? "Add again" : "Add"}
                    </Button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : productsLoading ? (
        <Text size="small" className="text-ui-fg-muted">
          Searching…
        </Text>
      ) : debouncedProductQuery ? (
        <Text size="small" className="text-ui-fg-muted">
          No products found for &quot;{debouncedProductQuery}&quot;.
        </Text>
      ) : null}

      {/* Custom item toggle */}
      <div>
        <Button
          variant="secondary"
          size="small"
          onClick={() => setShowCustomItem((v) => !v)}
        >
          {showCustomItem ? "Cancel custom item" : "+ Add custom item"}
        </Button>
        {showCustomItem && (
          <div className="mt-3 p-4 border border-ui-border-base rounded-md flex flex-col gap-3">
            <Text size="small" className="text-ui-fg-subtle">
              Custom items are not linked to a product variant.
            </Text>
            <div>
              <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
                Item name
              </label>
              <Input
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Custom product name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
                  Unit price (in dollars)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  placeholder="0.00"
                  className={fieldInput}
                />
              </div>
              <div>
                <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-1 block">
                  Quantity
                </label>
                <input
                  type="number"
                  min={1}
                  value={customQty}
                  onChange={(e) => setCustomQty(e.target.value)}
                  placeholder="1"
                  className={fieldInput}
                />
              </div>
            </div>
            <Button
              size="small"
              onClick={addCustomItem}
              disabled={!customTitle.trim()}
            >
              Add custom item
            </Button>
          </div>
        )}
      </div>

      {/* Line items */}
      {state.items.length > 0 && (
        <div>
          <Text className="txt-compact-small-plus text-ui-fg-base mb-3">
            Order items ({state.items.length})
          </Text>
          <div className="border border-ui-border-base rounded-md overflow-hidden">
            {state.items.map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-4 py-3 border-b border-ui-border-base last:border-b-0"
              >
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="w-8 h-8 rounded object-cover border border-ui-border-base flex-shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-ui-bg-subtle border border-ui-border-base flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <Text size="small" className="font-medium truncate">
                    {item.title}
                  </Text>
                  {item.variant_title && (
                    <Text size="xsmall" className="text-ui-fg-muted">
                      {item.variant_title}
                    </Text>
                  )}
                  {!item.variant_id && (
                    <Badge color="orange" className="mt-0.5">
                      Custom
                    </Badge>
                  )}
                </div>
                <Text size="small" className="text-ui-fg-subtle w-20 text-right">
                  {formatPrice(item.unit_price)}
                </Text>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateItemQty(idx, -1)}
                    className="w-7 h-7 flex items-center justify-center rounded border border-ui-border-base hover:bg-ui-bg-subtle text-ui-fg-muted"
                  >
                    <Minus />
                  </button>
                  <span className="w-8 text-center txt-compact-small">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateItemQty(idx, 1)}
                    className="w-7 h-7 flex items-center justify-center rounded border border-ui-border-base hover:bg-ui-bg-subtle text-ui-fg-muted"
                  >
                    <Plus />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="text-ui-fg-muted hover:text-ui-fg-error transition-colors ml-1"
                >
                  <Trash />
                </button>
              </div>
            ))}
            <div className="px-4 py-3 bg-ui-bg-subtle flex justify-between items-center">
              <Text size="small" className="text-ui-fg-muted">
                Estimated total (excl. tax &amp; shipping)
              </Text>
              <Text size="small" className="font-medium">
                {formatPrice(estimatedTotal)}
              </Text>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  const renderStep3 = () => (
    <div className="flex flex-col gap-6">
      {/* Shipping option */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="txt-compact-small-plus text-ui-fg-base">
            Shipping method
          </label>
          {shippingLoading && (
            <Text size="xsmall" className="text-ui-fg-muted">
              Loading…
            </Text>
          )}
          {!shippingLoading && !shippingError && (
            <Text size="xsmall" className="text-ui-fg-muted">
              {(shippingOptionsData?.shipping_options as ApiShippingOption[] | undefined)
                ?.length ?? 0}{" "}
              option(s) available
            </Text>
          )}
        </div>
        {shippingError ? (
          <Text size="small" className="text-ui-fg-error">
            Failed to load shipping options. Check console for details.
          </Text>
        ) : (
          <select
            value={state.shipping_option_id}
            onChange={(e) => set("shipping_option_id", e.target.value)}
            className={selectInput}
            disabled={shippingLoading}
          >
            <option value="">
              {shippingLoading
                ? "Loading shipping methods…"
                : (shippingOptionsData?.shipping_options as ApiShippingOption[] | undefined)
                    ?.length === 0
                ? "No shipping methods configured"
                : "Select a shipping method…"}
            </option>
            {(
              shippingOptionsData?.shipping_options as
                | ApiShippingOption[]
                | undefined
            )?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        {!shippingLoading &&
          !shippingError &&
          (shippingOptionsData?.shipping_options as ApiShippingOption[] | undefined)
            ?.length === 0 && (
            <Text size="xsmall" className="text-ui-fg-muted mt-1">
              No shipping options found. Configure them in Settings → Locations &
              Shipping.
            </Text>
          )}
      </div>

      {/* Shipping address */}
      <div>
        <Text className="txt-compact-small-plus text-ui-fg-base mb-3">
          Shipping address
        </Text>
        <AddressFormSection
          value={state.shipping_address}
          onChange={setAddress("shipping_address")}
        />
      </div>

      {/* Billing address */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Checkbox
            id="same-billing"
            checked={state.same_billing}
            onCheckedChange={(v) => set("same_billing", v === true)}
          />
          <label
            htmlFor="same-billing"
            className="txt-compact-small-plus text-ui-fg-base cursor-pointer"
          >
            Billing address same as shipping
          </label>
        </div>
        {!state.same_billing && (
          <AddressFormSection
            value={state.billing_address}
            onChange={setAddress("billing_address")}
            title="Billing address"
          />
        )}
      </div>
    </div>
  )

  const renderStep4 = () => (
    <div className="flex flex-col gap-6">
      {/* Customer */}
      <div className="flex flex-col gap-1">
        <Text className="txt-compact-xsmall-plus text-ui-fg-muted uppercase tracking-wider">
          Customer
        </Text>
        <Text size="small">
          {state.use_existing_customer && selectedCustomer
            ? `${selectedCustomer.first_name ?? ""} ${selectedCustomer.last_name ?? ""}`.trim() ||
              selectedCustomer.email
            : state.email || "—"}
        </Text>
        {selectedRegion && (
          <Text size="small" className="text-ui-fg-muted">
            Region: {(selectedRegion as { name?: string | null }).name} ·
            Channel: {(selectedChannel as { name?: string | null } | undefined)?.name ?? "—"}
          </Text>
        )}
        {state.no_notification_order && (
          <Badge color="orange">No notification email</Badge>
        )}
      </div>

      {/* Items */}
      <div className="flex flex-col gap-2">
        <Text className="txt-compact-xsmall-plus text-ui-fg-muted uppercase tracking-wider">
          Items ({state.items.length})
        </Text>
        <div className="border border-ui-border-base rounded-md overflow-hidden">
          {state.items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 px-4 py-2.5 border-b border-ui-border-base last:border-b-0"
            >
              <div className="flex-1 min-w-0">
                <Text size="small" className="font-medium truncate">
                  {item.title}
                </Text>
                {item.variant_title && (
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {item.variant_title}
                  </Text>
                )}
              </div>
              <Text size="small" className="text-ui-fg-muted">
                ×{item.quantity}
              </Text>
              <Text size="small" className="w-24 text-right">
                {formatPrice(
                  item.unit_price != null
                    ? item.unit_price * item.quantity
                    : undefined
                )}
              </Text>
            </div>
          ))}
          <div className="px-4 py-2.5 bg-ui-bg-subtle flex justify-between items-center">
            <Text size="small" className="text-ui-fg-muted">
              Estimated total (excl. tax &amp; shipping)
            </Text>
            <Text size="small" className="font-medium">
              {formatPrice(estimatedTotal)}
            </Text>
          </div>
        </div>
      </div>

      {/* Shipping */}
      <div className="flex flex-col gap-1">
        <Text className="txt-compact-xsmall-plus text-ui-fg-muted uppercase tracking-wider">
          Shipping
        </Text>
        <Text size="small">
          {selectedShippingOption?.name ?? state.shipping_option_id ?? "—"}
        </Text>
        <Text size="small" className="text-ui-fg-muted">
          {[
            state.shipping_address.first_name,
            state.shipping_address.last_name,
          ]
            .filter(Boolean)
            .join(" ")}
          {state.shipping_address.address_1
            ? `, ${state.shipping_address.address_1}`
            : ""}
          {state.shipping_address.city
            ? `, ${state.shipping_address.city}`
            : ""}
          {state.shipping_address.country_code
            ? `, ${state.shipping_address.country_code.toUpperCase()}`
            : ""}
        </Text>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-3 pt-2 border-t border-ui-border-base">
        <Text size="small" className="text-ui-fg-muted">
          Choose how to proceed with this order:
        </Text>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => saveAsDraft()}
            disabled={isSubmitting}
            className="flex-1"
          >
            {savingDraft ? "Saving…" : "Save as draft"}
          </Button>
          <Button
            onClick={() => createAndConfirm()}
            disabled={isSubmitting}
            className="flex-1"
          >
            {confirming ? "Creating…" : "Create & confirm order"}
          </Button>
        </div>
        <Text size="xsmall" className="text-ui-fg-muted">
          "Save as draft" keeps the order in draft state for further editing.
          "Create & confirm" immediately converts it to a live order.
        </Text>
      </div>
    </div>
  )

  const stepValid = [step1Valid, step2Valid, step3Valid, true]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 pb-12 max-w-3xl mx-auto">
      {/* Breadcrumb + title */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link to="/orders">
            <Button variant="transparent" size="small" className="!p-0 gap-1.5">
              <ChevronLeft />
              Back to orders
            </Button>
          </Link>
          <span className="text-ui-fg-muted">/</span>
          <span className="txt-small text-ui-fg-subtle">Create order</span>
        </div>
        <Heading>Create Order</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Manually create an order on behalf of a customer.
        </Text>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} total={4} labels={STEPS} />

      {/* Step content */}
      <Container className="p-6">
        <Heading level="h2" className="mb-6">
          {STEPS[step - 1]}
        </Heading>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </Container>

      {/* Navigation */}
      {step < 4 && (
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
          >
            Back
          </Button>
          <Button
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            disabled={!stepValid[step - 1]}
          >
            Continue
          </Button>
        </div>
      )}
      {step === 4 && (
        <div>
          <Button
            variant="secondary"
            onClick={() => setStep(3)}
            disabled={isSubmitting}
          >
            Back
          </Button>
        </div>
      )}
    </div>
  )
}

export default CreateOrderPage
