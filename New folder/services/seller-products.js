import crypto from 'node:crypto';
const problem=(message,status=400)=>Object.assign(new Error(message),{status});
const has=(o,k)=>Object.hasOwn(o,k);
function text(value,name,max,minimum=0){if(typeof value!=='string'||value.trim().length<minimum||value.trim().length>max)throw problem(`${name} must contain ${minimum}–${max} characters.`);return value.trim();}
function cash(value,name,nullable=false){if(nullable&&(value===null||value===''))return null;if(!['string','number'].includes(typeof value)||String(value).trim()==='')throw problem(`${name} must be a valid amount.`);const n=Number(value);if(!Number.isFinite(n)||n<0||n>9999999999.99||Math.abs(n*100-Math.round(n*100))>0.00001)throw problem(`${name} must be non-negative with at most two decimal places.`);return n;}
function stock(value){if(!['string','number'].includes(typeof value)||String(value).trim()==='')throw problem('Stock must be a whole number.');const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>2147483647)throw problem('Stock must be a non-negative whole number.');return n;}
function image(value,optional=false){const v=text(value,'Image URL',800,optional?0:1);if(!v&&optional)return v;if(/^\/assets\/[a-zA-Z0-9_./-]+$/.test(v)&&!v.includes('..'))return v;try{const u=new URL(v);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw 0;}catch{throw problem('Use an http(s) image URL or a local /assets/ image.');}return v;}
function body(req){if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw problem('Send a JSON object.');return req.body;}
function values(input,current={},variant=false){
 const field=(key,column=key,defaultValue='')=>has(input,key)?input[key]:(current[column]??defaultValue);
 const out={title:text(field('title'),'Title',180,2),price:cash(field('price','price',0),'Price'),oldPrice:cash(field('oldPrice','old_price',null),'Compare-at price',true),stock:stock(field('stock','stock',0)),sku:text(field('sku'),'SKU',80),image:image(field('image'),variant),active:field('active','active',true)};
 if(typeof out.active!=='boolean')throw problem('Visibility must be true or false.');
 if(out.oldPrice!==null&&out.oldPrice<out.price)throw problem('Compare-at price must be at least the selling price.');
 if(!variant)Object.assign(out,{cat:text(field('cat','cat','Other'),'Category',80,1),description:text(field('description'),'Description',3000),brand:text(field('brand'),'Brand',120),searchKeywords:text(field('searchKeywords','search_keywords'),'Search keywords',500),badge:text(field('badge','badge','NEW'),'Badge',40),costPrice:cash(field('costPrice','cost_price',0),'Cost price')});
 return out;
}
function publicProduct(p,currency){return {...p,currency:currency.toUpperCase(),price:Number(p.price),oldPrice:p.old_price==null?null:Number(p.old_price),costPrice:Number(p.cost_price||0),rating:Number(p.rating||0),variants:(p.variants||[]).map(v=>({...v,price:Number(v.price),oldPrice:v.old_price==null?null:Number(v.old_price)}))};}
async function audit(c,req,action,id,details){await c.query('insert into audit_logs(actor_user_id,action,entity_type,entity_id,details) values($1,$2,$3,$4,$5)',[req.session.uid,action,'product',id,JSON.stringify(details)]);}
async function inventory(c,req,id,variantId,previous,next){const delta=next-previous;if(delta)await c.query("insert into inventory_movements(product_id,variant_id,change_qty,reason,created_by) values($1,$2,$3,'seller_stock_update',$4)",[id,variantId,delta,req.session.uid]);}
function checkVersion(input,current){if(has(input,'expectedRevision')&&input.expectedRevision!==current.revision)throw problem('This product changed since you opened it. Reload the latest values before saving.',409);if(has(input,'stock')&&(!has(input,'expectedStock')||stock(input.expectedStock)!==current.stock))throw problem('Stock changed or its previous value is missing. Reload the latest stock before saving.',409);}
async function readOne(c,id,owner,currency){const p=(await c.query(`select p.*,p.updated_at::text as revision,exists(select 1 from supplier_products sp where sp.product_id=p.id) as supplier_managed from products p where p.id=$1 and p.seller_id=$2`,[id,owner])).rows[0];if(!p)throw problem('Product not found.',404);p.variants=(await c.query('select *,updated_at::text as revision from product_variants where product_id=$1 order by created_at,id',[id])).rows;return publicProduct(p,currency);}

export function registerSellerProducts({app,pool,sellerOnly,csrfOk,fail,ok,currency}){
 app.get('/api/seller/products',sellerOnly,async(req,res)=>{
  try{const page=Number(req.query.page||1),limit=Number(req.query.limit||24),q=String(req.query.q||'').trim(),visibility=req.query.visibility||'all';if(!Number.isSafeInteger(page)||page<1||!Number.isInteger(limit)||limit<1||limit>100||q.length>180||!['all','active','hidden'].includes(visibility)||!Number.isSafeInteger((page-1)*limit))throw problem('Invalid catalogue filters.');
   const args=[req.session.uid],clauses=['p.seller_id=$1'];if(q){args.push('%'+q.toLowerCase()+'%');clauses.push(`(lower(p.title) like $${args.length} or lower(coalesce(p.sku,'')) like $${args.length} or lower(p.cat) like $${args.length})`);}if(visibility!=='all')clauses.push(`p.active=${visibility==='active'?'true':'false'}`);const where=clauses.join(' and '),count=(await pool.query(`select count(*)::int n from products p where ${where}`,args)).rows[0].n;args.push(limit,(page-1)*limit);
   const rows=(await pool.query(`select p.*,p.updated_at::text as revision,exists(select 1 from supplier_products sp where sp.product_id=p.id) as supplier_managed from products p where ${where} order by p.created_at desc,p.id limit $${args.length-1} offset $${args.length}`,args)).rows;
   const ids=rows.map(p=>p.id),variants=ids.length?(await pool.query('select *,updated_at::text as revision from product_variants where product_id=any($1::text[]) order by created_at,id',[ids])).rows:[];
   return ok(res,{products:rows.map(p=>publicProduct({...p,variants:variants.filter(v=>v.product_id===p.id)},currency)),pagination:{page,limit,total:count,pages:Math.ceil(count/limit)}});
  }catch(e){return fail(res,e.status||500,e.status?e.message:'Could not load seller products.');}
 });
 app.get('/api/seller/products/:id',sellerOnly,async(req,res)=>{try{return ok(res,{product:await readOne(pool,req.params.id,req.session.uid,currency)});}catch(e){return fail(res,e.status||500,e.status?e.message:'Could not load product.');}});
 async function mutate(req,res,create=false,variant=false){
  if(!csrfOk(req))return fail(res,403,'Invalid CSRF token.');const c=await pool.connect();
  try{
   const input=body(req);await c.query('begin');await c.query('select id from sellers where id=$1 for update',[req.seller.id]);
   let parent,current,id=req.params.id;
   if(!create||variant){parent=(await c.query('select *,updated_at::text as revision from products where id=$1 and seller_id=$2 for update',[id,req.session.uid])).rows[0];if(!parent)throw problem('Product not found.',404);current=parent;}
   if(variant&&!create){current=(await c.query('select *,updated_at::text as revision from product_variants where id=$1 and product_id=$2 for update',[req.params.variantId,id])).rows[0];if(!current)throw problem('Variant not found.',404);}
   if(!create)checkVersion(input,current);
   const managed=parent&&(await c.query('select 1 from supplier_products where product_id=$1 limit 1',[id])).rowCount>0;
   if(managed&&(variant||has(input,'stock')))throw problem('Supplier-linked stock and variants are managed by supplier synchronization.',409);
   const v=values(input,create?{}:current,variant);
   if(v.sku){const clash=await c.query('select id from products where seller_id=$1 and sku=$2 and id<>$3',[req.session.uid,v.sku,create&&!variant?'':id]);if(clash.rowCount)throw problem('This SKU is already used by one of your products.',409);}
   if(variant){
    const variantId=create?'sv-'+crypto.randomUUID():req.params.variantId;v.sku=v.sku||variantId;
    if(create)await c.query('insert into product_variants(id,product_id,sku,title,price,old_price,stock,image,active) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[variantId,id,v.sku,v.title,v.price,v.oldPrice,v.stock,v.image,v.active]);
    else await c.query('update product_variants set sku=$2,title=$3,price=$4,old_price=$5,stock=$6,image=$7,active=$8,updated_at=clock_timestamp() where id=$1',[variantId,v.sku,v.title,v.price,v.oldPrice,v.stock,v.image,v.active]);
    await inventory(c,req,id,variantId,create?0:current.stock,v.stock);await c.query('update products set updated_at=clock_timestamp() where id=$1',[id]);await audit(c,req,create?'seller_variant_create':'seller_variant_update',id,{variantId,stock:v.stock,previousStock:create?0:current.stock,active:v.active});
   }else if(create){
    id='s-'+crypto.randomUUID();const slug=(v.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'product')+'-'+id;
    await c.query(`insert into products(id,slug,sku,cat,title,price,old_price,rating,reviews,image,badge,stock,description,currency,seller_id,brand,search_keywords,cost_price,active) values($1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[id,slug,v.sku||id,v.cat,v.title,v.price,v.oldPrice,v.image,v.badge,v.stock,v.description,currency.toUpperCase(),req.session.uid,v.brand,v.searchKeywords,v.costPrice,v.active]);
    await inventory(c,req,id,null,0,v.stock);await audit(c,req,'seller_product_create',id,{stock:v.stock,active:v.active});
   }else{
    await c.query(`update products set sku=$2,cat=$3,title=$4,price=$5,old_price=$6,image=$7,badge=$8,stock=$9,description=$10,brand=$11,search_keywords=$12,cost_price=$13,active=$14,updated_at=clock_timestamp() where id=$1`,[id,v.sku,v.cat,v.title,v.price,v.oldPrice,v.image,v.badge,v.stock,v.description,v.brand,v.searchKeywords,v.costPrice,v.active]);
    await inventory(c,req,id,null,current.stock,v.stock);await audit(c,req,'seller_product_update',id,{stock:v.stock,previousStock:current.stock,active:v.active,fields:Object.keys(input).filter(k=>!k.startsWith('expected'))});
   }
   // Keep the customer gallery's first image aligned with the seller's main image.
   if(!variant&&(create||has(input,'image'))){
    const first=(await c.query('select id from product_images where product_id=$1 order by sort_order,id limit 1',[id])).rows[0];
    if(first)await c.query('update product_images set url=$1,alt=$2 where id=$3',[v.image,v.title,first.id]);
    else await c.query('insert into product_images(product_id,url,alt,sort_order) values($1,$2,$3,0)',[id,v.image,v.title]);
   }
   const product=await readOne(c,id,req.session.uid,currency);await c.query('commit');return res.status(create?201:200).json({ok:true,id,product});
  }catch(e){await c.query('rollback').catch(()=>{});return fail(res,e.status||(e.code==='23505'?409:500),e.status?e.message:e.code==='23505'?'This SKU is already used.':'Could not save product. Please retry.');}finally{c.release();}
 }
 app.post('/api/seller/products',sellerOnly,(req,res)=>mutate(req,res,true));
 app.patch('/api/seller/products/:id',sellerOnly,(req,res)=>mutate(req,res));
 app.post('/api/seller/products/:id/variants',sellerOnly,(req,res)=>mutate(req,res,true,true));
 app.patch('/api/seller/products/:id/variants/:variantId',sellerOnly,(req,res)=>mutate(req,res,false,true));
}
