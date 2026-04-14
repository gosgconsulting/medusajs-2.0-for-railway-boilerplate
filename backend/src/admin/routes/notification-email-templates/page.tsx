import React, { useCallback, useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Envelope } from "@medusajs/icons"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Button,
  Container,
  Heading,
  Input,
  Label,
  Switch,
  Tabs,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { sdk } from "../../lib/sdk"

type CatalogEntry = {
  template_key: string
  label: string
  description: string
  audience?: "customer" | "admin"
  configured: boolean
  id: string | null
  subject: string
  reply_to: string
  is_enabled: boolean
  html_body: string
}

type ListResponse = {
  templates: CatalogEntry[]
}

type DetailResponse = {
  template_key: string
  configured: boolean
  id: string | null
  subject: string
  reply_to: string
  is_enabled: boolean
  html_body: string
  defaults: { subject: string; html_body: string }
}

const bodyTextareaClass = "font-mono text-sm min-h-[280px]"

const ORDER_TEMPLATE_VARS = [
  "{{customer_name}}",
  "{{customer_email}}",
  "{{order_id}}",
  "{{total}}",
  "{{currency}}",
  "{{items_count}}",
  "{{tracking_number}}",
  "{{shipping_address}}",
  "{{support_email}}",
  "{{store_name}}",
  "{{noticeHeadline}}",
  "{{noticeMessage}}",
  "{{formatDate order.created_at}}",
]

const INVITE_TEMPLATE_VARS = [
  "{{store_name}}",
  "{{support_email}}",
  "{{inviteLink}}",
]

const ADMIN_NEW_ORDER_TEMPLATE_VARS = [
  ...ORDER_TEMPLATE_VARS,
  "{{admin_order_url}}",
]

const ADMIN_ORDER_PLACED_TEMPLATE_KEY = "admin-order-placed"
const ADMIN_DEFERRED_ORDER_PAID_TEMPLATE_KEY = "admin-deferred-order-paid"

/** Visual accent for sidebar rows (matches common order-lifecycle semantics). */
const TEMPLATE_DOT_CLASS: Record<string, string> = {
  "order-placed": "bg-ui-fg-muted",
  "order-email-processing": "bg-blue-500",
  "order-email-payment-failed": "bg-orange-500",
  "order-email-in-fulfillment": "bg-lime-500",
  "order-email-shipment-in-progress": "bg-teal-500",
  "order-email-delivered": "bg-green-500",
  "order-email-cancelled": "bg-red-500",
  "order-email-refunded": "bg-pink-500",
  "invite-user": "bg-violet-500",
  "admin-order-placed": "bg-amber-500",
  "admin-deferred-order-paid": "bg-emerald-600",
}

const INVITE_TEMPLATE_KEY = "invite-user"

const NotificationEmailTemplatesPage = () => {
  const queryClient = useQueryClient()
  const [audienceTab, setAudienceTab] = useState<"customer" | "admin">("customer")
  const [selectedKey, setSelectedKey] = useState<string>("")
  const [subject, setSubject] = useState("")
  const [replyTo, setReplyTo] = useState("")
  const [enabled, setEnabled] = useState(true)
  const [htmlBody, setHtmlBody] = useState("")
  const [saving, setSaving] = useState(false)

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ["notification-email-templates"],
    queryFn: async () => {
      const res = await sdk.client.fetch<ListResponse>(
        "/admin/notification-email-templates"
      )
      return res
    },
  })

  const templates = listData?.templates ?? []

  const customerTemplates = useMemo(
    () => templates.filter((t) => (t.audience ?? "customer") === "customer"),
    [templates]
  )

  const adminTemplates = useMemo(
    () => templates.filter((t) => t.audience === "admin"),
    [templates]
  )

  const templatesForActiveTab =
    audienceTab === "customer" ? customerTemplates : adminTemplates

  useEffect(() => {
    if (!listLoading && audienceTab === "admin" && adminTemplates.length === 0) {
      setAudienceTab("customer")
    }
  }, [listLoading, audienceTab, adminTemplates.length])

  useEffect(() => {
    if (templatesForActiveTab.length === 0) return
    const stillInTab = templatesForActiveTab.some(
      (t) => t.template_key === selectedKey
    )
    if (!stillInTab) {
      setSelectedKey(templatesForActiveTab[0].template_key)
    }
  }, [templatesForActiveTab, selectedKey])

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["notification-email-template", selectedKey],
    queryFn: async () => {
      if (!selectedKey) return null
      const res = await sdk.client.fetch<DetailResponse>(
        `/admin/notification-email-templates/${encodeURIComponent(selectedKey)}`
      )
      return res
    },
    enabled: !!selectedKey,
  })

  useEffect(() => {
    if (!detail) return
    setSubject(detail.subject || detail.defaults.subject)
    setReplyTo(detail.reply_to || "")
    setEnabled(detail.configured ? detail.is_enabled : true)
    setHtmlBody(detail.html_body || detail.defaults.html_body)
  }, [detail])

  const selectedMeta = useMemo(
    () => templates.find((t) => t.template_key === selectedKey),
    [templates, selectedKey]
  )

  const save = useCallback(async () => {
    if (!selectedKey) return
    setSaving(true)
    try {
      await sdk.client.fetch(
        `/admin/notification-email-templates/${encodeURIComponent(selectedKey)}`,
        {
          method: "POST",
          body: {
            subject,
            reply_to: replyTo.trim() || null,
            is_enabled: enabled,
            html_body: htmlBody,
          },
        }
      )
      toast.success("Notification template saved.")
      await queryClient.invalidateQueries({
        queryKey: ["notification-email-templates"],
      })
      await queryClient.invalidateQueries({
        queryKey: ["notification-email-template", selectedKey],
      })
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not save template."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }, [
    selectedKey,
    subject,
    replyTo,
    enabled,
    htmlBody,
    queryClient,
  ])

  const resetDefaults = useCallback(async () => {
    if (!selectedKey) return
    setSaving(true)
    try {
      await sdk.client.fetch(
        `/admin/notification-email-templates/${encodeURIComponent(selectedKey)}`,
        {
          method: "POST",
          body: { reset_to_defaults: true },
        }
      )
      toast.success("Template reset to defaults.")
      await queryClient.invalidateQueries({
        queryKey: ["notification-email-templates"],
      })
      await queryClient.invalidateQueries({
        queryKey: ["notification-email-template", selectedKey],
      })
    } catch (e: unknown) {
      const msg =
        e &&
        typeof e === "object" &&
        "message" in e &&
        typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Could not reset template."
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }, [selectedKey, queryClient])

  const renderTemplateNavItem = (t: CatalogEntry) => {
    const active = t.template_key === selectedKey
    const dotClass =
      TEMPLATE_DOT_CLASS[t.template_key] ?? "bg-ui-fg-muted"
    return (
      <li key={t.template_key}>
        <button
          type="button"
          onClick={() => setSelectedKey(t.template_key)}
          className={[
            "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors",
            active
              ? "bg-ui-bg-base-hover text-ui-fg-base"
              : "text-ui-fg-subtle hover:bg-ui-bg-subtle-hover hover:text-ui-fg-base",
          ].join(" ")}
        >
          <span
            className={`mt-1.5 size-2 shrink-0 rounded-full ${dotClass}`}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="txt-compact-small-plus block truncate">
              {t.label}
            </span>
            {t.configured && t.is_enabled ? (
              <span className="txt-compact-xsmall text-ui-fg-muted">
                Custom
              </span>
            ) : null}
          </span>
        </button>
      </li>
    )
  }

  return (
    <Container className="flex min-h-0 flex-col divide-y p-0">
      <div className="flex shrink-0 items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Notification emails</Heading>
        </div>
      </div>

      <div className="flex min-h-[min(70vh,640px)] flex-1 flex-col lg:flex-row">
        <aside className="border-ui-border-base bg-ui-bg-subtle flex min-h-0 shrink-0 flex-col border-b lg:w-64 lg:border-b-0 lg:border-r">
          {listLoading ? (
            <div className="p-4">
              <Text size="small" className="text-ui-fg-muted">
                Loading templates…
              </Text>
            </div>
          ) : (
            <Tabs
              value={audienceTab}
              onValueChange={(v) => setAudienceTab(v as "customer" | "admin")}
              className="flex min-h-0 max-h-56 flex-1 flex-col overflow-hidden lg:max-h-none"
            >
              <div className="border-ui-border-base shrink-0 border-b px-3 py-3">
                <Tabs.List>
                  <Tabs.Trigger value="customer">Customer</Tabs.Trigger>
                  <Tabs.Trigger value="admin">Admin</Tabs.Trigger>
                </Tabs.List>
              </div>
              <Tabs.Content
                value="customer"
                className="min-h-0 flex-1 overflow-y-auto outline-none"
              >
                <nav className="p-4 pt-3" aria-label="Customer notification templates">
                  <Text size="xsmall" className="text-ui-fg-muted mb-2">
                    Emails sent to shoppers (order lifecycle and pay links).
                  </Text>
                  <ul className="flex flex-col gap-0.5">
                    {customerTemplates.map(renderTemplateNavItem)}
                  </ul>
                </nav>
              </Tabs.Content>
              <Tabs.Content
                value="admin"
                className="min-h-0 flex-1 overflow-y-auto outline-none"
              >
                <nav className="p-4 pt-3" aria-label="Admin notification templates">
                  <Text size="xsmall" className="text-ui-fg-muted mb-2">
                    Emails sent to staff (for example admin invitations).
                  </Text>
                  {adminTemplates.length === 0 ? (
                    <Text size="small" className="text-ui-fg-muted">
                      No admin templates in catalog.
                    </Text>
                  ) : (
                    <ul className="flex flex-col gap-0.5">
                      {adminTemplates.map(renderTemplateNavItem)}
                    </ul>
                  )}
                </nav>
              </Tabs.Content>
            </Tabs>
          )}
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          {!listLoading && selectedMeta ? (
            <div className="mb-6 flex flex-col gap-2 border-ui-border-base border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-2">
                <span
                  className={`mt-1 size-2 shrink-0 rounded-full ${TEMPLATE_DOT_CLASS[selectedMeta.template_key] ?? "bg-ui-fg-muted"}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <Heading level="h2" className="txt-compact-large-plus">
                    {selectedMeta.label}
                  </Heading>
                  {selectedMeta.description ? (
                    <Text size="small" className="text-ui-fg-subtle mt-1">
                      {selectedMeta.description}
                    </Text>
                  ) : null}
                  <Text size="xsmall" className="text-ui-fg-muted mt-1.5">
                    Recipients:{" "}
                    {(selectedMeta.audience ?? "customer") === "admin"
                      ? "admin users"
                      : "customers"}
                  </Text>
                </div>
              </div>
              {detail && !detailLoading ? (
                <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                  <Button
                    variant="primary"
                    onClick={() => void save()}
                    disabled={saving}
                  >
                    Save
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void resetDefaults()}
                    disabled={saving}
                  >
                    Reset to defaults
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {listLoading ? null : detailLoading || !detail ? (
            <Text size="small" className="text-ui-fg-muted">
              {selectedKey ? "Loading template…" : "Select a template."}
            </Text>
          ) : (
            <div className="flex max-w-4xl flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <Label htmlFor="subj">Subject</Label>
                  <label className="flex items-center gap-2 txt-compact-small text-ui-fg-subtle">
                    <Switch
                      checked={enabled}
                      onCheckedChange={setEnabled}
                    />
                    Use custom template
                  </label>
                </div>
                <Input
                  id="subj"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={detail.defaults.subject}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="reply">Reply-To (optional)</Label>
                <Input
                  id="reply"
                  value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="info@example.com"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="html">Email body (plain text)</Label>
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Blank line = new paragraph; single line break = line break in the email. You can
                  still use full paths (e.g.{" "}
                  <code className="txt-compact-xsmall">{"{{order.display_id}}"}</code>
                  ) or blocks like{" "}
                  <code className="txt-compact-xsmall">{"{{#each order.items}}"}</code>. Saved
                  full-HTML templates from before this change are still sent as HTML.
                </Text>
                <Textarea
                  id="html"
                  className={bodyTextareaClass}
                  value={htmlBody}
                  onChange={(e) => setHtmlBody(e.target.value)}
                  placeholder={`Hi {{customer_name}},\n\nYour order #{{order_id}}…`}
                />
                <div className="flex flex-col gap-2">
                  <Text
                    size="xsmall"
                    weight="plus"
                    className="text-ui-fg-muted uppercase tracking-wide"
                  >
                    Common variables
                  </Text>
                  <div className="flex flex-wrap gap-1.5">
                    {(selectedKey === INVITE_TEMPLATE_KEY
                      ? INVITE_TEMPLATE_VARS
                      : selectedKey === ADMIN_ORDER_PLACED_TEMPLATE_KEY ||
                          selectedKey === ADMIN_DEFERRED_ORDER_PAID_TEMPLATE_KEY
                        ? ADMIN_NEW_ORDER_TEMPLATE_VARS
                        : ORDER_TEMPLATE_VARS
                    ).map((v) => (
                      <code
                        key={v}
                        className="bg-ui-bg-subtle txt-compact-xsmall rounded-md border border-ui-border-base px-2 py-1 text-ui-fg-subtle"
                      >
                        {v}
                      </code>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Container>
  )
}

export default NotificationEmailTemplatesPage

export const config = defineRouteConfig({
  label: "Notification emails",
  icon: Envelope,
  rank: 80,
})
