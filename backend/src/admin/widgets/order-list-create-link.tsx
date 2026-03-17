import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button } from "@medusajs/ui"
import { Link } from "react-router-dom"

const OrderListCreateWidget = () => {
  return (
    <div className="flex justify-end px-6 pb-3 pt-1">
      <Button size="small" variant="secondary" asChild>
        <Link to="/orders/create">+ Create order</Link>
      </Button>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default OrderListCreateWidget
