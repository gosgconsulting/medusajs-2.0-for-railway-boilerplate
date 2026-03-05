import React, { useCallback, useRef } from "react"
import { Button } from "@medusajs/ui"
import { ListBullet, QueueList } from "@medusajs/icons"

export type SimpleMarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  minHeight?: string | number
  className?: string
}

/**
 * Wrap or insert markdown formatting at the textarea selection.
 * Returns [newValue, newCursorStart, newCursorEnd].
 */
function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string
): [string, number, number] {
  const selected = value.slice(start, end)
  const newValue =
    value.slice(0, start) + before + selected + after + value.slice(end)
  const newStart = start + before.length
  const newEnd = newStart + selected.length
  return [newValue, newStart, newEnd]
}

/**
 * Insert placeholder markers with cursor between them.
 * Returns [newValue, cursorPosition].
 */
function insertPlaceholder(
  value: string,
  start: number,
  before: string,
  after: string
): [string, number] {
  const cursorPos = start + before.length
  const newValue = value.slice(0, start) + before + after + value.slice(start)
  return [newValue, cursorPos]
}

/**
 * Get start index of the line containing position.
 */
function getLineStart(value: string, position: number): number {
  const lastNewline = value.lastIndexOf("\n", position - 1)
  return lastNewline === -1 ? 0 : lastNewline + 1
}

/**
 * Get end index of the line containing position (exclusive).
 */
function getLineEnd(value: string, position: number): number {
  const nextNewline = value.indexOf("\n", position)
  return nextNewline === -1 ? value.length : nextNewline
}

/**
 * Simple list toggle: prefix current line (or first line of selection) with "- " or "1. ".
 * If it already has that prefix, remove it.
 */
function toggleListSimple(
  value: string,
  start: number,
  end: number,
  prefix: string
): [string, number, number] {
  const lineStart = getLineStart(value, start)
  const lineEnd = getLineEnd(value, end)
  const line = value.slice(lineStart, lineEnd)
  const trimmed = line.trimStart()
  const indent = line.slice(0, line.length - trimmed.length)

  const hasBullet = /^(-|\*)\s/.test(trimmed)
  const hasNumber = /^\d+\.\s/.test(trimmed)

  let newLine: string
  if (prefix === "- ") {
    if (hasBullet) {
      newLine = indent + trimmed.replace(/^(-|\*)\s/, "")
    } else {
      newLine = indent + "- " + trimmed
    }
  } else {
    if (hasNumber) {
      newLine = indent + trimmed.replace(/^\d+\.\s/, "")
    } else {
      newLine = indent + "1. " + trimmed
    }
  }

  const newValue =
    value.slice(0, lineStart) + newLine + value.slice(lineEnd)
  const cursorPos = lineStart + newLine.length
  return [newValue, cursorPos, cursorPos]
}

export function SimpleMarkdownEditor({
  value,
  onChange,
  id,
  placeholder,
  minHeight = 280,
  className = "",
}: SimpleMarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const applyFormat = useCallback(
    (before: string, after: string) => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const start = el.selectionStart
      const end = el.selectionEnd
      if (start === end) {
        const [newValue, cursorPos] = insertPlaceholder(value, start, before, after)
        onChange(newValue)
        requestAnimationFrame(() => {
          el.setSelectionRange(cursorPos, cursorPos)
        })
      } else {
        const [newValue, newStart, newEnd] = wrapSelection(
          value,
          start,
          end,
          before,
          after
        )
        onChange(newValue)
        requestAnimationFrame(() => {
          el.setSelectionRange(newStart, newEnd)
        })
      }
    },
    [value, onChange]
  )

  const applyList = useCallback(
    (prefix: string) => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const start = el.selectionStart
      const end = el.selectionEnd
      const [newValue, newStart, newEnd] = toggleListSimple(value, start, end, prefix)
      onChange(newValue)
      requestAnimationFrame(() => {
        el.setSelectionRange(newStart, newEnd)
      })
    },
    [value, onChange]
  )

  const handleBold = useCallback(() => applyFormat("**", "**"), [applyFormat])
  const handleItalic = useCallback(() => applyFormat("*", "*"), [applyFormat])
  const handleUnderline = useCallback(
    () => applyFormat("<u>", "</u>"),
    [applyFormat]
  )
  const handleBulletList = useCallback(
    () => applyList("- "),
    [applyList]
  )
  const handleNumberedList = useCallback(
    () => applyList("1. "),
    [applyList]
  )

  const style = typeof minHeight === "number" ? { minHeight: `${minHeight}px` } : { minHeight }

  return (
    <div
      className={`flex flex-col rounded-md border border-ui-border-base overflow-hidden ${className}`.trim()}
    >
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-ui-border-base bg-ui-bg-subtle flex-wrap">
        <Button
          type="button"
          size="small"
          variant="transparent"
          onClick={handleBold}
          className="font-bold"
        >
          B
        </Button>
        <Button
          type="button"
          size="small"
          variant="transparent"
          onClick={handleItalic}
          className="italic"
        >
          I
        </Button>
        <Button
          type="button"
          size="small"
          variant="transparent"
          onClick={handleUnderline}
          className="underline"
        >
          U
        </Button>
        <span className="w-px h-5 bg-ui-border-base mx-1" aria-hidden />
        <Button
          type="button"
          size="small"
          variant="transparent"
          onClick={handleBulletList}
          aria-label="Bullet list"
        >
          <ListBullet />
        </Button>
        <Button
          type="button"
          size="small"
          variant="transparent"
          onClick={handleNumberedList}
          aria-label="Numbered list"
        >
          <QueueList />
        </Button>
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={style}
        className="flex-1 w-full resize-y rounded-b-md border-0 bg-ui-bg-field px-3 py-2 txt-small text-ui-fg-base placeholder:text-ui-fg-muted focus:outline-none focus:ring-0"
      />
    </div>
  )
}
