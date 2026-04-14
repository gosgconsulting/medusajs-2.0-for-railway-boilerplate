/** Strip HTML tags; keeps plain text (markdown punctuation is unchanged). */
export function stripHtmlTags(raw: string | null | undefined): string {
  if (raw == null || raw === "") return ""
  if (typeof window === "undefined") {
    return raw.replace(/<[^>]*>/g, "").trim()
  }
  try {
    const doc = new DOMParser().parseFromString(raw, "text/html")
    const text = doc.body.textContent ?? ""
    return text.replace(/\u00a0/g, " ").trim()
  } catch {
    return raw.replace(/<[^>]*>/g, "").trim()
  }
}
