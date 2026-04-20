import React, { useCallback, useEffect, useRef, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowsPointingOut, CaretMinimizeDiagonal, Window } from "@medusajs/icons"
import { Button, Heading, Text } from "@medusajs/ui"

const SITES_ENV_KEY = "VITE_ADMIN_EMBEDDED_SITES" as const
const LEGACY_URL_ENV_KEY = "VITE_ADMIN_EMBEDDED_SITE_URL" as const

type EmbeddedSiteEntry = { label: string; url: string }

type AdminImportMeta = ImportMeta & {
  env?: {
    VITE_ADMIN_EMBEDDED_SITES?: string
    VITE_ADMIN_EMBEDDED_SITE_URL?: string
  }
}

function getEnvString(key: keyof NonNullable<AdminImportMeta["env"]>): string {
  if (typeof import.meta === "undefined") {
    return ""
  }
  const raw = (import.meta as AdminImportMeta).env?.[key]
  return typeof raw === "string" ? raw.trim() : ""
}

function parseEmbeddedSites(): { entries: EmbeddedSiteEntry[]; error: string | null } {
  const jsonRaw = getEnvString(SITES_ENV_KEY)
  if (jsonRaw) {
    try {
      const parsed: unknown = JSON.parse(jsonRaw)
      if (!Array.isArray(parsed)) {
        return {
          entries: [],
          error: `${SITES_ENV_KEY} must be a JSON array of objects with "label" and "url".`,
        }
      }
      const entries: EmbeddedSiteEntry[] = []
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue
        const rec = item as Record<string, unknown>
        const label = typeof rec.label === "string" ? rec.label.trim() : ""
        const url = typeof rec.url === "string" ? rec.url.trim() : ""
        if (!url) continue
        entries.push({
          label: label || url,
          url,
        })
      }
      return { entries, error: null }
    } catch {
      return {
        entries: [],
        error: `${SITES_ENV_KEY} is not valid JSON.`,
      }
    }
  }

  const legacyUrl = getEnvString(LEGACY_URL_ENV_KEY)
  if (legacyUrl) {
    return {
      entries: [{ label: "Embedded", url: legacyUrl }],
      error: null,
    }
  }

  return { entries: [], error: null }
}

const { entries, error: parseError } = parseEmbeddedSites()

function getFullscreenElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null
  }
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

async function exitFullscreen(): Promise<void> {
  const d = document as Document & { webkitExitFullscreen?: () => void }
  if (document.exitFullscreen) {
    await document.exitFullscreen()
    return
  }
  d.webkitExitFullscreen?.()
}

async function requestFullscreenEl(el: HTMLElement): Promise<void> {
  const anyEl = el as HTMLElement & {
    webkitRequestFullscreen?: () => void
  }
  if (el.requestFullscreen) {
    await el.requestFullscreen()
    return
  }
  anyEl.webkitRequestFullscreen?.()
}

const EmbeddedSitePage = () => {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [iframeFullscreen, setIframeFullscreen] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (selectedIndex >= entries.length) {
      setSelectedIndex(0)
    }
  }, [entries.length, selectedIndex])

  const active = entries[selectedIndex]

  useEffect(() => {
    const iframe = iframeRef.current
    if (iframe && getFullscreenElement() === iframe) {
      void exitFullscreen().catch(() => {})
    }
  }, [selectedIndex])

  useEffect(() => {
    const sync = () => {
      setIframeFullscreen(getFullscreenElement() === iframeRef.current)
    }
    document.addEventListener("fullscreenchange", sync)
    document.addEventListener("webkitfullscreenchange", sync as EventListener)
    return () => {
      document.removeEventListener("fullscreenchange", sync)
      document.removeEventListener(
        "webkitfullscreenchange",
        sync as EventListener
      )
    }
  }, [])

  const toggleIframeFullscreen = useCallback(async () => {
    const el = iframeRef.current
    if (!el) return
    try {
      if (getFullscreenElement() === el) {
        await exitFullscreen()
      } else {
        await requestFullscreenEl(el)
      }
    } catch {
      // Unsupported or blocked (e.g. permissions)
    }
  }, [])

  return (
    <div
      className={[
        "bg-ui-bg-base relative ml-[calc(50%-50vw+150px)] flex min-h-[calc(100vh-100px)] w-screen min-w-0 max-w-[calc(100vw-300px)] flex-1 flex-col divide-y divide-ui-border-base",
        "shadow-none",
      ].join(" ")}
    >
      <div className="flex shrink-0 flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Heading level="h1">Embedded site</Heading>
            <Text size="small" className="text-ui-fg-muted">
              External pages load in a frame below. Some hosts refuse embedding (for
              example strict{" "}
              <code className="txt-compact-xsmall">X-Frame-Options</code> or CSP); if
              the frame stays blank, try a URL that allows iframes or open the link in
              a new tab.
            </Text>
          </div>
          {active ? (
            <Button
              type="button"
              variant="secondary"
              size="small"
              className="shrink-0"
              onClick={() => void toggleIframeFullscreen()}
            >
              <span className="flex items-center gap-1.5">
                {iframeFullscreen ? (
                  <CaretMinimizeDiagonal className="text-ui-fg-subtle" />
                ) : (
                  <ArrowsPointingOut className="text-ui-fg-subtle" />
                )}
                {iframeFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </span>
            </Button>
          ) : null}
        </div>
        {parseError ? (
          <Text size="small" className="text-ui-fg-error">
            {parseError}
          </Text>
        ) : null}
        {!parseError && entries.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle">
            Set{" "}
            <code className="txt-compact-xsmall">{SITES_ENV_KEY}</code> to a JSON
            array like{" "}
            <code className="txt-compact-xsmall break-all">
              [{`{"label":"Docs","url":"https://docs.medusajs.com"}`}]
            </code>
            , or set a single URL with{" "}
            <code className="txt-compact-xsmall">{LEGACY_URL_ENV_KEY}</code>. Then
            restart <code className="txt-compact-xsmall">medusa develop</code> or
            rebuild the admin.
          </Text>
        ) : null}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row lg:min-h-0">
        {entries.length > 1 ? (
          <aside className="border-ui-border-base bg-ui-bg-subtle flex max-h-48 min-h-0 w-full shrink-0 flex-col overflow-hidden border-b lg:max-h-none lg:w-56 lg:border-b-0 lg:border-r">
            <nav className="min-h-0 flex-1 overflow-y-auto p-3" aria-label="Embedded pages">
              <ul className="flex flex-col gap-0.5">
                {entries.map((e, i) => {
                  const isActive = i === selectedIndex
                  return (
                    <li key={`${e.url}-${i}`}>
                      <button
                        type="button"
                        onClick={() => setSelectedIndex(i)}
                        className={[
                          "w-full rounded-md px-2 py-2 text-left transition-colors",
                          isActive
                            ? "bg-ui-bg-base-hover text-ui-fg-base"
                            : "text-ui-fg-subtle hover:bg-ui-bg-subtle-hover hover:text-ui-fg-base",
                        ].join(" ")}
                      >
                        <span className="txt-compact-small-plus block truncate">
                          {e.label}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </aside>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-4">
          {active ? (
            <iframe
              ref={iframeRef}
              title={active.label}
              src={active.url}
              allow="fullscreen"
              className="bg-ui-bg-base min-h-[min(70vh,480px)] w-full flex-1 border-0 lg:min-h-0"
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default EmbeddedSitePage

export const config = defineRouteConfig({
  label: "Sparti Pages",
  icon: Window,
  rank: 75,
})
