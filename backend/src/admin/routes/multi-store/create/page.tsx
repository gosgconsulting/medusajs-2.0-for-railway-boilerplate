import React, { useState } from "react"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowLeft } from "@medusajs/icons"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Text,
  toast,
} from "@medusajs/ui"

import { sdk } from "../../../lib/sdk"

type CreateResponse = { store: { id: string; name?: string | null } }

const MultiStoreCreatePage = () => {
  const [name, setName] = useState("")
  const [currency, setCurrency] = useState("usd")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const n = name.trim()
    if (!n.length) {
      toast.error("Enter a store name.")
      return
    }
    const cc = currency.trim().toLowerCase()
    if (cc.length !== 3) {
      toast.error("Currency must be a 3-letter ISO code (e.g. usd).")
      return
    }
    setBusy(true)
    try {
      const res = await sdk.client.fetch<CreateResponse>("/admin/multi-store/stores", {
        method: "POST",
        body: {
          name: n,
          default_currency_code: cc,
        },
      })
      toast.success(`Store created: ${res.store?.name ?? res.store?.id ?? ""}`)
      window.location.assign("/orders")
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "Failed to create store"
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Create store</Heading>
        <Link
          to="/orders"
          className="txt-compact-small text-ui-fg-subtle hover:text-ui-fg-base flex items-center gap-1"
        >
          <ArrowLeft /> Back
        </Link>
      </div>
      <div className="px-6 py-8 max-w-md flex flex-col gap-6">
        <Text size="small" className="text-ui-fg-muted">
          Creates a Medusa Store, a default sales channel tagged with{" "}
          <code className="text-xs bg-ui-bg-subtle px-1 rounded">metadata.store_id</code>,
          and sets it as the store&apos;s default channel. Use the top-bar selector to scope product
          and order lists.
        </Text>
        <div className="flex flex-col gap-2">
          <Label htmlFor="store-name">Store name</Label>
          <Input
            id="store-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Paris"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="store-cc">Default currency (ISO 4217)</Label>
          <Input
            id="store-cc"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="usd"
          />
        </div>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? "Creating…" : "Create store"}
        </Button>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Create store",
  rank: 10,
})

export default MultiStoreCreatePage
