import crypto from 'node:crypto';
import {providerJSON,enabled,IntegrationError} from './provider-http.js';

const text=(v,n=240)=>String(v??'').trim().slice(0,n);
const array=(v,key)=>Array.isArray(v)?v:Array.isArray(v?.[key])?v[key]:[];
const stock=v=>Number.isInteger(Number(v))&&Number(v)>=0?Math.min(Number(v),1000000):null;
const photo=v=>{try{const u=new URL(v);if(!['https:','http:'].includes(u.protocol))return '';u.protocol='https:';return u.toString();}catch{return '';}};
export function aliSignature(parameters,secret,protocol='iop') {
  const input=Object.keys(parameters).filter(k=>k!=='sign').sort().map(k=>k+parameters[k]).join('');
  return crypto.createHmac(protocol==='top'?'md5':'sha256',secret).update(input).digest('hex').toUpperCase();
}

export function supplierAdapters(env,fetcher=fetch) {
  let amazonToken=null;
  const region=String(env.AMAZON_SP_API_REGION||'na');
  const amazonHost={na:'https://sellingpartnerapi-na.amazon.com',eu:'https://sellingpartnerapi-eu.amazon.com',fe:'https://sellingpartnerapi-fe.amazon.com'}[region];
  const protocol=String(env.ALIEXPRESS_PROTOCOL||'iop');
  const statuses={
    amazon:{enabled:enabled(env.ENABLE_AMAZON_SYNC),configured:Boolean(amazonHost&&env.AMAZON_LWA_CLIENT_ID&&env.AMAZON_LWA_CLIENT_SECRET&&env.AMAZON_REFRESH_TOKEN&&env.AMAZON_MARKETPLACE_ID),forwarding:enabled(env.ENABLE_AMAZON_FORWARDING),tracking:true,cancellation:'api_request',payment:'amazon_account_billing',retailPurchasing:false,mode:'Amazon MCF — your own fulfillment inventory'},
    aliexpress:{enabled:enabled(env.ENABLE_ALIEXPRESS_SYNC),configured:Boolean(['iop','top'].includes(protocol)&&env.ALIEXPRESS_APP_KEY&&env.ALIEXPRESS_APP_SECRET&&env.ALIEXPRESS_ACCESS_TOKEN),forwarding:enabled(env.ENABLE_ALIEXPRESS_FORWARDING),tracking:true,cancellation:'provider_account',payment:'provider_account',liveCompatibilityVerified:false,mode:'AliExpress DS account required; payment/cancellation completed in provider account'}
  };
  function ready(provider,forward=false) {
    const c=statuses[provider];if(!c)throw new IntegrationError('Unknown supplier.',400);
    if(!c.enabled||!c.configured)throw new IntegrationError('This supplier is not configured.',503);
    if(forward&&!c.forwarding)throw new IntegrationError('Supplier forwarding is disabled in server configuration.',503);
  }
  async function amazon(path,options={}) {
    ready('amazon');
    if(!amazonToken||amazonToken.expires<Date.now()) {
      const t=await providerJSON(fetcher,'https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:env.AMAZON_REFRESH_TOKEN,client_id:env.AMAZON_LWA_CLIENT_ID,client_secret:env.AMAZON_LWA_CLIENT_SECRET}).toString()});
      if(!t.access_token||!Number.isFinite(Number(t.expires_in)))throw new IntegrationError('Amazon authorization failed.');
      amazonToken={value:t.access_token,expires:Date.now()+Math.max(0,Math.min(Number(t.expires_in),3600)-60)*1000};
    }
    return providerJSON(fetcher,amazonHost+path,{...options,headers:{'x-amz-access-token':amazonToken.value,'user-agent':'NovaCart/20.0 (Language=JavaScript)','content-type':'application/json',...options.headers}});
  }
  async function ali(method,args) {
    ready('aliexpress');
    const timestamp=protocol==='top'?new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' '):String(Date.now());
    const parameters={app_key:env.ALIEXPRESS_APP_KEY,session:env.ALIEXPRESS_ACCESS_TOKEN,method,format:'json',v:'2.0',sign_method:protocol==='top'?'hmac':'sha256',timestamp,...args};
    parameters.sign=aliSignature(parameters,env.ALIEXPRESS_APP_SECRET,protocol);
    const data=await providerJSON(fetcher,protocol==='top'?'https://eco.taobao.com/router/rest':'https://api-sg.aliexpress.com/sync',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters).toString()});
    const body=data[method.replaceAll('.','_')+'_response'];
    if(data.error_response||!body||body.rsp_code&&!['200','0'].includes(String(body.rsp_code)))throw new IntegrationError('AliExpress rejected the request. Verify token, product availability and API permissions in your provider console.');
    return body.result;
  }
  async function product(provider,selection) {
    ready(provider);
    const externalId=text(selection.externalId,60),externalSku=text(selection.externalSku,240),country=text(selection.country,80).toUpperCase();
    if(!/^[A-Z]{2}$/.test(country)||!externalSku)throw new IntegrationError('Choose a supplier SKU and a two-letter destination country.',400);
    if(provider==='amazon') {
      if(!/^[A-Z0-9]{10}$/.test(externalId)||externalSku.length>50)throw new IntegrationError('Enter a valid Amazon ASIN and seller SKU.',400);
      const marketplace=env.AMAZON_MARKETPLACE_ID;
      const catalog=await amazon(`/catalog/2022-04-01/items/${encodeURIComponent(externalId)}?`+new URLSearchParams({marketplaceIds:marketplace,includedData:'summaries,images,attributes'}));
      const inv=await amazon('/fba/inventory/v1/summaries?'+new URLSearchParams({granularityType:'Marketplace',granularityId:marketplace,marketplaceIds:marketplace,sellerSku:externalSku,details:'true'}));
      const entry=inv.payload?.inventorySummaries?.find(x=>x.sellerSku===externalSku&&x.asin===externalId);
      if(!entry||stock(entry.inventoryDetails?.fulfillableQuantity)===null)throw new IntegrationError('No matching fulfillable inventory was returned for that ASIN and SKU.');
      const summary=catalog.summaries?.find(s=>s.marketplaceId===marketplace)||catalog.summaries?.[0];
      const photos=(catalog.images?.find(s=>s.marketplaceId===marketplace)||catalog.images?.[0])?.images||[];
      const image=photo((photos.find(p=>p.variant==='MAIN')||photos[0])?.link);
      if(catalog.asin!==externalId||!summary?.itemName||!image)throw new IntegrationError('Amazon product details were incomplete.');
      return {externalId,externalSku,country,marketplace,title:text(summary.itemName,180),description:(catalog.attributes?.bullet_point||[]).map(x=>text(x.value,500)).join('\n').slice(0,4000),image,images:[...new Set(photos.map(p=>photo(p.link)).filter(Boolean))].slice(0,8),brand:text(summary.brand,120),stock:stock(entry.inventoryDetails.fulfillableQuantity),cost:null,currency:String(env.CURRENCY||'USD').toUpperCase(),logisticsService:''};
    }
    if(!/^\d{5,20}$/.test(externalId))throw new IntegrationError('Enter an AliExpress product ID.',400);
    const currency=String(env.CURRENCY||'USD').toUpperCase();
    const result=await ali('aliexpress.ds.product.get',{product_id:externalId,ship_to_country:country,target_currency:currency,target_language:'EN'});
    const base=result?.ae_item_base_info_dto;
    const sku=array(result?.ae_item_sku_info_dtos,'ae_item_sku_info_d_t_o').find(x=>[String(x.id),String(x.sku_id)].includes(externalSku));
    if(!base||!sku)throw new IntegrationError('That AliExpress SKU was not found. Copy the exact SKU identifier from the approved product response.');
    const live=base.product_status_type==='onSelling';
    const amount=Number(sku.offer_sale_price??sku.sku_price),count=stock(sku.sku_available_stock??sku.ipm_sku_stock);
    if(!Number.isFinite(amount)||amount<0||count===null||String(sku.currency_code||base.currency_code).toUpperCase()!==currency)throw new IntegrationError('Supplier price, currency or exact stock was missing; no estimated inventory was imported.');
    const images=String(result.ae_multimedia_info_dto?.image_urls||'').split(';').map(photo).filter(Boolean).slice(0,8);
    if(!images.length||!base.subject)throw new IntegrationError('AliExpress product details were incomplete.');
    const properties=array(sku.ae_sku_property_dtos,'ae_sku_property_d_t_o').map(p=>text(p.property_value_definition_name||p.sku_property_value,60)).filter(Boolean);
    return {externalId,externalSku:String(sku.id||externalSku),country,marketplace:'',title:text(base.subject+(properties.length?' — '+properties.join(', '):''),180),description:text(String(base.detail||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' '),4000),image:images[0],images,brand:'',stock:live?count:0,cost:Math.round(amount*100)/100,currency,logisticsService:text(selection.logisticsService,100)};
  }
  function payload(provider,order,items,reference) {
    const address=order.shipping_address||{};
    const country=text(address.country,80).toUpperCase();
    if(!/^[A-Z]{2}$/.test(country)||!address.fullName||!address.line1||!address.city||!address.postalCode||!order.phone)throw new IntegrationError('A complete delivery address, two-letter country and phone are required.',400);
    if(items.some(i=>i.supplier_snapshot.country!==country))throw new IntegrationError('The delivery country differs from the country used to sync these products.',409);
    if(items.length>100||items.reduce((n,i)=>n+i.qty,0)>250)throw new IntegrationError('This shipment exceeds the supported item limit.',400);
    if(provider==='amazon') {
      if(items.some(i=>i.supplier_snapshot.marketplace!==env.AMAZON_MARKETPLACE_ID))throw new IntegrationError('Amazon marketplace changed. Review the original order mapping.',409);
      if(country==='IN')throw new IntegrationError('India MCF requires additional payment information. Fulfill this shipment through Seller Central.',409);
      return {marketplaceId:env.AMAZON_MARKETPLACE_ID,sellerFulfillmentOrderId:reference,displayableOrderId:order.id.slice(0,40),displayableOrderDate:new Date(order.created_at).toISOString(),displayableOrderComment:'Thank you for your NovaCart order.',shippingSpeedCategory:'Standard',fulfillmentAction:'Ship',fulfillmentPolicy:'FillOrKill',destinationAddress:{name:address.fullName,addressLine1:address.line1,addressLine2:address.line2||'',city:address.city,stateOrRegion:address.state||'',postalCode:address.postalCode,countryCode:country,phone:order.phone},items:items.map(i=>({sellerSku:i.supplier_snapshot.externalSku,sellerFulfillmentOrderItemId:String(i.id),quantity:i.qty}))};
    }
    if(items.some(i=>!i.supplier_snapshot.logisticsService))throw new IntegrationError('Each AliExpress item needs its confirmed logistics service before checkout.',409);
    return {logistics_address:{address:address.line1,address2:address.line2||'',city:address.city,contact_person:address.fullName,full_name:address.fullName,country,province:address.state||'',zip:address.postalCode,mobile_no:order.phone,locale:'en_US'},product_items:items.map(i=>({product_id:i.supplier_snapshot.externalId,sku_attr:i.supplier_snapshot.externalSku,product_count:i.qty,logistics_service_name:i.supplier_snapshot.logisticsService,order_memo:'NovaCart '+reference}))};
  }
  async function forward(provider,body) {
    ready(provider,true);
    if(provider==='amazon'){await amazon('/fba/outbound/2020-07-01/fulfillmentOrders',{method:'POST',body:JSON.stringify(body)});return {externalIds:[body.sellerFulfillmentOrderId],status:'submitted',message:'Amazon accepted the fulfillment request.'};}
    const result=await ali('aliexpress.trade.buy.placeorder',{param_place_order_request4_open_api_d_t_o:JSON.stringify(body)});
    const ids=array(result?.order_list,'number').map(String);
    if(![true,'true'].includes(result?.is_success)||!ids.length||ids.some(x=>!/^\d+$/.test(x)))throw new IntegrationError('Supplier order acceptance could not be confirmed. Check AliExpress before any further action.');
    return {externalIds:ids,status:'submitted',message:'Order created in AliExpress. Complete supplier payment in your approved account.'};
  }
  async function reconcileAmazon(reference,expected) {
    const response=await amazon('/fba/outbound/2020-07-01/fulfillmentOrders/'+encodeURIComponent(reference));
    const value=response.payload;
    if(value?.fulfillmentOrder?.sellerFulfillmentOrderId!==reference)throw new IntegrationError('No matching Amazon fulfillment was confirmed.');
    const items=value.fulfillmentOrderItems||[];
    if(expected.items.some(i=>!items.some(x=>x.sellerFulfillmentOrderItemId===i.sellerFulfillmentOrderItemId&&x.sellerSku===i.sellerSku&&Number(x.quantity)===i.quantity)))throw new IntegrationError('Amazon fulfillment items did not match this order.');
    return {externalIds:[reference],status:'submitted',message:'Amazon fulfillment verified: '+text(value.fulfillmentOrder.fulfillmentOrderStatus,50)};
  }
    async function orderStatus(row) {
    ready(row.provider);
    if(row.provider==='amazon'){
      const response=await amazon('/fba/outbound/2020-07-01/fulfillmentOrders/'+encodeURIComponent(row.reference));
      const value=response.payload,order=value?.fulfillmentOrder,items=value?.fulfillmentOrderItems||[];
      if(order?.sellerFulfillmentOrderId!==row.reference||!order.fulfillmentOrderStatus)throw new IntegrationError('Amazon returned an incomplete or mismatched order.');
      if(!row.payload.items?.length||row.payload.items.some(i=>!items.some(x=>x.sellerFulfillmentOrderItemId===i.sellerFulfillmentOrderItemId&&x.sellerSku===i.sellerSku&&Number(x.quantity)===i.quantity)))throw new IntegrationError('Amazon fulfillment items do not match the original shipment.');
      const state=text(order.fulfillmentOrderStatus,60),packages=[],warnings=[];let missingPackage=false;
      for(const shipment of value.fulfillmentShipments||[]){
        if(shipment.fulfillmentShipmentStatus==='CancelledByFulfiller')continue;
        for(const p of shipment.fulfillmentShipmentPackage||[]){
          if(packages.length>=100)throw new IntegrationError('Too many packages. Review in the provider account.');
          if(!p.trackingNumber){missingPackage=true;continue;}
          let packageStatus=shipment.fulfillmentShipmentStatus==='Shipped'?'shipped':'processing';
          if(packages.length<20&&Number.isInteger(p.packageNumber)){
            try{const detail=(await amazon('/fba/outbound/2020-07-01/tracking?'+new URLSearchParams({packageNumber:String(p.packageNumber)}))).payload;
              if(!detail||detail.trackingNumber!==p.trackingNumber||Number(detail.packageNumber)!==p.packageNumber)throw new IntegrationError('Tracking package mismatch.');
              if(detail.currentStatus==='DELIVERED')packageStatus='delivered';
            }catch{warnings.push('Package delivery details unavailable; tracking number retained.');}
          }
          packages.push({key:String(shipment.amazonShipmentId||'')+':'+String(p.packageNumber),trackingNumber:text(p.trackingNumber,160),courier:text(p.carrierCode,100),status:packageStatus});
        }
      }
      // Complete means Amazon handed off the order, not proof of customer delivery.
      const fulfillment=state==='Cancelled'?'cancelled':state==='Complete'&&!missingPackage&&packages.length&&packages.every(p=>p.status==='delivered')?'delivered':state==='Complete'&&packages.length?'shipped':packages.some(p=>['shipped','delivered'].includes(p.status))?'partially_shipped':'processing';
      return {warnings:[...new Set(warnings)],fulfillment,payment:'provider_billed',cancel:state==='Cancelled'?'confirmed':state==='Cancelling'?'requested':null,packages,states:[{id:row.reference,status:state}],externalIds:[row.reference]};
    }
    const ids=row.external_ids;
    if(!Array.isArray(ids)||!ids.length||ids.length>20||ids.some(id=>!/^\d{5,30}$/.test(String(id))))throw new IntegrationError('Exact AliExpress order references are required (up to 20 per shipment).');
    const states=[],packages=[];
    for(const id of ids){
      const r=await ali('aliexpress.ds.trade.order.get',{order_id:String(id)});
      if(!r||typeof r.order_status!=='string'||!r.order_status)throw new IntegrationError('AliExpress order-query response is incompatible. Check DS API permissions.');
      if(r.order_id!=null&&String(r.order_id)!==String(id))throw new IntegrationError('AliExpress returned a different order reference.');
      const state=text(r.order_status,60),logistics=text(r.logistics_status,60);
      states.push({id:String(id),status:state,logistics});
      for(const p of array(r.logistics_info_list,'ae_order_logistics_info')){
        if(!p.logistics_no)continue;
        packages.push({key:String(id)+':'+text(p.logistics_no,160),trackingNumber:text(p.logistics_no,160),courier:text(p.logistics_service,100),status:logistics==='BUYER_ACCEPT_GOODS'?'delivered':logistics==='SELLER_SEND_GOODS'?'shipped':'processing'});
      }
    }
    const paid=new Set(['WAIT_SELLER_SEND_GOODS','SELLER_PART_SEND_GOODS','WAIT_BUYER_ACCEPT_GOODS','FUND_PROCESSING']);
    const payment=states.every(s=>paid.has(s.status))?'paid':states.every(s=>s.status==='PLACE_ORDER_SUCCESS')?'awaiting_payment':'unknown';
    const fulfillment=states.every(s=>s.logistics==='BUYER_ACCEPT_GOODS')?'delivered':states.every(s=>s.logistics==='SELLER_SEND_GOODS')?'shipped':packages.some(p=>p.status==='shipped'||p.status==='delivered')?'partially_shipped':payment==='paid'?'processing':'pending';
    return {fulfillment,payment,cancel:states.some(s=>s.status==='IN_CANCEL')?'requested':null,packages,states,externalIds:ids};
  }
  async function cancelAmazon(row){
    ready('amazon');
    await amazon('/fba/outbound/2020-07-01/fulfillmentOrders/'+encodeURIComponent(row.reference)+'/cancel',{method:'PUT'});
    return {status:'requested',message:'Cancellation requested. Tracking sync must confirm the final outcome; this does not refund the customer.'};
  }

  return {statuses,ready,product,payload,forward,reconcileAmazon,orderStatus,cancelAmazon};
}
