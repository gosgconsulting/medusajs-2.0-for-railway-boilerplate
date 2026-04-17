import React, { useCallback, useEffect, useState } from "react"
import { Heading, Text, toast } from "@medusajs/ui"
import { sdk } from "../lib/sdk"

const selectInput =
  "flex h-9 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 txt-small focus:border-ui-border-interactive focus:outline-none text-ui-fg-base"

type CustomerWidgetData = {
  id: string
}

type CustomerGroupRow = { id: string; name?: string | null }

function getErrorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message: unknown }).message
    if (typeof m === "string") return m
  }
  return "Could not update customer group."
}

export const CustomerGroupSelectWidget = ({ data }: { data: CustomerWidgetData }) => {
  const customerId = data?.id
  const [groups, setGroups] = useState<CustomerGroupRow[]>([])
  const [assignedId, setAssignedId] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    if (!customerId) return
    setLoading(true)
    try {
      const [customerRes, groupsRes] = await Promise.all([
        sdk.admin.customer.retrieve(customerId, { fields: "id,*groups" }),
        sdk.admin.customerGroup.list({ limit: 100 }),
      ])
      const list = (groupsRes.customer_groups ?? []) as CustomerGroupRow[]
      setGroups([...list].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")))
      const g = customerRes.customer?.groups
      const first =
        Array.isArray(g) && g.length && g[0] && typeof g[0].id === "string"
          ? g[0].id
          : ""
      setAssignedId(first)
    } catch (e: unknown) {
      toast.error(getErrorMessage(e))
      setGroups([])
      setAssignedId("")
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onChangeGroup = async (nextId: string) => {
    if (!customerId || saving) return
    if (nextId === assignedId) return

    setSaving(true)
    try {
      if (nextId) {
        await sdk.admin.customerGroup.batchCustomers(nextId, {
          add: [customerId],
        })
      } else if (assignedId) {
        await sdk.admin.customerGroup.batchCustomers(assignedId, {
          remove: [customerId],
        })
      }
      setAssignedId(nextId)
      toast.success(nextId ? "Customer group updated." : "Customer removed from group.")
    } catch (e: unknown) {
      toast.error(getErrorMessage(e))
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  if (!customerId) {
    return null
  }

  return (
    <div className="shadow-elevation-card-rest bg-ui-bg-base w-full rounded-lg p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2" className="font-sans font-medium h2-core">
          Customer group
        </Heading>
      </div>
      <div className="w-full gap-y-4 flex h-full flex-col overflow-hidden border-t p-6">
        <Text size="small" className="text-ui-fg-subtle">
          Each customer can belong to one group. Changing the selection replaces
          the current group.
        </Text>
        <div>
          <label className="txt-compact-xsmall-plus text-ui-fg-subtle mb-2 block">
            Group
          </label>
          <select
            className={selectInput}
            disabled={loading || saving}
            value={assignedId}
            onChange={(e) => void onChangeGroup(e.target.value)}
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name?.trim() ? g.name : g.id}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
