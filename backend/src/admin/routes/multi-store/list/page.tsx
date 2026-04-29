import React, { useMemo } from "react"
import "../../../lib/sync-active-store-cookie"
import { Link } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowLeft, Buildings } from "@medusajs/icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Text,
  toast,
} from "@medusajs/ui"

import {
  ADMIN_LIST_ALL_STORES_HEADER,
  readActiveStoreIdFromStorage,
  setActiveAdminStoreId,
} from "../../../lib/active-store-context"
import { sdk } from "../../../lib/sdk"

const MultiStoreListPage = () => {
  const queryClient = useQueryClient()
  const activeFromStorage = useMemo(() => readActiveStoreIdFromStorage(), [])

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-stores-list-all"],
    queryFn: async () =>
      sdk.admin.store.list(
        {
          limit: 200,
          fields:
            "id,name,default_sales_channel_id,default_currency_code,supported_currencies",
        },
        { [ADMIN_LIST_ALL_STORES_HEADER]: "true" }
      ),
    staleTime: 30_000,
  })

  const stores = data?.stores ?? []

  const switchTo = (id: string, label: string) => {
    setActiveAdminStoreId(id)
    queryClient.invalidateQueries({ queryKey: ["admin-store-list-for-selector"] })
    queryClient.invalidateQueries({ queryKey: ["admin-stores-list-all"] })
    toast.success(`Active store: ${label}`)
    window.location.reload()
  }

  const defaultCc = (store: {
    default_currency_code?: string | null
    supported_currencies?: { currency_code?: string | null }[]
  }) => {
    const d = store.default_currency_code?.trim()
    if (d) return d.toUpperCase()
    const first = store.supported_currencies?.[0]?.currency_code?.trim()
    return first ? first.toUpperCase() : "—"
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h1">Stores</Heading>
        <Link
          to="/orders"
          className="txt-compact-small text-ui-fg-subtle hover:text-ui-fg-base flex items-center gap-1"
        >
          <ArrowLeft /> Back
        </Link>
      </div>
      <div className="px-6 py-8 flex flex-col gap-6">
        <Text size="small" className="text-ui-fg-muted max-w-2xl">
          Every row is a Medusa Store. The{" "}
          <Link to="/settings/store" className="text-ui-fg-interactive">
            Settings → Store
          </Link>{" "}
          screen reflects whichever store is active in the top bar. Use{" "}
          <strong>Switch active store</strong> here or in that dropdown to change scope for
          products and orders.
        </Text>

        {isLoading ? (
          <Text size="small" className="text-ui-fg-muted">
            Loading stores…
          </Text>
        ) : isError ? (
          <Text size="small" className="text-ui-fg-error">
            Could not load stores.
          </Text>
        ) : stores.length === 0 ? (
          <Text size="small" className="text-ui-fg-muted">
            No stores found.
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Store ID</Table.HeaderCell>
                <Table.HeaderCell>Currency</Table.HeaderCell>
                <Table.HeaderCell className="w-[140px]">Active</Table.HeaderCell>
                <Table.HeaderCell className="text-end">Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {stores.map((store) => {
                const name =
                  typeof store.name === "string" && store.name.trim().length
                    ? store.name.trim()
                    : store.id
                const isActive =
                  activeFromStorage === store.id ||
                  (!activeFromStorage && stores[0]?.id === store.id)

                return (
                  <Table.Row key={store.id}>
                    <Table.Cell className="font-medium">{name}</Table.Cell>
                    <Table.Cell>
                      <code className="txt-compact-xsmall text-ui-fg-muted">{store.id}</code>
                    </Table.Cell>
                    <Table.Cell>{defaultCc(store)}</Table.Cell>
                    <Table.Cell>
                      {isActive ? (
                        <Badge size="2xsmall" color="green">
                          Active
                        </Badge>
                      ) : (
                        <Text size="small" className="text-ui-fg-muted">
                          —
                        </Text>
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-end">
                      {!isActive ? (
                        <Button
                          size="small"
                          variant="secondary"
                          type="button"
                          onClick={() => switchTo(store.id, name)}
                        >
                          Switch active store
                        </Button>
                      ) : (
                        <Text size="small" className="text-ui-fg-muted">
                          —
                        </Text>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Stores",
  rank: 1,
  icon: Buildings,
})

export default MultiStoreListPage
