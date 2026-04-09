import React, { useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Heading, Input, Text, toast } from "@medusajs/ui"
import { sdk } from "../lib/sdk"

type CustomerLike = {
  id: string
  email?: string | null
  has_account?: boolean
}

const MIN_LEN = 8

const CustomerSetPasswordWidget = ({ data }: { data: CustomerLike }) => {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [pending, setPending] = useState(false)

  if (!data?.id) {
    return null
  }

  const submit = async () => {
    if (password.length < MIN_LEN) {
      toast.error(`Password must be at least ${MIN_LEN} characters.`)
      return
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.")
      return
    }
    setPending(true)
    try {
      await sdk.client.fetch(`/admin/customers/${data.id}/password`, {
        method: "POST",
        body: { password },
      })
      setPassword("")
      setConfirm("")
      toast.success("Store password updated.")
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not set password."
      toast.error(msg)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="shadow-elevation-card-rest bg-ui-bg-base w-full rounded-lg p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2" className="font-sans font-medium h2-core">
          Store login password
        </Heading>
      </div>
      <div className="w-full gap-y-4 flex h-full flex-col overflow-hidden border-t p-6">
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Set or reset the password this customer uses for email/password
          sign-in on the storefront.
        </Text>
        {!data.email ? (
          <Text size="small" className="text-ui-fg-muted">
            Add an email on the customer record before setting a password.
          </Text>
        ) : (
          <>
            <div className="flex flex-col gap-y-2">
              <label className="txt-compact-xsmall-plus text-ui-fg-subtle">
                New password
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={`At least ${MIN_LEN} characters`}
              />
            </div>
            <div className="flex flex-col gap-y-2">
              <label className="txt-compact-xsmall-plus text-ui-fg-subtle">
                Confirm password
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
              />
            </div>
            <Button
              type="button"
              size="small"
              variant="secondary"
              isLoading={pending}
              onClick={() => void submit()}
            >
              Save password
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.side.after",
})

export default CustomerSetPasswordWidget
