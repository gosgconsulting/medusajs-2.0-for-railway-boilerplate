import React, { useCallback, useEffect, useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Checkbox, Heading, Input, Text, toast } from "@medusajs/ui"
import { PencilSquare, Plus, Trash, XMark } from "@medusajs/icons"
import { Link } from "react-router-dom"

type ImportLimit = "1" | "10" | "all"

type ImportedRow = {
  medusaProductId: string
  title: string
  handle: string
  wcProductId: number
  action?: "created" | "updated"
}

type ImportErrorRow = {
  wcProductId?: number
  message: string
}

function adminApiOrigin(): string {
  if (
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: { VITE_BACKEND_URL?: string } }).env
      ?.VITE_BACKEND_URL
  ) {
    return String(
      (import.meta as ImportMeta & { env?: { VITE_BACKEND_URL?: string } }).env
        ?.VITE_BACKEND_URL
    ).replace(/\/$/, "")
  }
  return ""
}

const WC_IMPORT_STORAGE_KEY = "medusa-admin-wc-import-credentials"

type StoredWcCredentials = {
  baseUrl?: string
  consumerKey?: string
  consumerSecret?: string
  currencyCode?: string
}

function loadStoredCredentials(): StoredWcCredentials | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(WC_IMPORT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredWcCredentials
    if (
      typeof parsed?.consumerKey === "string" &&
      typeof parsed?.consumerSecret === "string"
    ) {
      return parsed
    }
  } catch {
    /* ignore */
  }
  return null
}

function persistCredentials(data: StoredWcCredentials) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(WC_IMPORT_STORAGE_KEY, JSON.stringify(data))
}

function clearStoredCredentials() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(WC_IMPORT_STORAGE_KEY)
}

const ProductListBulkEditWidget = () => {
  const [wcModalOpen, setWcModalOpen] = useState(false)
  const [wcConfigLoaded, setWcConfigLoaded] = useState(false)
  const [wcEnvConfigured, setWcEnvConfigured] = useState(false)
  const [wcApiHost, setWcApiHost] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState("")
  const [consumerKey, setConsumerKey] = useState("")
  const [consumerSecret, setConsumerSecret] = useState("")
  const [saveCredentials, setSaveCredentials] = useState(false)
  const [limit, setLimit] = useState<ImportLimit>("10")
  const [currencyCode, setCurrencyCode] = useState("eur")
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState<ImportedRow[]>([])
  const [importErrors, setImportErrors] = useState<ImportErrorRow[]>([])
  const [resetModalOpen, setResetModalOpen] = useState(false)
  const [resetConfirmInput, setResetConfirmInput] = useState("")
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    const stored = loadStoredCredentials()
    if (!stored) return
    setSaveCredentials(true)
    if (stored.baseUrl) setBaseUrl(stored.baseUrl)
    setConsumerKey(stored.consumerKey ?? "")
    setConsumerSecret(stored.consumerSecret ?? "")
    if (stored.currencyCode) setCurrencyCode(stored.currencyCode)
  }, [])

  useEffect(() => {
    if (!wcModalOpen) {
      setWcConfigLoaded(false)
      return
    }
    const origin = adminApiOrigin()
    if (!origin) {
      setWcEnvConfigured(false)
      setWcApiHost(null)
      setWcConfigLoaded(true)
      return
    }
    let cancelled = false
    void fetch(`${origin}/admin/wc-import`, { credentials: "include" })
      .then((r) => r.json().catch(() => ({})))
      .then((d: { wcEnvConfigured?: boolean; wcApiHost?: string | null }) => {
        if (cancelled) return
        setWcEnvConfigured(Boolean(d.wcEnvConfigured))
        setWcApiHost(
          typeof d.wcApiHost === "string" && d.wcApiHost.length > 0
            ? d.wcApiHost
            : null
        )
      })
      .catch(() => {
        if (!cancelled) {
          setWcEnvConfigured(false)
          setWcApiHost(null)
        }
      })
      .finally(() => {
        if (!cancelled) setWcConfigLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [wcModalOpen])

  const runWcImport = useCallback(async () => {
    const origin = adminApiOrigin()
    if (!origin) {
      toast.error("VITE_BACKEND_URL is not set; cannot call import API.")
      return
    }
    if (
      !wcEnvConfigured &&
      (!baseUrl.trim() || !consumerKey.trim() || !consumerSecret.trim())
    ) {
      toast.error("Please fill in WooCommerce URL, consumer key, and secret.")
      return
    }
    if (!wcEnvConfigured) {
      if (saveCredentials) {
        persistCredentials({
          baseUrl: baseUrl.trim(),
          consumerKey: consumerKey.trim(),
          consumerSecret: consumerSecret.trim(),
          currencyCode: (currencyCode.trim() || "eur").toLowerCase(),
        })
      } else {
        clearStoredCredentials()
      }
    }
    const payload: Record<string, unknown> = {
      limit,
      currencyCode: currencyCode.trim() || "eur",
    }
    if (!wcEnvConfigured) {
      payload.baseUrl = baseUrl.trim()
      payload.consumerKey = consumerKey.trim()
      payload.consumerSecret = consumerSecret.trim()
    }
    setImporting(true)
    setImported([])
    setImportErrors([])
    try {
      const res = await fetch(`${origin}/admin/wc-import`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          typeof data?.message === "string"
            ? data.message
            : `Import failed (${res.status})`
        )
        return
      }
      const rows = (data.imported ?? []) as ImportedRow[]
      const errs = (data.errors ?? []) as ImportErrorRow[]
      setImported(rows)
      setImportErrors(errs)
      if (rows.length) {
        toast.success(`Imported ${rows.length} product(s).`)
      }
      if (errs.length) {
        toast.warning(`${errs.length} product(s) failed — see list below.`)
      }
      if (!rows.length && !errs.length) {
        toast.info("No products returned from WooCommerce.")
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Import request failed.")
    } finally {
      setImporting(false)
    }
  }, [
    baseUrl,
    consumerKey,
    consumerSecret,
    limit,
    currencyCode,
    saveCredentials,
    wcEnvConfigured,
  ])

  const runResetAllProducts = useCallback(async () => {
    if (resetConfirmInput !== "DELETE_ALL_PRODUCTS") {
      toast.error('Type DELETE_ALL_PRODUCTS exactly to confirm.')
      return
    }
    const origin = adminApiOrigin()
    if (!origin) {
      toast.error("VITE_BACKEND_URL is not set; cannot call API.")
      return
    }
    setResetting(true)
    try {
      const res = await fetch(`${origin}/admin/wc-import/reset-products`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE_ALL_PRODUCTS" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          typeof data?.message === "string"
            ? data.message
            : `Reset failed (${res.status})`
        )
        return
      }
      const n =
        typeof data.deletedCount === "number" ? data.deletedCount : 0
      toast.success(
        n === 0
          ? "No products to delete."
          : `Deleted ${n} product(s). You can import again.`
      )
      setResetConfirmInput("")
      setResetModalOpen(false)
      setImported([])
      setImportErrors([])
    } catch (e: any) {
      toast.error(e?.message ?? "Reset request failed.")
    } finally {
      setResetting(false)
    }
  }, [resetConfirmInput])

  return (
    <>
      <div className="flex justify-end gap-2 px-6 pb-3 pt-1">
        <Button
          size="small"
          variant="secondary"
          type="button"
          title="WooCommerce API Import"
          onClick={() => setWcModalOpen(true)}
        >
          <Plus />
          WC API Import
        </Button>
        <Button size="small" variant="secondary" asChild>
          <Link to="/products/bulk-edit">
            <PencilSquare />
            Bulk Edit
          </Link>
        </Button>
        <Button
          size="small"
          variant="secondary"
          type="button"
          onClick={() => {
            setResetConfirmInput("")
            setResetModalOpen(true)
          }}
        >
          <Trash />
          Delete All Products
        </Button>
      </div>

      {resetModalOpen ? (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !resetting) {
              setResetModalOpen(false)
              setResetConfirmInput("")
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-ui-border-base bg-ui-bg-base p-5 shadow-elevation-flyout"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-catalog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <Heading level="h2" id="reset-catalog-title" className="text-ui-fg-error">
                Delete all products?
              </Heading>
              <Button
                type="button"
                size="small"
                variant="transparent"
                disabled={resetting}
                onClick={() => {
                  setResetModalOpen(false)
                  setResetConfirmInput("")
                }}
                aria-label="Close"
              >
                <XMark />
              </Button>
            </div>
            <Text size="small" className="mt-3 text-ui-fg-muted">
              This permanently removes every product in Medusa (variants, prices,
              and linked inventory). Product categories are not deleted. This
              cannot be undone.
            </Text>
            <div className="mt-4 flex flex-col gap-2">
              <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
                Type{" "}
                <span className="font-mono text-ui-fg-base">
                  DELETE_ALL_PRODUCTS
                </span>{" "}
                to confirm
              </Text>
              <Input
                value={resetConfirmInput}
                onChange={(e) => setResetConfirmInput(e.target.value)}
                placeholder="DELETE_ALL_PRODUCTS"
                autoComplete="off"
                disabled={resetting}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={resetting}
                onClick={() => {
                  setResetModalOpen(false)
                  setResetConfirmInput("")
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={
                  resetting || resetConfirmInput !== "DELETE_ALL_PRODUCTS"
                }
                onClick={() => void runResetAllProducts()}
              >
                {resetting ? "Deleting…" : "Delete all products"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {wcModalOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setWcModalOpen(false)
          }}
        >
          <div
            className="flex h-[80vh] w-[80vw] max-w-6xl flex-col overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base shadow-elevation-flyout"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wc-import-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-ui-border-base px-6 py-4">
              <Heading level="h2" id="wc-import-title">
                WooCommerce API import
              </Heading>
              <Button
                type="button"
                size="small"
                variant="transparent"
                onClick={() => setWcModalOpen(false)}
                aria-label="Close"
              >
                <XMark />
              </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-6 py-4">
              {!wcConfigLoaded ? (
                <Text size="small" className="text-ui-fg-muted">
                  Loading import options…
                </Text>
              ) : (
                <>
              {wcEnvConfigured ? (
                <Text size="small" className="text-ui-fg-muted">
                  WooCommerce URL and API keys are read from server environment
                  variables{" "}
                  <span className="font-mono txt-compact-xsmall">
                    WC_API_URL
                  </span>
                  ,{" "}
                  <span className="font-mono txt-compact-xsmall">
                    WC_CONSUMER_KEY
                  </span>
                  ,{" "}
                  <span className="font-mono txt-compact-xsmall">
                    WC_CONSUMER_SECRET
                  </span>
                  {wcApiHost ? (
                    <>
                      {" "}
                      (configured host:{" "}
                      <span className="font-medium text-ui-fg-base">
                        {wcApiHost}
                      </span>
                      )
                    </>
                  ) : null}
                  .
                </Text>
              ) : (
                <Text size="small" className="text-ui-fg-muted">
                  Credentials are sent to your Medusa server when you run an
                  import. Use a read-capable WooCommerce REST key. If you enable
                  “Save keys”, URL, key, and secret are kept in this browser’s{" "}
                  <span className="font-mono txt-compact-xsmall">
                    localStorage
                  </span>{" "}
                  only (not on the server). Alternatively, set{" "}
                  <span className="font-mono txt-compact-xsmall">WC_*</span> env
                  vars on the server to hide these fields.
                </Text>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                {!wcEnvConfigured ? (
                  <>
                    <div className="flex flex-col gap-1 md:col-span-2">
                      <Text
                        size="xsmall"
                        weight="plus"
                        className="text-ui-fg-muted"
                      >
                        WooCommerce site URL
                      </Text>
                      <Input
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://cms.example.com"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Text
                        size="xsmall"
                        weight="plus"
                        className="text-ui-fg-muted"
                      >
                        Consumer key
                      </Text>
                      <Input
                        value={consumerKey}
                        onChange={(e) => setConsumerKey(e.target.value)}
                        placeholder="ck_…"
                        autoComplete="off"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Text
                        size="xsmall"
                        weight="plus"
                        className="text-ui-fg-muted"
                      >
                        Consumer secret
                      </Text>
                      <Input
                        type="password"
                        value={consumerSecret}
                        onChange={(e) => setConsumerSecret(e.target.value)}
                        placeholder="cs_…"
                        autoComplete="off"
                      />
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 md:col-span-2">
                      <Checkbox
                        checked={saveCredentials}
                        onCheckedChange={(checked) => {
                          const on = checked === true
                          setSaveCredentials(on)
                          if (!on) clearStoredCredentials()
                        }}
                      />
                      <Text size="small" className="select-none">
                        Save keys in this browser (localStorage)
                      </Text>
                    </label>
                  </>
                ) : null}
                <div className="flex flex-col gap-1">
                  <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
                    Price currency (variant prices)
                  </Text>
                  <Input
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    placeholder="eur"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Text size="xsmall" weight="plus" className="text-ui-fg-muted">
                    Product limit
                  </Text>
                  <div className="flex flex-wrap gap-4">
                    {(
                      [
                        { v: "1" as const, label: "1" },
                        { v: "10" as const, label: "10" },
                        { v: "all" as const, label: "All" },
                      ] as const
                    ).map(({ v, label }) => (
                      <label
                        key={v}
                        className="flex cursor-pointer items-center gap-2 txt-small"
                      >
                        <input
                          type="radio"
                          name="wc-import-limit"
                          checked={limit === v}
                          onChange={() => setLimit(v)}
                          className="text-ui-fg-interactive"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={importing || !wcConfigLoaded}
                  onClick={() => void runWcImport()}
                >
                  {importing ? "Importing…" : "Run import"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={importing}
                  onClick={() => setWcModalOpen(false)}
                >
                  Close
                </Button>
              </div>

              {imported.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-ui-border-base pt-4">
                  <Text size="small" weight="plus">
                    Imported products
                  </Text>
                  <ul className="max-h-48 overflow-auto rounded-md border border-ui-border-base divide-y divide-ui-border-base">
                    {imported.map((row) => (
                      <li key={row.medusaProductId}>
                        <Link
                          to={`/products/${row.medusaProductId}`}
                          className="block px-3 py-2 text-sm text-ui-fg-interactive hover:bg-ui-bg-base-hover"
                          onClick={() => setWcModalOpen(false)}
                        >
                          <span className="font-medium">{row.title}</span>
                          <span className="ml-2 text-ui-fg-muted txt-compact-small">
                            {row.handle} · WC #{row.wcProductId}
                            {row.action === "updated"
                              ? " · updated"
                              : row.action === "created"
                                ? " · created"
                                : ""}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importErrors.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-ui-border-base pt-4">
                  <Text size="small" weight="plus" className="text-ui-fg-error">
                    Errors
                  </Text>
                  <ul className="max-h-32 overflow-auto txt-small text-ui-fg-error">
                    {importErrors.map((err, i) => (
                      <li key={i}>
                        {err.wcProductId != null
                          ? `WC #${err.wcProductId}: `
                          : ""}
                        {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default ProductListBulkEditWidget
