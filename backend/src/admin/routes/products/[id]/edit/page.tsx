import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  Link,
  useLoaderData,
  useParams,
  type LoaderFunctionArgs,
} from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Label,
  Switch,
  Text,
  Textarea,
  toast,
  Tooltip,
} from "@medusajs/ui"
import { ChevronLeft, ThumbnailBadge, Trash } from "@medusajs/icons"
import { SimpleMarkdownEditor } from "../../../../components/SimpleMarkdownEditor"
import { sdk } from "../../../../lib/sdk"

const ACCEPT_IMAGES = "image/jpeg,image/png,image/gif,image/webp"

type LoaderData = Awaited<ReturnType<typeof loader>>

async function loader({ params }: LoaderFunctionArgs): Promise<{ product: any }> {
  const { id } = params
  if (!id) {
    throw new Response("Not found", { status: 404 })
  }
  try {
    const { product } = await sdk.admin.product.retrieve(id)
    return { product }
  } catch {
    throw new Response("Product not found", { status: 404 })
  }
}

function getProductFromData(data: LoaderData | undefined) {
  return data?.product
}

const ProductEditPage = () => {
  const loaderData = useLoaderData() as LoaderData | undefined
  const { id } = useParams<{ id: string }>()
  const productFromLoader = getProductFromData(loaderData)

  const queryClient = useQueryClient()
  const { data: fetchedProduct, isLoading: isLoadingProduct } = useQuery({
    queryKey: ["admin-product", id],
    queryFn: () => sdk.admin.product.retrieve(id!).then((r) => r.product),
    enabled: Boolean(id) && !productFromLoader,
  })

  const initialProduct = productFromLoader ?? fetchedProduct
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [updatingMedia, setUpdatingMedia] = useState(false)

  const [title, setTitle] = useState(initialProduct?.title ?? "")
  const [subtitle, setSubtitle] = useState(initialProduct?.subtitle ?? "")
  const [description, setDescription] = useState(
    initialProduct?.description ?? ""
  )
  const [status, setStatus] = useState(initialProduct?.status ?? "draft")
  const [handle, setHandle] = useState(initialProduct?.handle ?? "")
  const [tagsInput, setTagsInput] = useState(
    (initialProduct?.tags ?? [])
      .map((t: { value?: string }) => (typeof t === "object" && t?.value) || t)
      .filter(Boolean)
      .join(", ")
  )
  const [material, setMaterial] = useState(initialProduct?.material ?? "")
  const [discountable, setDiscountable] = useState(
    initialProduct?.discountable ?? true
  )
  const [thumbnail, setThumbnail] = useState(initialProduct?.thumbnail ?? "")
  const [weight, setWeight] = useState(
    initialProduct?.weight != null ? String(initialProduct.weight) : ""
  )
  const [width, setWidth] = useState(
    initialProduct?.width != null ? String(initialProduct.width) : ""
  )
  const [height, setHeight] = useState(
    initialProduct?.height != null ? String(initialProduct.height) : ""
  )
  const [length, setLength] = useState(
    initialProduct?.length != null ? String(initialProduct.length) : ""
  )
  const [originCountry, setOriginCountry] = useState(
    initialProduct?.origin_country ?? ""
  )
  const [midCode, setMidCode] = useState(initialProduct?.mid_code ?? "")
  const [hsCode, setHsCode] = useState(initialProduct?.hs_code ?? "")
  const [externalId, setExternalId] = useState(initialProduct?.external_id ?? "")
  const [optionsState, setOptionsState] = useState<
    { id: string; title: string; valuesStr: string }[]
  >(
    (initialProduct?.options ?? []).map(
      (o: { id?: string; title?: string; values?: Array<{ value?: string } | string> }) => ({
        id: o.id ?? "",
        title: o.title ?? "",
        valuesStr: (o.values ?? [])
          .map((v) => (typeof v === "object" && v?.value) || v)
          .filter(Boolean)
          .join(", "),
      })
    )
  )
  const [savingOptions, setSavingOptions] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<"success" | "error" | null>(
    null
  )
  const [metadataEntries, setMetadataEntries] = useState<{ key: string; value: string }[]>(() => {
    if (!initialProduct?.metadata) return [{ key: "", value: "" }]
    const entries = Object.entries(initialProduct.metadata).map(([k, v]) => ({ key: k, value: String(v) }))
    return entries.length > 0 ? entries : [{ key: "", value: "" }]
  })


  useEffect(() => {
    if (!initialProduct) return
    setTitle(initialProduct.title ?? "")
    setSubtitle(initialProduct.subtitle ?? "")
    setDescription(initialProduct.description ?? "")
    setStatus(initialProduct.status ?? "draft")
    setHandle(initialProduct.handle ?? "")
    setTagsInput(
      (initialProduct.tags ?? [])
        .map((t: { value?: string }) => (typeof t === "object" && t?.value) || t)
        .filter(Boolean)
        .join(", ")
    )
    setMaterial(initialProduct.material ?? "")
    setDiscountable(initialProduct.discountable ?? true)
    setThumbnail(initialProduct.thumbnail ?? "")
    setWeight(
      initialProduct.weight != null ? String(initialProduct.weight) : ""
    )
    setWidth(initialProduct.width != null ? String(initialProduct.width) : "")
    setHeight(initialProduct.height != null ? String(initialProduct.height) : "")
    setLength(initialProduct.length != null ? String(initialProduct.length) : "")
    setOriginCountry(initialProduct.origin_country ?? "")
    setMidCode(initialProduct.mid_code ?? "")
    setHsCode(initialProduct.hs_code ?? "")
    setExternalId(initialProduct.external_id ?? "")
    setOptionsState(
      (initialProduct.options ?? []).map(
        (o: { id?: string; title?: string; values?: Array<{ value?: string } | string> }) => ({
          id: o.id ?? "",
          title: o.title ?? "",
          valuesStr: (o.values ?? [])
            .map((v) => (typeof v === "object" && v?.value) || v)
            .filter(Boolean)
            .join(", "),
        })
      )
    )
    const entries = initialProduct.metadata
      ? Object.entries(initialProduct.metadata).map(([k, v]) => ({ key: k, value: String(v) }))
      : []
    setMetadataEntries(entries.length > 0 ? entries : [{ key: "", value: "" }])
  }, [initialProduct])

  const handleSave = useCallback(async () => {
    if (!id) return
    setSaving(true)
    setSaveMessage(null)

    const parsedMetadata = metadataEntries.reduce((acc, { key, value }) => {
      if (key.trim()) {
        acc[key.trim()] = value
      }
      return acc
    }, {} as Record<string, string>)

    try {
      const tags = tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const num = (v: string) => (v === "" ? undefined : Number(v))
      await sdk.admin.product.update(id, {
        title: title || undefined,
        subtitle: subtitle || undefined,
        description: description || undefined,
        metadata: parsedMetadata,
        status: status as "draft" | "published",
        handle: handle || undefined,
        material: material || undefined,
        discountable,
        thumbnail: thumbnail || undefined,
        weight: num(weight),
        width: num(width),
        height: num(height),
        length: num(length),
        origin_country: originCountry || undefined,
        mid_code: midCode || undefined,
        hs_code: hsCode || undefined,
        external_id: externalId || undefined,
        ...(tags.length > 0 && { tags: tags.map((value) => ({ value })) }),
      } as unknown as Parameters<typeof sdk.admin.product.update>[1])
      setSaveMessage("success")
      toast.success("Product saved")
    } catch {
      setSaveMessage("error")
      toast.error("Failed to save product")
    } finally {
      setSaving(false)
    }
  }, [
    id,
    title,
    subtitle,
    description,
    status,
    handle,
    tagsInput,
    material,
    discountable,
    thumbnail,
    weight,
    width,
    height,
    length,
    originCountry,
    midCode,
    hsCode,
    externalId,
    metadataEntries,
  ])

  const refetchProduct = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin-product", id] })
  }, [queryClient, id])

  const handleUploadImages = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!id || !files?.length) return
      setUploading(true)
      try {
        const { files: uploaded } = await sdk.admin.upload.create({
          files: Array.from(files),
        })
        if (!uploaded?.length) {
          toast.error("Upload failed")
          return
        }
        const currentImages = (initialProduct?.images ?? []).map(
          (i: { id?: string; url?: string }) => ({ id: i.id, url: i.url })
        )
        const newImages = [
          ...currentImages,
          ...uploaded.map((f: { url?: string }) => ({ url: f.url })),
        ]
        await sdk.admin.product.update(id, {
          images: newImages,
        } as Parameters<typeof sdk.admin.product.update>[1])
        toast.success("Images added")
        refetchProduct()
      } catch (err) {
        toast.error("Failed to upload images")
      } finally {
        setUploading(false)
        e.target.value = ""
      }
    },
    [id, initialProduct?.images, refetchProduct]
  )

  const handleDeleteImage = useCallback(
    async (imageId: string, imageUrl: string) => {
      if (!id) return
      setUpdatingMedia(true)
      try {
        const currentImages = (initialProduct?.images ?? []).map(
          (i: { id?: string; url?: string }) => ({ id: i.id, url: i.url })
        )
        const mediaToKeep = currentImages.filter((i: { id?: string }) => i.id !== imageId)
        const wasThumbnail = initialProduct?.thumbnail === imageUrl
        await sdk.admin.product.update(id, {
          images: mediaToKeep,
          ...(wasThumbnail && { thumbnail: "" }),
        } as Parameters<typeof sdk.admin.product.update>[1])
        toast.success("Image removed")
        refetchProduct()
      } catch {
        toast.error("Failed to remove image")
      } finally {
        setUpdatingMedia(false)
      }
    },
    [id, initialProduct?.images, initialProduct?.thumbnail, refetchProduct]
  )

  const handleSetAsThumbnail = useCallback(
    async (imageUrl: string) => {
      if (!id) return
      setUpdatingMedia(true)
      try {
        await sdk.admin.product.update(id, {
          thumbnail: imageUrl,
        } as Parameters<typeof sdk.admin.product.update>[1])
        setThumbnail(imageUrl)
        toast.success("Thumbnail updated")
        refetchProduct()
      } catch {
        toast.error("Failed to set thumbnail")
      } finally {
        setUpdatingMedia(false)
      }
    },
    [id, refetchProduct]
  )

  const handleSaveOptions = useCallback(async () => {
    if (!id) return
    setSavingOptions(true)
    try {
      for (const opt of optionsState) {
        if (!opt.id) continue
        const values = opt.valuesStr
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        await sdk.admin.product.updateOption(id, opt.id, {
          title: opt.title || undefined,
          values,
        } as Parameters<typeof sdk.admin.product.updateOption>[2])
      }
      toast.success("Options saved")
      refetchProduct()
    } catch {
      toast.error("Failed to save options")
    } finally {
      setSavingOptions(false)
    }
  }, [id, optionsState, refetchProduct])

  const handleDeleteOption = useCallback(
    async (optionId: string) => {
      if (!id || !optionId) return
      setSavingOptions(true)
      try {
        await sdk.admin.product.deleteOption(id, optionId)
        toast.success("Option deleted")
        // Remove from local state immediately for better UX
        setOptionsState((prev) => prev.filter((o) => o.id !== optionId))
        refetchProduct()
      } catch {
        toast.error("Failed to delete option")
      } finally {
        setSavingOptions(false)
      }
    },
    [id, refetchProduct]
  )

  const setOptionField = useCallback(
    (index: number, field: "title" | "valuesStr", value: string) => {
      setOptionsState((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [field]: value }
        return next
      })
    },
    []
  )

  const updateMetadataKey = useCallback((index: number, key: string) => {
    setMetadataEntries((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], key }
      return next
    })
  }, [])

  const updateMetadataValue = useCallback((index: number, value: string) => {
    setMetadataEntries((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], value }
      return next
    })
  }, [])

  const addMetadataEntry = useCallback(() => {
    setMetadataEntries((prev) => [...prev, { key: "", value: "" }])
  }, [])

  const removeMetadataEntry = useCallback((index: number) => {
    setMetadataEntries((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const isLoading = Boolean(id) && !initialProduct && isLoadingProduct
  const isNotFound = !id || (Boolean(id) && !initialProduct && !isLoadingProduct)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Text className="text-ui-fg-muted">Loading product…</Text>
      </div>
    )
  }

  if (isNotFound) {
    return (
      <div className="flex flex-col gap-4 p-8">
        <Text className="text-ui-fg-muted">Product not found.</Text>
        <Link to="/products">
          <Button variant="secondary">Back to products</Button>
        </Link>
      </div>
    )
  }

  const product = initialProduct!
  const images = product.images ?? []
  const variants = product.variants ?? []
  const options = product.options ?? []

  return (
    <div className="flex flex-col gap-6 pb-8">
      {/* Header: back + breadcrumb + Save + status */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to={`/products/${id}`}>
            <Button variant="transparent" size="small" className="!p-0 gap-1.5">
              <ChevronLeft />
              Back to products
            </Button>
          </Link>
          <span className="text-ui-fg-muted">/</span>
          <span className="text-ui-fg-subtle txt-small truncate max-w-[200px]">
            {title || "Edit product"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {saveMessage === "success" && (
            <Text size="small" className="text-ui-fg-success">
              Saved
            </Text>
          )}
          {saveMessage === "error" && (
            <Text size="small" className="text-ui-fg-error">
              Save failed
            </Text>
          )}
          <Badge color={status === "published" ? "green" : "grey"}>
            {status === "published" ? "Published" : "Draft"}
          </Badge>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-8">
        {/* Main column */}
        <div className="flex flex-col gap-6">
          {/* Media */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <Heading level="h2">Media</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Upload, delete, or set thumbnail. Drag order in default product view.
                </Text>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_IMAGES}
                multiple
                className="hidden"
                onChange={handleUploadImages}
              />
              <Button
                size="small"
                variant="secondary"
                disabled={uploading || updatingMedia}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Upload images"}
              </Button>
            </div>
            <div className="px-6 py-4 flex flex-col gap-4">
              {images.length > 0 ? (
                <div className="flex flex-wrap gap-4">
                  {images.map((img: { id?: string; url?: string }) => {
                    const isCurrentThumbnail = (product?.thumbnail ?? thumbnail) === img.url
                    return (
                      <div
                        key={img.id ?? img.url}
                        className="relative w-28 rounded-lg border border-ui-border-base overflow-hidden bg-ui-bg-subtle group"
                      >
                        <img
                          src={img.url}
                          alt=""
                          className="w-full aspect-square object-cover"
                        />
                        {isCurrentThumbnail && (
                          <span className="absolute left-1 top-1 rounded bg-ui-bg-base px-1.5 py-0.5 txt-small font-medium">
                            Thumbnail
                          </span>
                        )}
                        <div className="flex items-center justify-end gap-1 p-1.5 bg-ui-bg-base border-t border-ui-border-base">
                          {!isCurrentThumbnail && (
                            <Tooltip content="Set as thumbnail">
                              <IconButton
                                size="small"
                                variant="transparent"
                                disabled={updatingMedia}
                                onClick={() => handleSetAsThumbnail(img.url ?? "")}
                                type="button"
                              >
                                <ThumbnailBadge />
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip content="Remove image">
                            <IconButton
                              size="small"
                              variant="transparent"
                              className="text-ui-fg-error"
                              disabled={updatingMedia}
                              onClick={() => handleDeleteImage(img.id!, img.url ?? "")}
                              type="button"
                            >
                              <Trash />
                            </IconButton>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Text size="small" className="text-ui-fg-muted">
                    No images yet. Click «Upload images» to add some.
                  </Text>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? "Uploading…" : "Upload images"}
                  </Button>
                </div>
              )}
            </div>
          </Container>

          {/* Title & description */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Title and description</Heading>
            </div>
            <div className="px-6 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-title">Title</Label>
                <Input
                  id="product-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Product name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-subtitle">Subtitle</Label>
                <Input
                  id="product-subtitle"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Short tagline or subtitle"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-description">Description (Markdown)</Label>
                <SimpleMarkdownEditor
                  id="product-description"
                  value={description}
                  onChange={setDescription}
                  placeholder="Describe your product. Use the toolbar for bold, italic, underline, and lists."
                  minHeight={280}
                />
              </div>
            </div>
          </Container>

          {/* Options */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <Heading level="h2">Options</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Product options (e.g. Size, Color). Edit below and save.
                </Text>
              </div>
              <Link to={`/products/${id}/options/create`}>
                <Button size="small" variant="secondary">
                  Add option
                </Button>
              </Link>
            </div>
            <div className="px-6 py-4">
              {(optionsState.length > 0 || options.length > 0) ? (
                <div className="flex flex-col gap-4">
                  {optionsState.map((opt, index) => (
                    <div
                      key={opt.id}
                      className="flex flex-col gap-2 rounded-lg border border-ui-border-base bg-ui-bg-subtle p-4 relative group"
                    >
                      <div className="absolute top-2 right-2">
                        <IconButton
                          size="small"
                          variant="transparent"
                          className="text-ui-fg-error"
                          disabled={savingOptions}
                          onClick={() => opt.id && handleDeleteOption(opt.id)}
                          type="button"
                        >
                          <Trash />
                        </IconButton>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`option-title-${opt.id}`}>
                          Option name
                        </Label>
                        <Input
                          id={`option-title-${opt.id}`}
                          value={opt.title}
                          onChange={(e) =>
                            setOptionField(index, "title", e.target.value)
                          }
                          placeholder="e.g. Size, Color"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor={`option-values-${opt.id}`}>
                          Values (comma-separated)
                        </Label>
                        <Input
                          id={`option-values-${opt.id}`}
                          value={opt.valuesStr}
                          onChange={(e) =>
                            setOptionField(index, "valuesStr", e.target.value)
                          }
                          placeholder="e.g. S, M, L or Red, Blue, Green"
                        />
                      </div>
                    </div>
                  ))}
                  {optionsState.length > 0 && (
                    <Button
                      size="small"
                      variant="secondary"
                      disabled={savingOptions}
                      onClick={handleSaveOptions}
                    >
                      {savingOptions ? "Saving options…" : "Save options"}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3 items-start">
                  <Text size="small" className="text-ui-fg-muted">
                    No options yet. Add options like Size or Color to create variants.
                  </Text>
                  <Link to={`/products/${id}/options/create`}>
                    <Button size="small" variant="secondary">
                      Add option
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </Container>

          {/* Variants */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4 flex items-center justify-between">
              <div>
                <Heading level="h2">Variants</Heading>
                <Text size="small" className="text-ui-fg-subtle mt-1">
                  Variant details. Click Edit to change title, SKU, prices, and inventory.
                </Text>
              </div>
              <Link to={`/products/${id}/variants/create`}>
                <Button size="small" variant="secondary">
                  Add variant
                </Button>
              </Link>
            </div>
            <div className="px-6 py-4">
              {variants.length > 0 ? (
                <ul className="divide-y divide-ui-border-base -mt-3">
                  {variants.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <Text size="small" weight="plus" className="block truncate">
                          {v.title ?? v.id}
                        </Text>
                        {v.sku && (
                          <Text size="small" className="text-ui-fg-muted">
                            SKU: {v.sku}
                          </Text>
                        )}
                      </div>
                      <Link to={`/products/${id}/variants/${v.id}`}>
                        <Button size="small" variant="secondary">
                          Edit
                        </Button>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col gap-3 items-start">
                  <Text size="small" className="text-ui-fg-muted">
                    No variants yet.
                  </Text>
                  <Link to={`/products/${id}/variants/create`}>
                    <Button size="small" variant="secondary">
                      Add variant
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </Container>

          {/* Metadata */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Metadata</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Custom key-value pairs for this product.
              </Text>
            </div>
            <div className="px-6 py-4 flex flex-col gap-4">
              {metadataEntries.map((entry, i) => (
                <div key={i} className="flex flex-col gap-2 p-4 border border-ui-border-base rounded-lg bg-ui-bg-subtle">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1">
                      <Label className="mb-2 block">Key</Label>
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) => updateMetadataKey(i, e.target.value)}
                      />
                    </div>
                    <div className="pt-6">
                      <IconButton
                        variant="transparent"
                        className="text-ui-fg-error"
                        onClick={() => removeMetadataEntry(i)}
                        type="button"
                      >
                        <Trash />
                      </IconButton>
                    </div>
                  </div>
                  <div>
                    <Label className="mb-2 block">Value</Label>
                    <SimpleMarkdownEditor
                      id={`metadata-value-${i}`}
                      value={entry.value}
                      onChange={(val) => updateMetadataValue(i, val)}
                      placeholder="Metadata value"
                      minHeight={150}
                    />
                  </div>
                </div>
              ))}
              <div>
                <Button size="small" variant="secondary" onClick={addMetadataEntry} type="button">
                  Add metadata
                </Button>
              </div>
            </div>
          </Container>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-6">
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Status</Heading>
            </div>
            <div className="px-6 py-4">
              <div className="flex flex-col gap-2">
                <Label>Status</Label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "draft" | "published")}
                  className="flex h-8 w-full rounded-md border border-ui-border-base bg-ui-bg-field px-3 py-1.5 txt-small focus:border-ui-border-interactive focus:outline-none"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                </select>
              </div>
            </div>
          </Container>

          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Organization</Heading>
            </div>
            <div className="px-6 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-handle">Handle (URL)</Label>
                <Input
                  id="product-handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="product-handle"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-tags">Tags</Label>
                <Input
                  id="product-tags"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="tag1, tag2"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-material">Material</Label>
                <Input
                  id="product-material"
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  placeholder="e.g. Cotton, Polyester"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="product-discountable">Discountable</Label>
                <Switch
                  id="product-discountable"
                  checked={discountable}
                  onCheckedChange={setDiscountable}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="product-external-id">External ID</Label>
                <Input
                  id="product-external-id"
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder="e.g. ERP or external system ID"
                />
              </div>
              <div className="border-t border-ui-border-base pt-4 flex flex-col gap-2">
                <Text size="small" weight="plus" className="text-ui-fg-subtle">
                  More in default view
                </Text>
                <Text size="small" className="text-ui-fg-muted">
                  Categories, collection, shipping profile and inventory are managed in the default product view.
                </Text>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Link to={`/products/${id}/organization`}>
                    <Button size="small" variant="secondary">
                      Categories & collection
                    </Button>
                  </Link>
                  <Link to={`/products/${id}/shipping-profile`}>
                    <Button size="small" variant="secondary">
                      Shipping profile
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </Container>

          {/* Attributes: dimensions & customs */}
          <Container className="divide-y p-0">
            <div className="px-6 py-4">
              <Heading level="h2">Attributes</Heading>
              <Text size="small" className="text-ui-fg-subtle mt-1">
                Weight, dimensions, and customs codes
              </Text>
            </div>
            <div className="px-6 py-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-weight">Weight (g)</Label>
                  <Input
                    id="product-weight"
                    type="number"
                    min={0}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-origin">Origin country</Label>
                  <Input
                    id="product-origin"
                    value={originCountry}
                    onChange={(e) => setOriginCountry(e.target.value)}
                    placeholder="e.g. US"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-width">Width (mm)</Label>
                  <Input
                    id="product-width"
                    type="number"
                    min={0}
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-height">Height (mm)</Label>
                  <Input
                    id="product-height"
                    type="number"
                    min={0}
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-length">Length (mm)</Label>
                  <Input
                    id="product-length"
                    type="number"
                    min={0}
                    value={length}
                    onChange={(e) => setLength(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-mid">MID code</Label>
                  <Input
                    id="product-mid"
                    value={midCode}
                    onChange={(e) => setMidCode(e.target.value)}
                    placeholder=""
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-hs">HS code</Label>
                  <Input
                    id="product-hs"
                    value={hsCode}
                    onChange={(e) => setHsCode(e.target.value)}
                    placeholder=""
                  />
                </div>
              </div>
            </div>
          </Container>
        </div>
      </div>
    </div>
  )
}

export { loader }
export default ProductEditPage

export const handle = {
  breadcrumb: ({ data }: { data?: LoaderData }) =>
    data?.product?.title ?? "Edit product",
}
