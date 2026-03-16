import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button } from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"
import { Link } from "react-router-dom"

const ProductListBulkEditWidget = () => {
  return (
    <div className="flex justify-end px-6 pb-3 pt-1">
      <Button size="small" variant="secondary" asChild>
        <Link to="/products/bulk-edit">
          <PencilSquare />
          Bulk Edit
        </Link>
      </Button>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default ProductListBulkEditWidget
