/** Local design preview: in-memory database, sample products, no real payments. */
import {sellerFixture} from '../tests/seller-fixture.js';
import {pathToFileURL} from 'node:url';
export async function createPreview(options={}){
 const f=await sellerFixture(options);
 await f.pool.query('update products set active=false');
 const items=[
  ['AeroSound wireless headphones','Tech',89.99,119.99,'demo-headphones','Everyday audio, beautifully simple. Soft ear cushions and a comfortable over-ear design.'],
  ['Halo reading lamp','Home',49,65,'demo-lamp','A warm little corner of light for your desk, your books and your evening routine.'],
  ['The everyday carry','Lifestyle',68,0,'demo-bag','A considered everyday bag for the essentials you like to keep close.'],
  ['PureFlow insulated bottle','Home',28,36,'demo-bottle','Made for the daily routine. A reusable bottle for your desk, your commute and beyond.'],
  ['Studio over-ear headphones','Tech',79,99,'category-tech','A simple over-ear silhouette with generous cushioning for everyday listening.'],
  ['The daily backpack','Lifestyle',59,0,'category-lifestyle','Make space for your next adventure with an easy everyday backpack.'],
  ['Morning ritual collection','Beauty',39,52,'category-beauty','Bring a little calm to your bathroom shelf with this everyday care collection.'],
  ['Cloudstep everyday sneakers','Lifestyle',72,89,'demo-sneakers','A bright accent for your everyday. Comfortable shoes for wherever the day takes you.'],
  ['The workspace laptop','Tech',649,799,'collection-tech','A clean, portable workspace for focus, ideas and everyday essentials.'],
  ['A little shelf inspiration','Home',35,0,'category-home','Warm textures and everyday details for a space that feels more like you.'],
  ['The fragrance edit','Beauty',58,0,'demo-fragrance','A thoughtful addition to your daily ritual, presented in a simple glass bottle.'],
  ['Quiet corners collection','Home',125,159,'collection-home','Inspired by natural textures, soft colour and easy living.']
 ];
 for(let n=0;n<60;n++){
  const [title,cat,price,old,image,description]=items[n%items.length];
  const id='preview-'+String(n+1).padStart(3,'0');
  await f.pool.query('insert into products(id,slug,title,cat,price,old_price,rating,reviews,image,badge,stock,description,seller_id) values($1,$1,$2,$3,$4,$5,0,0,$6,$7,$8,$9,$10)',[id,title+(n>=12?' · Edition '+(Math.floor(n/12)+1):''),cat,price,old||null,'/assets/'+image+'.jpg',n===0?'THE EVERYDAY PICK':n<4?'NEW FIND':'',n===59?0:24,description+' This is a sample product in the local design preview.',n<12?f.accounts.alpha.id:null]);
 }
 await f.pool.query("insert into product_images(product_id,url,alt,sort_order) values('preview-001','/assets/demo-headphones.jpg','Wireless headphones',0)");
 await f.pool.query("insert into product_variants(id,product_id,sku,title,price,stock) values('preview-natural','preview-001','DEMO-NATURAL','Natural',89.99,24)");
 await f.pool.query("update users set name='Alex Morgan' where id=$1",[f.accounts.buyer.id]);
 await f.pool.query("update users set is_admin=true,name='Studio Admin' where id=$1",[f.accounts.orphan.id]);
 await f.pool.query("update sellers set store_name='The Everyday Studio' where id=$1",[f.accounts.alpha.sellerId]);
 for(let n=0;n<4;n++)await f.checkout([{id:'preview-'+String(n+1).padStart(3,'0'),qty:1}]);
 return {...f,items};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const f=await createPreview({env:{CURRENCY:process.env.CURRENCY||'USD'}});
 console.log('\nNOVACART FORMA — LOCAL DESIGN PREVIEW\n'+f.base+'\n\nSample products and temporary data. No real charges or emails.\nCustomer: buyer@local.test\nSeller: alpha@local.test\nAdmin: orphan@local.test (Admin tab)\nPassword for preview accounts: '+f.password+'\n\nUse cash on delivery for a sample checkout. Card payments are simulated by the test fixture.\nPress Ctrl+C to close. Data resets when restarted.\n');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await f.close();process.exit(0);});
}
