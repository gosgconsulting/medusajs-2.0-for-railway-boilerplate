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

const mono = "font-mono text-sm min-h-[320px]"

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

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h1">Notification emails</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            Edit HTML email bodies with{" "}
            <a
              href="https://handlebarsjs.com/guide/"
              target="_blank"
              rel="noreferrer"
              className="text-ui-fg-interactive"
            >
              Handlebars
            </a>
            . When disabled or empty, the built-in React template is used.
          </Text>
        </div>
      </div>

      <div className="flex flex-col gap-6 px-6 py-6">
        {listLoading ? (
          <Text size="small" className="text-ui-fg-muted">
            Loading…
          </Text>
        ) : (
          <>
            <div className="flex max-w-md flex-col gap-2">
              <Label htmlFor="tpl-select">Notification</Label>
              <select
                id="tpl-select"
                className="border-ui-border-base bg-ui-bg-field txt-small rounded-md border px-3 py-2"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {templates.map((t) => (
                  <option key={t.template_key} value={t.template_key}>
                    {t.label} ({t.template_key})
                    {t.configured && t.is_enabled ? " — custom" : ""}
                  </option>
                ))}
              </select>
              {selectedMeta?.description ? (
                <Text size="small" className="text-ui-fg-subtle">
                  {selectedMeta.description}
                </Text>
              ) : null}
            </div>

            {detailLoading || !detail ? (
              <Text size="small" className="text-ui-fg-muted">
                Loading template…
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
                      Use custom HTML template
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
                  <Label htmlFor="html">HTML body (Handlebars)</Label>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    Order email: variables include{" "}
                    <code className="txt-compact-xsmall">order</code>,{" "}
                    <code className="txt-compact-xsmall">shippingAddress</code>,{" "}
                    <code className="txt-compact-xsmall">preview</code>. Invite:{" "}
                    <code className="txt-compact-xsmall">inviteLink</code>,{" "}
                    <code className="txt-compact-xsmall">preview</code>. Helper:{" "}
                    <code className="txt-compact-xsmall">{"{{formatDate order.created_at}}"}</code>
                  </Text>
                  <Textarea
                    id="html"
                    className={mono}
                    value={htmlBody}
                    onChange={(e) => setHtmlBody(e.target.value)}
                    placeholder="Paste HTML or click Reset to defaults"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
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
              </div>
            )}
          </>
        )}
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
