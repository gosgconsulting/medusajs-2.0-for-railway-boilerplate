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
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { sdk } from "../../lib/sdk"

type CatalogEntry = {
  template_key: string
  label: string
  description: string
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
}

const INVITE_TEMPLATE_KEY = "invite-user"

const NotificationEmailTemplatesPage = () => {
  const queryClient = useQueryClient()
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

  useEffect(() => {
    if (!selectedKey && templates.length > 0) {
      setSelectedKey(templates[0].template_key)
    }
  }, [templates, selectedKey])

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

  const { orderTemplates, otherTemplates } = useMemo(() => {
    const order: CatalogEntry[] = []
    const other: CatalogEntry[] = []
    for (const t of templates) {
      if (t.template_key === INVITE_TEMPLATE_KEY) {
        other.push(t)
      } else {
        order.push(t)
      }
    }
    return { orderTemplates: order, otherTemplates: other }
  }, [templates])

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
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Write plain-text email bodies with{" "}
            <a
              href="https://handlebarsjs.com/guide/"
              target="_blank"
              rel="noreferrer"
              className="text-ui-fg-interactive"
            >
              Handlebars
            </a>{" "}
            placeholders. The server turns them into HTML for sending. When disabled or empty, the
            built-in React template is used. Optional{" "}
            <code className="txt-compact-xsmall">STORE_NAME</code> and{" "}
            <code className="txt-compact-xsmall">STORE_SUPPORT_EMAIL</code> env vars fill{" "}
            <code className="txt-compact-xsmall">{"{{store_name}}"}</code> and{" "}
            <code className="txt-compact-xsmall">{"{{support_email}}"}</code>.
          </Text>
        </div>
      </div>

      <div className="flex min-h-[min(70vh,640px)] flex-1 flex-col lg:flex-row">
        <aside className="border-ui-border-base bg-ui-bg-subtle shrink-0 border-b lg:w-64 lg:border-b-0 lg:border-r">
          {listLoading ? (
            <div className="p-4">
              <Text size="small" className="text-ui-fg-muted">
                Loading templates…
              </Text>
            </div>
          ) : (
            <nav
              className="max-h-56 overflow-y-auto lg:max-h-none lg:h-full"
              aria-label="Notification templates"
            >
              <div className="p-4 pb-2">
                <Text
                  size="xsmall"
                  weight="plus"
                  className="text-ui-fg-muted uppercase tracking-wide"
                >
                  Order notifications
                </Text>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {orderTemplates.map(renderTemplateNavItem)}
                </ul>
              </div>
              {otherTemplates.length > 0 ? (
                <div className="border-ui-border-base border-t p-4 pt-3">
                  <Text
                    size="xsmall"
                    weight="plus"
                    className="text-ui-fg-muted uppercase tracking-wide"
                  >
                    Admin
                  </Text>
                  <ul className="mt-2 flex flex-col gap-0.5">
                    {otherTemplates.map(renderTemplateNavItem)}
                  </ul>
                </div>
              ) : null}
            </nav>
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
