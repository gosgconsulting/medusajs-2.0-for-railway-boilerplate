import { MedusaError } from "@medusajs/framework/utils"

export type DeeplTranslateParams = {
  apiBase: string
  authKey: string
  sourceLang: string
  targetLang: string
  texts: string[]
}

export type DeeplTranslateResult = {
  translations: string[]
}

function joinTranslateUrl(apiBase: string): string {
  const trimmed = apiBase.replace(/\/+$/, "")
  if (trimmed.endsWith("/translate")) return trimmed
  return `${trimmed}/translate`
}

/**
 * Calls DeepL `/v2/translate`. Auth: `Authorization: DeepL-Auth-Key …` (not form body).
 * `apiBase` is typically `https://api-free.deepl.com/v2` or `https://api.deepl.com/v2`.
 */
export async function deeplTranslateTexts(
  params: DeeplTranslateParams
): Promise<DeeplTranslateResult> {
  const { authKey, sourceLang, targetLang, texts } = params
  const url = joinTranslateUrl(params.apiBase)
  const body = new URLSearchParams()
  body.set("source_lang", sourceLang.toUpperCase())
  body.set("target_lang", targetLang.toUpperCase())
  for (const t of texts) {
    body.append("text", t)
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `DeepL request failed (${res.status}): ${text.slice(0, 500)}`
    )
  }

  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "DeepL returned non-JSON response"
    )
  }

  const obj = json as { translations?: { text?: string }[] }
  const list = obj.translations
  if (!Array.isArray(list) || list.length !== texts.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "DeepL response missing translations or length mismatch"
    )
  }

  const translations = list.map((row, i) => {
    const out = row?.text
    if (typeof out !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `DeepL translation missing text at index ${i}`
      )
    }
    return out
  })

  return { translations }
}
