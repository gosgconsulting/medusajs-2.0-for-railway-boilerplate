import React, { useMemo } from "react"
import SimpleMdeReact from "react-simplemde-editor"
import "easymde/dist/easymde.min.css"

export type SimpleMarkdownEditorProps = {
  value: string
  onChange: (value: string) => void
  id?: string
  placeholder?: string
  minHeight?: string | number
  className?: string
}

export function SimpleMarkdownEditor({
  value,
  onChange,
  id,
  placeholder,
  minHeight = 280,
  className = "",
}: SimpleMarkdownEditorProps) {
  const options = useMemo(() => {
    return {
      placeholder,
      minHeight: typeof minHeight === "number" ? `${minHeight}px` : minHeight,
      spellChecker: false,
      status: false,
      toolbar: [
        "bold",
        "italic",
        "heading",
        "|",
        "quote",
        "unordered-list",
        "ordered-list",
        "|",
        "link",
        "|",
        "preview",
        "side-by-side",
        "fullscreen",
        "|",
        "guide",
      ],
    } as any
  }, [placeholder, minHeight])

  return (
    <div className={`simple-mde-wrapper ${className}`.trim()}>
      <style>{`
        /* Minimal custom styling to force light mode appearance */
        .simple-mde-wrapper .editor-toolbar {
          border-color: #e5e7eb !important;
          background-color: #f9fafb !important;
          border-top-left-radius: 6px !important;
          border-top-right-radius: 6px !important;
          opacity: 1 !important;
        }
        .simple-mde-wrapper .editor-toolbar button {
          color: #374151 !important;
        }
        .simple-mde-wrapper .editor-toolbar button.active, 
        .simple-mde-wrapper .editor-toolbar button:hover {
          background: #f3f4f6 !important;
          border-color: #e5e7eb !important;
        }
        .simple-mde-wrapper .CodeMirror {
          border-color: #e5e7eb !important;
          border-bottom-left-radius: 6px !important;
          border-bottom-right-radius: 6px !important;
          font-family: inherit !important;
          background-color: #ffffff !important;
          color: #111827 !important;
          font-size: 14px !important;
        }
        .simple-mde-wrapper .CodeMirror-cursor {
          border-left: 1px solid #111827 !important;
        }
        
        /* Fix Tailwind CSS reset stripping list styles in the preview pane */
        .simple-mde-wrapper .editor-preview ul,
        .simple-mde-wrapper .editor-preview-side ul {
          list-style-type: disc !important;
          padding-left: 1.5rem !important;
          margin-bottom: 1rem !important;
        }
        .simple-mde-wrapper .editor-preview ol,
        .simple-mde-wrapper .editor-preview-side ol {
          list-style-type: decimal !important;
          padding-left: 1.5rem !important;
          margin-bottom: 1rem !important;
        }
        .simple-mde-wrapper .editor-preview li,
        .simple-mde-wrapper .editor-preview-side li {
          margin-bottom: 0.25rem !important;
        }
      `}</style>
      <SimpleMdeReact
        id={id}
        value={value}
        onChange={onChange}
        options={options}
      />
    </div>
  )
}
