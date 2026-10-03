import {readFileSync} from 'node:fs';
const template=readFileSync(new URL('../product.html',import.meta.url),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export const productPath=p=>'/p/'+encodeURIComponent(p.slug||p.id);
export async function publicProduct(pool,key,{currency,returnsDays},lookup='id'){
 if(typeof key!=='string'||!key||key.length>512)return null;
 const where=lookup==='slug'?"coalesce(nullif(slug,''),id)=$1":"(id=$1 or slug=$1)";
 const p=(await pool.query(`select id,slug,sku,cat,title,price,old_price as "oldPrice",rating,reviews,image,badge,stock,description,seo_title as "seoTitle",seo_description as "seoDescription" from products where ${where} and active=true order by case when id=$1 then 0 else 1 end limit 1`,[key])).rows[0];
 if(!p)return null;
 const [images,variants]=await Promise.all([
  pool.query('select id,url,alt,sort_order as "sortOrder" from product_images where product_id=$1 order by sort_order,id',[p.id]),
  pool.query('select id,sku,title,price,old_price as "oldPrice",stock,options,image from product_variants where product_id=$1 and active=true order by created_at,id',[p.id])
 ]);
 return {...p,currency:currency.toUpperCase(),returnsDays,canonicalPath:productPath(p),price:Number(p.price),oldPrice:p.oldPrice==null?null:Number(p.oldPrice),rating:Number(p.rating),images:images.rows.length?images.rows:[{id:0,url:p.image,alt:p.title,sortOrder:0}],variants:variants.rows.map(v=>({...v,price:Number(v.price),oldPrice:v.oldPrice==null?null:Number(v.oldPrice)}))};
}
function imageURL(value,base){try{const u=new URL(value,base);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password)return u.href;}catch{}return base+'/assets/image-unavailable.svg';}
export function renderProductPage(product,{base,businessName,reviews=[],related=[]}){
 const p={...product,image:imageURL(product.image,base),images:product.images.map(i=>({...i,url:imageURL(i.url,base)}))};
 const selected=p.variants[0]||p,canonical=base+productPath(p),price=Number(selected.price),stock=Number(selected.stock),old=selected.oldPrice??p.oldPrice;
 const money=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:p.currency}).format(Number(v)||0);
 const schema={'@context':'https://schema.org','@type':'Product',name:p.title,image:p.images.map(i=>i.url),description:p.description,sku:p.sku||p.id,...(p.reviews>0?{aggregateRating:{'@type':'AggregateRating',ratingValue:p.rating,reviewCount:p.reviews}}:{}),offers:{'@type':'Offer',price:price.toFixed(2),priceCurrency:p.currency,availability:stock>0?'https://schema.org/InStock':'https://schema.org/OutOfStock',url:canonical}};
 let html=template.replace(/<title>[\s\S]*?<\/title>/,()=>`<title>${esc(p.seoTitle||p.title+' — '+businessName)}</title>`).replace(/<meta name="description"[^>]*>/,()=>`<meta name="description" content="${esc(p.seoDescription||p.description)}">`).replace('<body class="product-page"','<body class="product-page product-server-rendered"');
 const content=(id,value)=>{const re=new RegExp('<([a-z0-9]+)([^>]*\\bid="'+id+'"[^>]*)>[\\s\\S]*?<\\/\\1>');if(!re.test(html))throw new Error('Missing product template target: '+id);html=html.replace(re,(_,tag,attrs)=>'<'+tag+attrs+'>'+value+'</'+tag+'>');};
 const text=(id,value)=>content(id,esc(value));
 for(const [id,value] of Object.entries({crumbCat:p.cat,crumbTitle:p.title,detailCat:p.cat.toUpperCase(),detailTitle:p.title,detailBadge:p.badge||'NOVA PICK',detailRating:p.reviews>0?p.rating.toFixed(1):'No reviews yet',detailReviews:p.reviews>0?p.reviews+' reviews':'Be the first',detailStars:p.reviews>0?'★'.repeat(Math.min(5,Math.round(p.rating))):'',detailPrice:money(price),detailOldPrice:old?money(old):'',detailDiscount:old>price?Math.round((1-price/old)*100)+'% OFF':'',detailDescription:p.description,longCopy:p.description,stockText:stock>0?'In stock':'Out of stock',stockDetail:stock>0?stock+' available · Ready to dispatch':'Currently unavailable',variantLabel:p.variants[0]?.title||'Standard',reviewScore:p.reviews>0?p.rating.toFixed(1):'—',reviewCount:p.reviews+' approved reviews',imageCounter:'1 / '+p.images.length}))text(id,value);
 content('variantRow',p.variants.length?p.variants.map((v,i)=>`<button class="variant-btn ${i===0?'active':''}" data-variant-id="${esc(v.id)}">${esc(v.title)}</button>`).join(''):'<span class="variant-note">Standard selection</span>');
 content('specGrid',[['Category',p.cat],['SKU',selected.sku||p.sku||'—'],['Availability',stock+' available'],['Returns',p.returnsDays+' days where eligible']].map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join(''));
 const reviewsHTML=reviews.length?reviews.map(r=>`<article class="review-card"><div class="review-top"><b>${esc(r.title||'Verified purchase')}</b><span>${'★'.repeat(Math.min(5,Math.max(0,Number(r.rating))))}</span></div><p>${esc(r.body)}</p><small>${esc(r.name||'Verified buyer')}</small></article>`).join(''):'<div class="empty-reviews">No approved reviews yet. Verified buyers can leave the first one.</div>';
 content('reviewGrid',reviewsHTML);content('reviews','<p>See customer reviews below.</p>');
 content('relatedGrid',related.map(r=>`<a class="related-card" href="${esc(productPath(r))}"><div class="related-img"><img src="${esc(imageURL(r.image,base))}" alt="${esc(r.title)}" loading="lazy"></div><span>${esc(r.cat)}</span><h3>${esc(r.title)}</h3><div><strong>${esc(money(r.price))}</strong></div></a>`).join(''));
 for(const [id,src,alt] of [['mainProductImage',p.images[0].url,p.title],...Array.from({length:4},(_,i)=>['thumb'+i,p.images[i]?.url||p.image,p.images[i]?.alt||p.title])]){
  const re=new RegExp('<img\\b[^>]*\\bid="'+id+'"[^>]*>');html=html.replace(re,tag=>tag.replace(/\s(?:src|alt)="[^"]*"/g,'').replace(/>$/,()=>` src="${esc(src)}" alt="${esc(alt)}">`));
 }
 for(let i=p.images.length;i<4;i++)html=html.replace(new RegExp('<button([^>]*data-view="'+i+'"[^>]*)>'),(_,attrs)=>'<button'+attrs+' style="display:none">');
 html=html.replace(/<button\b/g,'<button disabled data-needs-js');
 html=html.replace('</head>',()=>`<link rel="canonical" href="${esc(canonical)}"><meta property="og:type" content="product"><meta property="og:url" content="${esc(canonical)}"><meta property="og:title" content="${esc(p.seoTitle||p.title)}"><meta property="og:description" content="${esc(p.seoDescription||p.description)}"><meta property="og:image" content="${esc(p.images[0].url)}"><meta name="twitter:card" content="summary_large_image"><script id="productStructuredData" type="application/ld+json">${json(schema)}</script></head>`);
 html=html.replace('<script src="/product.js"></script>',()=>`<script id="productBootstrap" type="application/json">${json({product:p,related,canonical,title:p.seoTitle||p.title+' — '+businessName})}</script><script src="/product.js"></script>`);
 return html;
}
