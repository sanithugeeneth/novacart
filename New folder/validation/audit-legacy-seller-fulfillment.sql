-- Read only. Review historical seller fulfillment against payment/shipment evidence.
select so.order_id, so.seller_id, so.status as seller_status,
       so.tracking_number, o.status as order_status, o.payment_method,
       o.payment_status, o.paid_at, o.inventory_released
from seller_orders so
join orders o on o.id = so.order_id
where so.status in ('processing', 'packed', 'shipped', 'delivered')
  and o.payment_method = 'stripe'
  and (o.payment_status in ('unpaid', 'failed', 'pending')
       or (o.payment_status = 'paid' and o.paid_at is null))
order by so.created_at desc;
