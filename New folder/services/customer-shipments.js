// Customer-safe projection of the existing seller allocations; no duplicate
// tracking source and no changes to payment or administrative order status.
export async function customerShipments(pool,orders,storeName='NovaCart') {
  const result=new Map();
  if(!orders.length)return result;
  const ids=orders.map(o=>o.id);
  const allocations=(await pool.query(`select so.order_id,so.seller_id,so.status,
    so.tracking_number,so.courier,so.updated_at,s.user_id,s.store_name,s.slug
    from seller_orders so join sellers s on s.id=so.seller_id
    where so.order_id=any($1::text[]) order by so.created_at,so.seller_id`,[ids])).rows;
  const items=(await pool.query(`select order_id,seller_id,product_id,variant_id,title,qty,supplier_snapshot
    from order_items where order_id=any($1::text[]) order by id`,[ids])).rows;
  const supplierRows=(await pool.query("select order_id,provider,fulfillment_status,packages,last_sync_at from supplier_orders where order_id=any($1::text[]) and status='submitted'",[ids])).rows;
  const byOrder=new Map(ids.map(id=>[id,{allocations:[],items:[]}]));
  for(const row of allocations)byOrder.get(row.order_id).allocations.push(row);
  for(const row of items)byOrder.get(row.order_id).items.push(row);
  const publicItem=i=>({productId:i.product_id,variantId:i.variant_id,title:i.title,qty:i.qty});
  for(const order of orders){
    const data=byOrder.get(order.id),owners=new Set(data.allocations.map(s=>s.user_id));
    const shipments=data.allocations.map(s=>({
      key:'seller:'+s.seller_id,type:'seller',sellerName:s.store_name,sellerSlug:s.slug,
      status:s.status,trackingNumber:s.tracking_number,courier:s.courier,updatedAt:s.updated_at,
      items:data.items.filter(i=>i.seller_id===s.user_id).map(publicItem)
    }));
    const supplied=new Set();
    for(const provider of ['amazon','aliexpress']){
      const suppliedItems=data.items.filter(i=>i.supplier_snapshot?.provider===provider&&!owners.has(i.seller_id));if(!suppliedItems.length)continue;
      suppliedItems.forEach(i=>supplied.add(i));const source=supplierRows.find(s=>s.order_id===order.id&&s.provider===provider);
      const packages=(source?.packages||[]).map(p=>({trackingNumber:p.trackingNumber,courier:p.courier,status:p.status}));
      shipments.push({key:'supplier:'+provider,type:'supplier',sellerName:storeName+' · '+(provider==='amazon'?'MCF shipment':'Supplier shipment'),sellerSlug:null,status:source?.fulfillment_status||'processing',trackingNumber:packages.map(p=>p.trackingNumber).filter(Boolean).join(', '),courier:[...new Set(packages.map(p=>p.courier).filter(Boolean))].join(', '),updatedAt:source?.last_sync_at||order.updated_at,packages,items:suppliedItems.map(publicItem)});
    }
    const remaining=data.items.filter(i=>(!i.seller_id||!owners.has(i.seller_id))&&!supplied.has(i));
    if(remaining.length||!shipments.length)shipments.push({
      key:'store',type:'store',sellerName:storeName,sellerSlug:null,status:order.status,
      trackingNumber:order.tracking_number||'',courier:order.courier||'',updatedAt:order.updated_at,
      items:remaining.map(publicItem)
    });
    const rank={placed:0,paid:0,processing:1,packed:2,partially_shipped:2.5,shipped:3,delivered:4};
    const levels=shipments.map(s=>rank[s.status]??-1);
    const terminal=['pending_payment','payment_failed','payment_expired','cancelled','refunded','delivered'];
    let fulfillmentStatus=order.status;
    if(!terminal.includes(order.status)){
      if(levels.every(n=>n>=4))fulfillmentStatus='delivered';
      else if(levels.every(n=>n>=3))fulfillmentStatus='shipped';
      else if(levels.some(n=>n>=2.5))fulfillmentStatus='partially_shipped';
      else if(levels.every(n=>n>=2))fulfillmentStatus='packed';
      else if(levels.some(n=>n>=1))fulfillmentStatus='processing';
    }
    const canCancel=['pending_payment','placed','processing'].includes(order.status)
      &&['unpaid','cod'].includes(order.payment_status)
      &&!shipments.some(s=>['packed','shipped','delivered'].includes(s.status));
    result.set(order.id,{fulfillmentStatus,canCancel,shipments});
  }
  return result;
}
